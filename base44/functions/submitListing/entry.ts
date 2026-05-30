import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

async function checkSuspicious(base44, sellerEmail, askingPrice) {
  const [purchases, allListings, sellerUsers] = await Promise.all([
    base44.asServiceRole.entities.Purchase.filter({ seller_email: sellerEmail }),
    base44.asServiceRole.entities.Listing.filter({ seller_email: sellerEmail }),
    base44.asServiceRole.entities.User.filter({ email: sellerEmail }),
  ]);
  const seller = sellerUsers[0];
  if (seller && (seller.strike_count || 0) > 0) return { flagged: true, reason: `Seller has ${seller.strike_count} strike(s)` };
  const disputed = purchases.filter(p => p.transfer_status === 'disputed');
  if (disputed.length > 0) return { flagged: true, reason: `Seller has ${disputed.length} prior dispute(s)` };
  const expired = purchases.filter(p => p.transfer_status === 'expired' && !p.seller_confirmed);
  if (expired.length >= 3) return { flagged: true, reason: `Seller has ${expired.length} failed transfers` };
  const activeListings = allListings.filter(l => l.status === 'active');
  if (activeListings.length >= 10) return { flagged: true, reason: `Seller has ${activeListings.length} active listings (possible spam)` };
  if (askingPrice > 2000) return { flagged: true, reason: `Asking price $${askingPrice} is unusually high` };
  return { flagged: false, reason: null };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const askingPrice = parseFloat(body.asking_price) || 0;
  const optimisticId = body.optimistic_id;
  const isAdmin = user.role === 'admin';
  const isTest = body.is_test === true;

  if (!isAdmin) {
    const freshUsers = await base44.asServiceRole.entities.User.filter({ email: user.email });
    const freshUser = freshUsers[0];
    const onboardingComplete = freshUser?.stripe_onboarding_complete === true || freshUser?.stripe_onboarding_complete === 'true';
    if (!onboardingComplete) {
      return Response.json({ error: 'Connect your payout account before listing tickets.' }, { status: 403 });
    }
  }

  // ── SeatInventory conflict check ─────────────────────────────────────────
  // Block if this seat already has an active Flash Drop
  if (!isAdmin && !isTest) {
    const existingInv = await base44.asServiceRole.entities.SeatInventory.filter({
      owner_email: user.email,
      event_id: body.event_id,
    }).then(all => all.find(inv =>
      inv.section?.toLowerCase() === body.section?.toLowerCase() &&
      (!body.row || !inv.row || inv.row?.toLowerCase() === body.row?.toLowerCase()) &&
      !['cancelled', 'transferred'].includes(inv.inventory_status)
    )).catch(() => null);

    if (existingInv) {
      const blocking = {
        in_flash_drop: 'This seat is already in an active Flash Drop. Cancel or let it expire before listing for sale.',
        reserved_for_purchase: 'This seat is reserved for an active purchase.',
        claimed_by_winner: 'This seat was already claimed by a Flash Drop winner.',
      };
      if (blocking[existingInv.inventory_status]) {
        return Response.json({ error: blocking[existingInv.inventory_status], code: 'INVENTORY_CONFLICT' }, { status: 409 });
      }
    }
  }

  const { flagged, reason } = isAdmin || isTest
    ? { flagged: false, reason: null }
    : await checkSuspicious(base44, user.email, askingPrice);

  // Proof duplicate check
  let proofDuplicate = false;
  if (body.proof_url && !isAdmin && !isTest) {
    const existingWithProof = await base44.asServiceRole.entities.Listing.filter({ proof_url: body.proof_url }).catch(() => []);
    const otherSellerMatches = existingWithProof.filter(l => l.seller_email !== user.email);
    if (otherSellerMatches.length > 0) proofDuplicate = true;
  }

  const now = new Date().toISOString();
  const hasScreenshot = !!(body.transfer_attestation_proof_url);
  const verificationMethod = hasScreenshot ? 'screenshot_verified' : 'seller_attestation';
  const confidenceScore = hasScreenshot ? 75 : 55;

  const listing = await base44.entities.Listing.create({
    event_id: body.event_id,
    seller_email: user.email,
    section: body.section,
    row: body.row,
    seats: body.seats || undefined,
    quantity: body.quantity || 1,
    tier: body.tier || undefined,
    asking_price: askingPrice,
    original_price: body.original_price || undefined,
    transfer_method: body.transfer_method || 'email_transfer',
    proof_url: body.proof_url || undefined,
    proof_status: (flagged || proofDuplicate) ? 'pending_review' : 'approved',
    proof_rejection_reason: flagged ? reason : proofDuplicate ? 'Duplicate proof image detected — requires manual review' : undefined,
    status: 'active',
    notes: (isAdmin || isTest) ? '[TEST] Admin/demo listing' : undefined,
    last_transfer_verification: now,
    transfer_status: 'transfer_confirmed',
    transfer_verification_method: verificationMethod,
    transfer_verification_proof_url: body.transfer_attestation_proof_url || undefined,
    transfer_confidence_score: confidenceScore,
    transfer_verified_by: user.email,
    transfer_platform: body.transfer_source || undefined,
  });

  // ── Create/update SeatInventory for this listing ─────────────────────────
  if (!isTest) {
    base44.asServiceRole.entities.SeatInventory.filter({ owner_email: user.email, event_id: body.event_id })
      .then(async (allInv) => {
        const existingInv = allInv.find(inv =>
          inv.section?.toLowerCase() === body.section?.toLowerCase() &&
          (!body.row || !inv.row || inv.row?.toLowerCase() === body.row?.toLowerCase()) &&
          !['cancelled', 'transferred'].includes(inv.inventory_status)
        );

        const invData = {
          event_id: body.event_id,
          owner_email: user.email,
          owner_name: user.full_name || user.email,
          section: body.section,
          row: body.row || null,
          seats: body.seats || null,
          quantity: body.quantity || 1,
          inventory_status: 'listed_for_sale',
          inventory_intent: 'sell',
          source_type: 'listing',
          ownership_verified: hasScreenshot,
          ownership_verification_method: hasScreenshot ? 'transfer_capability' : null,
          ownership_verified_at: hasScreenshot ? now : null,
          transfer_verified: true,
          transfer_status: 'transfer_confirmed',
          last_transfer_verification: now,
          linked_listing_id: listing.id,
        };

        if (existingInv) {
          await base44.asServiceRole.entities.SeatInventory.update(existingInv.id, invData);
          // Also backlink seat_inventory_id onto the listing
          await base44.asServiceRole.entities.Listing.update(listing.id, { seat_inventory_id: existingInv.id });
        } else {
          const inv = await base44.asServiceRole.entities.SeatInventory.create(invData);
          await base44.asServiceRole.entities.Listing.update(listing.id, { seat_inventory_id: inv.id });
        }
      }).catch(err => console.error('[submitListing] SeatInventory error:', err?.message));
  }

  // Fire-and-forget: TransferVerificationLog
  base44.asServiceRole.entities.Event.filter({ id: body.event_id }).then(events => {
    const event = events[0];
    const eventStartMs = event?.event_start_utc ? new Date(event.event_start_utc).getTime() : event?.date ? new Date(event.date).getTime() : null;
    const minutesSinceStart = eventStartMs ? Math.round((Date.now() - eventStartMs) / 60000) : null;
    base44.asServiceRole.entities.TransferVerificationLog.create({
      listing_id: listing.id,
      event_id: body.event_id,
      seller_email: user.email,
      platform: body.transfer_source || undefined,
      verification_timestamp: now,
      transfer_available: true,
      verification_method: verificationMethod,
      event_start_utc: event?.event_start_utc || event?.date || undefined,
      minutes_since_event_start: minutesSinceStart,
      venue: event?.venue || undefined,
      city: event?.city || undefined,
      event_title: event?.title || undefined,
      has_screenshot: hasScreenshot,
      confidence_score: confidenceScore,
    }).catch(err => console.error('[submitListing] TransferVerificationLog failed:', err?.message));
  }).catch(err => console.error('[submitListing] event fetch failed:', err?.message));

  // Mark SeatInventory available when listing is cancelled (handled separately via listing status changes)

  return Response.json({ listing, flagged, flag_reason: reason, optimistic_id: optimisticId });
});