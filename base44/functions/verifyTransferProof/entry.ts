/**
 * verifyTransferProof — AI Transfer Verification Service
 *
 * Uses vision LLM to analyze seller-uploaded proof screenshots.
 * Returns structured confidence scoring, OCR extraction, and fraud flags.
 *
 * SAFETY RULES:
 * - NEVER permanently bans users
 * - NEVER auto-refunds or auto-cancels
 * - NEVER makes irreversible financial decisions alone
 * - All decisions can be overridden by human admin
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { secrets } from 'base44:runtime';
import { isMaintenanceActive, maintenance503, isProofScanningEnabled, proofScannerUnavailable503 } from '../../shared/maintenance.ts';
import { sendTransactionalEmail } from '../../shared/notifications.ts';
import { getPurchasePrivate, upsertPurchasePrivate, alertPrivateWriteFailure } from '../../shared/privateData.ts';
import { maybeRouteCanaryProofAssessment } from '../../shared/verifyTransferProofCanaryOrchestrator.js';
import { isCanaryEnabled } from '../../shared/authCanary.js';

// ── Confidence thresholds ─────────────────────────────────────────────────────
const THRESHOLDS = {
  HIGH: 90,
  MEDIUM: 70,
  LOW: 40,
};

// ── Platform signature keywords ───────────────────────────────────────────────
const PLATFORM_SIGNATURES = {
  ticketmaster: ['ticketmaster', 'tm transfer', 'ticket transfer', 'my account', 'ticket sent', 'transfer complete', 'livenation'],
  seatgeek:     ['seatgeek', 'sg transfer', 'seat geek', 'your transfer', 'transfer initiated'],
  axs:          ['axs', 'axs transfer', 'flash seats', 'axs mobile id'],
  stubhub:      ['stubhub', 'stub hub', 'fansfirst', 'transfer to buyer'],
  apple_wallet: ['apple wallet', 'wallet', 'add to wallet', 'passes', 'pkpass'],
  vivid:        ['vivid seats', 'vividseats'],
  other:        [],
};

// ── Status keywords indicating a successful transfer ─────────────────────────
const TRANSFER_CONFIRMED_KEYWORDS = [
  'transfer complete', 'transfer sent', 'tickets sent', 'transfer accepted',
  'successfully transferred', 'transfer initiated', 'ticket delivered',
  'transfer confirmed', 'sent to', 'delivery complete', 'transfer submitted',
  'tickets transferred', 'transfer pending', 'ticket transfer',
];

// ── Suspicion patterns ────────────────────────────────────────────────────────
const SUSPICION_KEYWORDS = [
  'photoshop', 'edited', 'screenshot failed', 'black screen',
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { purchase_id, proof_asset_id, force_reprocess } = body;

    // ── Canary guard (admin + synthetic [AUTH_CANARY] listing only) ─────────
    // Wired BEFORE the maintenance gate and legacy writes. Synthetic listings
    // never reach the normal path. Returns null for normal listings → fall through.
    {
      let canaryPurchase: any = null;
      try { const [p] = await base44.asServiceRole.entities.Purchase.filter({ id: purchase_id }); canaryPurchase = p || null; } catch (_) {}
      let canaryListing: any = null;
      if (canaryPurchase?.listing_id) { try { const [l] = await base44.asServiceRole.entities.Listing.filter({ id: canaryPurchase.listing_id }); canaryListing = l || null; } catch (_) {} }
      if (canaryListing && canaryPurchase) {
        const executorUrl = secrets.get('AUTHORITY_V1_DB_URL_DEV_EXECUTOR');
        const canaryResult = await maybeRouteCanaryProofAssessment({
          base44, user, body, listing: canaryListing, purchase: canaryPurchase,
          executorUrl,
          canaryEnabled: isCanaryEnabled(),
        });
        if (canaryResult) return Response.json(canaryResult.body, { status: canaryResult.status });
      }
    }

    // ── Legacy path (non-canary traffic + flag-OFF) — unchanged ──────────────
    if (isMaintenanceActive()) return maintenance503('AI proof verification is temporarily unavailable for scheduled maintenance.');
    if (!isProofScanningEnabled()) return proofScannerUnavailable503();

    if (!purchase_id || !proof_asset_id) {
      return Response.json({ error: 'purchase_id and proof_asset_id are required' }, { status: 400 });
    }

    // Fetch purchase
    const purchases = await base44.asServiceRole.entities.Purchase.filter({ id: purchase_id }).catch(() => []);
    const purchase = purchases[0];
    if (!purchase) return Response.json({ error: 'Purchase not found' }, { status: 404 });

    // Phase 1B: read authoritative seller/buyer identity + ai_proof_status from PurchasePrivate
    const pp = await getPurchasePrivate(base44, purchase.id);
    const authoritativeSellerEmail = pp?.seller_email ?? purchase.seller_email;
    const authoritativeBuyerEmail = pp?.buyer_email ?? purchase.buyer_email;
    const authoritativeAiProofStatus = pp?.ai_proof_status ?? purchase.ai_proof_status;

    // Auth: only seller, buyer, or admin can trigger verification
    const isSeller = authoritativeSellerEmail === user.email;
    const isBuyer  = authoritativeBuyerEmail === user.email;
    const isAdmin  = user.role === 'admin';
    if (!isSeller && !isBuyer && !isAdmin) {
      return Response.json({ error: 'Not authorized for this purchase' }, { status: 403 });
    }

    // Skip if already processing or verified at high confidence (prevents duplicate LLM runs / credit waste)
    if (!force_reprocess && ['processing', 'verified_high_confidence'].includes(authoritativeAiProofStatus)) {
      console.warn(`[verifyTransferProof] duplicate trigger blocked — purchase=${purchase_id} status=${authoritativeAiProofStatus} triggered_by=${user.email}`);
      return Response.json({ skipped: true, reason: 'already_processing_or_verified', ai_proof_status: authoritativeAiProofStatus });
    }

    // ── Verify the proof asset is the current, clean, authorized asset ────────
    const currentAssetId = pp?.current_transfer_proof_asset_id;
    if (!currentAssetId || proof_asset_id !== currentAssetId) {
      return Response.json({ error: 'Proof asset is not the current upload for this purchase' }, { status: 409 });
    }
    const [proofAsset] = await base44.asServiceRole.entities.ProofAsset.filter({ id: proof_asset_id }).catch(() => []);
    if (!proofAsset) {
      return Response.json({ error: 'Proof asset not found' }, { status: 404 });
    }
    if (proofAsset.reference_type !== 'purchase' || proofAsset.reference_id !== purchase_id) {
      return Response.json({ error: 'Proof asset reference mismatch' }, { status: 403 });
    }
    if (proofAsset.proof_type !== 'transfer_proof') {
      return Response.json({ error: 'Proof asset type mismatch' }, { status: 403 });
    }
    if (proofAsset.superseded_by_asset_id) {
      return Response.json({ error: 'Proof asset has been superseded by a newer upload' }, { status: 409 });
    }
    if (proofAsset.scan_status !== 'clean') {
      return Response.json({ error: 'Proof has not passed scan clearance', scan_status: proofAsset.scan_status }, { status: 403 });
    }

    // Atomic processing claim: only one concurrent verifyTransferProof runs the
    // (credit-costly) LLM. Conditional compare-and-set on ai_proof_status.
    if (!force_reprocess) {
      const procRes = await base44.asServiceRole.entities.Purchase.updateMany(
        { id: purchase_id, ai_proof_status: { $nin: ['processing', 'verified_high_confidence'] } },
        { $set: { ai_proof_status: 'processing' } }
      ).catch(() => ({ updated: 0 }));
      if ((procRes?.updated || 0) === 0) {
        console.warn(`[verifyTransferProof] concurrent processing claim lost — purchase=${purchase_id} triggered_by=${user.email}`);
        return Response.json({ skipped: true, reason: 'concurrent_processing_claim_lost', ai_proof_status: 'processing' });
      }
    } else {
      await base44.asServiceRole.entities.Purchase.update(purchase_id, { ai_proof_status: 'processing' });
    }
    // Phase 1B: mirror ai_proof_status='processing' to PurchasePrivate (authoritative)
    try {
      await upsertPurchasePrivate(base44, purchase_id, { ai_proof_status: 'processing' });
    } catch (err) {
      // Revert Purchase to previous status so retry can proceed
      await base44.asServiceRole.entities.Purchase.update(purchase_id, { ai_proof_status: authoritativeAiProofStatus || 'pending' }).catch(() => {});
      await alertPrivateWriteFailure(base44, { entity: 'PurchasePrivate', reference_id: purchase_id, reference_type: 'purchase', error: err });
      return Response.json({ error: 'Failed to set processing state. Please try again.' }, { status: 500 });
    }

    // Fetch listing + event for context matching
    const [listings, events] = await Promise.all([
      purchase.listing_id ? base44.asServiceRole.entities.Listing.filter({ id: purchase.listing_id }) : Promise.resolve([]),
      purchase.event_id   ? base44.asServiceRole.entities.Event.filter({ id: purchase.event_id })   : Promise.resolve([]),
    ]);
    const listing = listings[0] || null;
    const event   = events[0]   || null;

    // ── Create short-lived signed URL for the AI call ────────────────────────
    let signedProofUrl;
    try {
      const res = await base44.integrations.Core.CreateFileSignedUrl({ file_uri: proofAsset.storage_uri, expires_in: 300 });
      signedProofUrl = res.signed_url;
    } catch (e) {
      return Response.json({ error: 'Signed URL issuance failed', details: e?.message }, { status: 500 });
    }

    // ── FRAUD-PROBE: Duplicate checksum detection ────────────────────────────
    let isDuplicateProof = false;
    if (proofAsset.checksum) {
      const checksumMatches = await base44.asServiceRole.entities.ProofAsset.filter({
        checksum: proofAsset.checksum,
        reference_type: 'purchase',
      }).catch(() => []);
      isDuplicateProof = checksumMatches.some(a => a.reference_id !== purchase_id);
    }

    // ── Build AI analysis prompt ──────────────────────────────────────────────
    const contextStr = [
      event   ? `Event: "${event.title}" at ${event.venue}, ${event.city} on ${event.date ? new Date(event.date).toLocaleDateString() : 'unknown date'}` : '',
      listing ? `Section: ${listing.section}, Row: ${listing.row}, Seats: ${listing.seats || 'not specified'}, Qty: ${listing.quantity}` : '',
      `Buyer email: ${authoritativeBuyerEmail}`,
      `Buyer name: ${purchase.buyer_name || 'not specified'}`,
      `Seller email: ${authoritativeSellerEmail}`,
      `Expected quantity: ${purchase.quantity}`,
    ].filter(Boolean).join('\n');

    const analysisPrompt = `You are an expert ticket transfer verification system for a ticket marketplace called Peanut Gallery.

Analyze this ticket transfer proof screenshot and provide a detailed JSON assessment.

TRANSACTION CONTEXT:
${contextStr}

ANALYSIS TASKS:
1. Identify the ticketing platform (Ticketmaster, SeatGeek, AXS, StubHub, Apple Wallet, VividSeats, or unknown)
2. Extract any visible text: event name, venue, date/time, recipient name/email, section, row, seat numbers, quantity, transfer status
3. Assess if a ticket transfer was successfully initiated or completed
4. Check if the extracted details match the transaction context above
5. Identify any authenticity concerns or suspicious elements

CONFIDENCE SCORING WEIGHTS (calculate total 0-100):
+25 points: Event title/venue/date clearly visible and matches listing
+20 points: Recipient email/name visible and matches buyer  
+20 points: Transfer confirmation language detected (sent, transferred, complete, etc.)
+15 points: Section/row/seat numbers match listing
+10 points: Recognized ticketing platform UI detected
+10 points: Transfer timestamp is visible and plausible

DEDUCTIONS:
-25 points: Screenshot appears cropped/cut off in suspicious way (hiding key info)
-40 points: Signs of image editing, fake overlays, or manipulated UI
-20 points: Recipient doesn't match buyer details
-15 points: Event details don't match the listing
-20 points: Screenshot too incomplete to verify (blank, corrupted, or unrelated)
-15 points: Timestamp appears impossible (future date, wrong year, etc.)

SUSPICIOUS ELEMENTS TO FLAG:
- Mismatched fonts or colors suggesting editing
- Text that appears overlaid/photoshopped
- Impossible or contradictory timestamps  
- Generic placeholder text visible
- Screenshot of a screenshot (degraded quality, device frame visible)
- Blank or near-blank image
- Unrelated image (not a ticket transfer screen)
- Recipient clearly different from buyer

Return ONLY valid JSON with this exact structure:
{
  "platform": "ticketmaster|seatgeek|axs|stubhub|apple_wallet|vivid|screenshot_unknown|other",
  "transfer_status_detected": "completed|initiated|pending|cancelled|none_detected",
  "confidence_score": <0-100 integer>,
  "confidence_breakdown": {
    "event_match": <0-25>,
    "recipient_match": <0-20>,
    "transfer_language": <0-20>,
    "seat_match": <0-15>,
    "platform_detected": <0-10>,
    "timestamp_visible": <0-10>,
    "deductions": <negative integer>
  },
  "extracted": {
    "event_name": "<string or null>",
    "venue": "<string or null>",
    "event_date": "<string or null>",
    "recipient_name": "<string or null>",
    "recipient_email": "<string or null>",
    "section": "<string or null>",
    "row": "<string or null>",
    "seats": "<string or null>",
    "quantity": "<string or null>",
    "transfer_time": "<string or null>",
    "raw_ocr_summary": "<brief summary of all visible text>"
  },
  "authenticity": {
    "appears_authentic": <true|false>,
    "concerns": ["<list of specific concerns, empty if none>"],
    "editing_indicators": <true|false>,
    "is_screenshot_of_screenshot": <true|false>,
    "is_blank_or_unrelated": <true|false>
  },
  "flags": ["<list of issue strings, empty array if none>"],
  "verification_summary": "<1-2 sentence plain English summary of what you found>"
}`;

    // ── Call vision LLM ───────────────────────────────────────────────────────
    let aiResult = null;
    let processingError = null;
    const modelUsed = 'claude_sonnet_4_6';

    try {
      const llmResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: analysisPrompt,
        file_urls: [signedProofUrl],
        model: modelUsed,
        response_json_schema: {
          type: 'object',
          properties: {
            platform:                  { type: 'string' },
            transfer_status_detected:  { type: 'string' },
            confidence_score:          { type: 'number' },
            confidence_breakdown:      { type: 'object' },
            extracted:                 { type: 'object' },
            authenticity:              { type: 'object' },
            flags:                     { type: 'array', items: { type: 'string' } },
            verification_summary:      { type: 'string' },
          },
        },
      });
      aiResult = llmResponse;
    } catch (err) {
      console.error('[verifyTransferProof] LLM call failed:', err.message);
      processingError = err.message;
    }

    // ── Handle LLM failure gracefully ─────────────────────────────────────────
    if (!aiResult || processingError) {
      const failPayload = {
        ai_proof_status: 'failed_processing',
        ai_review_notes: `AI processing failed: ${processingError || 'unknown error'}. Requires human review.`,
        ai_processed_at: new Date().toISOString(),
        ai_processed_by_model: modelUsed,
      };
      await base44.asServiceRole.entities.Purchase.update(purchase_id, failPayload);
      // Phase 1B: mirror failure fields to PurchasePrivate (authoritative)
      try {
        await upsertPurchasePrivate(base44, purchase_id, failPayload);
      } catch (err) {
        await alertPrivateWriteFailure(base44, { entity: 'PurchasePrivate', reference_id: purchase_id, reference_type: 'purchase', error: err });
      }
      return Response.json({
        success: false,
        ai_proof_status: 'failed_processing',
        error: 'AI processing failed — escalated to human review',
      });
    }

    // ── Apply duplicate proof penalty ─────────────────────────────────────────
    let score = Math.max(0, Math.min(100, Math.round(aiResult.confidence_score || 0)));
    const flags = [...(aiResult.flags || [])];

    if (isDuplicateProof) {
      score = Math.max(0, score - 35);
      flags.push('duplicate_proof_image_reused_across_purchases');
    }

    // ── Determine final status ────────────────────────────────────────────────
    let aiProofStatus;
    if (aiResult.authenticity?.is_blank_or_unrelated) {
      aiProofStatus = 'rejected_suspicious';
      score = Math.min(score, 10);
      flags.push('blank_or_unrelated_image');
    } else if (aiResult.authenticity?.editing_indicators) {
      aiProofStatus = 'rejected_suspicious';
      score = Math.min(score, 35);
      flags.push('image_editing_detected');
    } else if (score >= THRESHOLDS.HIGH) {
      aiProofStatus = 'verified_high_confidence';
    } else if (score >= THRESHOLDS.MEDIUM) {
      aiProofStatus = 'verified_medium_confidence';
    } else if (score >= THRESHOLDS.LOW) {
      aiProofStatus = 'needs_human_review';
    } else {
      aiProofStatus = 'rejected_suspicious';
    }

    // Fraud risk score (0-100, higher = more suspicious)
    const fraudRiskScore = Math.max(0, Math.min(100,
      (aiResult.authenticity?.editing_indicators ? 50 : 0) +
      (isDuplicateProof ? 40 : 0) +
      (aiResult.authenticity?.is_blank_or_unrelated ? 60 : 0) +
      (aiResult.authenticity?.is_screenshot_of_screenshot ? 20 : 0) +
      (flags.filter(f => f.includes('mismatch')).length * 15)
    ));

    // ── Build the update payload ──────────────────────────────────────────────
    const now = new Date().toISOString();
    const updatePayload = {
      ai_proof_status:          aiProofStatus,
      ai_confidence_score:      score,
      ai_review_notes:          aiResult.verification_summary || '',
      ai_detected_platform:     aiResult.platform || 'screenshot_unknown',
      ai_extracted_event_name:  aiResult.extracted?.event_name || null,
      ai_extracted_recipient:   aiResult.extracted?.recipient_email || aiResult.extracted?.recipient_name || null,
      ai_extracted_transfer_time: aiResult.extracted?.transfer_time || null,
      ai_extracted_section:     aiResult.extracted?.section || null,
      ai_extracted_row:         aiResult.extracted?.row || null,
      ai_extracted_seats:       aiResult.extracted?.seats || null,
      ai_flags:                 flags,
      ai_processed_at:          now,
      ai_processed_by_model:    modelUsed,
      fraud_risk_score:         fraudRiskScore,
    };

    // If suspicious/low confidence, set auto_review_flagged
    if (aiProofStatus === 'rejected_suspicious' || fraudRiskScore >= 50) {
      updatePayload.auto_review_flagged = true;
      updatePayload.auto_review_flagged_at = now;
    }

    await base44.asServiceRole.entities.Purchase.update(purchase_id, updatePayload);
    // Phase 1B: mirror all AI review fields to PurchasePrivate (authoritative)
    try {
      await upsertPurchasePrivate(base44, purchase_id, updatePayload);
    } catch (err) {
      await alertPrivateWriteFailure(base44, { entity: 'PurchasePrivate', reference_id: purchase_id, reference_type: 'purchase', error: err });
      return Response.json({ error: 'AI verification completed but private record sync failed. Please contact support.' }, { status: 500 });
    }

    // ── False-claim flag (idempotent) + DERIVED count ─────────────────────────
    // Base44 has no atomic compare-and-set, so we set the flag with an
    // idempotent $set (true→true) and DERIVE the seller's false-claim count from
    // all their flagged purchases. A duplicate/concurrent invocation sets the
    // same flag and recomputes the same count — it cannot double-count.
    if (aiProofStatus === 'rejected_suspicious' && authoritativeSellerEmail) {
      await base44.asServiceRole.entities.Purchase.update(purchase_id, {
        false_claim_recorded: true,
      }).catch(() => {});
      // Phase 1B: mirror false_claim_recorded to PurchasePrivate (authoritative)
      try {
        await upsertPurchasePrivate(base44, purchase_id, { false_claim_recorded: true });
      } catch (err) {
        await alertPrivateWriteFailure(base44, { entity: 'PurchasePrivate', reference_id: purchase_id, reference_type: 'purchase', error: err });
      }
      const sellers = await base44.asServiceRole.entities.User.filter({ email: authoritativeSellerEmail }).catch(() => []);
      const seller = sellers[0];
      if (seller) {
        const flagged = await base44.asServiceRole.entities.Purchase.filter({
          seller_email: purchase.seller_email, false_claim_recorded: true,
        }).catch(() => []);
        await base44.asServiceRole.entities.User.update(seller.id, {
          transfer_false_claim_count: flagged.length,
        }).catch(() => {});
      }
    }

    // ── Admin alerts for high-risk results ───────────────────────────────────
    if (aiProofStatus === 'rejected_suspicious' || fraudRiskScore >= 60) {
      sendTransactionalEmail(base44, 'experience@peanutgallery.store',
        `🚨 AI Flagged Suspicious Transfer Proof — Purchase ${purchase_id}`,
        `AI Transfer Verification flagged a suspicious proof upload.\n\nPurchase: ${purchase_id}\nSeller: ${authoritativeSellerEmail}\nBuyer: ${authoritativeBuyerEmail}\nAmount: $${purchase.amount?.toFixed(2)}\n\nAI Status: ${aiProofStatus}\nConfidence: ${score}/100\nFraud Risk: ${fraudRiskScore}/100\nFlags: ${flags.join(', ') || 'none'}\n\nAI Summary: ${aiResult.verification_summary}\n\nReview in admin panel immediately.`
      ).catch(() => {});
    }

    console.log(`[verifyTransferProof] purchase=${purchase_id} status=${aiProofStatus} score=${score} fraud_risk=${fraudRiskScore}`);

    return Response.json({
      success: true,
      ai_proof_status: aiProofStatus,
      ai_confidence_score: score,
      ai_review_notes: aiResult.verification_summary,
      ai_detected_platform: aiResult.platform,
      ai_flags: flags,
      fraud_risk_score: fraudRiskScore,
      extracted: aiResult.extracted,
      authenticity: aiResult.authenticity,
    });

  } catch (error) {
    console.error('[verifyTransferProof] unhandled error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});