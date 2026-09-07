// Only allowlisted stored-function calls. The handler must inject restricted
// executor/recorder transports; this module never reads credentials or falls
// back to Base44 locking. The ordered outbox worker owns projection receipts.
export function createMission1Authority({ executor, recorder, worker }) {
  const call = async (transport, name, args) => {
    if (!transport) throw new Error('APPROVED_AUTHORITY_REQUIRED');
    const placeholders = args.map((_, index) => `$${index + 1}`).join(',');
    const rows = await transport(`SELECT authority_v1.${name}(${placeholders}) AS result`, args);
    const result = rows?.[0]?.result;
    if (!result || result.ok === false) throw new Error(result?.code || 'AUTHORITY_RESPONSE_UNPROVEN');
    return result;
  };
  return {
    checkoutReady: (purchase,pi,buyer) => call(executor,'m1_checkout_ready',[purchase,pi,buyer]),
    getState: id => call(executor, 'get_state', [id]),
    beginCheckout: p => call(executor, 'm1_begin_checkout', [p.listingId, p.version, p.buyerId, p.tokenHash, p.expiresAt, p.operationId]),
    attachIntent: (operation, pi) => call(executor, 'm1_attach_checkout_intent', [operation, pi]),
    bindCheckout: (operation, purchase, pi) => call(executor, 'm1_bind_checkout', [operation, purchase, pi]),
    releaseReservation: (id, version, operation, buyer, hash) => call(executor, 'm1_release_reservation', [id, version, operation, buyer, hash]),
    operationContext: operation => call(executor, 'm1_operation_context', [operation]),
    acknowledgeOperation: (operation, version) => call(worker, 'm1_ack_projection', [operation, version]),
    settleAdmission: (operation, proof) => call(recorder, 'm1_settle_checkout_admission', [operation, JSON.stringify(proof)]),
    context: purchase => call(executor, 'm1_release_context', [purchase]),
    prepare: (p, snapshot, owner, recover) => call(executor, 'm1_prepare_release', [p.purchase_id, p.listing_id, p.payment_intent_id, JSON.stringify(snapshot), owner, recover]),
    dispatch: (purchase, owner, epoch, kind) => call(executor, 'm1_dispatch_release', [purchase, owner, epoch, kind]),
    fail: (purchase, owner, epoch, error) => call(executor, 'm1_release_failure', [purchase, owner, epoch, error]),
    commit: (purchase, owner, epoch, proof) => call(recorder, 'm1_commit_release', [purchase, owner, epoch, JSON.stringify(proof)]),
    acknowledgeProjection: (purchase, version) => call(worker, 'm1_ack_release_projection', [purchase, version]),
    recordHistorical: (user, purchase, pi, proof) => call(recorder, 'm1_record_historical_settlement', [user, purchase, pi, JSON.stringify(proof)]),
    claimProjection: (op, owner, recover = false) => call(worker, 'm1_claim_projection', [op, owner, recover]),
    planProjection: (op, owner, plan) => call(worker, 'm1_plan_projection', [op, owner, JSON.stringify(plan)]),
    projectionStep: (op, owner, index, verified) => call(worker, 'm1_projection_step', [op, owner, index, verified]),
    projectionFailure: (op, owner, code) => call(worker, 'm1_projection_failure', [op, owner, code]),
    completeProjection: (op, owner) => call(worker, 'm1_complete_projection', [op, owner]),
    projectionReceipt: op => call(executor, 'm1_projection_receipt', [op]),
    pendingRecovery: () => call(worker, 'm1_pending_recovery', []),
    queueInventory: listing => call(executor, 'm1_queue_inventory', [listing]),
    reserve: p => call(executor, 'm1_reserve', [p.listingId,p.version,p.buyerId,p.tokenHash,p.expiresAt,p.operationId,JSON.stringify(p.details)]),
    async userObligations(id) {
      if (!executor) throw new Error('APPROVED_AUTHORITY_REQUIRED');
      return executor('SELECT * FROM authority_v1.check_user_obligations($1)', [id]);
    },
  };
}

export function requireMission1Authority(deps) {
  if (!deps.paymentAuthority) throw new Error('APPROVED_AUTHORITY_REQUIRED');
  return deps.paymentAuthority;
}

export async function hashReservationToken(token) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
