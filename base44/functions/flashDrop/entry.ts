import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { action } = body;

  // ── CREATE FLASH DROP ─────────────────────────────────────────────────────
  if (action === 'create') {
    const { event_id, section, row, seats, quantity, is_anonymous, donor_message, drop_type, scheduled_label, scheduled_at, entry_window_seconds, source_purchase_id } = body;
    if (!event_id || !section) return Response.json({ error: 'event_id and section required' }, { status: 400 });

    const events = await base44.asServiceRole.entities.Event.filter({ id: event_id });
    const event = events[0];
    const windowSecs = Math.min(90, Math.max(30, entry_window_seconds || 60));

    let status = 'pending';
    let entry_opens_at = null;
    let entry_closes_at = null;

    if (drop_type === 'immediate') {
      const now = new Date();
      entry_opens_at = now.toISOString();
      entry_closes_at = new Date(now.getTime() + windowSecs * 1000).toISOString();
      status = 'active';
    }

    const drop = await base44.entities.FlashDrop.create({
      event_id,
      event_title: event?.title || '',
      donor_email: user.email,
      donor_name: is_anonymous ? null : (user.full_name || user.email),
      is_anonymous: is_anonymous || false,
      section,
      row: row || null,
      seats: seats || null,
      quantity: quantity || 1,
      donor_message: donor_message || null,
      drop_type: drop_type || 'immediate',
      scheduled_label: scheduled_label || null,
      scheduled_at: scheduled_at || null,
      entry_window_seconds: windowSecs,
      status,
      entry_opens_at,
      entry_closes_at,
      entry_count: 0,
      source_purchase_id: source_purchase_id || null,
      metrics: { views: 0, entries: 0, loser_upgrade_clicks: 0, loser_purchases: 0 },
    });

    return Response.json({ success: true, drop });
  }

  // ── ENTER A FLASH DROP ────────────────────────────────────────────────────
  if (action === 'enter') {
    const { flash_drop_id } = body;
    if (!flash_drop_id) return Response.json({ error: 'flash_drop_id required' }, { status: 400 });

    const drops = await base44.asServiceRole.entities.FlashDrop.filter({ id: flash_drop_id });
    const drop = drops[0];
    if (!drop) return Response.json({ error: 'Flash drop not found' }, { status: 404 });
    if (drop.status !== 'active') return Response.json({ error: 'Entry window is closed', status: drop.status }, { status: 409 });

    // Check window is still open
    if (drop.entry_closes_at && new Date() > new Date(drop.entry_closes_at)) {
      return Response.json({ error: 'Entry window has expired' }, { status: 409 });
    }

    // Check donor can't enter their own drop
    if (drop.donor_email === user.email) {
      return Response.json({ error: 'You cannot enter your own Flash Drop' }, { status: 403 });
    }

    // Dedup check
    const existing = await base44.asServiceRole.entities.FlashDropEntry.filter({ flash_drop_id, entrant_email: user.email });
    if (existing.length > 0) return Response.json({ error: 'Already entered', entry: existing[0] }, { status: 409 });

    const entry = await base44.entities.FlashDropEntry.create({
      flash_drop_id,
      event_id: drop.event_id,
      entrant_email: user.email,
      entrant_name: user.full_name || user.email,
      entered_at: new Date().toISOString(),
      is_winner: false,
      loser_action: 'none',
    });

    // Increment entry_count
    await base44.asServiceRole.entities.FlashDrop.update(flash_drop_id, {
      entry_count: (drop.entry_count || 0) + 1,
    });

    return Response.json({ success: true, entry });
  }

  // ── CLOSE DROP + SELECT WINNER ────────────────────────────────────────────
  if (action === 'close_and_pick') {
    const { flash_drop_id } = body;
    const drops = await base44.asServiceRole.entities.FlashDrop.filter({ id: flash_drop_id });
    const drop = drops[0];
    if (!drop) return Response.json({ error: 'Not found' }, { status: 404 });

    // Verify user is donor or admin
    if (drop.donor_email !== user.email && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const entries = await base44.asServiceRole.entities.FlashDropEntry.filter({ flash_drop_id });
    if (entries.length === 0) {
      await base44.asServiceRole.entities.FlashDrop.update(flash_drop_id, { status: 'expired' });
      return Response.json({ success: true, winner: null, no_entries: true });
    }

    // Random winner
    const winner = entries[Math.floor(Math.random() * entries.length)];

    await Promise.all([
      base44.asServiceRole.entities.FlashDrop.update(flash_drop_id, {
        status: 'winner_selected',
        winner_email: winner.entrant_email,
        winner_name: winner.entrant_name,
        winner_selected_at: new Date().toISOString(),
        entry_count: entries.length,
      }),
      base44.asServiceRole.entities.FlashDropEntry.update(winner.id, { is_winner: true }),
    ]);

    // Fire winner notification
    base44.asServiceRole.functions.invoke('recordNotification', {
      user_email: winner.entrant_email,
      type: 'donation_won',
      title: '🎁 You won a Flash Drop!',
      body: `Section ${drop.section}${drop.row ? ` Row ${drop.row}` : ''} — ${drop.event_title}`,
      reference_id: flash_drop_id,
      reference_type: 'donation',
      icon: '🎁',
    }).catch(() => {});

    return Response.json({ success: true, winner: { email: winner.entrant_email, name: winner.entrant_name }, entry_count: entries.length });
  }

  // ── ACTIVATE SCHEDULED DROP ───────────────────────────────────────────────
  if (action === 'activate_scheduled') {
    const { flash_drop_id } = body;
    if (user.role !== 'admin' && !body._system) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const drops = await base44.asServiceRole.entities.FlashDrop.filter({ id: flash_drop_id });
    const drop = drops[0];
    if (!drop) return Response.json({ error: 'Not found' }, { status: 404 });

    const now = new Date();
    const closes = new Date(now.getTime() + (drop.entry_window_seconds || 60) * 1000);
    await base44.asServiceRole.entities.FlashDrop.update(flash_drop_id, {
      status: 'active',
      entry_opens_at: now.toISOString(),
      entry_closes_at: closes.toISOString(),
    });

    return Response.json({ success: true, entry_closes_at: closes.toISOString() });
  }

  // ── TRACK LOSER ACTION ────────────────────────────────────────────────────
  if (action === 'track_loser_action') {
    const { flash_drop_id, loser_action } = body;
    const entries = await base44.asServiceRole.entities.FlashDropEntry.filter({ flash_drop_id, entrant_email: user.email });
    if (entries[0]) {
      await base44.asServiceRole.entities.FlashDropEntry.update(entries[0].id, { loser_action });
    }
    return Response.json({ success: true });
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 });
});