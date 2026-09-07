/** Provider verification shared by expiry, abort and buyer cancellation.
 * A response from cancel/refund is never proof of settlement. Only a fresh
 * provider read permits inventory release. Captured seller expiries require
 * review; only the existing buyer-cancellation policy permits a new refund.
 */
export async function verifyPaymentRelease(stripe, piId, { allowRefund = false, readOnly = false, beforeAction } = {}) {
  if (!stripe || !piId) throw new Error('PAYMENT_UNAVAILABLE');
  let pi = await stripe.paymentIntents.retrieve(piId);
  if (pi.id !== piId) throw new Error('PAYMENT_ID_MISMATCH');
  if (pi.status === 'succeeded') {
    const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id;
    if (!chargeId) throw new Error('CAPTURED_PAYMENT_REQUIRES_REVIEW');
    let charge = await stripe.charges.retrieve(chargeId);
    const refunded = c => c.payment_intent === piId && c.refunded === true &&
      c.amount > 0 && c.amount_refunded === c.amount;
    if (!refunded(charge) && allowRefund && !readOnly) {
      // A partial/pending refund cannot safely be retried as a new full refund.
      if (charge.amount_refunded !== 0) throw new Error('PARTIAL_REFUND_REQUIRES_REVIEW');
      const refunds = await stripe.refunds.list({ payment_intent: piId, limit: 1 });
      if (refunds.data.length) throw new Error('EXISTING_REFUND_REQUIRES_REVIEW');
      if (!beforeAction) throw new Error('APPROVED_DISPATCH_REQUIRED');
      const dispatch = await beforeAction('refund');
      try {
        await stripe.refunds.create({ payment_intent: piId }, { idempotencyKey: dispatch.idempotency_key });
      } catch { /* A lost response is reconciled below, never assumed safe. */ }
    }
    pi = await stripe.paymentIntents.retrieve(piId);
    charge = await stripe.charges.retrieve(chargeId);
    if (pi.id !== piId || pi.status !== 'succeeded' || !refunded(charge)) {
      throw new Error('CAPTURED_PAYMENT_REQUIRES_REVIEW');
    }
    return { status: 'refunded', payment_intent_id: piId, pi_status: pi.status, verified_at: new Date().toISOString(),
      charge_payment_intent: charge.payment_intent, charge_refunded: charge.refunded, amount: charge.amount, amount_refunded: charge.amount_refunded };
  }
  if (['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'requires_capture'].includes(pi.status)) {
    if (readOnly) throw new Error('PAYMENT_REQUIRES_PROVIDER_RECONCILIATION');
    if (!beforeAction) throw new Error('APPROVED_DISPATCH_REQUIRED');
    const dispatch = await beforeAction('cancel');
    try {
      await stripe.paymentIntents.cancel(piId, {}, { idempotencyKey: dispatch.idempotency_key });
    } catch { /* Includes lost responses; the fresh read decides. */ }
  } else if (pi.status !== 'canceled') {
    throw new Error(`PAYMENT_UNRESOLVED:${pi.status}`);
  }
  pi = await stripe.paymentIntents.retrieve(piId);
  if (pi.id !== piId || pi.status !== 'canceled') throw new Error(`CANCELLATION_UNVERIFIED:${pi.status}`);
  return { status: 'canceled', payment_intent_id: piId, pi_status: pi.status, verified_at: new Date().toISOString() };
}
