/**
 * cleanupAbandonedCheckouts — Scheduled recovery for abandoned checkouts.
 *
 * 7C.4 FAIL-CLOSED REWRITE:
 *   - No catch-to-empty on Purchase or PurchasePrivate queries.
 *   - PurchasePrivate is mandatory; no legacy identity/payment fallback.
 *   - PI retrieval failure or unknown status → quarantine + alert. Never
 *     expire, cancel, release, or clear anything.
 *   - Only expire/release after Stripe is positively verified canceled.
 *   - requires_capture/succeeded/processing → remain locked for capture/admin.
 *   - Release ownership requires BOTH exact buyer AND exact reservation token.
 *   - Explicitly handles hidden checkout_quarantine records.
 *   - Post-write verifies Purchase, Listing, and ListingPrivate.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';
import { isMaintenanceActive } from '../../shared/maintenance.ts';
import { getPurchasePrivate, upsertListingPrivate, getListingPrivate, quarantineListing } from '../../shared/privateData.ts';
import { classifyCleanupOutcome } from '../../shared/checkoutLogic.js';

const ABANDONED_MS = 10 * 60 * 1000;

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  if (isMaintenanceActive()) return Response.json({ ok: true, skipped: 'maintenance mode' });

  const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
  if (!secretKey || (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_'))) {
    return Response.json({ error: 'Stripe secret key misconfigured' }, { status: 500 });
  }
  const stripe = new Stripe(secretKey);

  // ── Fetch pending purchases — NO catch-to-empty ──
  let pending;
  try {
    pending = await base44.asServiceRole.entities.Purchase.filter({
      transfer_status: 'pending_transfer',
      payment_captured: false,
      is_demo: false,
    }, '-created_date', 200);
  } catch (err) {
    return Response.json({ error: 'Failed to fetch pending purchases' }, { status: 500 });
  }

  const now = Date.now();
  let expired = 0, released = 0, quarantined = 0, skippedRecent = 0, skippedAuthorized = 0, errors = 0;

  for (const p of pending) {
    try {
      const created = p.created_date ? new Date(p.created_date).getTime() : 0;
      if (now - created < ABANDONED_MS) { skippedRecent++; continue; }

      // PurchasePrivate is mandatory — no legacy fallback
      const pp = await getPurchasePrivate(base44, p.id);
      if (!pp) {
        await quarantineListing(base44, p.listing_id, `PurchasePrivate missing for purchase ${p.id}`, p.id, p.payment_intent_id);
        quarantined++;
        continue;
      }

      const piId = pp.payment_intent_id;
      const buyerEmail = pp.buyer_email;
      const resToken = pp.reservation_token;

      if (!piId) {
        await quarantineListing(base44, p.listing_id, `No payment_intent_id for purchase ${p.id}`, p.id, null);
        quarantined++;
        continue;
      }

      // ── Retrieve PI — failure → quarantine (fail-closed) ──
      let piStatus = null;
      try {
        const pi = await stripe.paymentIntents.retrieve(piId);
        piStatus = pi.status;
      } catch (err) {
        await quarantineListing(base44, p.listing_id, `PI retrieval failed for ${piId}: ${err?.message}`, p.id, piId);
        quarantined++;
        continue;
      }

      // ── Fetch Listing + LP for ownership check ──
      const [listing] = await base44.asServiceRole.entities.Listing.filter({ id: p.listing_id });
      const lp = await getListingPrivate(base44, p.listing_id);

      const ownsByBuyer = !!(listing && listing.reserved_by_email === buyerEmail);
      const ownsByToken = !!(resToken && lp && lp.reservation_token === resToken);

      // ── Classify cleanup outcome ──
      const outcome = classifyCleanupOutcome(piStatus, ownsByBuyer, ownsByToken);

      if (outcome === 'keep_locked') {
        skippedAuthorized++;
        continue;
      }

      if (outcome === 'quarantine') {
        await quarantineListing(base44, p.listing_id, `Cleanup quarantine: PI status=${piStatus}, buyer_match=${ownsByBuyer}, token_match=${ownsByToken}`, p.id, piId);
        quarantined++;
        continue;
      }

      // outcome === 'release'
      // For requires_payment_method/requires_action: cancel PI first, then verify canceled
      if (piStatus === 'requires_payment_method' || piStatus === 'requires_action') {
        try {
          const canceled = await stripe.paymentIntents.cancel(piId);
          if (canceled.status !== 'canceled') {
            await quarantineListing(base44, p.listing_id, `PI cancel returned ${canceled.status}`, p.id, piId);
            quarantined++;
            continue;
          }
        } catch (err) {
          // Check if already canceled
          try {
            const retrieved = await stripe.paymentIntents.retrieve(piId);
            if (retrieved.status !== 'canceled') {
              await quarantineListing(base44, p.listing_id, `PI cancel failed: ${err?.message}, status=${retrieved.status}`, p.id, piId);
              quarantined++;
              continue;
            }
          } catch (__) {
            await quarantineListing(base44, p.listing_id, `PI cancel+retrieve failed: ${err?.message}`, p.id, piId);
            quarantined++;
            continue;
          }
        }
      }

      // ── Expire Purchase ──
      try {
        await base44.asServiceRole.entities.Purchase.update(p.id, { transfer_status: 'expired' });
      } catch (err) {
        await quarantineListing(base44, p.listing_id, `Purchase expiry failed: ${err?.message}`, p.id, piId);
        quarantined++;
        continue;
      }

      // ── Release listing (BOTH buyer AND token already verified by classifyCleanupOutcome) ──
      if (listing && listing.status === 'pending_transfer') {
        try {
          await base44.asServiceRole.entities.Listing.update(listing.id, {
            status: 'active',
            reservation_token: null,
            reservation_expires_at: null,
            reserved_by_email: null,
            hidden_reason: null,
          });
        } catch (err) {
          await quarantineListing(base44, listing.id, `Listing release failed: ${err?.message}`, p.id, piId);
          quarantined++;
          continue;
        }

        try {
          await upsertListingPrivate(base44, listing.id, {
            reservation_token: null,
            reservation_expires_at: null,
            reserved_by_email: null,
            checkout_quarantined: false,
            checkout_quarantine_reason: null,
            checkout_quarantined_at: null,
            checkout_quarantine_pi_id: null,
          });
        } catch (err) {
          await quarantineListing(base44, listing.id, `LP release failed: ${err?.message}`, p.id, piId);
          quarantined++;
          continue;
        }

        // ── Post-write verification: Purchase, Listing, AND ListingPrivate ──
        const [verifyListing] = await base44.asServiceRole.entities.Listing.filter({ id: listing.id });
        const verifyLP = await getListingPrivate(base44, listing.id);
        const [verifyPurchase] = await base44.asServiceRole.entities.Purchase.filter({ id: p.id });

        if (!verifyPurchase || verifyPurchase.transfer_status !== 'expired') {
          await quarantineListing(base44, listing.id, 'Post-write verification failed (Purchase not expired)', p.id, piId);
          quarantined++;
          continue;
        }
        if (!verifyListing || verifyListing.status !== 'active' || verifyListing.reservation_token !== null) {
          await quarantineListing(base44, listing.id, 'Post-write verification failed (Listing)', p.id, piId);
          quarantined++;
          continue;
        }
        if (!verifyLP || verifyLP.reservation_token !== null) {
          await quarantineListing(base44, listing.id, 'Post-write verification failed (LP)', p.id, piId);
          quarantined++;
          continue;
        }

        released++;
      }
      expired++;
    } catch (err) {
      console.error('[cleanupAbandonedCheckouts] error processing', p.id, err?.message);
      errors++;
    }
  }

  // ── Process quarantined listings (checkout_quarantine) ──
  let quarantinedListings = [];
  try {
    quarantinedListings = await base44.asServiceRole.entities.ListingPrivate.filter({
      checkout_quarantined: true,
    }, 'id', 200);
  } catch (err) {
    // Non-fatal — main cleanup is done
  }

  let quarantineResolved = 0;
  for (const lp of quarantinedListings) {
    try {
      const piId = lp.checkout_quarantine_pi_id;
      if (!piId) continue;

      let piStatus = null;
      try {
        const pi = await stripe.paymentIntents.retrieve(piId);
        piStatus = pi.status;
      } catch (err) {
        continue; // Can't verify — leave quarantined
      }

      // Only resolve if PI is canceled AND no pending Purchase
      if (piStatus !== 'canceled') continue;

      const purchases = await base44.asServiceRole.entities.Purchase.filter({
        listing_id: lp.listing_id,
        transfer_status: 'pending_transfer',
      });
      if (purchases.length > 0) continue;

      // Safe to release
      await base44.asServiceRole.entities.Listing.update(lp.listing_id, {
        status: 'active',
        reservation_token: null,
        reservation_expires_at: null,
        reserved_by_email: null,
        hidden_reason: null,
      });
      await upsertListingPrivate(base44, lp.listing_id, {
        reservation_token: null,
        reservation_expires_at: null,
        reserved_by_email: null,
        checkout_quarantined: false,
        checkout_quarantine_reason: null,
        checkout_quarantined_at: null,
        checkout_quarantine_pi_id: null,
      });

      // Post-write verification
      const [verifyListing] = await base44.asServiceRole.entities.Listing.filter({ id: lp.listing_id });
      if (verifyListing && verifyListing.status === 'active') {
        quarantineResolved++;
      }
    } catch (err) {
      console.error('[cleanupAbandonedCheckouts] quarantine resolve error', lp.listing_id, err?.message);
    }
  }

  return Response.json({
    processed: pending.length,
    expired,
    released,
    quarantined,
    skipped_recent: skippedRecent,
    skipped_authorized: skippedAuthorized,
    errors,
    quarantine_resolved: quarantineResolved,
  });
});