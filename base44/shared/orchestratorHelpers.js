/**
 * orchestratorHelpers.js — Entity-access helpers with dependency injection.
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
import { verifyReservation, isQuarantined, QUARANTINE_DRAIN_MS } from './checkoutLogic.js';

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

// Helper: critical alert with PI ID (never throws)
async function criticalAlertForQuarantine(deps, listing_id, title, description, piId) {
  try {
    await deps.entities.AdminAlert.create({
      alert_type: 'admin_action_required',
      priority: 'critical',
      title,
      description: `${description} PI ID: ${piId || 'N/A'}.`,
      reference_type: 'listing',
      reference_id: listing_id,
    });
  } catch (_) { /* alert failure must never throw */ }
}

// ── Quarantine listing (writes to BOTH Listing and ListingPrivate, verifies) ──
// 7C.8: IMMUTABLE QUARANTINE SNAPSHOT — original snapshot AND generation are
// never mutated by repeated quarantines. Divergence blocks recovery and
// preserves the original identity (generation is NOT incremented). Same-state
// repeated quarantine is an idempotent no-op that does not replace pi_id,
// purchase_id, generation, recovery_not_before, or any snapshot field.
// All protection writes are awaited and verified. If either fails, returns
// quarantined:false — never returns quarantined:true based on best-effort writes.
export async function quarantineListing(deps, listing_id, reason, purchase_id, pi_id) {
  const quarantineAt = new Date(deps.now()).toISOString();
  const drainUntil = new Date(deps.now() + QUARANTINE_DRAIN_MS).toISOString();

  // Capture state BEFORE quarantining
  const [listingBefore] = await deps.entities.Listing.filter({ id: listing_id });
  const lpBefore = await getListingPrivate(deps, listing_id);
  const currentGeneration = lpBefore?.quarantine_generation || 0;

  const alreadyQuarantined = lpBefore?.checkout_quarantined === true;

  if (alreadyQuarantined) {
    // Check for state divergence between current reservation fields and original snapshot
    const snapToken = lpBefore?.quarantined_reservation_token ?? null;
    const snapBuyer = lpBefore?.quarantined_buyer ?? null;
    const snapExpiry = lpBefore?.quarantined_expiration ?? null;
    const currentToken = lpBefore?.reservation_token ?? listingBefore?.reservation_token ?? null;
    const currentBuyer = lpBefore?.reserved_by_email ?? listingBefore?.reserved_by_email ?? null;
    const currentExpiry = lpBefore?.reservation_expires_at ?? listingBefore?.reservation_expires_at ?? null;

    const hasDivergence = currentToken !== snapToken || currentBuyer !== snapBuyer || currentExpiry !== snapExpiry;

    if (hasDivergence) {
      // DIVERGENCE: Current state differs from original snapshot.
      // Block recovery, alert, preserve ORIGINAL snapshot AND generation.
      // Do NOT increment generation. Do NOT overwrite snapshot fields.

      // Step 1: Write recovery_blocked and VERIFY
      try {
        await upsertListingPrivate(deps, listing_id, {
          recovery_blocked: true,
          recovery_blocked_reason: `Repeated quarantine detected state divergence. Snap token=${snapToken}, current=${currentToken}. Manual resolution required. PI ID: ${pi_id || 'N/A'}.`,
          recovery_blocked_at: quarantineAt,
        });
      } catch (err) {
        await criticalAlertForQuarantine(deps, listing_id, `RECOVERY_BLOCKED WRITE FAILED for ${listing_id}`, `Error: ${err?.message}. ${reason}.`, pi_id);
        return { quarantined: false, error: err };
      }
      const lpVerifyBlock = await getListingPrivate(deps, listing_id);
      if (!lpVerifyBlock || lpVerifyBlock.recovery_blocked !== true) {
        await criticalAlertForQuarantine(deps, listing_id, `RECOVERY_BLOCKED VERIFICATION FAILED for ${listing_id}`, `recovery_blocked not set after write. ${reason}.`, pi_id);
        return { quarantined: false, error: new Error('recovery_blocked verification failed') };
      }

      // Step 2: Ensure Listing is hidden + quarantine and VERIFY
      try {
        await deps.entities.Listing.update(listing_id, { status: 'hidden', hidden_reason: 'checkout_quarantine' });
      } catch (err) {
        await criticalAlertForQuarantine(deps, listing_id, `QUARANTINE LISTING WRITE FAILED for ${listing_id}`, `Error: ${err?.message}. ${reason}.`, pi_id);
        return { quarantined: false, error: err };
      }
      const [verifyListingDiv] = await deps.entities.Listing.filter({ id: listing_id });
      if (!verifyListingDiv || verifyListingDiv.status !== 'hidden' || verifyListingDiv.hidden_reason !== 'checkout_quarantine') {
        await criticalAlertForQuarantine(deps, listing_id, `QUARANTINE LISTING VERIFICATION FAILED for ${listing_id}`, `Status: ${verifyListingDiv?.status}, reason: ${verifyListingDiv?.hidden_reason}. ${reason}.`, pi_id);
        return { quarantined: false, error: new Error('Listing hidden verification failed') };
      }

      // Original snapshot AND generation preserved (NOT incremented)
      return { quarantined: true, recovery_blocked: true };
    }

    // SAME-STATE: Repeated quarantine with matching state.
    // Idempotent no-op — do NOT replace checkout_quarantine_pi_id,
    // quarantined_purchase_id, quarantine_generation, recovery_not_before,
    // or any snapshot field. Only ensure Listing is hidden + quarantine.
    const [listingCheck] = await deps.entities.Listing.filter({ id: listing_id });
    if (!listingCheck || listingCheck.status !== 'hidden' || listingCheck.hidden_reason !== 'checkout_quarantine') {
      try {
        await deps.entities.Listing.update(listing_id, { status: 'hidden', hidden_reason: 'checkout_quarantine' });
      } catch (err) {
        await criticalAlertForQuarantine(deps, listing_id, `QUARANTINE LISTING WRITE FAILED for ${listing_id}`, `Error: ${err?.message}. ${reason}.`, pi_id);
        return { quarantined: false, error: err };
      }
      const [verifyListingSame] = await deps.entities.Listing.filter({ id: listing_id });
      if (!verifyListingSame || verifyListingSame.status !== 'hidden' || verifyListingSame.hidden_reason !== 'checkout_quarantine') {
        await criticalAlertForQuarantine(deps, listing_id, `QUARANTINE LISTING VERIFICATION FAILED for ${listing_id}`, `${reason}.`, pi_id);
        return { quarantined: false, error: new Error('Listing hidden verification failed') };
      }
    }
    // Do NOT write any identity fields to LP — idempotent no-op
    return { quarantined: true };
  }

  // First-time quarantine — capture snapshot from current state
  const snapshot = {
    quarantined_reservation_token: lpBefore?.reservation_token ?? listingBefore?.reservation_token ?? null,
    quarantined_buyer: lpBefore?.reserved_by_email ?? listingBefore?.reserved_by_email ?? null,
    quarantined_expiration: lpBefore?.reservation_expires_at ?? listingBefore?.reservation_expires_at ?? null,
    quarantined_purchase_id: purchase_id || null,
    quarantine_generation: currentGeneration + 1,
    recovery_not_before: drainUntil,
  };

  try {
    await deps.entities.Listing.update(listing_id, {
      status: 'hidden',
      hidden_reason: 'checkout_quarantine',
    });
  } catch (err) {
    await criticalAlertForQuarantine(deps, listing_id, `QUARANTINE LISTING WRITE FAILED for ${listing_id}`, `${reason}. Error: ${err?.message}. Purchase: ${purchase_id || 'N/A'}.`, pi_id);
    return { quarantined: false, error: err };
  }

  try {
    await upsertListingPrivate(deps, listing_id, {
      checkout_quarantined: true,
      checkout_quarantine_reason: reason,
      checkout_quarantined_at: quarantineAt,
      checkout_quarantine_pi_id: pi_id || null,
      ...snapshot,
    });
  } catch (err) {
    await criticalAlertForQuarantine(deps, listing_id, `QUARANTINE LP WRITE FAILED for ${listing_id}`, `${reason}. Error: ${err?.message}. Purchase: ${purchase_id || 'N/A'}. PI ID: ${pi_id || 'N/A'}.`, pi_id);
    return { quarantined: false, error: err };
  }

  // Post-write verification
  const [verifyListing] = await deps.entities.Listing.filter({ id: listing_id });
  const verifyLP = await getListingPrivate(deps, listing_id);

  if (!verifyListing || verifyListing.status !== 'hidden' || verifyListing.hidden_reason !== 'checkout_quarantine') {
    await criticalAlertForQuarantine(deps, listing_id, `QUARANTINE LISTING VERIFICATION FAILED for ${listing_id}`, `Status: ${verifyListing?.status}, reason: ${verifyListing?.hidden_reason}.`, pi_id);
    return { quarantined: false, error: new Error('Listing post-write verification failed') };
  }

  if (!verifyLP || !verifyLP.checkout_quarantined) {
    await criticalAlertForQuarantine(deps, listing_id, `QUARANTINE LP VERIFICATION FAILED for ${listing_id}`, `Post-write verification failed. checkout_quarantined not set.`, pi_id);
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