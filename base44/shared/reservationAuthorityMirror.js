/**
 * Reservation Authority Mirror (7C.9C.2E Correction Round 2 — Defect 3)
 *
 * Safe mirror projection using conditional updateMany with an expected
 * public-mirror version. Listing is a non-authoritative public read model.
 *
 * Round 2 corrections:
 *   - LP missing reservation_version → MIGRATION_REQUIRED (never version 0)
 *   - Listing missing reservation_version → MIRROR_MIGRATION_REQUIRED (never 0)
 *   - Equal version: derive expected public payload and compare every field;
 *     divergence does NOT return already_synced.
 *   - Post-sweep: re-fetch BOTH authority and mirror; verify version, status,
 *     hidden_reason.
 *   - Authority advances during sweep: retry from newest authority (bounded);
 *     if convergence cannot be proven, hide/quarantine Listing and return
 *     structured non-success.
 *   - Strict validation: listing ID, version types, mirror payload.
 *   - Reject unknown fields instead of silently dropping them.
 *   - Projection allowlist limited to: reservation_version, status, hidden_reason.
 *   - Never project private tuple or identity fields.
 *
 * No Deno/Node-specific imports — pure ESM JavaScript.
 */
import {
  FORBIDDEN_MIRROR_FIELDS, CALLER_ALLOWED_FIELDS, APPROVED_MIRROR_FIELDS,
  isValidVersion, isNonEmptyString,
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

// ── Validate mirror payload: reject forbidden and unknown fields ────────────
function validateMirrorPayload(mirror_payload) {
  if (!mirror_payload || typeof mirror_payload !== 'object' || Array.isArray(mirror_payload)) {
    return { ok: false, code: 'VALIDATION_ERROR', error: 'mirror_payload must be an object' };
  }
  // 1. Check for forbidden fields (recursive)
  const forbidden = [];
  findForbiddenFields(mirror_payload, '', forbidden);
  if (forbidden.length > 0) {
    return { ok: false, code: 'MIRROR_FORBIDDEN_FIELD', fields: forbidden };
  }
  // 2. Check for unknown fields (not in CALLER_ALLOWED_FIELDS)
  const unknown = [];
  for (const key of Object.keys(mirror_payload)) {
    if (!CALLER_ALLOWED_FIELDS.has(key)) {
      unknown.push(key);
    }
  }
  if (unknown.length > 0) {
    return { ok: false, code: 'MIRROR_UNKNOWN_FIELD', fields: unknown };
  }
  return { ok: true };
}

// ── Derive expected public payload from authority lifecycle state ──────────
function deriveExpectedPayload(lp_version, lifecycle_state) {
  const payload = { reservation_version: lp_version };
  if (lifecycle_state === 'frozen') {
    payload.status = 'hidden';
    payload.hidden_reason = 'checkout_quarantine';
  } else if (lifecycle_state === 'sold') {
    payload.status = 'sold';
    payload.hidden_reason = null;
  } else if (lifecycle_state === 'cancelled') {
    payload.status = 'cancelled';
    payload.hidden_reason = null;
  } else if (lifecycle_state === 'expired') {
    payload.status = 'expired';
    payload.hidden_reason = null;
  } else {
    payload.status = 'active';
    payload.hidden_reason = null;
  }
  return payload;
}

// ── Compare projected fields between expected and actual ────────────────────
function compareProjectedFields(expected, actual) {
  const mismatches = [];
  for (const key of Object.keys(expected)) {
    if (actual[key] !== expected[key]) {
      mismatches.push({ field: key, expected: expected[key], actual: actual[key] });
    }
  }
  return mismatches;
}

// ── Project a mirror update with conditional CAS ────────────────────────────
async function projectMirror(deps, listing_id, expected_current_version, new_version, mirror_payload) {
  // 1. Validate inputs
  if (!isNonEmptyString(listing_id)) {
    return { ok: false, code: 'VALIDATION_ERROR', error: 'listing_id must be a nonempty string' };
  }
  if (!isValidVersion(expected_current_version)) {
    return { ok: false, code: 'VALIDATION_ERROR', error: 'expected_current_version must be a nonnegative integer' };
  }
  if (!isValidVersion(new_version)) {
    return { ok: false, code: 'VALIDATION_ERROR', error: 'new_version must be a nonnegative integer' };
  }
  if (new_version <= expected_current_version) {
    return { ok: false, code: 'VALIDATION_ERROR', error: 'new_version must be > expected_current_version' };
  }

  // 2. Validate mirror payload (reject forbidden and unknown fields)
  const payloadCheck = validateMirrorPayload(mirror_payload);
  if (!payloadCheck.ok) {
    return { ok: false, code: payloadCheck.code, error: payloadCheck.error, fields: payloadCheck.fields };
  }

  // 3. Read the Listing to check for missing version
  let listing;
  try {
    const rows = await deps.entities.Listing.filter({ id: listing_id });
    listing = rows[0] || null;
  } catch (e) {
    return { ok: false, code: 'MIRROR_READ_ERROR', error: e?.message || String(e) };
  }
  if (!listing) return { ok: false, code: 'MIRROR_NOT_FOUND', error: 'mirror not found' };

  // Listing missing reservation_version → MIRROR_MIGRATION_REQUIRED
  if (listing.reservation_version === null || listing.reservation_version === undefined) {
    return { ok: false, code: 'MIRROR_MIGRATION_REQUIRED', error: 'Listing missing reservation_version — initialization required' };
  }

  // 4. Build approved payload
  const approved = { ...mirror_payload };
  approved.reservation_version = new_version;

  // 5. Conditional updateMany (CAS) with expected_current_version
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
    // 6. CAS won — re-fetch and verify every projected field
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

  // 7. CAS lost — re-fetch to determine stale vs conflict
  let current;
  try {
    const rows = await deps.entities.Listing.filter({ id: listing_id });
    current = rows[0] || null;
  } catch (e) {
    return { ok: false, code: 'MIRROR_REREAD_ERROR', error: e?.message || String(e) };
  }
  if (!current) return { ok: false, code: 'MIRROR_NOT_FOUND', error: 'mirror not found' };

  const current_version = current.reservation_version;

  if (current_version > new_version) {
    return { ok: false, code: 'STALE_MIRROR', current_mirror_version: current_version, attempted_version: new_version };
  }
  if (current_version === new_version) {
    // Equal version — compare every projected field; divergence is NOT already_synced
    for (const key of Object.keys(approved)) {
      if (key === 'reservation_version') continue;
      if (current[key] !== approved[key]) {
        return { ok: false, code: 'MIRROR_CONFLICT', current_mirror_version: current_version, field: key, expected: approved[key], actual: current[key] };
      }
    }
    return { ok: true, mirror_version: new_version, already_synced: true };
  }
  return { ok: false, code: 'MIRROR_CAS_LOST', current_mirror_version: current_version, attempted_version: new_version };
}

// ── Sweep: repair stale mirror from authority (bounded retry) ───────────────
async function sweepMirror(deps, listing_id) {
  // 1. Validate listing_id
  if (!isNonEmptyString(listing_id)) {
    return { ok: false, code: 'VALIDATION_ERROR', error: 'listing_id must be a nonempty string' };
  }

  const MAX_RETRIES = 3;
  let lastResult = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // 2. Read authority (LP)
    let lp;
    try {
      const rows = await deps.entities.ListingPrivate.filter({ listing_id });
      lp = rows[0] || null;
    } catch (e) {
      return { ok: false, code: 'SWEEP_AUTHORITY_ERROR', error: e?.message || String(e) };
    }
    if (!lp) return { ok: false, code: 'NOT_FOUND', error: 'authority not found' };

    // LP missing reservation_version → MIGRATION_REQUIRED
    if (lp.reservation_version === null || lp.reservation_version === undefined) {
      return { ok: false, code: 'MIGRATION_REQUIRED', error: 'ListingPrivate missing reservation_version — initialization required' };
    }

    const lp_version = lp.reservation_version;
    const lp_state = lp.reservation_lifecycle_state || 'available';

    // 3. Read mirror (Listing)
    let listing;
    try {
      const rows = await deps.entities.Listing.filter({ id: listing_id });
      listing = rows[0] || null;
    } catch (e) {
      return { ok: false, code: 'SWEEP_MIRROR_ERROR', error: e?.message || String(e) };
    }
    if (!listing) return { ok: false, code: 'MIRROR_NOT_FOUND', error: 'mirror not found' };

    // Listing missing reservation_version → MIRROR_MIGRATION_REQUIRED
    if (listing.reservation_version === null || listing.reservation_version === undefined) {
      return { ok: false, code: 'MIRROR_MIGRATION_REQUIRED', error: 'Listing missing reservation_version — initialization required' };
    }

    const current_mirror_version = listing.reservation_version;

    // 4. Equal versions — derive expected payload and compare every field
    if (current_mirror_version === lp_version) {
      const expected = deriveExpectedPayload(lp_version, lp_state);
      const mismatches = compareProjectedFields(expected, listing);
      if (mismatches.length === 0) {
        return { ok: true, already_synced: true, mirror_version: lp_version };
      }
      // Divergence at equal version — need to update fields without changing version
      // Use CAS with current version to update status/hidden_reason only
      const fieldUpdate = { status: expected.status, hidden_reason: expected.hidden_reason };
      let casResult;
      try {
        casResult = await deps.entities.Listing.updateMany(
          { id: listing_id, reservation_version: current_mirror_version },
          { $set: fieldUpdate }
        );
      } catch (e) {
        return { ok: false, code: 'SWEEP_CAS_ERROR', error: e?.message || String(e) };
      }
      if (casResult.updated > 0) {
        // Re-fetch and verify
        let verified;
        try {
          const rows = await deps.entities.Listing.filter({ id: listing_id });
          verified = rows[0] || null;
        } catch (e) {
          return { ok: false, code: 'SWEEP_VERIFY_ERROR', error: e?.message || String(e) };
        }
        if (!verified || verified.reservation_version !== lp_version ||
            verified.status !== expected.status ||
            verified.hidden_reason !== expected.hidden_reason) {
          return { ok: false, code: 'SWEEP_VERIFY_MISMATCH', error: 'field mismatch after equal-version repair' };
        }
        return { ok: true, repaired: true, mirror_version: lp_version, fields_repaired: mismatches.map(m => m.field) };
      }
      // CAS lost — another sweeper modified it; retry
      lastResult = { ok: false, code: 'SWEEP_CAS_LOST', current_mirror_version, authority_version: lp_version };
      continue;
    }

    // 5. Mirror newer than authority — corruption
    if (current_mirror_version > lp_version) {
      return { ok: false, code: 'MIRROR_NEWER_THAN_AUTHORITY', mirror_version: current_mirror_version, authority_version: lp_version };
    }

    // 6. Mirror behind authority — CAS update
    const approvedPayload = deriveExpectedPayload(lp_version, lp_state);

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
      if (deps.hooks?.afterSweepCAS) {
        try { await deps.hooks.afterSweepCAS(deps, listing_id); } catch (e) { /* non-fatal */ }
      }
      // 7. Re-fetch BOTH authority and mirror
      let lpAfter, listingAfter;
      try {
        const lpRows = await deps.entities.ListingPrivate.filter({ listing_id });
        lpAfter = lpRows[0] || null;
        const lRows = await deps.entities.Listing.filter({ id: listing_id });
        listingAfter = lRows[0] || null;
      } catch (e) {
        return { ok: false, code: 'SWEEP_REREAD_ERROR', error: e?.message || String(e) };
      }

      if (!lpAfter) return { ok: false, code: 'NOT_FOUND', error: 'authority disappeared after sweep' };
      if (!listingAfter) return { ok: false, code: 'MIRROR_NOT_FOUND', error: 'mirror disappeared after sweep' };

      // 8. Verify authority hasn't advanced
      if (lpAfter.reservation_version !== lp_version) {
        // Authority advanced during sweep — projection is stale
        // Retry from newest authority
        lastResult = {
          ok: false, code: 'STALE_PROJECTION',
          projected_version: lp_version,
          current_authority_version: lpAfter.reservation_version,
        };
        continue;
      }

      // 9. Verify mirror: version, status, hidden_reason
      if (listingAfter.reservation_version !== lp_version) {
        return { ok: false, code: 'SWEEP_VERIFY_MISMATCH', error: `mirror version: expected ${lp_version}, got ${listingAfter.reservation_version}` };
      }
      const expectedAfter = deriveExpectedPayload(lp_version, lp_state);
      if (listingAfter.status !== expectedAfter.status) {
        return { ok: false, code: 'SWEEP_VERIFY_MISMATCH', error: `mirror status: expected ${expectedAfter.status}, got ${listingAfter.status}` };
      }
      if (listingAfter.hidden_reason !== expectedAfter.hidden_reason) {
        return { ok: false, code: 'SWEEP_VERIFY_MISMATCH', error: `mirror hidden_reason: expected ${expectedAfter.hidden_reason}, got ${listingAfter.hidden_reason}` };
      }

      return { ok: true, repaired: true, mirror_version: lp_version, verified: true };
    }

    // CAS lost — retry from current state
    lastResult = { ok: false, code: 'SWEEP_CAS_LOST', current_mirror_version, authority_version: lp_version };
  }

  // Exhausted retries — hide/quarantine Listing and return structured non-success
  // Attempt to hide the Listing as a safety measure
  try {
    await deps.entities.Listing.updateMany(
      { id: listing_id },
      { $set: { status: 'hidden', hidden_reason: 'checkout_quarantine' } }
    );
  } catch (e) {
    // Best-effort hide
  }

  return {
    ok: false,
    code: 'SWEEP_CONVERGENCE_FAILED',
    error: `sweep could not converge after ${MAX_RETRIES} attempts — Listing hidden as safety measure`,
    last_result: lastResult,
    hidden: true,
  };
}

// ── Factory ──────────────────────────────────────────────────────────────────
export function createMirrorAuthority(deps) {
  return {
    projectMirror: (listing_id, expected_current_version, new_version, mirror_payload) =>
      projectMirror(deps, listing_id, expected_current_version, new_version, mirror_payload),
    sweepMirror: (listing_id) => sweepMirror(deps, listing_id),
  };
}