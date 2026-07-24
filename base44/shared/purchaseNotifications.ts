/**
 * Shared fire-and-forget helpers for purchase-related backend functions.
 * Plain module — no Deno.serve. Imported by trusted backend functions and run
 * in-process; never re-invokes a public function, so there is no spoofable
 * internal-call header.
 */

import { recordNotification } from './notifications.ts';
import { awardPointsInternal } from './points.ts';

// Fire-and-forget points award — never throws. Trusted: the caller has already
// verified the marketplace state; awardPointsInternal re-validates the record.
export async function awardPoints(base44, userEmail, action, referenceId, referenceType) {
  try {
    await awardPointsInternal(base44, userEmail, action, referenceId, referenceType);
  } catch (err) {
    console.error('[purchase] awardPoints failed for', userEmail, '|', err?.message);
  }
}

// Fire-and-forget notification — records in-app + push + email. Title/body/type
// are produced server-side by the caller; the buyer never supplies content.
export async function notify(base44, userEmail, title, body, type, purchaseId) {
  try {
    await recordNotification(base44, {
      user_email: userEmail,
      title,
      body,
      type,
      reference_id: purchaseId,
      reference_type: 'purchase',
      action_url: purchaseId ? `/purchase/${purchaseId}` : null,
    });
  } catch (err) {
    console.error('[purchase] notify failed to', userEmail, '|', err?.message);
  }
}

// Fee engine (mirrors feeEngine.js ACTIVE_FEE_MODEL_ID = 'buyer_5_min_1')
export function calcPlatformFee(subtotal) {
  return Math.max(1.00, Math.round(subtotal * 0.05 * 100) / 100);
}