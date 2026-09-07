import { hashReservationToken } from './mission1Authority.js';
import { verifyPaymentRelease } from './paymentRelease.js';
import { readCleanupRows } from './purchaseExpiry.js';

const fields = ['reservation_token','reserved_by_email','reservation_expires_at','reservation_revision'];
const read = async (entities, entity, id) => {
  const rows = await entities[entity].filter({ id });
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('PROJECTION_RECORD_UNPROVEN');
  return { ...rows[0] };
};
const exact = (row, expected) => Object.entries(expected).every(([key, value]) => row[key] === value);
const snapshot = (row, keys) => Object.fromEntries(keys.map(key => [key,row[key] ?? null]));

async function buildPlan(deps, context) {
  const { entities, paymentAuthority: authority } = deps;
  const listing = await read(entities,'Listing',context.listing_id);
  const privateRows = await readCleanupRows(entities.ListingPrivate,{listing_id:listing.id});
  if (privateRows.length !== 1) throw new Error('PROJECTION_PRIVATE_RECORD_UNPROVEN');
  const lp = privateRows[0];
  if(lp.seller_pause_requested_at || lp.seller_cancel_requested_at) throw new Error('SELLER_INTENT_REQUIRES_REVIEW');
  const state = await authority.getState(listing.id);
  if (state.version !== context.authority_version) throw new Error('PROJECTION_VERSION_CONFLICT');
  const plan = [];
  const add = (entity,row,patch,keys=Object.keys(patch)) => plan.push({entity,id:row.id,before:snapshot(row,keys),patch});
  const checkout = context.kind === 'checkout';
  const reserve = context.kind === 'reserve';
  const inventoryOnly = context.kind === 'inventory_sync';
  let token=null, buyer=null, expiry=null, revision=context.operation_id, purchaseId=null;
  if(reserve){
    if(await hashReservationToken(context.details.token)!==context.token_hash) throw new Error('PROJECTION_TOKEN_MISMATCH');
    token=context.details.token;buyer=context.details.buyer_email;expiry=state.reservation_expires_at;revision=context.revision;
  }
  if (!inventoryOnly) {
    const oldHash=context.snapshot?.token_hash ?? (Object.hasOwn(context,'previous_token_hash') ? context.previous_token_hash : context.token_hash);
    for (const row of [listing,lp]) {
      const hash=row.reservation_token ? await hashReservationToken(row.reservation_token) : null;
      if (hash !== oldHash && !(checkout && hash === context.token_hash)) throw new Error('PROJECTION_OWNERSHIP_CHANGED');
      if (row.reservation_revision !== (context.snapshot?.reservation_revision ?? context.previous_revision ?? row.reservation_revision)) {
        throw new Error('PROJECTION_REVISION_CHANGED');
      }
    }
    if (context.payment_intent_id && !checkout) await verifyPaymentRelease(deps.stripe,context.payment_intent_id,{readOnly:true});
    const purchases = await readCleanupRows(entities.Purchase,{listing_id:listing.id});
    if (purchases.some(p=>p.id!==context.purchase_id &&
      !(context.kind==='checkout_admission_recovery' && p.payment_intent_id===context.payment_intent_id) &&
      ['pending_transfer','disputed'].includes(p.transfer_status))) {
      throw new Error('ANOTHER_ACTIVE_PURCHASE');
    }
    if (context.purchase_id) {
      const p = await read(entities,'Purchase',context.purchase_id);
      const pps=await readCleanupRows(entities.PurchasePrivate,{purchase_id:p.id});
      if (pps.length!==1 || pps[0].payment_intent_id!==context.payment_intent_id || pps[0].listing_id!==listing.id) {
        throw new Error('PROJECTION_PURCHASE_IDENTITY_UNPROVEN');
      }
      const pp=pps[0];
      if (p.seller_confirmed || p.buyer_confirmed || !['pending_transfer','expired'].includes(p.transfer_status)) throw new Error('FULFILLMENT_CHANGED');
      if (checkout) {
        if (await hashReservationToken(pp.reservation_token)!==context.token_hash) throw new Error('PROJECTION_TOKEN_MISMATCH');
        token=pp.reservation_token;buyer=pp.buyer_email;expiry=state.reservation_expires_at;revision=context.revision;purchaseId=p.id;
      } else {
        add('Purchase',p,{transfer_status:'expired'});
        add('PurchasePrivate',pp,{cleanup_completed_at:context.committed_at,cleanup_claim:null});
      }
    } else if (context.kind==='checkout_admission_recovery') {
      // Recover partial purchase creation by its independently verified PI.
      const pps=await readCleanupRows(entities.PurchasePrivate,{payment_intent_id:context.payment_intent_id});
      const partial=purchases.filter(p=>p.payment_intent_id===context.payment_intent_id);
      for(const p of partial){
        if(p.seller_confirmed || p.buyer_confirmed || !['pending_transfer','expired'].includes(p.transfer_status)) throw new Error('FULFILLMENT_CHANGED');
        add('Purchase',p,{transfer_status:'expired'});
      }
      for(const pp of pps){
        if(pp.listing_id!==listing.id || !partial.some(p=>p.id===pp.purchase_id)) throw new Error('PARTIAL_PURCHASE_IDENTITY_UNPROVEN');
        add('PurchasePrivate',pp,{cleanup_completed_at:context.settlement.verified_at,cleanup_claim:null});
      }
    }
    const tuple={reservation_token:token,reserved_by_email:buyer,reservation_expires_at:expiry,reservation_revision:revision};
    add('ListingPrivate',lp,{...tuple,cleanup_purchase_id:null,recovery_blocked:false,checkout_quarantined:false},[...fields,'cleanup_purchase_id','recovery_blocked','checkout_quarantined']);
  }
  // Resolve inventory from current stored identity. A linked but missing or
  // differently-owned row is an error, never an optional successful write.
  let inventory;
  if(listing.seat_inventory_id) inventory=await read(entities,'SeatInventory',listing.seat_inventory_id);
  else {
    const candidates=await readCleanupRows(entities.SeatInventory,{linked_listing_id:listing.id});
    if(candidates.length>1) throw new Error('INVENTORY_IDENTITY_AMBIGUOUS');
    inventory=candidates[0];
  }
  if(inventory){
    if(inventory.linked_listing_id && inventory.linked_listing_id!==listing.id ||
       inventory.owner_email && inventory.owner_email!==(lp.seller_email || listing.seller_email) ||
       !inventoryOnly && inventory.linked_purchase_id && inventory.linked_purchase_id!==context.purchase_id) throw new Error('INVENTORY_OWNERSHIP_CHANGED');
    let status=checkout||reserve?'reserved_for_purchase':'listed_for_sale';
    if(inventoryOnly){
      if(state.recovery_blocked || state.checkout_quarantined) return plan;
      status=state.lifecycle_state==='sold'?'transferred':state.lifecycle_state==='reserved'||state.lifecycle_state==='frozen'?'reserved_for_purchase':
        listing.status==='active'?'listed_for_sale':'available';
      purchaseId=context.purchase_id || null;
      if(purchaseId && inventory.linked_purchase_id && inventory.linked_purchase_id!==purchaseId) throw new Error('INVENTORY_OWNERSHIP_CHANGED');
    }
    add('SeatInventory',inventory,{inventory_status:status,inventory_intent:status==='available'?'undecided':'sell',
      linked_listing_id:status==='available'?null:listing.id,linked_purchase_id:purchaseId});
  }
  if(!inventoryOnly) add('Listing',listing,{status:checkout?'pending_transfer':'active',hidden_reason:null,
    reservation_token:token,reserved_by_email:buyer,reservation_expires_at:expiry,reservation_revision:revision},['status','hidden_reason',...fields]);
  return plan;
}

// The designated projection worker. All writes have a durable start marker.
// A thrown/ambiguous Base44 write retains its owner and stops; no timeout-based
// takeover can allow an older write to land after a newer reservation.
export async function projectMission1Operation(deps, operationId, {recover = false} = {}) {
  const {paymentAuthority:authority,entities}=deps;
  const owner=crypto.randomUUID();
  const claim=await authority.claimProjection(operationId,owner,recover);
  if(claim.completed) return authority.projectionReceipt(operationId);
  let context=claim.context;
  try {
    // Persisted plans are not provider evidence on a recovery attempt.
    if(context.payment_intent_id && context.kind !== 'checkout') {
      await verifyPaymentRelease(deps.stripe,context.payment_intent_id,{readOnly:true});
    }
    if(!context.projection_plan){
      const plan=await buildPlan(deps,context);
      ({context}=await authority.planProjection(operationId,owner,plan));
    }
    if(context.projection_pending!==undefined) throw new Error('PROJECTION_WRITE_OUTCOME_UNKNOWN');
    const plan=context.projection_plan;
    for(let index=context.projection_done;index<plan.length;index++){
      const item=plan[index];
      // Additional drift checks; exclusion still comes only from the SQL
      // barrier and verified rollout coverage of every conflicting writer.
      const currentPrivate=await readCleanupRows(entities.ListingPrivate,{listing_id:context.listing_id});
      if(currentPrivate.length!==1 || currentPrivate[0].seller_pause_requested_at || currentPrivate[0].seller_cancel_requested_at) throw new Error('SELLER_INTENT_REQUIRES_REVIEW');
      if(context.purchase_id && context.kind!=='inventory_sync'){
        const purchase=await read(entities,'Purchase',context.purchase_id);
        if(purchase.seller_confirmed || purchase.buyer_confirmed || !['pending_transfer','expired'].includes(purchase.transfer_status)) throw new Error('FULFILLMENT_CHANGED');
      }
      for(const planned of plan){
        const row=await read(entities,planned.entity,planned.id);
        if(!exact(row,planned.patch) && !Object.entries(planned.before).every(([key,value])=>(row[key]??null)===value)) throw new Error('PROJECTION_OWNERSHIP_CHANGED');
      }
      const before=await read(entities,item.entity,item.id);
      if(!exact(before,item.patch) && !Object.entries(item.before).every(([key,value])=>(before[key]??null)===value)) throw new Error('PROJECTION_OWNERSHIP_CHANGED');
      await authority.projectionStep(operationId,owner,index,false);
      if(!exact(before,item.patch)) await entities[item.entity].update(item.id,item.patch);
      const after=await read(entities,item.entity,item.id);
      if(!exact(after,item.patch)) throw new Error('PROJECTION_PERSISTENCE_UNVERIFIED');
      await authority.projectionStep(operationId,owner,index,true);
    }
    for(const item of plan) if(!exact(await read(entities,item.entity,item.id),item.patch)) throw new Error('PROJECTION_FINAL_VERIFICATION_FAILED');
    await authority.completeProjection(operationId,owner);
    return authority.projectionReceipt(operationId);
  } catch(error) {
    try { await authority.projectionFailure(operationId,owner,error.message); } catch { /* Durable ownership remains; never claim success. */ }
    throw error;
  }
}
