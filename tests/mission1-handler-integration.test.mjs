import assert from 'node:assert/strict';
import { createMockDeps,createDefaultSeed } from './helpers/mockDeps.mjs';
import { closeMission1Databases } from './helpers/mission1Postgres.mjs';
import { loadMission1Handler } from './helpers/loadMission1Handler.mjs';

if(!process.env.PG_MISSION1_SOCKET)throw new Error('Run through tests/run-mission1-local.mjs');
const cases=[];const test=(name,run)=>cases.push({name,run});
function fixture(unpaid=false){
  const ctx=createDefaultSeed({purchase:{seller_confirmed:false,created_date:new Date(Date.now()-49*3600000).toISOString()}});
  if(unpaid){ctx.seed.Purchase=[];ctx.seed.PurchasePrivate=[];ctx.seed.Listing[0].status='active';}
  const deps=createMockDeps({seed:ctx.seed,hooks:{}});
  deps.stripe.pisById.set(ctx.piId,{id:ctx.piId,status:'requires_capture'});
  const stores=deps._state.stores;
  stores.Listing[0].seat_inventory_id='inventory_1';
  const inventory={id:'inventory_1',linked_listing_id:ctx.listingId,linked_purchase_id:unpaid?null:ctx.purchaseId,
    owner_email:ctx.sellerEmail,inventory_status:unpaid?'listed_for_sale':'reserved_for_purchase',inventory_intent:'sell'};
  deps.entities.SeatInventory={filter:async query=>Object.entries(query).every(([k,v])=>inventory[k]===v)?[{...inventory}]:[],
    update:async(id,patch)=>{assert.equal(id,inventory.id);await deps.hooks.inventoryUpdate?.(patch);Object.assign(inventory,patch);return {...inventory};}};
  return {ctx,deps,stores,inventory};
}

test('actual abort handler uses restricted authority and real projector to settle and restore inventory',async()=>{
  const f=fixture();const handler=await loadMission1Handler('abortCheckout',f.deps);
  const response=await handler.request({purchase_id:f.ctx.purchaseId});
  const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
  assert.equal(f.stores.Purchase[0].transfer_status,'expired');assert.equal(f.inventory.inventory_status,'listed_for_sale');
  assert.equal(f.stores.Listing[0].reservation_token,null);assert.equal(f.inventory.linked_purchase_id,null);
  assert.ok(handler.queries.some(q=>q.role==='authority_stripe_recorder'&&q.query.includes('m1_commit_release')));
  assert.ok(handler.queries.some(q=>q.role==='authority_worker'&&q.query.includes('m1_complete_projection')));
});
test('actual reminder handler expires seller purchase through the same recovery and inventory worker',async()=>{
  const f=fixture();f.deps.user.role='admin';const handler=await loadMission1Handler('processTransferReminders',f.deps);
  const response=await handler.request();assert.equal(response.status,200,JSON.stringify(await response.json()));
  assert.equal(f.inventory.inventory_status,'listed_for_sale');assert.ok(f.stores.PurchasePrivate[0].cleanup_completed_at);
});
test('actual reservation release handler projects an unpaid release before reporting success',async()=>{
  const f=fixture(true);const handler=await loadMission1Handler('releaseReservation',f.deps);
  const response=await handler.request({listing_id:f.ctx.listingId});assert.equal(response.status,200,JSON.stringify(await response.json()));
  assert.equal(f.stores.Listing[0].reservation_token,null);
});
test('actual worker rejects anonymous or ordinary-user recovery before SQL and financial calls',async()=>{
  const f=fixture();
  for(const anonymous of [true,false]){
    const handler=await loadMission1Handler('processTransferReminders',f.deps,{anonymous});
    assert.equal((await handler.request({action:'recover_purchase',purchase_id:f.ctx.purchaseId})).status,403);
    assert.equal(handler.queries.length,0);
  }
});
test('rollout assertions from request JSON cannot enable unconfigured handlers',async()=>{
  const f=fixture();const handler=await loadMission1Handler('abortCheckout',f.deps,{secrets:{MISSION1_ROLLOUT_EVIDENCE:undefined}});
  const response=await handler.request({purchase_id:f.ctx.purchaseId,base44_persistence_verified:true,exclusive_writers_verified:true});
  assert.equal(response.status,503);assert.equal(handler.queries.length,0);
});

function freshFixture(){
  const f=fixture(true);
  for(const row of [f.stores.Listing[0],f.stores.ListingPrivate[0]]){
    row.reservation_token=null;row.reserved_by_email=null;row.reservation_expires_at=null;
  }
  return f;
}
const checkoutBody=f=>({listing_id:f.ctx.listingId,buyer_name:'Synthetic Buyer',buyer_phone:'5555550100'});
const worker=async(f,options={})=>{f.deps.user.role='admin';return loadMission1Handler('processTransferReminders',f.deps,options);};
const contextOf=async f=>(await f.deps.paymentAuthority.context(f.ctx.purchaseId)).context;

test('actual checkout creates admission and binding before ordered reservation and inventory publication',async()=>{
  const f=freshFixture(),handler=await loadMission1Handler('createCheckout',f.deps);
  const response=await handler.request(checkoutBody(f)),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
  assert.ok(body.clientSecret);assert.equal(f.inventory.inventory_status,'reserved_for_purchase');
  assert.equal(f.inventory.linked_purchase_id,body.purchase_id);
  assert.equal(f.stores.Listing[0].reservation_token,f.stores.PurchasePrivate[0].reservation_token);
  const q=handler.queries.map(row=>row.query);
  assert.ok(q.findIndex(q=>q.includes('m1_begin_checkout'))<q.findIndex(q=>q.includes('m1_bind_checkout')));
  assert.ok(q.findIndex(q=>q.includes('m1_bind_checkout'))<q.findIndex(q=>q.includes('m1_claim_projection')));
});

test('exact real-handler race: checkout binds after the release negative lookup and release cannot clear it',async()=>{
  const f=fixture(true),release=await loadMission1Handler('releaseReservation',f.deps),checkout=await loadMission1Handler('createCheckout',f.deps);
  const read=f.deps.entities.PurchasePrivate.filter;let interleaved=false,created;
  f.deps.entities.PurchasePrivate.filter=async query=>{
    const result=await read(query);
    if(!interleaved && Object.keys(query).length===1 && query.listing_id===f.ctx.listingId){
      interleaved=true;const response=await checkout.request(checkoutBody(f));created=await response.json();assert.equal(response.status,200,JSON.stringify(created));
    }
    return result;
  };
  const response=await release.request({listing_id:f.ctx.listingId});
  assert.ok(interleaved);assert.equal(response.status,409);
  assert.equal((await response.json()).code,'AUTHORITY_OWNERSHIP_CHANGED');
  assert.ok(release.queries.some(q=>q.query.includes('m1_release_reservation')));
  assert.equal(f.stores.Listing[0].status,'pending_transfer');assert.equal(f.inventory.linked_purchase_id,created.purchase_id);
  assert.equal(f.stores.Listing[0].reservation_token,f.stores.PurchasePrivate[0].reservation_token);
});

test('actual reserve and release share authority; reservation projection preserves exact ownership',async()=>{
  const f=freshFixture(),reserve=await loadMission1Handler('reserveListing',f.deps);
  const response=await reserve.request({listing_id:f.ctx.listingId});assert.equal(response.status,200,JSON.stringify(await response.json()));
  assert.ok(f.stores.Listing[0].reservation_token);assert.equal(f.inventory.inventory_status,'reserved_for_purchase');
  const release=await loadMission1Handler('releaseReservation',f.deps);
  const done=await release.request({listing_id:f.ctx.listingId});assert.equal(done.status,200,JSON.stringify(await done.json()));
  assert.equal(f.inventory.inventory_status,'listed_for_sale');
});

test('actual cancellation handler settles through the same inventory worker',async()=>{
  const f=fixture(),handler=await loadMission1Handler('cancelPurchase',f.deps);
  const response=await handler.request({purchase_id:f.ctx.purchaseId});assert.equal(response.status,200,JSON.stringify(await response.json()));
  assert.equal(f.inventory.linked_purchase_id,null);assert.equal((await contextOf(f)).phase,'completed');
});

test('settlement before persistence is recovered by the actual worker without another cancellation',async()=>{
  const f=fixture();let cancelCount=0,fail=true;
  const cancel=f.deps.stripe.paymentIntents.cancel;f.deps.stripe.paymentIntents.cancel=async(...args)=>{cancelCount++;return cancel(...args);};
  const first=await loadMission1Handler('abortCheckout',f.deps,{beforeQuery:query=>{if(fail&&query.includes('m1_commit_release')){fail=false;throw new Error('synthetic lost persistence');}}});
  assert.equal((await first.request({purchase_id:f.ctx.purchaseId})).status,500);assert.notEqual(f.inventory.inventory_status,'listed_for_sale');
  const recovery=await worker(f);const response=await recovery.request({action:'recover_purchase',purchase_id:f.ctx.purchaseId});
  assert.equal(response.status,200,JSON.stringify(await response.json()));assert.equal(cancelCount,1);assert.equal(f.inventory.inventory_status,'listed_for_sale');
});

test('crash after projection claim and before any write is fenced and recovered without waiting for a timeout',async()=>{
  const f=fixture();let fail=true;
  const first=await loadMission1Handler('abortCheckout',f.deps,{afterQuery:query=>{if(fail&&query.includes('m1_claim_projection')){fail=false;throw new Error('synthetic crash');}}});
  assert.equal((await first.request({purchase_id:f.ctx.purchaseId})).status,500);
  const [old]=await f.deps._mission1.sql("SELECT event_id,lease_owner FROM authority_v1.reservation_outbox WHERE event_id LIKE 'm1-release:%'");
  assert.ok(old?.lease_owner);
  const recovery=await worker(f),response=await recovery.request({action:'recover_purchase',purchase_id:f.ctx.purchaseId});
  assert.equal(response.status,200,JSON.stringify(await response.json()));
  await assert.rejects(f.deps.paymentAuthority.planProjection(old.event_id,old.lease_owner,[]),/PROJECTION_PLAN_REJECTED/);
});

test('release before completion persists ownership and resumes with fresh provider verification',async()=>{
  const f=fixture();let fail=true;
  const first=await loadMission1Handler('abortCheckout',f.deps,{beforeQuery:query=>{if(fail&&query.includes('m1_complete_projection')){fail=false;throw new Error('completion unavailable');}}});
  assert.equal((await first.request({purchase_id:f.ctx.purchaseId})).status,500);
  assert.equal(f.inventory.inventory_status,'listed_for_sale');assert.equal((await contextOf(f)).phase,'committed');
  const a=await f.deps.paymentAuthority.getState(f.ctx.listingId);
  await assert.rejects(f.deps.paymentAuthority.beginCheckout({listingId:f.ctx.listingId,version:a.version,buyerId:'user_buyer',tokenHash:'new',expiresAt:new Date(Date.now()+60000).toISOString(),operationId:'m1-checkout:blocked'}),/CHECKOUT_AUTHORITY_CONFLICT/);
  const retrieve=f.deps.stripe.paymentIntents.retrieve;f.deps.stripe.paymentIntents.retrieve=async()=>{throw new Error('provider unavailable');};
  const recovery=await worker(f);assert.equal((await recovery.request({action:'recover_purchase',purchase_id:f.ctx.purchaseId})).status,500);
  f.deps.stripe.paymentIntents.retrieve=retrieve;
  assert.equal((await recovery.request({action:'recover_purchase',purchase_id:f.ctx.purchaseId})).status,200);
});

test('unknown inventory write retains ownership, rejects generic workers and remains failed after alert resolution',async()=>{
  const f=fixture();f.deps.hooks.inventoryUpdate=async()=>{throw new Error('unknown write outcome');};
  const first=await loadMission1Handler('abortCheckout',f.deps);assert.equal((await first.request({purchase_id:f.ctx.purchaseId})).status,500);
  const [outbox]=await f.deps._mission1.sql("SELECT * FROM authority_v1.reservation_outbox WHERE event_id LIKE 'm1-release:%'");
  assert.ok(outbox.lease_owner);assert.ok(outbox.payload.projection_pending!==undefined);
  const client=await f.deps._mission1.independentConnection();await client.query('SET ROLE authority_worker');
  assert.equal((await client.query('SELECT * FROM authority_v1.claim_outbox_batch($1,100,10)',['generic'])).rows.length,0);
  await assert.rejects(client.query('SELECT authority_v1.complete_outbox_event($1,true,NULL)',[outbox.outbox_id]),/OUTBOX_COMPLETE_COUNT/);
  await f.deps._mission1.sql("UPDATE authority_v1.reservation_outbox SET lease_expires_at=now()-interval '1 hour'");
  assert.equal((await client.query('SELECT authority_v1.recover_expired_outbox_leases() AS count')).rows[0].count,0);
  await f.deps._mission1.sql('UPDATE authority_v1.operational_incidents SET resolved=true');
  delete f.deps.hooks.inventoryUpdate;
  const recovery=await worker(f);assert.equal((await recovery.request({action:'recover_purchase',purchase_id:f.ctx.purchaseId})).status,500);
  assert.equal((await recovery.request()).status,500); // scheduled result must not hide retained recovery failure
  assert.notEqual(f.stores.Listing[0].status,'active');
});

test('Base44 silently dropping completion or explicit null clearing cannot produce a receipt',async()=>{
  for(const field of ['cleanup_completed_at','cleanup_claim']){
    const f=fixture();f.stores.PurchasePrivate[0].cleanup_claim='legacy_fenced';
    const update=f.deps.entities.PurchasePrivate.update;
    f.deps.entities.PurchasePrivate.update=async(id,patch)=>{const dropped={...patch};delete dropped[field];return update(id,dropped);};
    const handler=await loadMission1Handler('abortCheckout',f.deps);
    assert.equal((await handler.request({purchase_id:f.ctx.purchaseId})).status,500);
    assert.notEqual(f.stores.Listing[0].status,'active');assert.equal((await contextOf(f)).phase,'committed');
  }
});

test('delayed inventory event uses current authority and cannot clear a captured purchase',async()=>{
  const f=fixture();f.stores.PurchasePrivate[0].payment_captured=true;
  const handler=await loadMission1Handler('syncInventoryOnListingChange',f.deps);
  const response=await handler.request({event:{entity_id:f.ctx.listingId},data:{id:f.ctx.listingId,status:'cancelled',linked_purchase_id:null}});
  assert.equal(response.status,200,JSON.stringify(await response.json()));
  assert.equal(f.inventory.inventory_status,'reserved_for_purchase');assert.equal(f.inventory.linked_purchase_id,f.ctx.purchaseId);
});

test('actual captured quarantine recovers only after independently verified full refund, never alert resolution',async()=>{
  const f=fixture();let refunds=0;
  f.deps.stripe.pisById.set(f.ctx.piId,{id:f.ctx.piId,status:'succeeded',latest_charge:'ch_synthetic'});
  const charge={id:'ch_synthetic',payment_intent:f.ctx.piId,amount:10500,amount_refunded:0,refunded:false};
  f.deps.stripe.charges={retrieve:async()=>({...charge})};f.deps.stripe.refunds={create:async()=>{refunds++;throw new Error('No automatic seller refund');}};
  const handler=await worker(f);assert.equal((await handler.request()).status,500);
  await f.deps._mission1.sql('UPDATE authority_v1.operational_incidents SET resolved=true');
  assert.equal((await handler.request({action:'recover_purchase',purchase_id:f.ctx.purchaseId})).status,500);
  charge.amount_refunded=10500;charge.refunded=true;
  const response=await handler.request({action:'recover_purchase',purchase_id:f.ctx.purchaseId});assert.equal(response.status,200,JSON.stringify(await response.json()));
  assert.equal(refunds,0);assert.equal(f.inventory.inventory_status,'listed_for_sale');
});

test('wrong SQL role or database fingerprint blocks real handlers before any SQL or Stripe action',async()=>{
  for(const value of ['postgresql://postgres:synthetic@synthetic.neon.tech/fixture','postgresql://authority_executor:synthetic@synthetic.neon.tech/wrong']){
    const f=fixture(),handler=await loadMission1Handler('abortCheckout',f.deps,{secrets:{AUTHORITY_V1_DB_URL_DEV_EXECUTOR:value}});
    assert.equal((await handler.request({purchase_id:f.ctx.purchaseId})).status,503);assert.equal(handler.queries.length,0);
  }
});

for(const settlement of ['canceled','refunded','unresolved']){
  test(`actual deletion handler reconciles historical ${settlement} before private data mutation`,async()=>{
    const f=fixture();f.stores.Purchase[0].transfer_status='expired';
    for(const row of [f.stores.Listing[0],f.stores.ListingPrivate[0]]){
      row.reservation_token=null;row.reserved_by_email=null;row.reservation_expires_at=null;
    }
    f.stores.Listing[0].status='active';f.stores.PurchasePrivate[0].payment_captured=settlement==='refunded';
    f.deps.stripe.pisById.set(f.ctx.piId,{id:f.ctx.piId,status:settlement==='refunded'?'succeeded':settlement==='canceled'?'canceled':'requires_capture',latest_charge:'ch_history'});
    f.deps.stripe.charges={retrieve:async()=>({id:'ch_history',payment_intent:f.ctx.piId,amount:10500,amount_refunded:10500,refunded:true})};
    let postGuard=false;
    // Stop before the existing unrelated deletion body; this specifically
    // verifies actual runtime dependencies reach the historical guard.
    f.deps.entities.UserPrivate={filter:async()=>{postGuard=true;throw new Error('SYNTHETIC_POST_GUARD_STOP');}};
    const handler=await loadMission1Handler('deleteAccount',f.deps),response=await handler.request();
    assert.equal(postGuard,settlement!=='unresolved');
    assert.equal(response.status,settlement==='unresolved'?409:500);
    assert.equal(f.stores.PurchasePrivate.length,1);
    assert.equal(handler.queries.some(q=>q.query.includes('m1_record_historical_settlement')),settlement!=='unresolved');
  });
}

test('duplicate actual worker calls cancel once and cannot independently publish inventory',async()=>{
  const f=fixture();let cancels=0;
  const cancel=f.deps.stripe.paymentIntents.cancel;
  f.deps.stripe.paymentIntents.cancel=async(...args)=>{cancels++;return cancel(...args);};
  const first=await loadMission1Handler('abortCheckout',f.deps),second=await loadMission1Handler('abortCheckout',f.deps);
  const responses=await Promise.all([first.request({purchase_id:f.ctx.purchaseId}),second.request({purchase_id:f.ctx.purchaseId})]);
  assert.ok(responses.some(r=>r.status===200));assert.equal(cancels,1);
  assert.equal(f.inventory.inventory_status,'listed_for_sale');assert.equal((await contextOf(f)).phase,'completed');
});

test('actual recovery status exposes durable incident evidence and failed incident writes cannot claim success',async()=>{
  const f=fixture();f.deps.stripe.paymentIntents.retrieve=async()=>{throw new Error('provider unavailable');};
  const handler=await worker(f);
  assert.equal((await handler.request()).status,500);
  const status=await (await handler.request({action:'recovery_status'})).json();
  assert.ok(status.incidents.some(i=>i.description.includes(f.ctx.piId)));assert.ok(status.operations.length);
  const g=fixture();g.deps.stripe.paymentIntents.retrieve=async()=>{throw new Error('provider unavailable');};
  await g.deps._mission1.sql(`CREATE FUNCTION public.reject_incident() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic incident failure'; END $$;
    CREATE TRIGGER reject_incident BEFORE INSERT OR UPDATE ON authority_v1.operational_incidents FOR EACH ROW EXECUTE FUNCTION public.reject_incident()`);
  const failed=await loadMission1Handler('abortCheckout',g.deps),response=await failed.request({purchase_id:g.ctx.purchaseId}),body=await response.json();
  assert.equal(response.status,500);assert.equal(body.alert_proven,false);
  assert.notEqual(g.inventory.inventory_status,'listed_for_sale');assert.equal((await contextOf(g)).phase,'prepared');
});

test('checkout retry cannot expose a client secret while its projection receipt is incomplete',async()=>{
  const f=freshFixture(),handler=await loadMission1Handler('createCheckout',f.deps);
  assert.equal((await handler.request(checkoutBody(f))).status,200);
  await f.deps._mission1.sql("UPDATE authority_v1.reservation_outbox SET delivery_status='pending' WHERE payload->>'kind'='checkout'");
  const sec=f.stores.UserSecurityProfile.find(s=>s.user_id==='user_buyer');sec.last_pi_attempt_at=null;
  const response=await handler.request(checkoutBody(f)),body=await response.json();
  assert.equal(response.status,503);assert.equal(body.clientSecret,undefined);assert.equal(body.code,'CHECKOUT_PROJECTION_INCOMPLETE');
});

test('all PostgreSQL authority writers are fenced while a Mission 1 projection is pending',async()=>{
  const f=fixture();let fail=true;
  const handler=await loadMission1Handler('abortCheckout',f.deps,{beforeQuery:query=>{if(fail&&query.includes('m1_complete_projection')){fail=false;throw new Error('interrupted completion');}}});
  assert.equal((await handler.request({purchase_id:f.ctx.purchaseId})).status,500);
  const client=await f.deps._mission1.independentConnection();
  // Separate real connection: the table barrier also covers existing stored
  // functions, rather than assuming every generic writer remembered a lookup.
  for(const patch of ["version=version+1","seller_pause_requested_at=now()","transfer_state='in_progress'"]){
    await assert.rejects(client.query(`UPDATE authority_v1.reservation_authority SET ${patch}`),/MISSION1_PROJECTION_PENDING/);
  }
  const recovery=await worker(f);assert.equal((await recovery.request({action:'recover_purchase',purchase_id:f.ctx.purchaseId})).status,200);
  await client.query('UPDATE authority_v1.reservation_authority SET version=version+1');
});

let failed=0;
for(const {name,run}of cases){try{await run();console.log(`PASS ${name}`);}catch(error){failed++;console.error(`FAIL ${name}: ${error.stack}`);}}
await closeMission1Databases();console.log(`${cases.length-failed} passed, ${failed} failed`);process.exitCode=failed?1:0;
