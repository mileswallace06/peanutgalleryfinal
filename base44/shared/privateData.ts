/**
 * privateData.ts — shared private-entity access layer for Phase 1B backend cutover.
 *
 * All backend functions read/write sensitive data through these helpers.
 * Pattern:
 *   READ  → private sidecar first, legacy field as temporary fallback
 *   WRITE → private sidecar is the authoritative destination
 *
 * Legacy fields on Listing/Purchase/User are NOT cleared (Phase 1B rule 2).
 * During the transition, callers may also mirror writes to legacy fields so
 * the not-yet-cut-over frontend keeps working; the private record is canonical.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

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
  return base44.asServiceRole.entities.ListingPrivate.create({ listing_id, ...fields });
}

/**
 * Read a single private Listing field with legacy fallback.
 * Usage: const token = await readListingPrivate(base44, listing, 'reservation_token');
 */
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
  return base44.asServiceRole.entities.PurchasePrivate.create({ purchase_id, ...fields });
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
  return base44.asServiceRole.entities.UserSecurityProfile.create({ user_id, user_email, ...fields });
}

/**
 * Read a User security field with legacy User fallback.
 * Usage: const strikes = await readUserSecurity(base44, user, 'strike_count');
 */
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

/**
 * Record a legacy public proof URL as a ProofAsset stub (requires_private_reupload).
 * Idempotent on (reference_id, legacy_public_url).
 */
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
/**
 * Ensure a brand-new User has all three private records (UserSecurityProfile,
 * UserPrivate, PublicProfile). Called when a user is created/onboarded.
 * Idempotent — no-op if records already exist.
 */
export async function ensureUserRecords(base44, user) {
  const email = user.email;
  const user_id = user.id;
  if (!email || !user_id) return null;

  let sec = await getUserSecurityProfile(base44, { user_id, user_email: email });
  if (!sec) {
    sec = await base44.asServiceRole.entities.UserSecurityProfile.create({
      user_id, user_email: email, migration_version: 3, migrated_at: new Date().toISOString(),
    });
  }

  let up = await getUserPrivate(base44, email);
  if (!up) {
    const pubId = `pp_${crypto.randomUUID()}`;
    up = await base44.asServiceRole.entities.UserPrivate.create({
      user_id, user_email: email, public_profile_id: pubId, updated_at: new Date().toISOString(),
    });
  }

  const pubId = up.public_profile_id;
  const pubRows = await base44.asServiceRole.entities.PublicProfile.filter({ public_profile_id: pubId });
  if (!pubRows[0]) {
    await base44.asServiceRole.entities.PublicProfile.create({
      public_profile_id: pubId,
      display_name: user.full_name || null,
      updated_at: new Date().toISOString(),
    });
  }

  return { sec, user_private: up, public_profile_id: pubId };
}

/**
 * Ensure a newly-created Listing has its ListingPrivate sidecar.
 * `fields` should contain the sensitive values to seed.
 */
export async function ensureListingPrivate(base44, listing_id, fields) {
  const existing = await getListingPrivate(base44, listing_id);
  if (existing) return existing;
  return base44.asServiceRole.entities.ListingPrivate.create({ listing_id, ...fields });
}

/**
 * Ensure a newly-created Purchase has its PurchasePrivate sidecar.
 */
export async function ensurePurchasePrivate(base44, purchase_id, fields) {
  const existing = await getPurchasePrivate(base44, purchase_id);
  if (existing) return existing;
  return base44.asServiceRole.entities.PurchasePrivate.create({ purchase_id, ...fields });
}