/**
 * orchestratorHelpers.js — Entity-access helpers with dependency injection.
 *
 * These functions accept a `deps` object instead of a global base44 client,
 * making them testable in both Deno (entry.ts) and Node.js (tests).
 *
 * deps = {
 *   entities: { Listing, ListingPrivate, Purchase, PurchasePrivate,
 *               User, UserSecurityProfile, AdminAlert, SeatInventory },
 *   stripe: StripeClient,
 *   now: () => number,
 * }
 *
 * No Deno/Node-specific imports — pure ESM JavaScript.
 */
import { verifyReservation, isQuarantined } from './checkoutLogic.js';

// ── ListingPrivate ─────────────────────────────────────────────────────────
export async function getListingPrivate(deps, listing_id) {
  if (!listing_id) return null;
  const rows = await deps.entities.ListingPrivate.filter({ listing_id });
  return rows[0] || null;
}

export async function upsertListingPrivate(deps, listing_id, fields) {
  if (!listing_id) return null;
  const existing = await getListingPrivate(deps, listing_id);
  if (existing) {
    return deps.entities.ListingPrivate.update(existing.id, fields);
  }
  return deps.entities.ListingPrivate.create({ listing_id, ...fields });
}

export async function ensureListingPrivate(deps, listing_id, fields) {
  const existing = await getListingPrivate(deps, listing_id);
  if (existing) return existing;
  return deps.entities.ListingPrivate.create({ listing_id, ...fields });
}

// ── PurchasePrivate ─────────────────────────────────────────────────────────
export async function getPurchasePrivate(deps, purchase_id) {
  if (!purchase_id) return null;
  const rows = await deps.entities.PurchasePrivate.filter({ purchase_id });
  return rows[0] || null;
}

export async function upsertPurchasePrivate(deps, purchase_id, fields) {
  if (!purchase_id) return null;
  const existing = await getPurchasePrivate(deps, purchase_id);
  if (existing) {
    return deps.entities.PurchasePrivate.update(existing.id, fields);
  }
  return deps.entities.PurchasePrivate.create({ purchase_id, ...fields });
}

// ── UserSecurityProfile ────────────────────────────────────────────────────
export async function getUserSecurityProfile(deps, { user_id, user_email } = {}) {
  if (user_id) {
    const rows = await deps.entities.UserSecurityProfile.filter({ user_id });
    if (rows[0]) return rows[0];
  }
  if (user_email) {
    const rows = await deps.entities.UserSecurityProfile.filter({ user_email });
    if (rows[0]) return rows[0];
  }
  return null;
}

export async function upsertUserSecurityProfile(deps, { user_id, user_email }, fields) {
  const existing = await getUserSecurityProfile(deps, { user_id, user_email });
  if (existing) {
    return deps.entities.UserSecurityProfile.update(existing.id, fields);
  }
  if (!user_id || !user_email) return null;
  return deps.entities.UserSecurityProfile.create({ user_id, user_email, ...fields });
}

// ── Alerts ──────────────────────────────────────────────────────────────────
export async function alertPrivateWriteFailure(deps, { entity, reference_id, reference_type, error }) {
  try {
    await deps.entities.AdminAlert.create({
      alert_type: 'admin_action_required',
      priority: 'high',
      title: `Private write failure: ${entity}`,
      description: `Failed to write ${entity} for ${reference_type} ${reference_id}: ${error?.message || String(error)}`,
      reference_type,
      reference_id,
    });
  } catch (_) { /* alert failure must never throw */ }
}

// ── Quarantine listing (writes to BOTH Listing and ListingPrivate, verifies) ──
export async function quarantineListing(deps, listing_id, reason, purchase_id, pi_id) {
  const quarantineAt = new Date(deps.now()).toISOString();

  try {
    await deps.entities.Listing.update(listing_id, {
      status: 'hidden',
      hidden_reason: 'checkout_quarantine',
    });
  } catch (err) {
    console.error(`[CRITICAL] quarantineListing: Listing write failed for ${listing_id}: ${err?.message}.`);
    try {
      await deps.entities.AdminAlert.create({
        alert_type: 'admin_action_required',
        priority: 'critical',
        title: `QUARANTINE LISTING WRITE FAILED for ${listing_id}`,
        description: `${reason}. Error: ${err?.message}. Purchase: ${purchase_id || 'N/A'}.`,
        reference_type: 'listing',
        reference_id: listing_id,
      });
    } catch (alertErr) {
      console.error(`[CRITICAL] Alert creation failed for quarantine: ${alertErr?.message}`);
    }
    return { quarantined: false, error: err };
  }

  try {
    await upsertListingPrivate(deps, listing_id, {
      checkout_quarantined: true,
      checkout_quarantine_reason: reason,
      checkout_quarantined_at: quarantineAt,
      checkout_quarantine_pi_id: pi_id || null,
    });
  } catch (err) {
    console.error(`[CRITICAL] quarantineListing: LP write failed for ${listing_id}: ${err?.message}.`);
    try {
      await deps.entities.AdminAlert.create({
        alert_type: 'admin_action_required',
        priority: 'critical',
        title: `QUARANTINE LP WRITE FAILED for ${listing_id}`,
        description: `${reason}. Error: ${err?.message}. Purchase: ${purchase_id || 'N/A'}.`,
        reference_type: 'listing',
        reference_id: listing_id,
      });
    } catch (alertErr) {
      console.error(`[CRITICAL] Alert creation failed for LP quarantine: ${alertErr?.message}`);
    }
    return { quarantined: false, error: err };
  }

  // Post-write verification
  const [verifyListing] = await deps.entities.Listing.filter({ id: listing_id });
  const verifyLP = await getListingPrivate(deps, listing_id);

  if (!verifyListing || verifyListing.status !== 'hidden' || verifyListing.hidden_reason !== 'checkout_quarantine') {
    console.error(`[CRITICAL] quarantineListing: Listing verification failed for ${listing_id}.`);
    try {
      await deps.entities.AdminAlert.create({
        alert_type: 'admin_action_required',
        priority: 'critical',
        title: `QUARANTINE LISTING VERIFICATION FAILED for ${listing_id}`,
        description: `Status: ${verifyListing?.status}, reason: ${verifyListing?.hidden_reason}.`,
        reference_type: 'listing',
        reference_id: listing_id,
      });
    } catch (alertErr) {
      console.error(`[CRITICAL] Alert creation failed: ${alertErr?.message}`);
    }
    return { quarantined: false, error: new Error('Listing post-write verification failed') };
  }

  if (!verifyLP || !verifyLP.checkout_quarantined) {
    console.error(`[CRITICAL] quarantineListing: LP verification failed for ${listing_id}.`);
    try {
      await deps.entities.AdminAlert.create({
        alert_type: 'admin_action_required',
        priority: 'critical',
        title: `QUARANTINE LP VERIFICATION FAILED for ${listing_id}`,
        description: `Post-write verification failed. checkout_quarantined not set.`,
        reference_type: 'listing',
        reference_id: listing_id,
      });
    } catch (alertErr) {
      console.error(`[CRITICAL] Alert creation failed: ${alertErr?.message}`);
    }
    return { quarantined: false, error: new Error('ListingPrivate post-write verification failed') };
  }

  return { quarantined: true };
}

// ── Cancel PI and quarantine — compensation for checkout failures ──────────
// Cancels the PI, verifies canceled, expires Purchase (if provided), quarantines listing.
// If cancel fails, persists an AdminAlert with the PI ID (recoverable record).
export async function cancelPIAndQuarantine(deps, paymentIntentId, listing_id, purchase_id, reason) {
  let piCanceled = false;
  let piStatus = null;

  // Step 1: Cancel PI and verify
  try {
    const canceled = await deps.stripe.paymentIntents.cancel(paymentIntentId);
    piStatus = canceled.status;
    piCanceled = canceled.status === 'canceled';
  } catch (_) {
    try {
      const retrieved = await deps.stripe.paymentIntents.retrieve(paymentIntentId);
      piStatus = retrieved.status;
      piCanceled = retrieved.status === 'canceled';
    } catch (__) {
      piStatus = 'unknown';
    }
  }

  if (!piCanceled) {
    // Persist recoverable record with PI ID
    try {
      await deps.entities.AdminAlert.create({
        alert_type: 'admin_action_required',
        priority: 'critical',
        title: `ORPHAN PI: ${paymentIntentId} — cancellation uncertain`,
        description: `${reason}. PI status: ${piStatus}. Listing: ${listing_id}. Purchase: ${purchase_id || 'N/A'}. Manual cancellation required.`,
        reference_type: 'listing',
        reference_id: listing_id,
      });
    } catch (alertErr) {
      console.error(`[CRITICAL] Alert creation failed for orphan PI: ${alertErr?.message}`);
    }
    // Still quarantine the listing
    await quarantineListing(deps, listing_id, `PI cancellation uncertain (status: ${piStatus}). ${reason}`, purchase_id, paymentIntentId);
    return { cancelOk: false, allStepsOk: false };
  }

  // Step 2: Expire Purchase (if provided)
  if (purchase_id) {
    try {
      await deps.entities.Purchase.update(purchase_id, { transfer_status: 'expired' });
    } catch (err) {
      await quarantineListing(deps, listing_id, `Purchase ${purchase_id} expiry write failed: ${err?.message}. ${reason}`, purchase_id, paymentIntentId);
      return { cancelOk: true, allStepsOk: false };
    }
  }

  // Step 3: Quarantine listing
  const qResult = await quarantineListing(deps, listing_id, `Checkout compensation: ${reason}`, purchase_id, paymentIntentId);
  if (!qResult.quarantined) {
    return { cancelOk: true, allStepsOk: false };
  }

  return { cancelOk: true, allStepsOk: true };
}