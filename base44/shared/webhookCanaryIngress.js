/**
 * webhookCanaryIngress.js — P0-01K Canary webhook ingress routing.
 *
 * Durably ingests signature-verified Stripe webhook events for authority-bound
 * (canary) PaymentIntents into the authority_v1 Postgres boundary. PostgreSQL
 * is authoritative; Base44 is not a fallback.
 *
 * P0-01K PRIVILEGE BOUNDARY CORRECTION: Ingestion is performed by the RECORDER
 * client (authority_stripe_recorder), NOT the executor. The recorder role has
 * exactly 4 functions: ingest_stripe_webhook_event + 3 record_*_result. The
 * executor no longer has EXECUTE on ingest_stripe_webhook_event.
 *
 * FLOW (canary-eligible only — flag ON + authority-bound PI):
 *   1. Extract minimal envelope from the verified event.
 *   2. SHA-256 the verified raw body (payload hash).
 *   3. Recorder client calls ingest_stripe_webhook_event (Postgres authoritative).
 *   4. canary_owned=true + ok → 2xx durable ack.
 *   5. canary_owned=true + VERIFICATION_MISMATCH → 409 fail-closed.
 *   6. Database failure → 503 retryable.
 *   7. canary_owned=false → null (fall through to legacy path).
 *
 * GUARANTEES:
 *   - No Base44 entity writes on the canary path (Postgres-only).
 *   - Canary ownership determined from the authoritative PaymentIntent binding
 *     inside the DB — never from event metadata.
 *   - Trusted dependency injection: canaryEnabled supplied by caller, never
 *     from env/global/header/query/body/secret.
 *
 * Returns null when the request is NOT canary-eligible (caller falls through
 * to the legacy webhook path), or { status, body } when canary-handled.
 */
import { sha256Hex } from './canaryMirror.js';

export async function maybeRouteCanaryWebhook(deps) {
  const { canaryEnabled, event, rawBody } = deps;

  // ── Trusted dependency-injected enabled state ─────────────────────────────
  if (canaryEnabled !== true) return null;

  const recorderUrl = deps.recorderUrl;
  if (!recorderUrl) return null; // no authority configured → legacy

  // ── Extract minimal envelope from the verified event ─────────────────────
  const eventId = event?.id;
  const eventType = event?.type;
  if (!eventId || !eventType) return null; // malformed → legacy

  const obj = event.data?.object || {};
  const piId = eventType.startsWith('payment_intent.')
    ? obj.id
    : (obj.payment_intent || null);

  const livemode = event.livemode === true;
  const created = event.created ? new Date(event.created * 1000).toISOString() : null;
  const apiVersion = event['api_version'] || null;

  // SHA-256 of the verified raw body
  const payloadHash = await sha256Hex(rawBody);

  // No PI → cannot determine canary ownership → non-canary → legacy
  if (!piId) return null;

  // ── Create recorder client (or use injected for tests) ──────────────────
  let recorderClient = deps.recorderClient;
  if (!recorderClient) {
    const { createAuthorityV1StripeRecorderClient } = await import('./authorityV1StripeRecorderClient.js');
    recorderClient = createAuthorityV1StripeRecorderClient(recorderUrl);
  }

  let result;
  try {
    result = await recorderClient.ingestStripeWebhookEvent(
      eventId, eventType, piId, livemode, created, apiVersion, payloadHash,
    );
  } catch (_) {
    // Database failure — return retryable 5xx. Do NOT fall through to legacy;
    // a canary event must be durably acknowledged before 2xx.
    return {
      status: 503,
      body: { error: 'Canary webhook ingestion database failure', code: 'INGEST_DB_FAILURE' },
    };
  }

  // Non-canary event (no authority binding) → legacy path
  if (!result || result.canary_owned !== true) return null;

  // ── Canary-owned event — PostgreSQL authoritative, Base44 not a fallback ──
  if (result.ok === true) {
    return {
      status: 200,
      body: {
        received: true,
        canary_ingested: true,
        replay: result.replay === true,
        purchase_id: result.purchase_id || null,
        listing_id: result.listing_id || null,
      },
    };
  }

  // Verification mismatch — fail closed (durable incident already created in DB)
  if (result.code === 'VERIFICATION_MISMATCH') {
    return {
      status: 409,
      body: { error: 'Verification mismatch', code: 'VERIFICATION_MISMATCH', webhook_event_id: eventId },
    };
  }

  // Unexpected structured failure — retryable 5xx
  return {
    status: 503,
    body: { error: 'Canary webhook ingestion failed', code: result.code || 'INGEST_FAILED' },
  };
}