/**
 * migrateSensitiveData — admin-only, idempotent, copy-only migration.
 *
 * CORRECTED RUN changes:
 *  - deterministic per-source cursor: ascending 'id' sort, resume by id > cursor,
 *    returned as next_cursors (replaces the non-deterministic findIndex slice)
 *  - opaque random public_profile_id (crypto.randomUUID), never derived from user.id
 *  - UserPrivate sidecars now created (owner-scoped private account metadata)
 *  - ProofAsset records created for every legacy public proof URL, flagged
 *    migration_status="requires_private_reupload" (never trusted as private)
 *
 * Invariants (unchanged):
 *  - default dry_run=true; applies only with confirm=true
 *  - admin session required; scheduler/unauthenticated forbidden
 *  - copies records; NEVER deletes or clears source fields
 *  - at most one sidecar per source record (keyed by listing_id / purchase_id /
 *    user_id / user_email); existing sidecars reported as duplicates
 *  - ZERO notifications, points, Stripe, or marketplace-state changes
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const MIGRATION_VERSION = 2;

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  let user;
  try { user = await base44.auth.me(); } catch (_) { return Response.json({ error: 'Unauthorized' }, { status: 401 }); }
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const confirm = body?.confirm === true;
  const batchLimit = Math.min(500, Math.max(1, Number(body?.batch_limit) || 200));
  // Per-source deterministic cursor: { listing, purchase, user } = last id processed.
  const resumeAfter = body?.resume_after || {};
  const sources = body?.sources || ['listing', 'purchase', 'user'];

  const report = {
    migration_version: MIGRATION_VERSION,
    mode: confirm ? 'apply' : 'dry_run',
    batch_limit: batchLimit,
    resume_after: resumeAfter,
    source_counts: {},
    records_requiring_migration: 0,
    proposed_creates: 0,
    missing_keys: [],
    duplicate_sidecars: [],
    malformed_values: [],
    unsafe_fields: [],
    sidecar_counts_after: {},
    next_cursors: {},
  };

  // Deterministic cursor fetch: ascending 'id', drop id <= cursor, take batch.
  const fetchBatch = async (entity, cursor) => {
    const all = await base44.asServiceRole.entities[entity].filter({}, 'id', batchLimit + 100);
    let arr = all;
    if (cursor) arr = arr.filter(r => r.id > cursor);
    return arr.slice(0, batchLimit);
  };

  // ── Listing → ListingPrivate + ProofAsset(legacy) ────────────────────────
  if (sources.includes('listing')) {
    const cursor = resumeAfter.listing || null;
    const listings = await fetchBatch('Listing', cursor);
    report.source_counts.Listing = listings.length;
    const existingPriv = await base44.asServiceRole.entities.ListingPrivate.filter({}, 'id', 10000);
    const privByListingId = new Map(existingPriv.map(p => [p.listing_id, p]));
    const existingProofs = await base44.asServiceRole.entities.ProofAsset.filter({ reference_type: 'listing' }, 'id', 10000);
    const proofKeys = new Set(existingProofs.map(p => `${p.reference_id}|${p.legacy_public_url}`));

    let lastId = cursor;
    for (const l of listings) {
      lastId = l.id;
      if (!l.id) { report.missing_keys.push({ entity: 'Listing', field: 'id' }); continue; }
      if (privByListingId.has(l.id)) { report.duplicate_sidecars.push({ entity: 'ListingPrivate', listing_id: l.id }); }
      else {
        report.records_requiring_migration++;
        report.proposed_creates++;
        if (confirm) {
          try {
            await base44.asServiceRole.entities.ListingPrivate.create({
              listing_id: l.id, event_id: l.event_id, seller_email: l.seller_email,
              section: l.section, row: l.row, seats: l.seats, quantity: l.quantity,
              proof_url: l.proof_url, proof_status: l.proof_status, proof_rejection_reason: l.proof_rejection_reason,
              ticket_file_url: l.ticket_file_url, reservation_token: l.reservation_token,
              reservation_expires_at: l.reservation_expires_at, reserved_by_email: l.reserved_by_email,
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
          } catch (e) { report.malformed_values.push({ entity: 'ListingPrivate', listing_id: l.id, error: e?.message }); }
        }
      }

      // Legacy public proof URLs → ProofAsset (requires_private_reupload)
      const legacyProofs = [
        ['listing_proof', l.proof_url],
        ['transfer_attestation', l.transfer_verification_proof_url],
        ['ownership_proof', l.ticket_file_url],
        ['pg_custody_proof', l.pg_transfer_proof_url],
      ];
      for (const [proof_type, url] of legacyProofs) {
        if (!url) continue;
        const key = `${l.id}|${url}`;
        if (proofKeys.has(key)) { report.duplicate_sidecars.push({ entity: 'ProofAsset', key }); continue; }
        report.proposed_creates++;
        report.unsafe_fields.push({ entity: 'Listing', listing_id: l.id, field: proof_type, reason: 'public URL → ProofAsset requires_private_reupload' });
        if (confirm) {
          try {
            await base44.asServiceRole.entities.ProofAsset.create({
              owner_email: l.seller_email, reference_type: 'listing', reference_id: l.id,
              proof_type, private_file_id: null, storage_uri: null, content_type: null,
              checksum: null, scan_status: 'pending', uploaded_at: new Date().toISOString(),
              legacy_public_url: url, migration_status: 'requires_private_reupload',
            });
          } catch (e) { report.malformed_values.push({ entity: 'ProofAsset', key, error: e?.message }); }
        }
      }
    }
    report.next_cursors.listing = lastId;
    report.sidecar_counts_after.ListingPrivate = (await base44.asServiceRole.entities.ListingPrivate.filter({}, 'id', 10000)).length;
  }

  // ── Purchase → PurchasePrivate + ProofAsset(legacy) ─────────────────────
  if (sources.includes('purchase')) {
    const cursor = resumeAfter.purchase || null;
    const purchases = await fetchBatch('Purchase', cursor);
    report.source_counts.Purchase = purchases.length;
    const existingPriv = await base44.asServiceRole.entities.PurchasePrivate.filter({}, 'id', 10000);
    const privByPurchaseId = new Map(existingPriv.map(p => [p.purchase_id, p]));
    const existingProofs = await base44.asServiceRole.entities.ProofAsset.filter({ reference_type: 'purchase' }, 'id', 10000);
    const proofKeys = new Set(existingProofs.map(p => `${p.reference_id}|${p.legacy_public_url}`));

    let lastId = cursor;
    for (const p of purchases) {
      lastId = p.id;
      if (!p.id) { report.missing_keys.push({ entity: 'Purchase', field: 'id' }); continue; }
      if (privByPurchaseId.has(p.id)) { report.duplicate_sidecars.push({ entity: 'PurchasePrivate', purchase_id: p.id }); }
      else {
        report.records_requiring_migration++;
        report.proposed_creates++;
        if (confirm) {
          try {
            await base44.asServiceRole.entities.PurchasePrivate.create({
              purchase_id: p.id, listing_id: p.listing_id, event_id: p.event_id,
              buyer_email: p.buyer_email, seller_email: p.seller_email,
              payment_intent_id: p.payment_intent_id, reservation_token: p.reservation_token,
              buyer_phone: p.buyer_phone, authorization_confirmed_at: p.authorization_confirmed_at,
              seller_notified_at: p.seller_notified_at, seller_push_status: p.seller_push_status,
              seller_email_status: p.seller_email_status, payment_capture_failed: p.payment_capture_failed,
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
              is_demo: p.is_demo,
              migration_version: MIGRATION_VERSION, migrated_at: new Date().toISOString(),
            });
          } catch (e) { report.malformed_values.push({ entity: 'PurchasePrivate', purchase_id: p.id, error: e?.message }); }
        }
      }

      const legacyProofs = [
        ['transfer_proof', p.transfer_proof_url],
        ['pg_custody_proof', p.fulfillment_proof_url],
      ];
      for (const [proof_type, url] of legacyProofs) {
        if (!url) continue;
        const key = `${p.id}|${url}`;
        if (proofKeys.has(key)) { report.duplicate_sidecars.push({ entity: 'ProofAsset', key }); continue; }
        report.proposed_creates++;
        report.unsafe_fields.push({ entity: 'Purchase', purchase_id: p.id, field: proof_type, reason: 'public URL → ProofAsset requires_private_reupload' });
        if (confirm) {
          try {
            await base44.asServiceRole.entities.ProofAsset.create({
              owner_email: p.seller_email, reference_type: 'purchase', reference_id: p.id,
              proof_type, private_file_id: null, storage_uri: null, content_type: null,
              checksum: null, scan_status: 'pending', uploaded_at: new Date().toISOString(),
              legacy_public_url: url, migration_status: 'requires_private_reupload',
            });
          } catch (e) { report.malformed_values.push({ entity: 'ProofAsset', key, error: e?.message }); }
        }
      }
    }
    report.next_cursors.purchase = lastId;
    report.sidecar_counts_after.PurchasePrivate = (await base44.asServiceRole.entities.PurchasePrivate.filter({}, 'id', 10000)).length;
  }

  // ── User → UserSecurityProfile + PublicProfile + UserPrivate ─────────────
  if (sources.includes('user')) {
    const cursor = resumeAfter.user || null;
    const users = await fetchBatch('User', cursor);
    report.source_counts.User = users.length;
    const existingSec = await base44.asServiceRole.entities.UserSecurityProfile.filter({}, 'id', 10000);
    const secByKey = new Map(existingSec.map(s => [s.user_id || s.user_email, s]));
    const existingPub = await base44.asServiceRole.entities.PublicProfile.filter({}, 'id', 10000);
    const pubByUserId = new Map(existingPub.map(s => [s.user_id, s]));
    const existingPriv = await base44.asServiceRole.entities.UserPrivate.filter({}, 'id', 10000);
    const privByEmail = new Map(existingPriv.map(s => [s.user_email, s]));

    let lastId = cursor;
    for (const u of users) {
      lastId = u.id;
      if (!u.id) { report.missing_keys.push({ entity: 'User', field: 'id' }); continue; }
      const email = u.email;
      if (!email) { report.missing_keys.push({ entity: 'User', id: u.id, field: 'email' }); continue; }

      // UserSecurityProfile
      if (secByKey.has(u.id) || secByKey.has(email)) {
        report.duplicate_sidecars.push({ entity: 'UserSecurityProfile', user_id: u.id });
      } else {
        report.records_requiring_migration++;
        report.proposed_creates++;
        if (confirm) {
          try {
            await base44.asServiceRole.entities.UserSecurityProfile.create({
              user_id: u.id, user_email: email,
              stripe_account_id: u.stripe_account_id, stripe_onboarding_complete: u.stripe_onboarding_complete,
              peanut_points: u.peanut_points, lifetime_points: u.lifetime_points, points_last_updated: u.points_last_updated,
              trust_score: u.trust_score, seller_transfer_reliability: u.seller_transfer_reliability,
              transfer_success_count: u.transfer_success_count, transfer_fail_count: u.transfer_fail_count,
              transfer_expired_count: u.transfer_expired_count, transfer_false_claim_count: u.transfer_false_claim_count,
              strike_count: u.strike_count, confirmed_fraud_count: u.confirmed_fraud_count, false_dispute_count: u.false_dispute_count,
              total_purchases: u.total_purchases, total_sales: u.total_sales, total_instant_listings: u.total_instant_listings,
              total_live_upgrades: u.total_live_upgrades, total_fast_transfers: u.total_fast_transfers, total_disputes: u.total_disputes,
              total_failed_transfers: u.total_failed_transfers, total_cancelled_sales: u.total_cancelled_sales, total_donations_made: u.total_donations_made,
              seller_streak: u.seller_streak, last_pi_attempt_at: u.last_pi_attempt_at, pi_attempt_count: u.pi_attempt_count,
              admin_flags: [], internal_risk_notes: null,
              migration_version: MIGRATION_VERSION, migrated_at: new Date().toISOString(),
            });
          } catch (e) { report.malformed_values.push({ entity: 'UserSecurityProfile', user_id: u.id, error: e?.message }); }
        }
      }

      // PublicProfile — opaque random public_profile_id
      if (pubByUserId.has(u.id)) {
        report.duplicate_sidecars.push({ entity: 'PublicProfile', user_id: u.id });
      } else {
        report.proposed_creates++;
        if (confirm) {
          try {
            await base44.asServiceRole.entities.PublicProfile.create({
              user_id: u.id, public_profile_id: `pp_${crypto.randomUUID()}`,
              display_name: u.full_name || u.persona_name || null,
              avatar_url: u.avatar_url, banner_url: u.banner_url, bio: u.bio,
              persona_name: u.persona_name, persona_style: u.persona_style,
              verified_fan: u.verified_fan, is_founding_fan: u.is_founding_fan,
              peanut_level: u.peanut_level, peanut_rank: u.peanut_rank,
              trust_badges: u.trust_badges, achievements: u.achievements,
              public_trust_summary: null, referral_code: u.referral_code,
              updated_at: new Date().toISOString(),
            });
          } catch (e) { report.malformed_values.push({ entity: 'PublicProfile', user_id: u.id, error: e?.message }); }
        }
      }

      // UserPrivate — owner-scoped private account metadata
      if (privByEmail.has(email)) {
        report.duplicate_sidecars.push({ entity: 'UserPrivate', user_email: email });
      } else {
        report.proposed_creates++;
        if (confirm) {
          try {
            await base44.asServiceRole.entities.UserPrivate.create({
              user_id: u.id, user_email: email,
              phone: null, has_seen_onboarding: u.has_seen_onboarding,
              points_last_updated: u.points_last_updated, referred_by: u.referred_by,
              preferences: {}, updated_at: new Date().toISOString(),
            });
          } catch (e) { report.malformed_values.push({ entity: 'UserPrivate', user_id: u.id, error: e?.message }); }
        }
      }
      report.unsafe_fields.push({ entity: 'User', user_id: u.id, field: 'email/stripe_account_id', reason: 'never copied to PublicProfile' });
    }
    report.next_cursors.user = lastId;
    report.sidecar_counts_after.UserSecurityProfile = (await base44.asServiceRole.entities.UserSecurityProfile.filter({}, 'id', 10000)).length;
    report.sidecar_counts_after.PublicProfile = (await base44.asServiceRole.entities.PublicProfile.filter({}, 'id', 10000)).length;
    report.sidecar_counts_after.UserPrivate = (await base44.asServiceRole.entities.UserPrivate.filter({}, 'id', 10000)).length;
  }

  report.sidecar_counts_after.ProofAsset = (await base44.asServiceRole.entities.ProofAsset.filter({}, 'id', 10000)).length;

  // No notifications, points, Stripe, or marketplace state changes performed.
  return Response.json(report);
});