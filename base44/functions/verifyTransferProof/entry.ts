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
    const { purchase_id, proof_url, force_reprocess } = body;

    if (!purchase_id || !proof_url) {
      return Response.json({ error: 'purchase_id and proof_url are required' }, { status: 400 });
    }

    // Fetch purchase
    const purchases = await base44.asServiceRole.entities.Purchase.filter({ id: purchase_id }).catch(() => []);
    const purchase = purchases[0];
    if (!purchase) return Response.json({ error: 'Purchase not found' }, { status: 404 });

    // Auth: only seller, buyer, or admin can trigger verification
    const isSeller = purchase.seller_email === user.email;
    const isBuyer  = purchase.buyer_email === user.email;
    const isAdmin  = user.role === 'admin';
    if (!isSeller && !isBuyer && !isAdmin) {
      return Response.json({ error: 'Not authorized for this purchase' }, { status: 403 });
    }

    // Skip if already processing or verified at high confidence (prevents duplicate LLM runs / credit waste)
    if (!force_reprocess && ['processing', 'verified_high_confidence'].includes(purchase.ai_proof_status)) {
      console.warn(`[verifyTransferProof] duplicate trigger blocked — purchase=${purchase_id} status=${purchase.ai_proof_status} triggered_by=${user.email}`);
      return Response.json({ skipped: true, reason: 'already_processing_or_verified', ai_proof_status: purchase.ai_proof_status });
    }

    // Mark as processing
    await base44.asServiceRole.entities.Purchase.update(purchase_id, {
      ai_proof_status: 'processing',
    });

    // Fetch listing + event for context matching
    const [listings, events] = await Promise.all([
      purchase.listing_id ? base44.asServiceRole.entities.Listing.filter({ id: purchase.listing_id }) : Promise.resolve([]),
      purchase.event_id   ? base44.asServiceRole.entities.Event.filter({ id: purchase.event_id })   : Promise.resolve([]),
    ]);
    const listing = listings[0] || null;
    const event   = events[0]   || null;

    // ── FRAUD-PROBE: Duplicate image detection ────────────────────────────────
    // Check if this same proof URL was used on another purchase (reuse attack)
    const proofMatches = await base44.asServiceRole.entities.Purchase.filter({
      transfer_proof_url: proof_url,
    }).catch(() => []);
    const isDuplicateProof = proofMatches.filter(p => p.id !== purchase_id).length > 0;

    // ── Build AI analysis prompt ──────────────────────────────────────────────
    const contextStr = [
      event   ? `Event: "${event.title}" at ${event.venue}, ${event.city} on ${event.date ? new Date(event.date).toLocaleDateString() : 'unknown date'}` : '',
      listing ? `Section: ${listing.section}, Row: ${listing.row}, Seats: ${listing.seats || 'not specified'}, Qty: ${listing.quantity}` : '',
      `Buyer email: ${purchase.buyer_email}`,
      `Buyer name: ${purchase.buyer_name || 'not specified'}`,
      `Seller email: ${purchase.seller_email}`,
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
        file_urls: [proof_url],
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
      await base44.asServiceRole.entities.Purchase.update(purchase_id, {
        ai_proof_status: 'failed_processing',
        ai_review_notes: `AI processing failed: ${processingError || 'unknown error'}. Requires human review.`,
        ai_processed_at: new Date().toISOString(),
        ai_processed_by_model: modelUsed,
      });
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

    // ── Increment transfer_false_claim_count on rejection ────────────────────
    // When AI rejects the proof as suspicious, the seller made a false transfer claim
    if (aiProofStatus === 'rejected_suspicious' && purchase.seller_email) {
      const sellers = await base44.asServiceRole.entities.User.filter({ email: purchase.seller_email }).catch(() => []);
      const seller = sellers[0];
      if (seller) {
        await base44.asServiceRole.entities.User.update(seller.id, {
          transfer_false_claim_count: (seller.transfer_false_claim_count || 0) + 1,
        }).catch(() => {});
      }
    }

    // ── Admin alerts for high-risk results ───────────────────────────────────
    if (aiProofStatus === 'rejected_suspicious' || fraudRiskScore >= 60) {
      base44.asServiceRole.functions.invoke('sendNotificationEmail', {
        to: 'experience@peanutgallery.store',
        subject: `🚨 AI Flagged Suspicious Transfer Proof — Purchase ${purchase_id}`,
        body: `AI Transfer Verification flagged a suspicious proof upload.\n\nPurchase: ${purchase_id}\nSeller: ${purchase.seller_email}\nBuyer: ${purchase.buyer_email}\nAmount: $${purchase.amount?.toFixed(2)}\n\nAI Status: ${aiProofStatus}\nConfidence: ${score}/100\nFraud Risk: ${fraudRiskScore}/100\nFlags: ${flags.join(', ') || 'none'}\n\nAI Summary: ${aiResult.verification_summary}\n\nReview in admin panel immediately.`,
      }).catch(() => {});
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