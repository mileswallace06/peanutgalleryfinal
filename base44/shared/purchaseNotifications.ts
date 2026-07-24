/**
 * Shared fire-and-forget helpers for purchase-related backend functions.
 * Plain module — no Deno.serve. Import from functions that need to award
 * points or record notifications without blocking the main response.
 */

// Fire-and-forget points award — never throws
export async function awardPoints(base44, userEmail, action, referenceId, referenceType) {
  try {
    await base44.asServiceRole.functions.invoke('awardPoints', {
      _internal_service_call: true,
      action,
      reference_id: referenceId,
      reference_type: referenceType,
      target_email: userEmail,
    });
  } catch (err) {
    console.error('[purchase] awardPoints failed for', userEmail, '|', err?.message);
  }
}

// Fire-and-forget notification — records in-app + push + email
export async function notify(base44, userEmail, title, body, type, purchaseId) {
  try {
    await base44.asServiceRole.functions.invoke('recordNotification', {
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