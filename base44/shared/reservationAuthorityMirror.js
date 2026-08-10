/**
 * Reservation Authority Mirror (7C.9C.2E Correction — Defect 2)
 *
 * Safe mirror projection using conditional updateMany with an expected
 * public-mirror version. Listing is a non-authoritative public read model.
 *
 * Safety guarantees:
 *   - Conditional updateMany (CAS) — no read-then-write gap
 *   - Delayed old projection cannot overwrite newer committed mirror
 *   - Equal version + different payload → MIRROR_CONFLICT
 *   - Re-fetch after CAS win and verify every projected field
 *   - Two concurrent sweepers converge to newest authority version
 *   - Authority advancing during sweep → STALE_PROJECTION
 *   - Forbidden fields never projected (recursive check)
 *   - Only approved public fields projected
 *
 * No Deno/Node-specific imports — pure ESM JavaScript.
 */
import {
  FORBIDDEN_MIRROR_FIELDS, APPROVED_MIRROR_FIELDS,
} from './reservationAuthorityConstants.js';

// ── Recursively check for forbidden fields in a payload ──────────────────────
function findForbiddenFields(obj, prefix, found) {
  if (obj === null || typeof obj !== 'object') return;
  for (const key of Object.keys(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (FORBIDDEN_MIRROR_FIELDS.has(key)) {
      found.push(path);
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      findForbiddenFields(obj[key], path, found);
    }
  }
}

// ── Filter payload to only approved fields ──────────────────────────────────
function filterApproved(payload) {
  const approved = {};
  for (const key of Object.keys(payload)) {
    if (APPROVED_MIRROR_FIELDS.has(key)) {
      approved[key] = payload[key];
    }
  }
  return approved;
}

// ── Project a mirror update with conditional CAS ────────────────────────────
// listing_id: target Listing record
// expected_current_version: the mirror version the caller expects (CAS predicate)
// new_version: the version to project (must be > expected_current_version)
// mirror_payload: only approved public fields (status, hidden_reason)
async function projectMirror(deps, listing_id, expected_current_version, new_version, mirror_payload) {
  if (new_version <= expected_current_version) {
    return { ok: false, code: 'VALIDATION_ERROR', error: 'new_version must be > expected_current_version' };
  }

  // 1. Check for forbidden fields (recursive)
  const forbidden = [];
  findForbiddenFields(mirror_payload, '', forbidden);
  if (forbidden.length > 0) {
    return { ok: false, code: 'MIRROR_FORBIDDEN_FIELD', fields: forbidden };
  }

  // 2. Filter to approved fields only
  const approved = filterApproved(mirror_payload);
  approved.reservation_version = new_version;

  // 3. Conditional updateMany (CAS) with expected_current_version
  // Hook: beforeMirrorCAS (for delayed-projection race tests)
  if (deps.hooks?.beforeMirrorCAS) {
    try { await deps.hooks.beforeMirrorCAS(deps, listing_id); } catch (e) { /* non-fatal */ }
  }
  let casResult;
  try {
    casResult = await deps.entities.Listing.updateMany(
      { id: listing_id, reservation_version: expected_current_version },
      { $set: approved }
    );
  } catch (e) {
    return { ok: false, code: 'MIRROR_CAS_ERROR', error: e?.message || String(e) };
  }

  const updated = casResult.updated || 0;

  if (updated > 0) {
    // 4. CAS won — re-fetch and verify every projected field
    let verified;
    try {
      const rows = await deps.entities.Listing.filter({ id: listing_id });
      verified = rows[0] || null;
    } catch (e) {
      return { ok: false, code: 'MIRROR_VERIFY_ERROR', error: e?.message || String(e) };
    }
    if (!verified) return { ok: false, code: 'MIRROR_VERIFY_ERROR', error: 'mirror not found after CAS' };
    if (verified.reservation_version !== new_version) {
      return { ok: false, code: 'MIRROR_VERIFY_MISMATCH', error: `version: expected ${new_version}, got ${verified.reservation_version}` };
    }
    for (const key of Object.keys(approved)) {
      if (verified[key] !== approved[key]) {
        return { ok: false, code: 'MIRROR_VERIFY_MISMATCH', error: `field ${key}: expected ${approved[key]}, got ${verified[key]}` };
      }
    }
    return { ok: true, mirror_version: new_version, verified: true };
  }

  // 5. CAS lost — re-fetch to determine stale vs conflict
  let current;
  try {
    const rows = await deps.entities.Listing.filter({ id: listing_id });
    current = rows[0] || null;
  } catch (e) {
    return { ok: false, code: 'MIRROR_REREAD_ERROR', error: e?.message || String(e) };
  }
  if (!current) return { ok: false, code: 'MIRROR_NOT_FOUND', error: 'mirror not found' };

  const current_version = current.reservation_version ?? 0;

  if (current_version > new_version) {
    // Mirror is newer — delayed old projection
    return { ok: false, code: 'STALE_MIRROR', current_mirror_version: current_version, attempted_version: new_version };
  }
  if (current_version === new_version) {
    // Equal version — check if payload matches
    for (const key of Object.keys(approved)) {
      if (key === 'reservation_version') continue;
      if (current[key] !== approved[key]) {
        return { ok: false, code: 'MIRROR_CONFLICT', current_mirror_version: current_version, field: key, expected: approved[key], actual: current[key] };
      }
    }
    // Already synced with same payload — idempotent
    return { ok: true, mirror_version: new_version, already_synced: true };
  }
  // current_version < new_version but CAS lost — version changed between read and CAS
  // (shouldn't happen in normal flow, but handle it)
  return { ok: false, code: 'MIRROR_CAS_LOST', current_mirror_version: current_version, attempted_version: new_version };
}

// ── Sweep: repair stale mirror from authority ───────────────────────────────
async function sweepMirror(deps, listing_id) {
  // 1. Read authority (LP)
  let lp;
  try {
    const rows = await deps.entities.ListingPrivate.filter({ listing_id });
    lp = rows[0] || null;
  } catch (e) {
    return { ok: false, code: 'SWEEP_AUTHORITY_ERROR', error: e?.message || String(e) };
  }
  if (!lp) return { ok: false, code: 'NOT_FOUND', error: 'authority not found' };

  const lp_version = lp.reservation_version ?? 0;

  // 2. Read mirror (Listing)
  let listing;
  try {
    const rows = await deps.entities.Listing.filter({ id: listing_id });
    listing = rows[0] || null;
  } catch (e) {
    return { ok: false, code: 'SWEEP_MIRROR_ERROR', error: e?.message || String(e) };
  }
  if (!listing) return { ok: false, code: 'MIRROR_NOT_FOUND', error: 'mirror not found' };

  const current_mirror_version = listing.reservation_version ?? 0;

  // 3. Already synced
  if (current_mirror_version === lp_version) {
    return { ok: true, already_synced: true, mirror_version: lp_version };
  }
  // 4. Mirror newer than authority — corruption
  if (current_mirror_version > lp_version) {
    return { ok: false, code: 'MIRROR_NEWER_THAN_AUTHORITY', mirror_version: current_mirror_version, authority_version: lp_version };
  }

  // 5. CAS updateMany: predicate = current_mirror_version, set = lp_version
  const approvedPayload = { reservation_version: lp_version };
  // Derive public status from lifecycle state
  if (lp.reservation_lifecycle_state === 'frozen') {
    approvedPayload.status = 'hidden';
    approvedPayload.hidden_reason = 'checkout_quarantine';
  } else if (lp.reservation_lifecycle_state === 'sold') {
    approvedPayload.status = 'sold';
    approvedPayload.hidden_reason = null;
  } else if (lp.reservation_lifecycle_state === 'cancelled') {
    approvedPayload.status = 'cancelled';
    approvedPayload.hidden_reason = null;
  } else if (lp.reservation_lifecycle_state === 'expired') {
    approvedPayload.status = 'expired';
    approvedPayload.hidden_reason = null;
  } else {
    approvedPayload.status = 'active';
    approvedPayload.hidden_reason = null;
  }

  let casResult;
  try {
    casResult = await deps.entities.Listing.updateMany(
      { id: listing_id, reservation_version: current_mirror_version },
      { $set: approvedPayload }
    );
  } catch (e) {
    return { ok: false, code: 'SWEEP_CAS_ERROR', error: e?.message || String(e) };
  }

  const updated = casResult.updated || 0;

  if (updated > 0) {
    // Hook: afterSweepCAS (for authority-advancing-during-sweep tests)
    if (deps.hooks?.afterSweepCAS) {
      try { await deps.hooks.afterSweepCAS(deps, listing_id); } catch (e) { /* non-fatal */ }
    }
    // 6. Re-read authority to verify it hasn't advanced during sweep
    let lpAfter;
    try {
      const rows = await deps.entities.ListingPrivate.filter({ listing_id });
      lpAfter = rows[0] || null;
    } catch (e) {
      return { ok: false, code: 'SWEEP_AUTHORITY_REREAD_ERROR', error: e?.message || String(e) };
    }
    if (!lpAfter) return { ok: false, code: 'NOT_FOUND', error: 'authority disappeared after sweep' };

    if (lpAfter.reservation_version !== lp_version) {
      // Authority advanced during sweep — projection is stale
      return { ok: false, code: 'STALE_PROJECTION', projected_version: lp_version, current_authority_version: lpAfter.reservation_version };
    }

    // 7. Verify mirror
    let verifiedListing;
    try {
      const rows = await deps.entities.Listing.filter({ id: listing_id });
      verifiedListing = rows[0] || null;
    } catch (e) {
      return { ok: false, code: 'SWEEP_VERIFY_ERROR', error: e?.message || String(e) };
    }
    if (!verifiedListing || verifiedListing.reservation_version !== lp_version) {
      return { ok: false, code: 'SWEEP_VERIFY_MISMATCH', error: 'mirror version mismatch after sweep' };
    }
    return { ok: true, repaired: true, mirror_version: lp_version };
  }

  // CAS lost — another sweeper won or mirror changed
  let currentAfter;
  try {
    const rows = await deps.entities.Listing.filter({ id: listing_id });
    currentAfter = rows[0] || null;
  } catch (e) {
    return { ok: false, code: 'SWEEP_REREAD_ERROR', error: e?.message || String(e) };
  }
  if (!currentAfter) return { ok: false, code: 'MIRROR_NOT_FOUND' };

  const after_version = currentAfter.reservation_version ?? 0;
  if (after_version === lp_version) {
    // Another sweeper already synced to the same version
    return { ok: true, already_synced: true, mirror_version: lp_version };
  }
  if (after_version > lp_version) {
    // Mirror is now newer — another sweeper projected a newer version
    return { ok: false, code: 'STALE_PROJECTION', projected_version: lp_version, current_mirror_version: after_version };
  }
  // Still behind — retry needed
  return { ok: false, code: 'SWEEP_CAS_LOST', current_mirror_version: after_version, authority_version: lp_version };
}

// ── Factory ──────────────────────────────────────────────────────────────────
export function createMirrorAuthority(deps) {
  return {
    projectMirror: (listing_id, expected_current_version, new_version, mirror_payload) =>
      projectMirror(deps, listing_id, expected_current_version, new_version, mirror_payload),
    sweepMirror: (listing_id) => sweepMirror(deps, listing_id),
  };
}