/**
 * verifyTransferProofCanaryOrchestrator.js — P0-01S Advisory AI Proof Assessment.
 *
 * Owns the canary advisory proof-assessment transition for synthetic
 * [AUTH_CANARY] records only. Postgres is authoritative; Base44 is mirror-only.
 *
 * CRITICAL RULE: AI analysis is advisory evidence. It MUST NEVER:
 *   - Mark a transfer completed
 *   - Release payment, trigger payout, or capture
 *   - Refund or cancel
 *   - Relist inventory
 *   - Change transfer_state
 *
 * The assessment is recorded on reservation_payment_bindings.proof_assessment_state
 * with advisory states: 'ai_likely_valid', 'ai_uncertain', 'ai_suspicious'.
 * None of these means provider-, buyer-, or human-verified.
 *
 * FLOW (canary-eligible only — flag ON, admin, canary action, synthetic listing):
 *   1. Read authority state → verify seller linkage, eligible transfer state
 *   2. Verify proof asset is current, clean, authorized (trusted reference)
 *   3. Call AI provider (injected adapter — trusted DI)
 *   4. Map AI result to advisory assessment state
 *   5. Hash proof_asset_id → trusted proof reference
 *   6. Call record_transfer_proof_assessment (executor-only, CAS, no transfer_state change)
 *   7. Mirror advisory result to Purchase + PurchasePrivate (durable outbox on failure)
 *
 * GUARANTEES:
 *   - transfer_state is NEVER changed for any AI outcome
 *   - version is NEVER incremented (assessment is advisory, not a lifecycle transition)
 *   - Deterministic operation ID for idempotent replay
 *   - Exact replay returns the original result
 *   - Changed-payload replay is rejected (OPERATION_ID_CONFLICT)
 *   - Malformed/timeout AI responses fail closed (ai_uncertain)
 *   - No AI-only payout, capture, refund, release, relist, or completion path
 *   - Base44 is mirror-only
 *   - Mirror failure uses the durable outbox (CanaryMirrorOutbox)
 *   - Never imports admin client
 *
 * Dependency-injected for testability. Tests inject mock clients + fake AI provider.
 */
import { sha256Hex, canonicalEnvelope } from './canaryMirror.js';
import { isCanaryListing } from './authCanary.js';

// ── Advisory assessment state mapping ──────────────────────────────────────
// Maps the legacy ai_proof_status to the authoritative advisory assessment state.
// These are ADVISORY ONLY — they never trigger financial or transfer-completion actions.
function mapToAssessmentState(aiProofStatus, score) {
  if (aiProofStatus === 'verified_high_confidence' || aiProofStatus === 'verified_medium_confidence') {
    return 'ai_likely_valid';
  }
  if (aiProofStatus === 'rejected_suspicious') {
    return 'ai_suspicious';
  }
  // needs_human_review, failed_processing, processing, pending → uncertain
  return 'ai_uncertain';
}

// ── Normalize assessment data for authoritative storage ─────────────────────
// Records only normalized assessment data: trusted proof reference/hash, model
// identifier, confidence, detected platform, limited extracted fields, assessment
// state, and timestamp. Does NOT store raw images, prompts, credentials, or
// unrestricted model output.
function normalizeAssessmentData(aiResult, modelUsed, score, fraudRiskScore, flags) {
  return {
    model: modelUsed,
    confidence_score: score,
    fraud_risk_score: fraudRiskScore,
    detected_platform: aiResult?.platform || 'screenshot_unknown',
    extracted_event_name: aiResult?.extracted?.event_name || null,
    extracted_recipient: aiResult?.extracted?.recipient_email || aiResult?.extracted?.recipient_name || null,
    extracted_section: aiResult?.extracted?.section || null,
    extracted_row: aiResult?.extracted?.row || null,
    extracted_seats: aiResult?.extracted?.seats || null,
    flags: flags || [],
    verification_summary: (aiResult?.verification_summary || '').slice(0, 500),
  };
}

// ── Mirror helper: apply advisory assessment to Purchase + PurchasePrivate ──
// Postgres transition has already committed. If the mirror write fails, a
// CanaryMirrorOutbox record is created so a retry can repair the mirror exactly
// once. Postgres is never rolled back.
async function applyAssessmentMirrorWithOutbox(entities, purchaseId, listingId, mirrorPayload, simulateFailure) {
  const mirror = { attempted: true, purchase: null, purchase_private: null, outbox_id: null };

  if (simulateFailure) {
    try {
      const outbox = await entities.CanaryMirrorOutbox.create({
        listing_id: listingId,
        operation_type: 'proof_assessment',
        authority_version: 0,
        authority_revision: null,
        mirror_payload: mirrorPayload,
        status: 'pending',
      });
      mirror.outbox_id = outbox.id;
      mirror.purchase = 'simulated_failure';
    } catch (e) {
      mirror.purchase = 'outbox_create_failed:' + (e.message || String(e)).slice(0, 80);
    }
    return mirror;
  }

  // Write to PurchasePrivate (authoritative buyer identity)
  try {
    const ppRows = await entities.PurchasePrivate.filter({ purchase_id: purchaseId });
    const pp = ppRows[0];
    if (pp) {
      await entities.PurchasePrivate.update(pp.id, mirrorPayload.purchase_private);
      mirror.purchase_private = 'ok';
    } else {
      mirror.purchase_private = 'no_record';
    }
  } catch (e) {
    mirror.purchase_private = 'failed:' + (e.message || String(e)).slice(0, 80);
    try {
      const outbox = await entities.CanaryMirrorOutbox.create({
        listing_id: listingId, operation_type: 'proof_assessment',
        authority_version: 0, authority_revision: null,
        mirror_payload: mirrorPayload, status: 'pending',
      });
      mirror.outbox_id = outbox.id;
    } catch (oe) {
      mirror.outbox_create_failed = (oe.message || String(oe)).slice(0, 80);
    }
  }

  // Write to Purchase (mirror)
  try {
    await entities.Purchase.update(purchaseId, mirrorPayload.purchase);
    mirror.purchase = 'ok';
  } catch (e) {
    mirror.purchase = 'failed:' + (e.message || String(e)).slice(0, 80);
    if (!mirror.outbox_id) {
      try {
        const outbox = await entities.CanaryMirrorOutbox.create({
          listing_id: listingId, operation_type: 'proof_assessment',
          authority_version: 0, authority_revision: null,
          mirror_payload: mirrorPayload, status: 'pending',
        });
        mirror.outbox_id = outbox.id;
      } catch (oe) {
        mirror.outbox_create_failed = (oe.message || String(oe)).slice(0, 80);
      }
    }
  }

  return mirror;
}

/**
 * Run the canary proof-assessment saga.
 * @param {object} deps
 * @param {object} deps.entities - base44.asServiceRole.entities
 * @param {object} deps.user - authenticated user
 * @param {object} deps.executorClient - createAuthorityV1Client result
 * @param {object} deps.aiProvider - { assessProof(signedUrl, context) → aiResult }
 * @param {object} deps.params - saga parameters
 * @returns {Promise<{status: number, body: object}>}
 */
export async function runCanaryProofAssessmentSaga(deps) {
  const { entities, user, executorClient, aiProvider, params } = deps;

  const listingId = params?.listing_id;
  const purchaseId = params?.purchase_id;
  const proofAssetId = params?.proof_asset_id;
  const sellerUserId = params?.seller_user_id;
  const proofAssetIdHash = params?.proof_asset_id_hash;

  if (!listingId) return { status: 400, body: { error: 'listing_id required' } };
  if (!purchaseId) return { status: 400, body: { error: 'purchase_id required' } };
  if (!proofAssetId) return { status: 400, body: { error: 'proof_asset_id required' } };
  if (!sellerUserId) return { status: 400, body: { error: 'seller_user_id required' } };
  if (!proofAssetIdHash) return { status: 400, body: { error: 'proof_asset_id_hash required' } };

  if (!user) return { status: 401, body: { error: 'Unauthorized' } };
  if (!executorClient) return { status: 500, body: { error: 'Executor client required' } };
  if (!aiProvider) return { status: 500, body: { error: 'AI provider required' } };

  // ── 1. Read authority state ──────────────────────────────────────────────
  let state;
  try {
    state = await executorClient.getState(listingId);
  } catch (e) {
    return { status: 500, body: { error: 'Authority state read failed', code: 'STATE_READ_FAILED' } };
  }
  if (!state?.ok) {
    return { status: 409, body: { error: 'Not initialized in authority', code: state?.code || 'NOT_FOUND' } };
  }

  // Verify seller linkage — never trust from request body
  if (state.seller_user_id !== sellerUserId) {
    return { status: 403, body: { error: 'Seller mismatch', code: 'SELLER_MISMATCH' } };
  }

  // Verify eligible transfer state (not terminal_cancelled)
  if (state.transfer_state === 'terminal_cancelled') {
    return { status: 409, body: { error: 'Transfer cancelled', code: 'TRANSFER_CANCELLED' } };
  }

  // ── 2. Call AI provider (injected adapter) ──────────────────────────────
  let aiResult;
  let aiError = null;
  try {
    aiResult = await aiProvider.assessProof(params.signed_proof_url, params.ai_context);
  } catch (e) {
    aiError = e?.message || String(e);
  }

  // ── 3. Fail closed on malformed/timeout AI responses ─────────────────────
  const modelUsed = params?.model_used || 'claude_sonnet_4_6';
  let score = 0;
  let aiProofStatus = 'failed_processing';
  let flags = [];
  let fraudRiskScore = 0;

  if (aiResult && !aiError) {
    score = Math.max(0, Math.min(100, Math.round(aiResult.confidence_score || 0)));
    flags = [...(aiResult.flags || [])];

    if (aiResult.authenticity?.is_blank_or_unrelated) {
      aiProofStatus = 'rejected_suspicious';
      score = Math.min(score, 10);
      flags.push('blank_or_unrelated_image');
    } else if (aiResult.authenticity?.editing_indicators) {
      aiProofStatus = 'rejected_suspicious';
      score = Math.min(score, 35);
      flags.push('image_editing_detected');
    } else if (score >= 70) {
      aiProofStatus = 'verified_high_confidence';
    } else if (score >= 40) {
      aiProofStatus = 'needs_human_review';
    } else {
      aiProofStatus = 'rejected_suspicious';
    }

    fraudRiskScore = Math.max(0, Math.min(100,
      (aiResult.authenticity?.editing_indicators ? 50 : 0) +
      (aiResult.authenticity?.is_blank_or_unrelated ? 60 : 0) +
      (aiResult.authenticity?.is_screenshot_of_screenshot ? 20 : 0) +
      (flags.filter(f => f.includes('mismatch')).length * 15)
    ));
  } else {
    // Malformed/timeout → fail closed as ai_uncertain
    aiResult = { verification_summary: `AI processing failed: ${aiError || 'unknown error'}` };
  }

  // ── 4. Map to advisory assessment state ──────────────────────────────────
  const assessmentState = mapToAssessmentState(aiProofStatus, score);
  const assessmentData = normalizeAssessmentData(aiResult, modelUsed, score, fraudRiskScore, flags);

  // ── 5. Call record_transfer_proof_assessment (deterministic operation ID) ─
  const operationId = `canary_proof_${purchaseId}_${proofAssetId}`;
  const requestHash = await sha256Hex(canonicalEnvelope({
    op: 'proof_assessment', listing_id: listingId, purchase_id: purchaseId,
    proof_asset_id_hash: proofAssetIdHash, assessment_state: assessmentState,
    authority_version: state.version, seller_user_id: sellerUserId,
    assessment_data_hash: await sha256Hex(JSON.stringify(assessmentData, Object.keys(assessmentData).sort())),
  }));

  let assessResult;
  try {
    assessResult = await executorClient.recordTransferProofAssessment(
      listingId, state.version, sellerUserId, purchaseId,
      proofAssetIdHash, assessmentState, assessmentData,
      operationId, requestHash,
    );
  } catch (e) {
    return { status: 500, body: { error: 'record_transfer_proof_assessment failed', code: 'ASSESS_ERROR' } };
  }

  if (!assessResult?.ok) {
    return {
      status: 409,
      body: { error: 'Assessment conflict', code: assessResult?.code || 'CONFLICT', authority: assessResult },
    };
  }

  // ── 6. Mirror advisory result to Purchase + PurchasePrivate ──────────────
  const now = new Date().toISOString();
  const mirrorPayload = {
    purchase: {
      ai_proof_status: aiProofStatus,
      ai_confidence_score: score,
      ai_review_notes: aiResult.verification_summary || '',
      ai_detected_platform: aiResult.platform || 'screenshot_unknown',
      ai_extracted_event_name: aiResult.extracted?.event_name || null,
      ai_extracted_recipient: aiResult.extracted?.recipient_email || aiResult.extracted?.recipient_name || null,
      ai_extracted_section: aiResult.extracted?.section || null,
      ai_extracted_row: aiResult.extracted?.row || null,
      ai_extracted_seats: aiResult.extracted?.seats || null,
      ai_flags: flags,
      ai_processed_at: now,
      ai_processed_by_model: modelUsed,
      fraud_risk_score: fraudRiskScore,
    },
    purchase_private: {
      ai_proof_status: aiProofStatus,
      ai_confidence_score: score,
      ai_review_notes: aiResult.verification_summary || '',
      ai_detected_platform: aiResult.platform || 'screenshot_unknown',
      ai_processed_at: now,
      ai_processed_by_model: modelUsed,
      fraud_risk_score: fraudRiskScore,
    },
  };

  const simulateFailure = params.simulate_mirror_failure === true;
  const mirror = await applyAssessmentMirrorWithOutbox(entities, purchaseId, listingId, mirrorPayload, simulateFailure);

  return {
    status: 200,
    body: {
      ok: true,
      assessed: true,
      idempotent: assessResult.idempotent === true,
      assessment_state: assessmentState,
      transfer_state: assessResult.transfer_state,
      transfer_state_unchanged: true,
      ai_proof_status: aiProofStatus,
      ai_confidence_score: score,
      fraud_risk_score: fraudRiskScore,
      ai_flags: flags,
      authority: assessResult,
      mirror,
    },
  };
}

/**
 * maybeRouteCanaryProofAssessment — Canary eligibility guard + routing for
 * verifyTransferProof.
 *
 * Returns null when the request is NOT canary-eligible (caller falls through
 * to the legacy verifyTransferProof path), or { status, body } when canary-handled.
 *
 * Isolation rules (identical to other canary guards):
 *   - Synthetic [AUTH_CANARY] listing WITHOUT body.canary → 403
 *   - body.canary=true on NON-canary listing → 400
 *   - Canary request from non-admin → 403
 *   - Flag OFF → 503 CANARY_DISABLED
 *   - No executor URL → 500
 *
 * @param {object} deps
 * @returns {Promise<{status:number,body:object}|null>}
 */
export async function maybeRouteCanaryProofAssessment(deps) {
  const { listing, body, user } = deps;
  const isCanary = isCanaryListing(listing);
  const wantsCanary = body?.canary === true;

  if (!isCanary && !wantsCanary) return null;

  if (isCanary && !wantsCanary) {
    return { status: 403, body: { error: 'Synthetic canary listing requires explicit canary action', code: 'CANARY_ACTION_REQUIRED' } };
  }
  if (wantsCanary && !isCanary) {
    return { status: 400, body: { error: 'Canary action on non-canary listing', code: 'NOT_CANARY' } };
  }
  if (user?.role !== 'admin') {
    return { status: 403, body: { error: 'Canary requires admin', code: 'CANARY_ADMIN_REQUIRED' } };
  }
  if (!deps.canaryEnabled) {
    return { status: 503, body: { error: 'Canary integration is disabled.', code: 'CANARY_DISABLED' } };
  }
  if (!deps.executorUrl) {
    return { status: 500, body: { error: 'Authority executor URL not configured', code: 'NO_EXECUTOR_URL' } };
  }

  const { purchase, purchasePrivate } = deps;
  if (!purchase) return { status: 404, body: { error: 'Purchase not found' } };

  // Derive seller_user_id from authenticated user (admin) — never from request body
  const sellerUserId = user.id || user.email;
  const proofAssetId = body?.proof_asset_id;
  if (!proofAssetId) return { status: 400, body: { error: 'proof_asset_id required', code: 'NO_PROOF_ASSET' } };

  // Hash the proof asset ID for trusted reference
  const proofAssetIdHash = await sha256Hex(proofAssetId);

  // Create executor client (or use injected for tests)
  let executorClient = deps.executorClient;
  if (!executorClient) {
    const { createAuthorityV1Client } = await import('./authorityV1Client.js');
    executorClient = createAuthorityV1Client(deps.executorUrl);
  }

  return runCanaryProofAssessmentSaga({
    entities: deps.base44.asServiceRole.entities,
    user,
    executorClient,
    aiProvider: deps.aiProvider,
    params: {
      listing_id: listing.id,
      purchase_id: purchase.id,
      proof_asset_id: proofAssetId,
      proof_asset_id_hash: proofAssetIdHash,
      seller_user_id: sellerUserId,
      signed_proof_url: deps.signedProofUrl,
      ai_context: deps.aiContext,
      model_used: deps.modelUsed || 'claude_sonnet_4_6',
      simulate_mirror_failure: body?.simulate_mirror_failure === true,
    },
  });
}