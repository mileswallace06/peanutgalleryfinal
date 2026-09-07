import { hashReservationToken } from './mission1Authority.js';
import { isFailClosed } from './checkoutLogic.js';
import { runReleaseReservation } from './releaseOrchestrator.js';
import { readCleanupRows } from './purchaseExpiry.js';

export async function runMission1Reserve(deps,listingId) {
  const {entities,user,paymentAuthority:authority}=deps;
  const listings=await readCleanupRows(entities.Listing,{id:listingId});
  const privateRows=await readCleanupRows(entities.ListingPrivate,{listing_id:listingId});
  if(listings.length!==1 || privateRows.length!==1) return {status:409,body:{code:'LISTING_INTEGRITY_ERROR'}};
  const listing=listings[0],lp=privateRows[0];
  if(listing.status!=='active' || lp.proof_status!=='approved' || isFailClosed(listing,lp)) return {status:409,body:{code:'UNAVAILABLE'}};
  if(lp.seller_email===user.email) return {status:400,body:{code:'SELF_PURCHASE'}};
  const now=Date.now();
  const other=await readCleanupRows(entities.Listing,{reserved_by_email:user.email,status:'active'});
  for(const row of other){
    if(row.id===listingId) continue;
    if(Date.parse(row.reservation_expires_at)>now) return {status:409,body:{code:'ALREADY_HAS_RESERVATION',existing_listing_id:row.id}};
    const released=await runReleaseReservation(deps,{listing_id:row.id});
    if(released.status!==200) return released;
  }
  const state=await authority.getState(listingId),token=crypto.randomUUID();
  const result=await authority.reserve({listingId,version:state.version,buyerId:user.id,tokenHash:await hashReservationToken(token),
    expiresAt:new Date(now+10*60*1000).toISOString(),operationId:`m1-reserve:${crypto.randomUUID()}`,details:{token,buyer_email:user.email}});
  if(result.already_reserved) return {status:200,body:{already_reserved:true,reservation_expires_at:result.reservation_expires_at}};
  const receipt=await deps.projectCheckout(result.context.operation_id);
  if(!receipt.verified) throw new Error('RESERVATION_PROJECTION_UNVERIFIED');
  return {status:200,body:{reservation_expires_at:(await authority.getState(listingId)).reservation_expires_at}};
}
