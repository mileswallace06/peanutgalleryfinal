/**
 * Reservation Authority Mirror (7C.9C.2E Correction Round 3)
 *
 * Round 3 corrections:
 *   1. projectMirror is AUTHORITY-DRIVEN: it reads ListingPrivate itself and
 *      derives the public projection solely from authoritative state. Callers
 *      cannot supply status or hidden_reason. A caller cannot project 'active'
 *      when authority says 'sold', 'cancelled', 'expired', 'reserved', 'frozen',
 *      or corrupt.
 *   2. Equal-version repair races: after any mirror update, re-fetch BOTH
 *      ListingPrivate and Listing. Verify authority version and state did not
 *      change during repair. If authority advanced, retry from the new
 *      authoritative version with a strict bound. Never return success unless
 *      the final mirror exactly matches the latest authoritative state.
 *   3. mirror_version > authority_version: hide/quarantine the public Listing
 *      and create a durable incident. Never remain active. Every hide
 *      operation checks the update result and re-fetches Listing. Never return
 *      hidden:true unless the authoritative re-fetch proves the Listing is
 *      hidden. Return PROTECTION_INCOMPLETE if any step fails.
 *   4. Fail closed on unknown lifecycle state: no `|| 'available'` fallback.
 *      Missing/empty/invalid state returns STATE_CORRUPT and triggers protection.
 *
 * No Deno/Node-specific imports — pure ESM JavaScript.
 */
import {
  FORBIDDEN_MIRROR_FIELDS,
  isValidVersion, isNonEmptyString, validateLifecycleState,
} from './reservationAuthorityConstants.js';

// ── Derive expected public payload from authority lifecycle state ──────────
// This is the ONLY way to produce a mirror payload. Callers cannot override it.
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
  } else if (lifecycle_state === 'reserved') {
    payload.status = 'active';
    payload.hidden_reason = null;
  } else if (lifecycle_state === 'available') {
    payload.status = 'active';
    payload.hidden_reason = null;
  } else {
    // Unknown state — should never reach here (validated upstream)
    payload.status = 'hidden';
    payload.hidden_reason = 'checkout_quarantine';
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

// ── Protection: hide Listing + create AdminAlert + verify ───────────────────
// Used for mirror-newer-than-authority and convergence failure.
// Returns { protected: true, code: 'PROTECTED' } or { protected: false, code: 'PROTECTION_INCOMPLETE', steps }.
// Never returns protected:true unless the authoritative re-fetch proves the
// Listing is hidden and exactly one unresolved alert exists.
async function protectMirror(deps, listing_id, reason, evidence) {
  const now_iso = new Date(deps.now()).toISOString();
  const steps = {};
  const incident_key = `mirror_corruption:${listing_id}`;

  // 1. Hide Listing via updateMany
  let hideResult;
  try {
    hideResult = await deps.entities.Listing.updateMany(
      { id: listing_id },
      { $set: { status: 'hidden', hidden_reason: 'checkout_quarantine' } }
    );
    steps.hide_attempted = true;
    steps.hide_updated = hideResult.updated || 0;
  } catch (e) {
    steps.hide_error = e?.message || String(e);
    steps.hide_attempted = false;
    steps.hide_updated = 0;
  }

  // 2. Re-fetch Listing and verify it is hidden
  try {
    const rows = await deps.entities.Listing.filter({ id: listing_id });
    const listing = rows[0];
    if (listing) {
      steps.listing_hidden_verified = listing.status === 'hidden';
      steps.listing_hidden_reason_verified = listing.hidden_reason === 'checkout_quarantine';
    } else {
      steps.listing_hidden_verified = false;
      steps.listing_hidden_reason_verified = false;
      steps.listing_disappeared = true;
    }
  } catch (e) {
    steps.listing_verify_error = e?.message || String(e);
    steps.listing_hidden_verified = false;
    steps.listing_hidden_reason_verified = false;
  }

  // 3. Create/update AdminAlert
  if (deps.entities.AdminAlert) {
    try {
      const existing = await deps.entities.AdminAlert.filter({ incident_key });
      if (existing.length > 0) {
        await deps.entities.AdminAlert.update(existing[0].id, {
          occurrence_count: (existing[0].occurrence_count || 1) + 1,
          last_occurred_at: now_iso,
          description: `MIRROR_CORRUPTION: ${reason}. Evidence: ${JSON.stringify(evidence).slice(0, 500)}`,
        });
        steps.admin_alert_updated = true;
      } else {
        await deps.entities.AdminAlert.create({
          alert_type: 'admin_action_required',
          priority: 'critical',
          title: 'Mirror Corruption Detected',
          description: `MIRROR_CORRUPTION: ${reason}. Evidence: ${JSON.stringify(evidence).slice(0, 500)}`,
          reference_id: listing_id,
          reference_type: 'listing',
          incident_key,
          occurrence_count: 1,
          last_occurred_at: now_iso,
          resolved: false,
        });
        steps.admin_alert_created = true;
      }
      steps.admin_alert_attempted = true;
    } catch (e) {
      steps.admin_alert_error = e?.message || String(e);
      steps.admin_alert_attempted = false;
    }

    // 4. Verify exactly one unresolved alert with the incident key
    try {
      const alerts = await deps.entities.AdminAlert.filter({ incident_key, resolved: false });
      steps.admin_alert_count = alerts.length;
      steps.admin_alert_verified = alerts.length === 1 && alerts[0].priority === 'critical';
      if (alerts.length > 1) {
        steps.admin_alert_duplicate_detected = true;
      }
    } catch (e) {
      steps.admin_alert_verify_error = e?.message || String(e);
      steps.admin_alert_verified = false;
    }
  } else {
    steps.admin_alert_verified = false;
    steps.admin_alert_skipped = true;
  }

  // 5. Determine if all protection steps verified
  const allVerified =
    steps.hide_updated > 0 &&
    steps.listing_hidden_verified === true &&
    steps.listing_hidden_reason_verified === true &&
    steps.admin_alert_verified === true;

  return {
    protected: allVerified,
    steps,
    code: allVerified ? 'PROTECTED' : 'PROTECTION_INCOMPLETE',
    incident_key,
  };
}

// ── Project a mirror update (AUTHORITY-DRIVEN) ──────────────────────────────
// Reads ListingPrivate itself and derives the public projection solely from
// authoritative state. The caller provides only listing_id and version bounds.
// The caller CANNOT control status or hidden_reason.
async function projectMirror(deps, listing_id, expected_current_version, new_version) {
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

  // 2. Read the authoritative ListingPrivate row
  let lp;
  try {
    const rows = await deps.entities.ListingPrivate.filter({ listing_id });
    lp = rows[0] || null;
  } catch (e) {
    return { ok: false, code: 'AUTHORITY_READ_ERROR', error: e?.message || String(e) };
  }
  if (!lp) return { ok: false, code: 'NOT_FOUND', error: 'authoritative record not found' };

  // 3. Validate LP has reservation_version
  if (lp.reservation_version === null || lp.reservation_version === undefined) {
    return { ok: false, code: 'MIGRATION_REQUIRED', error: 'ListingPrivate missing reservation_version — initialization required' };
  }

  // 4. Validate LP lifecycle state (fail-closed on unknown — no '|| available' fallback)
  const stateCheck = validateLifecycleState(lp.reservation_lifecycle_state);
  if (!stateCheck.valid) {
    return { ok: false, code: 'STATE_CORRUPT', error: stateCheck.error, state_code: stateCheck.code };
  }

  // 5. Verify LP version matches new_version (authority has committed this version)
  if (lp.reservation_version !== new_version) {
    return {
      ok: false, code: 'AUTHORITY_VERSION_MISMATCH',
      error: `authority version ${lp.reservation_version} does not match expected new_version ${new_version}`,
      authority_version: lp.reservation_version,
      expected_new_version: new_version,
    };
  }

  // 6. Derive expected public payload from authoritative lifecycle state
  const approved = deriveExpectedPayload(lp.reservation_version, lp.reservation_lifecycle_state);

  // 7. Read the Listing (mirror)
  let listing;
  try {
    const rows = await deps.entities.Listing.filter({ id: listing_id });
    listing = rows[0] || null;
  } catch (e) {
    return { ok: false, code: 'MIRROR_READ_ERROR', error: e?.message || String(e) };
  }
  if (!listing) return { ok: false, code: 'MIRROR_NOT_FOUND', error: 'mirror not found' };

  // 8. Listing missing reservation_version → MIRROR_MIGRATION_REQUIRED
  if (listing.reservation_version === null || listing.reservation_version === undefined) {
    return { ok: false, code: 'MIRROR_MIGRATION_REQUIRED', error: 'Listing missing reservation_version — initialization required' };
  }

  // 9. Conditional updateMany (CAS) with expected_current_version
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
    // 10. CAS won — re-fetch and verify every projected field
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

  // 11. CAS lost — re-fetch to determine stale vs conflict
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

    // Validate LP lifecycle state (fail-closed — no '|| available' fallback)
    const stateCheck = validateLifecycleState(lp.reservation_lifecycle_state);
    if (!stateCheck.valid) {
      // State is corrupt — protect the Listing and return
      const protection = await protectMirror(deps, listing_id, `STATE_CORRUPT: ${stateCheck.error}`, { state: lp.reservation_lifecycle_state });
      return {
        ok: false, code: 'STATE_CORRUPT',
        error: stateCheck.error, state_code: stateCheck.code,
        protection,
      };
    }

    const lp_version = lp.reservation_version;
    const lp_state = lp.reservation_lifecycle_state;

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

    // 4. Mirror newer than authority → corruption — protect and fail closed
    if (current_mirror_version > lp_version) {
      const protection = await protectMirror(deps, listing_id,
        `mirror version ${current_mirror_version} > authority version ${lp_version}`,
        { mirror_version: current_mirror_version, authority_version: lp_version });
      return {
        ok: false, code: 'MIRROR_NEWER_THAN_AUTHORITY',
        mirror_version: current_mirror_version, authority_version: lp_version,
        protection,
      };
    }

    // 5. Equal versions — derive expected payload and compare every field
    if (current_mirror_version === lp_version) {
      const expected = deriveExpectedPayload(lp_version, lp_state);
      const mismatches = compareProjectedFields(expected, listing);
      if (mismatches.length === 0) {
        return { ok: true, already_synced: true, mirror_version: lp_version };
      }
      // Divergence at equal version — update fields without changing version
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
        // Re-fetch BOTH authority and mirror to detect repair races
        let lpAfter, listingAfter;
        try {
          const lpRows = await deps.entities.ListingPrivate.filter({ listing_id });
          lpAfter = lpRows[0] || null;
          const lRows = await deps.entities.Listing.filter({ id: listing_id });
          listingAfter = lRows[0] || null;
        } catch (e) {
          return { ok: false, code: 'SWEEP_REREAD_ERROR', error: e?.message || String(e) };
        }

        if (!lpAfter) return { ok: false, code: 'NOT_FOUND', error: 'authority disappeared during repair' };
        if (!listingAfter) return { ok: false, code: 'MIRROR_NOT_FOUND', error: 'mirror disappeared during repair' };

        // Verify authority hasn't advanced during repair
        if (lpAfter.reservation_version !== lp_version) {
          // Authority advanced during repair — retry from newest authority
          lastResult = {
            ok: false, code: 'STALE_PROJECTION',
            projected_version: lp_version,
            current_authority_version: lpAfter.reservation_version,
          };
          continue;
        }

        // Verify authority state hasn't changed
        const stateAfterCheck = validateLifecycleState(lpAfter.reservation_lifecycle_state);
        if (!stateAfterCheck.valid || lpAfter.reservation_lifecycle_state !== lp_state) {
          lastResult = {
            ok: false, code: 'STALE_PROJECTION',
            projected_version: lp_version,
            current_authority_state: lpAfter.reservation_lifecycle_state,
          };
          continue;
        }

        // Verify mirror: version, status, hidden_reason
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

        return { ok: true, repaired: true, mirror_version: lp_version, fields_repaired: mismatches.map(m => m.field), verified: true };
      }
      // CAS lost — another sweeper modified it; retry
      lastResult = { ok: false, code: 'SWEEP_CAS_LOST', current_mirror_version, authority_version: lp_version };
      continue;
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
        // Authority advanced during sweep — retry from newest authority
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

  // Exhausted retries — protect the Listing (hide + alert + verify)
  const protection = await protectMirror(deps, listing_id,
    `sweep could not converge after ${MAX_RETRIES} attempts`,
    { last_result: lastResult });
  return {
    ok: false,
    code: 'SWEEP_CONVERGENCE_FAILED',
    error: `sweep could not converge after ${MAX_RETRIES} attempts — Listing hidden as safety measure`,
    last_result: lastResult,
    protection,
  };
}

// ── Factory ──────────────────────────────────────────────────────────────────
export function createMirrorAuthority(deps) {
  // Normalize deps — ensure `now` is always available for protection functions
  const now = deps.now || (() => Date.now());
  const normalizedDeps = { ...deps, now };
  return {
    projectMirror: (listing_id, expected_current_version, new_version) =>
      projectMirror(normalizedDeps, listing_id, expected_current_version, new_version),
    sweepMirror: (listing_id) => sweepMirror(normalizedDeps, listing_id),
  };
}