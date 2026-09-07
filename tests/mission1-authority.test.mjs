import assert from 'node:assert/strict';
import { createMockDeps, createDefaultSeed } from './helpers/mockDeps.mjs';
import { createMission1Authority, hashReservationToken } from '../base44/shared/mission1Authority.js';
import { expirePurchaseSafely, reconcilePaymentRelease } from '../base44/shared/purchaseExpiry.js';
import { closeMission1Databases } from './helpers/mission1Postgres.mjs';
import { reconcileCheckoutAdmission } from '../base44/shared/checkoutAdmissionRecovery.js';
import { runReleaseReservation } from '../base44/shared/releaseOrchestrator.js';

if (!process.env.PG_MISSION1_SOCKET) throw new Error('Run through tests/run-mission1-local.mjs; these tests require actual PostgreSQL');
const cases=[]; const test=(name,run)=>cases.push({name,run});
function fixture(unpaid=false) {
  const ctx=createDefaultSeed({purchase:{seller_confirmed:false,created_date:new Date(Date.now()-49*3600000).toISOString()}});
  if(unpaid){ctx.seed.Purchase=[];ctx.seed.PurchasePrivate=[];ctx.seed.Listing[0].status='active';}
  const deps=createMockDeps({seed:ctx.seed,hooks:{}});let cancels=0;
  deps.stripe.pisById.set(ctx.piId,{id:ctx.piId,status:'requires_capture'});
  const cancel=deps.stripe.paymentIntents.cancel;
  deps.stripe.paymentIntents.cancel=async(...args)=>{cancels++;return cancel(...args);};
  return {ctx,deps,authority:deps.paymentAuthority,sql:deps._mission1.sql,stores:deps._state.stores,cancels:()=>cancels};
}
const snapshot=async f=>({...f.stores.Listing[0],token_hash:await hashReservationToken(f.ctx.token),
  listing_private_id:f.stores.ListingPrivate[0].id,purchase_private_id:f.stores.PurchasePrivate[0]?.id,
  listing_status:f.stores.Listing[0].status});
async function waiting(sql,client) {
  for(let n=0;n<100;n++){
    const rows=await sql('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[client.processID]);
    if(rows[0]?.wait_event_type==='Lock')return;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.fail('Second real PostgreSQL connection did not wait on the authority lock');
}

test('real transactions: checkout admission wins, concurrent release waits and refuses',async()=>{
  const f=fixture(true);await f.sql('SELECT 1');
  const a=await f.deps._mission1.independentConnection(),b=await f.deps._mission1.independentConnection();
  await a.query('BEGIN');
  await a.query('SELECT authority_v1.m1_begin_checkout($1,0,$2,$3,$4,$5)',
    [f.ctx.listingId,'user_buyer',await hashReservationToken('new-checkout'),f.ctx.expiry,'checkout-race']);
  const release=b.query('SELECT authority_v1.release_listing($1,0,$2,$2) AS result',[f.ctx.listingId,'release-race']);
  await waiting(f.sql,b);await a.query('COMMIT');
  assert.equal((await release).rows[0].result.code,'PAYMENT_OBLIGATION');
  assert.equal((await f.authority.getState(f.ctx.listingId)).lifecycle_state,'reserved');
});
test('real transactions: release wins, stale checkout cannot create a purchase',async()=>{
  const f=fixture(true);await f.sql('SELECT 1');
  const a=await f.deps._mission1.independentConnection(),b=await f.deps._mission1.independentConnection();
  await a.query('BEGIN');await a.query('SELECT authority_v1.release_listing($1,0,$2,$2)',[f.ctx.listingId,'release-first']);
  const checkout=b.query('SELECT authority_v1.m1_begin_checkout($1,0,$2,$3,$4,$5) AS result',
    [f.ctx.listingId,'user_buyer','new-hash',f.ctx.expiry,'stale-checkout']);
  await waiting(f.sql,b);await a.query('COMMIT');
  assert.equal((await checkout).rows[0].result.code,'CHECKOUT_AUTHORITY_CONFLICT');
  assert.equal((await f.sql('SELECT count(*)::INTEGER n FROM authority_v1.reservation_payment_bindings'))[0].n,0);
});
test('bound purchase prevents ordinary release and expiry in the same authority',async()=>{
  const f=fixture();
  for(const name of ['release_listing','expire_listing']){
    const result=await f.sql(`SELECT authority_v1.${name}($1,0,$2,$2) AS result`,[f.ctx.listingId,name]);
    assert.equal(result[0].result.code,'PAYMENT_OBLIGATION');
  }
});
test('duplicate cleanup over separate SQL connections has one financial action and outbox event',async()=>{
  const f=fixture();await f.sql('SELECT 1');
  const client=await f.deps._mission1.independentConnection();const sql=async(q,a)=>(await client.query(q,a)).rows;
  const second={...f.deps,paymentAuthority:createMission1Authority({executor:sql,recorder:sql,worker:sql})};
  const results=await Promise.all([expirePurchaseSafely(f.deps,f.ctx.purchaseId),expirePurchaseSafely(second,f.ctx.purchaseId)]);
  assert.ok(results.some(r=>r.status===200));assert.equal(f.cancels(),1);
  assert.equal((await f.sql('SELECT count(*)::INTEGER n FROM authority_v1.payment_actions'))[0].n,1);
  assert.equal((await f.sql('SELECT count(*)::INTEGER n FROM authority_v1.reservation_outbox WHERE event_id=$1',['m1-release:'+f.ctx.purchaseId]))[0].n,1);
});
test('crash before dispatch: recovery fences the old worker before allowing one action',async()=>{
  const f=fixture();const old=await f.authority.prepare(f.stores.PurchasePrivate[0],await snapshot(f),'old-worker',false);
  assert.equal((await reconcilePaymentRelease(f.deps,f.ctx.purchaseId)).status,200);
  await assert.rejects(f.authority.dispatch(f.ctx.purchaseId,'old-worker',old.epoch,'cancel'),/FENCED/);
  assert.equal(f.cancels(),1);
});
test('ambiguous dispatch: timeout and cleared Base44 claim grant no second financial command',async()=>{
  const f=fixture();const old=await f.authority.prepare(f.stores.PurchasePrivate[0],await snapshot(f),'old-worker',false);
  await f.authority.dispatch(f.ctx.purchaseId,'old-worker',old.epoch,'cancel');
  await f.sql('SELECT authority_v1.recover_expired_payment_action_leases()');
  assert.equal((await f.sql('SELECT status FROM authority_v1.payment_actions'))[0].status,'in_flight');
  f.stores.PurchasePrivate[0].cleanup_claim=null;
  assert.equal((await reconcilePaymentRelease(f.deps,f.ctx.purchaseId)).status,500);
  assert.equal(f.cancels(),0);
  assert.equal((await f.authority.getState(f.ctx.listingId)).recovery_blocked,true);
  // Independent operator settlement is synthetic here. Recovery reads it;
  // it does not assume the dispatch happened or create a replacement action.
  f.deps.stripe.pisById.get(f.ctx.piId).status='canceled';
  assert.equal((await reconcilePaymentRelease(f.deps,f.ctx.purchaseId)).status,200);
  await assert.rejects(f.authority.commit(f.ctx.purchaseId,'old-worker',old.epoch,{status:'canceled',pi_status:'canceled',payment_intent_id:f.ctx.piId,verified_at:new Date().toISOString()}),/STALE_WORKER/);
  assert.equal(f.cancels(),0);
});

test('old worker paused after dispatch cannot overwrite recovery or a newer reservation',async()=>{
  const f=fixture();let entered,unpause;
  const atProvider=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{unpause=resolve;});
  const cancel=f.deps.stripe.paymentIntents.cancel;
  f.deps.stripe.paymentIntents.cancel=async(...args)=>{entered();await gate;return cancel(...args);};
  const old=expirePurchaseSafely(f.deps,f.ctx.purchaseId);await atProvider;
  assert.equal((await reconcilePaymentRelease(f.deps,f.ctx.purchaseId)).status,500);
  f.deps.stripe.pisById.get(f.ctx.piId).status='canceled';
  assert.equal((await reconcilePaymentRelease(f.deps,f.ctx.purchaseId)).status,200);
  const state=await f.authority.getState(f.ctx.listingId);
  await f.authority.beginCheckout({listingId:f.ctx.listingId,version:state.version,buyerId:'user_buyer',
    tokenHash:await hashReservationToken('later-token'),expiresAt:f.ctx.expiry,operationId:'later-checkout'});
  f.stores.Listing[0].reservation_token='later-token';
  f.stores.ListingPrivate[0].reservation_token='later-token';
  unpause();assert.equal((await old).status,500);
  assert.equal(f.stores.Listing[0].reservation_token,'later-token');
  assert.equal((await f.authority.getState(f.ctx.listingId)).lifecycle_state,'reserved');
  assert.equal(f.cancels(),1);
});
test('settlement before persistence: retry freshly verifies and never dispatches again',async()=>{
  const f=fixture();f.deps.hooks.afterSettlementVerified=async()=>{throw Error('interrupted before recorder');};
  assert.equal((await expirePurchaseSafely(f.deps,f.ctx.purchaseId)).status,500);
  delete f.deps.hooks.afterSettlementVerified;
  assert.equal((await reconcilePaymentRelease(f.deps,f.ctx.purchaseId)).status,200);assert.equal(f.cancels(),1);
});
test('release before completion: durable owner/outbox survives, checkout remains blocked, retry finishes',async()=>{
  const f=fixture();f.deps.hooks.before_Purchase_updateMany=async()=>{throw Error('purchase mirror unavailable');};
  assert.equal((await expirePurchaseSafely(f.deps,f.ctx.purchaseId)).status,500);
  const saved=await f.authority.context(f.ctx.purchaseId);assert.equal(saved.context.phase,'committed');
  assert.equal((await f.authority.getState(f.ctx.listingId)).recovery_blocked,true);
  assert.ok(saved.context.snapshot.reservation_token);assert.equal(f.stores.Listing[0].reservation_token,null);
  delete f.deps.hooks.before_Purchase_updateMany;
  assert.equal((await reconcilePaymentRelease(f.deps,f.ctx.purchaseId)).status,200);assert.equal(f.cancels(),1);
  assert.equal((await f.authority.context(f.ctx.purchaseId)).context.phase,'completed');
});
test('committed retry still fails closed when fresh provider retrieval fails',async()=>{
  const f=fixture();f.deps.hooks.afterAuthorityCommit=async()=>{throw Error('worker disappeared');};
  assert.equal((await expirePurchaseSafely(f.deps,f.ctx.purchaseId)).status,500);
  f.deps.stripe.paymentIntents.retrieve=async()=>{throw Error('provider unavailable');};
  assert.equal((await reconcilePaymentRelease(f.deps,f.ctx.purchaseId)).status,500);
  assert.equal((await f.authority.context(f.ctx.purchaseId)).context.phase,'committed');
});
test('durable incident write failure retains claim; recovery resumes with a fresh fence',async()=>{
  const f=fixture();await f.sql(`CREATE FUNCTION reject_incident() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'incident storage unavailable'; END$$;
    CREATE TRIGGER fail_incident BEFORE INSERT ON authority_v1.operational_incidents FOR EACH ROW EXECUTE FUNCTION reject_incident()`);
  const retrieve=f.deps.stripe.paymentIntents.retrieve;f.deps.stripe.paymentIntents.retrieve=async()=>{throw Error('provider unavailable');};
  const result=await expirePurchaseSafely(f.deps,f.ctx.purchaseId);assert.equal(result.status,500);assert.equal(result.body.alert_proven,false);
  const old=await f.authority.context(f.ctx.purchaseId);assert.ok(old.owner);
  await f.sql('DROP TRIGGER fail_incident ON authority_v1.operational_incidents');f.deps.stripe.paymentIntents.retrieve=retrieve;
  assert.equal((await reconcilePaymentRelease(f.deps,f.ctx.purchaseId)).status,200);
  await assert.rejects(f.authority.dispatch(f.ctx.purchaseId,old.owner,old.epoch,'cancel'),/FENCED/);
});
test('captured quarantine: resolving alert is insufficient; independently verified full refund recovers',async()=>{
  const f=fixture();f.deps.stripe.pisById.set(f.ctx.piId,{id:f.ctx.piId,status:'succeeded',latest_charge:'ch_capture'});
  let refunded=false;
  f.deps.stripe.charges={retrieve:async()=>({id:'ch_capture',payment_intent:f.ctx.piId,amount:10500,amount_refunded:refunded?10500:0,refunded})};
  assert.equal((await expirePurchaseSafely(f.deps,f.ctx.purchaseId,{sellerExpiry:true})).status,500);
  await f.sql('UPDATE authority_v1.operational_incidents SET resolved=true');
  assert.equal((await reconcilePaymentRelease(f.deps,f.ctx.purchaseId)).status,500);
  refunded=true;
  assert.equal((await reconcilePaymentRelease(f.deps,f.ctx.purchaseId)).status,200);
  assert.equal((await f.sql('SELECT capture_state FROM authority_v1.reservation_payment_bindings'))[0].capture_state,'refunded');
  assert.equal(f.cancels(),0);
});
test('recorder rejects missing refund evidence and a stale epoch',async()=>{
  const f=fixture();const lease=await f.authority.prepare(f.stores.PurchasePrivate[0],await snapshot(f),'owner',false);
  await assert.rejects(f.authority.commit(f.ctx.purchaseId,'owner',lease.epoch,{status:'refunded',pi_status:'succeeded',payment_intent_id:f.ctx.piId,verified_at:new Date().toISOString()}),/SETTLEMENT_UNVERIFIED/);
  await assert.rejects(f.authority.dispatch(f.ctx.purchaseId,'owner',null,'cancel'),/FENCED/);
});
test('no ordered projection receipt means no cleanup success and authority stays blocked',async()=>{
  const f=fixture();delete f.deps.projectRelease;
  const result=await expirePurchaseSafely(f.deps,f.ctx.purchaseId);assert.equal(result.status,500);assert.equal(result.body.code,'ORDERED_PROJECTION_REQUIRED');
  assert.equal((await f.authority.getState(f.ctx.listingId)).recovery_blocked,true);
});

test('unpaid release persists projection ownership and blocks newer checkout until receipt',async()=>{
  const f=fixture(true);delete f.deps.projectReservationRelease;
  assert.equal((await runReleaseReservation(f.deps,{listing_id:f.ctx.listingId})).status,503);
  const state=await f.authority.getState(f.ctx.listingId);
  assert.equal(state.recovery_blocked,true);
  await assert.rejects(f.authority.beginCheckout({listingId:f.ctx.listingId,version:state.version,buyerId:'user_buyer',
    tokenHash:'new-token',expiresAt:f.ctx.expiry,operationId:'gap-checkout'}),/CONFLICT/);
  const events=await f.sql('SELECT * FROM authority_v1.reservation_outbox');assert.equal(events.length,1);
  assert.equal(events[0].payload.kind,'unpaid_release');
  // A trusted worker can resume using the durable outbox even if mirrors lost
  // their old token. This is a protocol test, not Base44 projection evidence.
  await f.authority.acknowledgeOperation(events[0].operation_id,state.version);
  assert.equal((await f.authority.getState(f.ctx.listingId)).recovery_blocked,false);
  await f.authority.acknowledgeOperation(events[0].operation_id,state.version);
});

test('outbox persistence failure rolls back canonical release; recovery reuses provider settlement',async()=>{
  const f=fixture();await f.sql(`CREATE FUNCTION reject_outbox() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'outbox unavailable'; END$$;
    CREATE TRIGGER fail_outbox BEFORE INSERT ON authority_v1.reservation_outbox FOR EACH ROW EXECUTE FUNCTION reject_outbox()`);
  assert.equal((await expirePurchaseSafely(f.deps,f.ctx.purchaseId)).status,500);
  assert.equal((await f.authority.getState(f.ctx.listingId)).lifecycle_state,'reserved');
  await f.sql('DROP TRIGGER fail_outbox ON authority_v1.reservation_outbox');
  assert.equal((await reconcilePaymentRelease(f.deps,f.ctx.purchaseId)).status,200);assert.equal(f.cancels(),1);
});

test('admission interrupted before PI persistence recovers only from independently identified terminal PI',async()=>{
  const f=fixture(true),op='lost-admission',token='lost-token';
  const admitted=await f.authority.beginCheckout({listingId:f.ctx.listingId,version:0,buyerId:'user_buyer',
    tokenHash:await hashReservationToken(token),expiresAt:f.ctx.expiry,operationId:op});
  assert.ok(admitted.context.stripe_idempotency_key);
  await assert.rejects(reconcileCheckoutAdmission(f.deps,op),/DISCOVERY_REQUIRED/);
  const pi=f.deps.stripe.pisById.get(f.ctx.piId);
  pi.metadata={mission1_checkout_operation_id:op,listing_id:f.ctx.listingId,reservation_token:token};
  await assert.rejects(reconcileCheckoutAdmission(f.deps,op,f.ctx.piId),/PROVIDER_RECONCILIATION/);
  pi.status='canceled';
  await assert.rejects(reconcileCheckoutAdmission(f.deps,op,f.ctx.piId),/ORDERED_PROJECTION_REQUIRED/);
  assert.equal((await f.authority.getState(f.ctx.listingId)).recovery_blocked,true);
  await assert.rejects(f.authority.attachIntent(op,f.ctx.piId),/OWNERSHIP_CHANGED/);
  await assert.rejects(f.authority.bindCheckout(op,'stale-purchase',f.ctx.piId),/OWNERSHIP_CHANGED/);
  f.deps.projectAdmissionRecovery=async context=>({verified:true,operation_id:op,version:context.authority_version});
  assert.equal((await reconcileCheckoutAdmission(f.deps,op,f.ctx.piId)).ok,true);
  assert.equal(f.cancels(),0);
});

test('runtime roles cannot record settlement or acknowledge projection outside their boundary',async()=>{
  const f=fixture();await f.sql('SELECT 1');const client=await f.deps._mission1.independentConnection();
  for(const role of ['authority_executor','authority_stripe_recorder','authority_worker']){
    await client.query(`SET ROLE ${role}`);
    await assert.rejects(client.query('UPDATE authority_v1.reservation_authority SET recovery_blocked=false'),/permission denied/);
    if(role!=='authority_stripe_recorder') await assert.rejects(client.query("SELECT authority_v1.m1_commit_release('p','o',1,'{}')"),/permission denied/);
    if(role!=='authority_worker') await assert.rejects(client.query("SELECT authority_v1.m1_ack_projection('op',1)"),/permission denied/);
    if(role!=='authority_executor') await assert.rejects(client.query("SELECT authority_v1.m1_dispatch_release('p','o',1,'cancel')"),/permission denied/);
    await client.query('RESET ROLE');
  }
  await client.query('SET ROLE authority_executor');
  assert.equal((await client.query('SELECT authority_v1.get_state($1) result',[f.ctx.listingId])).rows[0].result.ok,true);
});

test('missing SQL schema prevents provider action; required fields persist and clear to SQL NULL',async()=>{
  const f=fixture();
  await f.sql('ALTER TABLE authority_v1.reservation_operations DROP COLUMN recovery_owner');
  assert.equal((await expirePurchaseSafely(f.deps,f.ctx.purchaseId)).status,500);assert.equal(f.cancels(),0);
  const healthy=fixture();assert.equal((await expirePurchaseSafely(healthy.deps,healthy.ctx.purchaseId)).status,200);
  const row=(await healthy.sql('SELECT * FROM authority_v1.reservation_operations WHERE operation_id=$1',['m1-release:'+healthy.ctx.purchaseId]))[0];
  assert.equal(row.recovery_owner,null);assert.equal(row.recovery_dispatch_started,true);
  assert.equal(row.recovery_evidence.phase,'completed');
  assert.equal((await healthy.sql('SELECT payment_release_operation_id FROM authority_v1.reservation_authority'))[0].payment_release_operation_id,null);
});

test('retained legacy Base44 claim requires verified worker fencing, never a timeout',async()=>{
  const f=fixture();f.stores.PurchasePrivate[0].cleanup_claim='legacy-worker';
  f.stores.PurchasePrivate[0].cleanup_started_at=new Date(0).toISOString();
  assert.equal((await reconcilePaymentRelease(f.deps,f.ctx.purchaseId)).body.code,'LEGACY_WORKER_FENCING_REQUIRED');
  assert.equal(f.cancels(),0);
  // Synthetic deployment fact only; the test does not prove the production
  // legacy fleet was stopped or had its mutation capabilities revoked.
  f.deps.legacyWorkersFenced=true;
  assert.equal((await reconcilePaymentRelease(f.deps,f.ctx.purchaseId)).status,200);
});

let failed=0;
for(const {name,run} of cases){try{await run();console.log(`PASS ${name}`);}catch(error){failed++;console.error(`FAIL ${name}: ${error.stack}`);}}
await closeMission1Databases();console.log(`${cases.length-failed} passed, ${failed} failed`);process.exitCode=failed?1:0;
