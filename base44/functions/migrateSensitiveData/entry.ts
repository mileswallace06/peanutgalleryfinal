/**
 * migrateSensitiveData — admin-only, idempotent, copy-only migration of
 * sensitive fields from Listing/Purchase/User into private sidecar entities.
 *
 * - default dry_run=true; applies only with confirm=true
 * - scheduler / unauthenticated access forbidden (admin session required)
 * - copies records; NEVER deletes or clears source fields
 * - creates at most one sidecar per source record (keyed by listing_id /
 *   purchase_id / user_id); existing sidecars are reported as duplicates
 * - supports resume_after_id and bounded batches
 * - records migration_version + migrated_at on each created sidecar
 * - performs ZERO notifications, points awards, Stripe calls, or marketplace
 *   state changes
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const MIGRATION_VERSION = 1;

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  // Admin-only; scheduler/unauthenticated forbidden.
  let user;
  try { user = await base44.auth.me(); } catch (_) { return Response.json({ error: 'Unauthorized' }, { status: 401 }); }
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const confirm = body?.confirm === true;
  const batchLimit = Math.min(500, Math.max(1, Number(body?.batch_limit) || 200));
  const resumeAfterId = body?.resume_after_id || null;
  const sources = body?.sources || ['listing', 'purchase', 'user'];

  const report = {
    migration_version: MIGRATION_VERSION,
    mode: confirm ? 'apply' : 'dry_run',
    batch_limit: batchLimit,
    resume_after_id: resumeAfterId,
    source_counts: {},
    records_requiring_migration: 0,
    proposed_creates: 0,
    missing_keys: [],
    duplicate_sidecars: [],
    malformed_values: [],
    unsafe_fields: [],
    sidecar_counts_after: {},
  };

  const fetchBatch = async (entity, sortField) => {
    const all = await base44.asServiceRole.entities[entity].filter({}, sortField, batchLimit + 50);
    let arr = all;
    if (resumeAfterId) {
      const idx = arr.findIndex(r => r.id === resumeAfterId);
      if (idx >= 0) arr = arr.slice(idx + 1);
    }
    return arr.slice(0, batchLimit);
  };

  // ── Listing → ListingPrivate ────────────────────────────────────────────
  if (sources.includes('listing')) {
    const listings = await fetchBatch('Listing', '-created_date');
    report.source_counts.Listing = listings.length;
    const existingPriv = await base44.asServiceRole.entities.ListingPrivate.filter({}, '-created_date', 10000);
    const privByListingId = new Map(existingPriv.map(p => [p.listing_id, p]));
    for (const l of listings) {
      if (!l.id) { report.missing_keys.push({ entity: 'Listing', id: l.id, field: 'id' }); continue; }
      if (privByListingId.has(l.id)) { report.duplicate_sidecars.push({ entity: 'ListingPrivate', listing_id: l.id }); continue; }
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
      if (l.proof_url) report.unsafe_fields.push({ entity: 'Listing', listing_id: l.id, field: 'proof_url', reason: 'public URL — record as legacy_public_url in ProofAsset; requires_private_reupload' });
      if (l.transfer_verification_proof_url) report.unsafe_fields.push({ entity: 'Listing', listing_id: l.id, field: 'transfer_verification_proof_url', reason: 'public URL — requires_private_reupload' });
    }
    report.sidecar_counts_after.ListingPrivate = (await base44.asServiceRole.entities.ListingPrivate.filter({}, '-created_date', 10000)).length;
  }

  // ── Purchase → PurchasePrivate ─────────────────────────────────────────
  if (sources.includes('purchase')) {
    const purchases = await fetchBatch('Purchase', '-created_date');
    report.source_counts.Purchase = purchases.length;
    const existingPriv = await base44.asServiceRole.entities.PurchasePrivate.filter({}, '-created_date', 10000);
    const privByPurchaseId = new Map(existingPriv.map(p => [p.purchase_id, p]));
    for (const p of purchases) {
      if (!p.id) { report.missing_keys.push({ entity: 'Purchase', id: p.id, field: 'id' }); continue; }
      if (privByPurchaseId.has(p.id)) { report.duplicate_sidecars.push({ entity: 'PurchasePrivate', purchase_id: p.id }); continue; }
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
      if (p.transfer_proof_url) report.unsafe_fields.push({ entity: 'Purchase', purchase_id: p.id, field: 'transfer_proof_url', reason: 'public URL — requires_private_reupload' });
      if (p.fulfillment_proof_url) report.unsafe_fields.push({ entity: 'Purchase', purchase_id: p.id, field: 'fulfillment_proof_url', reason: 'public URL — requires_private_reupload' });
    }
    report.sidecar_counts_after.PurchasePrivate = (await base44.asServiceRole.entities.PurchasePrivate.filter({}, '-created_date', 10000)).length;
  }

  // ── User → UserSecurityProfile + PublicProfile ──────────────────────────
  if (sources.includes('user')) {
    const users = await fetchBatch('User', '-created_date');
    report.source_counts.User = users.length;
    const existingSec = await base44.asServiceRole.entities.UserSecurityProfile.filter({}, '-created_date', 10000);
    const secByKey = new Map(existingSec.map(s => [s.user_id || s.user_email, s]));
    const existingPub = await base44.asServiceRole.entities.PublicProfile.filter({}, '-created_date', 10000);
    const pubByUserId = new Map(existingPub.map(s => [s.user_id, s]));
    for (const u of users) {
      if (!u.id) { report.missing_keys.push({ entity: 'User', id: u.id, field: 'id' }); continue; }
      const email = u.email;
      if (!email) { report.missing_keys.push({ entity: 'User', id: u.id, field: 'email' }); continue; }

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

      if (pubByUserId.has(u.id)) {
        report.duplicate_sidecars.push({ entity: 'PublicProfile', user_id: u.id });
      } else {
        report.proposed_creates++;
        if (confirm) {
          try {
            await base44.asServiceRole.entities.PublicProfile.create({
              user_id: u.id, public_profile_id: `pp_${u.id}`,
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
      // email + Stripe account id must NEVER be copied to PublicProfile.
      report.unsafe_fields.push({ entity: 'User', user_id: u.id, field: 'email/stripe_account_id', reason: 'never copied to PublicProfile' });
    }
    report.sidecar_counts_after.UserSecurityProfile = (await base44.asServiceRole.entities.UserSecurityProfile.filter({}, '-created_date', 10000)).length;
    report.sidecar_counts_after.PublicProfile = (await base44.asServiceRole.entities.PublicProfile.filter({}, '-created_date', 10000)).length;
  }

  // No notifications, points, Stripe, or marketplace state changes performed.
  return Response.json(report);
});