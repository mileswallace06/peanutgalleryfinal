/**
 * canaryMirror.js — Shared helpers for authority_v1 canary mirror writes.
 *
 * Extracted from authCanary.js so both the user-initiated canary reserve/release
 * and the system-initiated scheduled release share the exact same mirror +
 * outbox logic. Postgres is authoritative; Base44 is mirror-only; no fallback.
 *
 * Exports:
 *   sha256Hex, canonicalEnvelope, genId, applyMirrorWithOutbox
 */

// ── SHA-256 helpers (Deno + Node compatible) ─────────────────────────────────
export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

export function canonicalEnvelope(envelope) {
  return JSON.stringify(envelope, Object.keys(envelope).sort());
}

export function genId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ── Mirror helper: apply Base44 mirror with durable outbox on failure ────────
// Postgres transition has already committed. If the mirror write fails (or is
// simulated to fail), a CanaryMirrorOutbox record is created so a retry can
// repair the mirror exactly once. Postgres is never rolled back.
export async function applyMirrorWithOutbox(entities, listing_id, mirrorPayload, simulateFailure, authorityVersion, authorityRevision, operationType) {
  const mirror = { attempted: true, listing: null, listing_private: null, outbox_id: null };

  if (simulateFailure) {
    try {
      const outbox = await entities.CanaryMirrorOutbox.create({
        listing_id,
        operation_type: operationType,
        authority_version: authorityVersion,
        authority_revision: authorityRevision,
        mirror_payload: mirrorPayload,
        status: 'pending',
      });
      mirror.outbox_id = outbox.id;
      mirror.listing = 'simulated_failure';
    } catch (e) {
      mirror.listing = 'outbox_create_failed:' + (e.message || String(e)).slice(0, 80);
    }
    return mirror;
  }

  try {
    await entities.Listing.update(listing_id, mirrorPayload.listing);
    mirror.listing = 'ok';
  } catch (e) {
    mirror.listing = 'failed:' + (e.message || String(e)).slice(0, 80);
    try {
      const outbox = await entities.CanaryMirrorOutbox.create({
        listing_id,
        operation_type: operationType,
        authority_version: authorityVersion,
        authority_revision: authorityRevision,
        mirror_payload: mirrorPayload,
        status: 'pending',
      });
      mirror.outbox_id = outbox.id;
    } catch (oe) {
      mirror.outbox_create_failed = (oe.message || String(oe)).slice(0, 80);
    }
  }
  if (entities.ListingPrivate) {
    try {
      const lpRows = await entities.ListingPrivate.filter({ listing_id });
      const lp = lpRows[0];
      if (lp) {
        await entities.ListingPrivate.update(lp.id, mirrorPayload.listing_private);
        mirror.listing_private = 'ok';
      } else {
        mirror.listing_private = 'no_record';
      }
    } catch (e) {
      mirror.listing_private = 'failed:' + (e.message || String(e)).slice(0, 80);
    }
  }
  return mirror;
}