/**
 * migrateSensitiveData — admin-only, idempotent, copy-only migration.
 *
 * CORRECTED RUN 2:
 *  - Apply mode (confirm=true) returns 409 UNLESS maintenance is active.
 *  - Server-side pagination via the SDK's positional `skip` argument with a
 *    unique `id` ascending sort (deterministic total order; $gt/$or keyset
 *    cursors are NOT supported by the SDK filter on string fields — verified at
 *    runtime, $gt returns 0 on created_date and id). Cursor = per-source
 *    { offset, last_id }. Returns next_cursor, has_more, processed, remaining.
 *  - MigrationRun durable claim: unique apply_request_id, rejects concurrent
 *    and replayed apply requests, records started/completed + per-source cursor
 *    + counts.
 *  - PublicProfile no longer stores/returns user_id; the user_id ↔
 *    public_profile_id mapping lives only in UserPrivate.
 *  - Report splits created / already_migrated / actual_duplicates (>1 sidecar
 *    per source) / failed / processed / remaining. One existing sidecar is
 *    already_migrated, NOT a duplicate.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { isMaintenanceActive } from '../../shared/maintenance.ts';

const MIGRATION_VERSION = 3;

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  let user;
  try { user = await base44.auth.me(); } catch (_) { return Response.json({ error: 'Unauthorized' }, { status: 401 }); }
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const confirm = body?.confirm === true;
  const batchLimit = Math.min(500, Math.max(1, Number(body?.batch_limit) || 200));
  const resumeAfter = body?.resume_after || {};
  const sources = body?.sources || ['listing', 'purchase', 'user'];

  // ── Apply gate: maintenance must be active ──────────────────────────────
  if (confirm && !isMaintenanceActive()) {
    return Response.json({ error: 'Apply mode requires maintenance mode to be active', code: 'MAINTENANCE_REQUIRED' }, { status: 409 });
  }

  // ── MigrationRun durable claim (apply only) ─────────────────────────────
  let run = null;
  if (confirm) {
    const apply_request_id = body?.apply_request_id;
    if (!apply_request_id) return Response.json({ error: 'apply_request_id required for apply mode' }, { status: 400 });
    const byReq = await base44.asServiceRole.entities.MigrationRun.filter({ apply_request_id });
    if (byReq.length > 0) {
      return Response.json({ error: 'Replayed apply request rejected', code: 'REPLAY', existing_status: byReq[0].status }, { status: 409 });
    }
    const inProgress = await base44.asServiceRole.entities.MigrationRun.filter({ status: 'in_progress' });
    if (inProgress.length > 0) {
      return Response.json({ error: 'A migration apply run is already in progress', code: 'CONCURRENT', run_id: inProgress[0].id }, { status: 409 });
    }
    run = await base44.asServiceRole.entities.MigrationRun.create({
      apply_request_id, status: 'in_progress', mode: 'apply', started_at: new Date().toISOString(),
      cursors: resumeAfter, counts: {}, migration_version: MIGRATION_VERSION,
    });
  }

  const perSource = {};
  const totals = { created: 0, already_migrated: 0, actual_duplicates: 0, failed: 0, processed: 0, remaining: 0 };
  const missing_keys = [];
  const unsafe_fields = [];
  const next_cursors = {};

  // Server-side paginated fetch: unique `id` ascending sort + positional skip.
  const fetchPage = (entity, offset) => base44.asServiceRole.entities[entity].filter({}, 'id', batchLimit, offset);
  const countAll = (entity) => base44.asServiceRole.entities[entity].filter({}, 'id', 10000);

  // ── Listing → ListingPrivate + ProofAsset(legacy) ───────────────────────
  if (sources.includes('listing')) {
    const offset = Number(resumeAfter.listing?.offset) || 0;
    const total = (await countAll('Listing')).length;
    const page = await fetchPage('Listing', offset);
    const acc = { created: 0, already: 0, dups: 0, failed: 0 };

    const privAll = await base44.asServiceRole.entities.ListingPrivate.filter({}, 'id', 10000);
    const privCount = new Map();
    for (const p of privAll) privCount.set(p.listing_id, (privCount.get(p.listing_id) || 0) + 1);
    const proofAll = await base44.asServiceRole.entities.ProofAsset.filter({ reference_type: 'listing' }, 'id', 10000);
    const proofKeys = new Set(proofAll.map(p => `${p.reference_id}|${p.legacy_public_url}`));

    for (const l of page) {
      if (!l.id) { missing_keys.push({ entity: 'Listing', field: 'id' }); continue; }
      const cnt = privCount.get(l.id) || 0;
      if (cnt > 1) acc.dups++;
      else if (cnt === 1) acc.already++;
      else {
        acc.created++;
        if (confirm) {
          try {
            await base44.asServiceRole.entities.ListingPrivate.create({
              listing_id: l.id, event_id: l.event_id, seller_email: l.seller_email,
              section: l.section, row: l.row, seats: l.seats, quantity: l.quantity,
              proof_url: l.proof_url, proof_status: l.proof_status, proof_rejection_reason: l.proof_rejection_reason,
              ticket_file_url: l.ticket_file_url, reservation_token: l.reservation_token,
              reservation_expires_at: l.reservation_expires_at, reserved_by_email: l.reserved_by_email,
              reservation_revision: l.reservation_revision,
              transfer_verification_proof_url: l.transfer_verification_proof_url, transfer_verified_by: l.transfer_verified_by,
              transfer_verified_notes: l.transfer_verified_notes, pg_transfer_proof_url: l.pg_transfer_proof_url,
              pg_transfer_notes: l.pg_transfer_notes, pg_fulfilled_at: l.pg_fulfilled_at, pg_fulfilled_by: l.pg_fulfilled_by,
              seller_ownership_confirmed: l.seller_ownership_confirmed, limited_transfer_authorization: l.limited_transfer_authorization,
              ticket_custody_status: l.ticket_custody_status, custody_received_at: l.custody_received_at,
              buyer_delivered_at: l.buyer_delivered_at, returned_to_seller_at: l.returned_to_seller_at,
              transfer_failure_reason: l.transfer_failure_reason, seller_release_deadline: l.seller_release_deadline,
              custody_status: l.custody_status, seat_inventory_id: l.seat_inventory_id,
              is_demo_listing: l.is_demo_listing, notes: l.notes,
              migration_version: MIGRATION_VERSION, migrated_at: new Date().toISOString(),
            });
          } catch (e) { acc.failed++; }
        }
      }
      for (const [proof_type, url] of [['listing_proof', l.proof_url], ['transfer_attestation', l.transfer_verification_proof_url], ['ownership_proof', l.ticket_file_url], ['pg_custody_proof', l.pg_transfer_proof_url]]) {
        if (!url) continue;
        const key = `${l.id}|${url}`;
        if (proofKeys.has(key)) continue;
        unsafe_fields.push({ entity: 'Listing', listing_id: l.id, field: proof_type, reason: 'public URL → ProofAsset requires_private_reupload' });
        if (confirm) {
          try {
            await base44.asServiceRole.entities.ProofAsset.create({
              owner_email: l.seller_email, reference_type: 'listing', reference_id: l.id, proof_type,
              private_file_id: null, storage_uri: null, content_type: null, checksum: null,
              scan_status: 'pending', uploaded_at: new Date().toISOString(),
              legacy_public_url: url, migration_status: 'requires_private_reupload',
            });
          } catch (e) { /* legacy proof failure */ }
        }
      }
    }
    const processed = page.length;
    const hasMore = offset + processed < total;
    next_cursors.listing = { offset: offset + processed, last_id: page.length ? page[page.length - 1].id : null };
    perSource.listing = { total, processed, remaining: total - (offset + processed), has_more: hasMore, next_cursor: next_cursors.listing, created: acc.created, already_migrated: acc.already, actual_duplicates: acc.dups, failed: acc.failed };
    totals.created += acc.created; totals.already_migrated += acc.already; totals.actual_duplicates += acc.dups; totals.failed += acc.failed; totals.processed += processed; totals.remaining += perSource.listing.remaining;
  }

  // ── Purchase → PurchasePrivate + ProofAsset(legacy) ────────────────────
  if (sources.includes('purchase')) {
    const offset = Number(resumeAfter.purchase?.offset) || 0;
    const total = (await countAll('Purchase')).length;
    const page = await fetchPage('Purchase', offset);
    const acc = { created: 0, already: 0, dups: 0, failed: 0 };

    const privAll = await base44.asServiceRole.entities.PurchasePrivate.filter({}, 'id', 10000);
    const privCount = new Map();
    for (const p of privAll) privCount.set(p.purchase_id, (privCount.get(p.purchase_id) || 0) + 1);
    const proofAll = await base44.asServiceRole.entities.ProofAsset.filter({ reference_type: 'purchase' }, 'id', 10000);
    const proofKeys = new Set(proofAll.map(p => `${p.reference_id}|${p.legacy_public_url}`));

    for (const p of page) {
      if (!p.id) { missing_keys.push({ entity: 'Purchase', field: 'id' }); continue; }
      const cnt = privCount.get(p.id) || 0;
      if (cnt > 1) acc.dups++;
      else if (cnt === 1) acc.already++;
      else {
        acc.created++;
        if (confirm) {
          try {
            await base44.asServiceRole.entities.PurchasePrivate.create({
              purchase_id: p.id, listing_id: p.listing_id, event_id: p.event_id,
              buyer_email: p.buyer_email, buyer_name: p.buyer_name, seller_email: p.seller_email,
              payment_intent_id: p.payment_intent_id, reservation_token: p.reservation_token,
              buyer_phone: p.buyer_phone, authorization_confirmed_at: p.authorization_confirmed_at,
              seller_notified_at: p.seller_notified_at, seller_push_status: p.seller_push_status,
              seller_email_status: p.seller_email_status, payment_captured: p.payment_captured, payment_capture_failed: p.payment_capture_failed,
              transfer_proof_url: p.transfer_proof_url, dispute_reason: p.dispute_reason,
              buyer_lat: p.buyer_lat, buyer_lng: p.buyer_lng, location_verified: p.location_verified,
              reminder_flags: p.reminder_flags, auto_review_flagged: p.auto_review_flagged,
              auto_review_flagged_at: p.auto_review_flagged_at, false_claim_recorded: p.false_claim_recorded,
              fulfillment_status: p.fulfillment_status, fulfillment_proof_url: p.fulfillment_proof_url,
              fulfillment_notes: p.fulfillment_notes, fulfillment_started_at: p.fulfillment_started_at,
              fulfillment_completed_at: p.fulfillment_completed_at,
              ai_proof_status: p.ai_proof_status, ai_confidence_score: p.ai_confidence_score,
              ai_review_notes: p.ai_review_notes, ai_detected_platform: p.ai_detected_platform,
              ai_extracted_event_name: p.ai_extracted_event_name, ai_extracted_recipient: p.ai_extracted_recipient,
              ai_extracted_transfer_time: p.ai_extracted_transfer_time, ai_extracted_section: p.ai_extracted_section,
              ai_extracted_row: p.ai_extracted_row, ai_extracted_seats: p.ai_extracted_seats,
              ai_flags: p.ai_flags, ai_processed_at: p.ai_processed_at, ai_processed_by_model: p.ai_processed_by_model,
              fraud_risk_score: p.fraud_risk_score,
              admin_override_status: p.admin_override_status, admin_override_reason: p.admin_override_reason,
              admin_override_by: p.admin_override_by, admin_override_at: p.admin_override_at,
              is_demo: p.is_demo, migration_version: MIGRATION_VERSION, migrated_at: new Date().toISOString(),
            });
          } catch (e) { acc.failed++; }
        }
      }
      for (const [proof_type, url] of [['transfer_proof', p.transfer_proof_url], ['pg_custody_proof', p.fulfillment_proof_url]]) {
        if (!url) continue;
        const key = `${p.id}|${url}`;
        if (proofKeys.has(key)) continue;
        unsafe_fields.push({ entity: 'Purchase', purchase_id: p.id, field: proof_type, reason: 'public URL → ProofAsset requires_private_reupload' });
        if (confirm) {
          try {
            await base44.asServiceRole.entities.ProofAsset.create({
              owner_email: p.seller_email, reference_type: 'purchase', reference_id: p.id, proof_type,
              private_file_id: null, storage_uri: null, content_type: null, checksum: null,
              scan_status: 'pending', uploaded_at: new Date().toISOString(),
              legacy_public_url: url, migration_status: 'requires_private_reupload',
            });
          } catch (e) { /* legacy proof failure */ }
        }
      }
    }
    const processed = page.length;
    const hasMore = offset + processed < total;
    next_cursors.purchase = { offset: offset + processed, last_id: page.length ? page[page.length - 1].id : null };
    perSource.purchase = { total, processed, remaining: total - (offset + processed), has_more: hasMore, next_cursor: next_cursors.purchase, created: acc.created, already_migrated: acc.already, actual_duplicates: acc.dups, failed: acc.failed };
    totals.created += acc.created; totals.already_migrated += acc.already; totals.actual_duplicates += acc.dups; totals.failed += acc.failed; totals.processed += processed; totals.remaining += perSource.purchase.remaining;
  }

  // ── User → UserSecurityProfile + PublicProfile + UserPrivate ────────────
  if (sources.includes('user')) {
    const offset = Number(resumeAfter.user?.offset) || 0;
    const total = (await countAll('User')).length;
    const page = await fetchPage('User', offset);
    const acc = { created: 0, already: 0, dups: 0, failed: 0 };

    const secAll = await base44.asServiceRole.entities.UserSecurityProfile.filter({}, 'id', 10000);
    const secCount = new Map();
    for (const s of secAll) secCount.set(s.user_id, (secCount.get(s.user_id) || 0) + 1);
    const privAll = await base44.asServiceRole.entities.UserPrivate.filter({}, 'id', 10000);
    const privByEmail = new Map();
    const privCountByEmail = new Map();
    for (const p of privAll) { privByEmail.set(p.user_email, p); privCountByEmail.set(p.user_email, (privCountByEmail.get(p.user_email) || 0) + 1); }
    const pubAll = await base44.asServiceRole.entities.PublicProfile.filter({}, 'id', 10000);
    const pubCountById = new Map();
    for (const p of pubAll) pubCountById.set(p.public_profile_id, (pubCountById.get(p.public_profile_id) || 0) + 1);

    for (const u of page) {
      if (!u.id) { missing_keys.push({ entity: 'User', field: 'id' }); continue; }
      const email = u.email;
      if (!email) { missing_keys.push({ entity: 'User', id: u.id, field: 'email' }); continue; }

      const secDup = (secCount.get(u.id) || 0) > 1;
      const privDup = (privCountByEmail.get(email) || 0) > 1;
      const privExisting = privByEmail.get(email);
      const pubDup = privExisting?.public_profile_id ? (pubCountById.get(privExisting.public_profile_id) || 0) > 1 : false;
      if (secDup || privDup || pubDup) acc.dups++;

      const secExists = secCount.has(u.id);
      if (secExists) acc.already++;
      else { acc.created++; if (confirm) { try { await base44.asServiceRole.entities.UserSecurityProfile.create({
        user_id: u.id, user_email: email, stripe_account_id: u.stripe_account_id, stripe_onboarding_complete: u.stripe_onboarding_complete,
        peanut_points: u.peanut_points, lifetime_points: u.lifetime_points, points_last_updated: u.points_last_updated,
        trust_score: u.trust_score, seller_transfer_reliability: u.seller_transfer_reliability,
        transfer_success_count: u.transfer_success_count, transfer_fail_count: u.transfer_fail_count,
        transfer_expired_count: u.transfer_expired_count, transfer_false_claim_count: u.transfer_false_claim_count,
        strike_count: u.strike_count, confirmed_fraud_count: u.confirmed_fraud_count, false_dispute_count: u.false_dispute_count,
        total_purchases: u.total_purchases, total_sales: u.total_sales, total_instant_listings: u.total_instant_listings,
        total_live_upgrades: u.total_live_upgrades, total_fast_transfers: u.total_fast_transfers, total_disputes: u.total_disputes,
        total_failed_transfers: u.total_failed_transfers, total_cancelled_sales: u.total_cancelled_sales, total_donations_made: u.total_donations_made,
        seller_streak: u.seller_streak, last_pi_attempt_at: u.last_pi_attempt_at, pi_attempt_count: u.pi_attempt_count,
        admin_flags: [], internal_risk_notes: null, migration_version: MIGRATION_VERSION, migrated_at: new Date().toISOString(),
      }); } catch (e) { acc.failed++; } } }

      const pubId = privExisting?.public_profile_id;
      const pubExists = pubId && pubCountById.has(pubId);
      if (privExisting && pubExists) { /* already migrated for pub+priv */ }
      else {
        acc.created++;
        if (confirm) {
          const newPubId = pubId || `pp_${crypto.randomUUID()}`;
          try {
            if (privExisting && !pubId) {
              await base44.asServiceRole.entities.UserPrivate.update(privExisting.id, { public_profile_id: newPubId });
            } else if (!privExisting) {
              await base44.asServiceRole.entities.UserPrivate.create({
                user_id: u.id, user_email: email, public_profile_id: newPubId, phone: null,
                has_seen_onboarding: u.has_seen_onboarding, points_last_updated: u.points_last_updated,
                referred_by: u.referred_by, preferences: {}, updated_at: new Date().toISOString(),
              });
            }
            if (!pubExists) {
              await base44.asServiceRole.entities.PublicProfile.create({
                public_profile_id: newPubId, display_name: u.full_name || u.persona_name || null,
                avatar_url: u.avatar_url, banner_url: u.banner_url, bio: u.bio, persona_name: u.persona_name,
                persona_style: u.persona_style, verified_fan: u.verified_fan, is_founding_fan: u.is_founding_fan,
                peanut_level: u.peanut_level, peanut_rank: u.peanut_rank, trust_badges: u.trust_badges,
                achievements: u.achievements, public_trust_summary: null, referral_code: u.referral_code,
                updated_at: new Date().toISOString(),
              });
            }
          } catch (e) { acc.failed++; }
        }
      }
      unsafe_fields.push({ entity: 'User', user_id: u.id, field: 'email/stripe_account_id', reason: 'never copied to PublicProfile' });
    }
    const processed = page.length;
    const hasMore = offset + processed < total;
    next_cursors.user = { offset: offset + processed, last_id: page.length ? page[page.length - 1].id : null };
    perSource.user = { total, processed, remaining: total - (offset + processed), has_more: hasMore, next_cursor: next_cursors.user, created: acc.created, already_migrated: acc.already, actual_duplicates: acc.dups, failed: acc.failed };
    totals.created += acc.created; totals.already_migrated += acc.already; totals.actual_duplicates += acc.dups; totals.failed += acc.failed; totals.processed += processed; totals.remaining += perSource.user.remaining;
  }

  const sidecar_counts_after = {
    ListingPrivate: (await base44.asServiceRole.entities.ListingPrivate.filter({}, 'id', 10000)).length,
    PurchasePrivate: (await base44.asServiceRole.entities.PurchasePrivate.filter({}, 'id', 10000)).length,
    UserSecurityProfile: (await base44.asServiceRole.entities.UserSecurityProfile.filter({}, 'id', 10000)).length,
    PublicProfile: (await base44.asServiceRole.entities.PublicProfile.filter({}, 'id', 10000)).length,
    UserPrivate: (await base44.asServiceRole.entities.UserPrivate.filter({}, 'id', 10000)).length,
    ProofAsset: (await base44.asServiceRole.entities.ProofAsset.filter({}, 'id', 10000)).length,
  };

  if (confirm && run) {
    await base44.asServiceRole.entities.MigrationRun.update(run.id, {
      status: 'completed', completed_at: new Date().toISOString(),
      cursors: next_cursors, counts: perSource, totals,
    });
  }

  return Response.json({
    migration_version: MIGRATION_VERSION,
    mode: confirm ? 'apply' : 'dry_run',
    batch_limit: batchLimit,
    resume_after: resumeAfter,
    per_source: perSource,
    totals,
    missing_keys,
    unsafe_fields,
    sidecar_counts_after,
    next_cursors,
    migration_run_id: run?.id || null,
  });
});