import { requireMission1Authority, hashReservationToken } from './mission1Authority.js';
import { verifyPaymentRelease } from './paymentRelease.js';

// Trusted recovery service only. Discovery of a PI lost before attachIntent
// uses the durable operation id/key and Stripe metadata, never a timeout or
// an empty search result. This function issues NO financial command.
export async function reconcileCheckoutAdmission(deps, operationId, discoveredPiId) {
  const authority = requireMission1Authority(deps);
  let { context } = await authority.operationContext(operationId);
  if (!context) throw new Error('CHECKOUT_ADMISSION_NOT_FOUND');
  if (context.phase === 'completed') return { ok: true, already_completed: true };
  if (!['checkout_prepared', 'committed'].includes(context.phase)) throw new Error('BOUND_PURCHASE_REQUIRES_RECOVERY');
  const piId = context.payment_intent_id || discoveredPiId;
  if (!piId) throw new Error('PROVIDER_INTENT_DISCOVERY_REQUIRED');
  const pi = await deps.stripe.paymentIntents.retrieve(piId);
  if (pi.id !== piId || pi.metadata?.mission1_checkout_operation_id !== operationId ||
      pi.metadata?.listing_id !== context.listing_id ||
      await hashReservationToken(pi.metadata?.reservation_token || '') !== context.token_hash) {
    throw new Error('ADMISSION_PAYMENT_IDENTITY_UNPROVEN');
  }
  const proof = { ...await verifyPaymentRelease(deps.stripe, piId, { readOnly: true }),
    checkout_operation_id: operationId, token_hash: context.token_hash };
  if (context.phase === 'checkout_prepared') {
    ({ context } = await authority.settleAdmission(operationId, proof));
  }
  // Partial Purchase/PP rows and the old mirror reservation must be reconciled
  // by the ordered outbox worker before authority eligibility is restored.
  if (!deps.projectAdmissionRecovery) throw new Error('ORDERED_PROJECTION_REQUIRED');
  const receipt = await deps.projectAdmissionRecovery(context);
  if (receipt?.verified !== true || receipt.operation_id !== operationId || receipt.version !== context.authority_version) {
    throw new Error('PROJECTION_UNVERIFIED');
  }
  if ((await authority.operationContext(operationId)).context?.phase !== 'completed') {
    await authority.acknowledgeOperation(operationId, context.authority_version);
  }
  return { ok: true };
}
