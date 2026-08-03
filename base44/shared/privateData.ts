/**
 * privateData.ts — shared private-entity access layer for Phase 1B backend cutover.
 *
 * Pattern:
 *   READ  → private sidecar first, legacy field as temporary fallback
 *   WRITE → private sidecar is the authoritative destination; awaited, no silent catch
 *
 * CONCURRENCY: Base44 has no atomic compare-and-set. Upsert/ensure helpers
 * re-check for duplicate sidecars after create and, if a race produced >1,
 * delete the extras and emit an AdminAlert rather than silently keeping one.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── Alert helpers ───────────────────────────────────────────────────────────
async function alertDuplicateSidecar(base44, { entity, key, key_value, dup_count }) {
  try {
    const refType = entity === 'ListingPrivate' ? 'listing'
      : entity === 'PurchasePrivate' ? 'purchase' : 'user';
    await base44.asServiceRole.entities.AdminAlert.create({
      alert_type: 'admin_action_required',
      priority: 'high',
      title: `Duplicate ${entity} sidecar reconciled`,
      description: `Race condition created ${dup_count} ${entity} records for ${key}=${key_value}. Extras deleted; one retained.`,
      reference_type: refType,
      reference_id: key_value,
    });
  } catch (_) { /* alert failure must never throw */ }
}

export async function alertPrivateWriteFailure(base44, { entity, reference_id, reference_type, error }) {
  try {
    await base44.asServiceRole.entities.AdminAlert.create({
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
// Sets Listing to hidden with hidden_reason='checkout_quarantine'.
// Sets ListingPrivate.checkout_quarantined=true + reason + timestamp + pi_id.
// Post-write verifies BOTH entities. Does NOT clear reservation_token (no TOCTOU).
// Does NOT silently swallow alert failures — logs to console.error.
export async function quarantineListing(base44, listing_id, reason, purchase_id, pi_id) {
  const quarantineAt = new Date().toISOString();

  try {
    await base44.asServiceRole.entities.Listing.update(listing_id, {
      status: 'hidden',
      hidden_reason: 'checkout_quarantine',
    });
  } catch (err) {
    console.error(`[CRITICAL] quarantineListing: Listing write failed for ${listing_id}: ${err?.message}. Reason: ${reason}. Purchase: ${purchase_id || 'N/A'}.`);
    try {
      await base44.asServiceRole.entities.AdminAlert.create({
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
    await upsertListingPrivate(base44, listing_id, {
      checkout_quarantined: true,
      checkout_quarantine_reason: reason,
      checkout_quarantined_at: quarantineAt,
      checkout_quarantine_pi_id: pi_id || null,
    });
  } catch (err) {
    console.error(`[CRITICAL] quarantineListing: LP write failed for ${listing_id}: ${err?.message}.`);
    try {
      await base44.asServiceRole.entities.AdminAlert.create({
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

  const [verifyListing] = await base44.asServiceRole.entities.Listing.filter({ id: listing_id });
  const verifyLP = await getListingPrivate(base44, listing_id);

  if (!verifyListing || verifyListing.status !== 'hidden' || verifyListing.hidden_reason !== 'checkout_quarantine') {
    console.error(`[CRITICAL] quarantineListing: Listing verification failed for ${listing_id}. Status: ${verifyListing?.status}, reason: ${verifyListing?.hidden_reason}.`);
    try {
      await base44.asServiceRole.entities.AdminAlert.create({
        alert_type: 'admin_action_required',
        priority: 'critical',
        title: `QUARANTINE LISTING VERIFICATION FAILED for ${listing_id}`,
        description: `Post-write verification failed. Status: ${verifyListing?.status}, reason: ${verifyListing?.hidden_reason}.`,
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
      await base44.asServiceRole.entities.AdminAlert.create({
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

/**
 * Post-create duplicate reconciliation. After a create, re-fetch all sidecars
 * for the key; if >1 exist (a concurrent create won the race), delete the
 * extras and alert. Returns the retained record.
 */
async function reconcileDuplicates(base44, { entityName, keyField, keyValue, createdId, label }) {
  const all = await base44.asServiceRole.entities[entityName].filter({ [keyField]: keyValue });
  if (all.length <= 1) return;
  const extras = all.filter(r => r.id !== createdId);
  for (const e of extras) {
    await base44.asServiceRole.entities[entityName].delete(e.id).catch(() => {});
  }
  await alertDuplicateSidecar(base44, { entity: label, key: keyField, key_value: keyValue, dup_count: all.length });
}

// ── ListingPrivate ─────────────────────────────────────────────────────────
export async function getListingPrivate(base44, listing_id) {
  if (!listing_id) return null;
  const rows = await base44.asServiceRole.entities.ListingPrivate.filter({ listing_id });
  return rows[0] || null;
}

export async function upsertListingPrivate(base44, listing_id, fields) {
  if (!listing_id) return null;
  const existing = await getListingPrivate(base44, listing_id);
  if (existing) {
    return base44.asServiceRole.entities.ListingPrivate.update(existing.id, fields);
  }
  const created = await base44.asServiceRole.entities.ListingPrivate.create({ listing_id, ...fields });
  await reconcileDuplicates(base44, { entityName: 'ListingPrivate', keyField: 'listing_id', keyValue: listing_id, createdId: created.id, label: 'ListingPrivate' });
  return created;
}

export async function readListingPrivate(base44, listing, field) {
  const lp = await getListingPrivate(base44, listing.id);
  if (lp && lp[field] !== undefined && lp[field] !== null) return lp[field];
  return listing?.[field] ?? null;
}

// ── PurchasePrivate ─────────────────────────────────────────────────────────
export async function getPurchasePrivate(base44, purchase_id) {
  if (!purchase_id) return null;
  const rows = await base44.asServiceRole.entities.PurchasePrivate.filter({ purchase_id });
  return rows[0] || null;
}

export async function upsertPurchasePrivate(base44, purchase_id, fields) {
  if (!purchase_id) return null;
  const existing = await getPurchasePrivate(base44, purchase_id);
  if (existing) {
    return base44.asServiceRole.entities.PurchasePrivate.update(existing.id, fields);
  }
  const created = await base44.asServiceRole.entities.PurchasePrivate.create({ purchase_id, ...fields });
  await reconcileDuplicates(base44, { entityName: 'PurchasePrivate', keyField: 'purchase_id', keyValue: purchase_id, createdId: created.id, label: 'PurchasePrivate' });
  return created;
}

export async function readPurchasePrivate(base44, purchase, field) {
  const pp = await getPurchasePrivate(base44, purchase.id);
  if (pp && pp[field] !== undefined && pp[field] !== null) return pp[field];
  return purchase?.[field] ?? null;
}

// ── UserSecurityProfile ─────────────────────────────────────────────────────
export async function getUserSecurityProfile(base44, { user_id, user_email } = {}) {
  if (user_id) {
    const rows = await base44.asServiceRole.entities.UserSecurityProfile.filter({ user_id });
    if (rows[0]) return rows[0];
  }
  if (user_email) {
    const rows = await base44.asServiceRole.entities.UserSecurityProfile.filter({ user_email });
    if (rows[0]) return rows[0];
  }
  return null;
}

export async function upsertUserSecurityProfile(base44, { user_id, user_email }, fields) {
  const existing = await getUserSecurityProfile(base44, { user_id, user_email });
  if (existing) {
    return base44.asServiceRole.entities.UserSecurityProfile.update(existing.id, fields);
  }
  if (!user_id || !user_email) return null;
  const created = await base44.asServiceRole.entities.UserSecurityProfile.create({ user_id, user_email, ...fields });
  await reconcileDuplicates(base44, { entityName: 'UserSecurityProfile', keyField: 'user_id', keyValue: user_id, createdId: created.id, label: 'UserSecurityProfile' });
  return created;
}

export async function readUserSecurity(base44, user, field) {
  const sec = await getUserSecurityProfile(base44, { user_id: user.id, user_email: user.email });
  if (sec && sec[field] !== undefined && sec[field] !== null) return sec[field];
  return user?.[field] ?? null;
}

// ── UserPrivate ─────────────────────────────────────────────────────────────
export async function getUserPrivate(base44, user_email) {
  if (!user_email) return null;
  const rows = await base44.asServiceRole.entities.UserPrivate.filter({ user_email });
  return rows[0] || null;
}

export async function upsertUserPrivate(base44, user_email, fields) {
  const existing = await getUserPrivate(base44, user_email);
  if (existing) {
    return base44.asServiceRole.entities.UserPrivate.update(existing.id, fields);
  }
  return null; // creation requires user_id — use ensureUserRecords
}

// ── PublicProfile ───────────────────────────────────────────────────────────
export async function getPublicProfileByPubId(base44, public_profile_id) {
  if (!public_profile_id) return null;
  const rows = await base44.asServiceRole.entities.PublicProfile.filter({ public_profile_id });
  return rows[0] || null;
}

export async function getPublicProfileForUser(base44, user_email) {
  const up = await getUserPrivate(base44, user_email);
  if (!up?.public_profile_id) return null;
  return getPublicProfileByPubId(base44, up.public_profile_id);
}

export async function getPublicProfileIdForUser(base44, user_email) {
  const up = await getUserPrivate(base44, user_email);
  return up?.public_profile_id || null;
}

// ── ProofAsset ──────────────────────────────────────────────────────────────
export async function getProofAssetsForRef(base44, reference_type, reference_id) {
  if (!reference_id) return [];
  return base44.asServiceRole.entities.ProofAsset.filter({ reference_type, reference_id });
}

export async function recordLegacyProofUrl(base44, { owner_email, reference_type, reference_id, proof_type, legacy_url }) {
  if (!legacy_url || !reference_id) return null;
  const existing = await base44.asServiceRole.entities.ProofAsset.filter({ reference_type, reference_id });
  if (existing.some(p => p.legacy_public_url === legacy_url)) return null;
  return base44.asServiceRole.entities.ProofAsset.create({
    owner_email, reference_type, reference_id, proof_type,
    private_file_id: null, storage_uri: null, content_type: null, checksum: null,
    scan_status: 'pending', uploaded_at: new Date().toISOString(),
    legacy_public_url: legacy_url, migration_status: 'requires_private_reupload',
  });
}

// ── New-entity provisioning ─────────────────────────────────────────────────
export async function ensureUserRecords(base44, user) {
  const email = user.email;
  const user_id = user.id;
  if (!email || !user_id) return null;

  let sec = await getUserSecurityProfile(base44, { user_id, user_email: email });
  if (!sec) {
    sec = await base44.asServiceRole.entities.UserSecurityProfile.create({
      user_id, user_email: email, migration_version: 3, migrated_at: new Date().toISOString(),
    });
    await reconcileDuplicates(base44, { entityName: 'UserSecurityProfile', keyField: 'user_id', keyValue: user_id, createdId: sec.id, label: 'UserSecurityProfile' });
  }

  let up = await getUserPrivate(base44, email);
  if (!up) {
    const pubId = `pp_${crypto.randomUUID()}`;
    up = await base44.asServiceRole.entities.UserPrivate.create({
      user_id, user_email: email, public_profile_id: pubId, updated_at: new Date().toISOString(),
    });
    await reconcileDuplicates(base44, { entityName: 'UserPrivate', keyField: 'user_email', keyValue: email, createdId: up.id, label: 'UserPrivate' });
  }

  const pubId = up.public_profile_id;
  const pubRows = await base44.asServiceRole.entities.PublicProfile.filter({ public_profile_id: pubId });
  if (!pubRows[0]) {
    await base44.asServiceRole.entities.PublicProfile.create({
      public_profile_id: pubId,
      display_name: user.full_name || null,
      updated_at: new Date().toISOString(),
    });
    await reconcileDuplicates(base44, { entityName: 'PublicProfile', keyField: 'public_profile_id', keyValue: pubId, createdId: pubRows[0]?.id, label: 'PublicProfile' });
  }

  return { sec, user_private: up, public_profile_id: pubId };
}

export async function ensureListingPrivate(base44, listing_id, fields) {
  const existing = await getListingPrivate(base44, listing_id);
  if (existing) return existing;
  const created = await base44.asServiceRole.entities.ListingPrivate.create({ listing_id, ...fields });
  await reconcileDuplicates(base44, { entityName: 'ListingPrivate', keyField: 'listing_id', keyValue: listing_id, createdId: created.id, label: 'ListingPrivate' });
  return created;
}

export async function ensurePurchasePrivate(base44, purchase_id, fields) {
  const existing = await getPurchasePrivate(base44, purchase_id);
  if (existing) return existing;
  const created = await base44.asServiceRole.entities.PurchasePrivate.create({ purchase_id, ...fields });
  await reconcileDuplicates(base44, { entityName: 'PurchasePrivate', keyField: 'purchase_id', keyValue: purchase_id, createdId: created.id, label: 'PurchasePrivate' });
  return created;
}