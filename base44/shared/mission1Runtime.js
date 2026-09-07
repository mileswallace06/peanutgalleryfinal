import { neon } from 'npm:@neondatabase/serverless@0.10.4';
import { createMission1Authority } from './mission1Authority.js';
import { projectMission1Operation } from './mission1Projector.js';
import { reconcilePaymentRelease } from './purchaseExpiry.js';
import { reconcileCheckoutAdmission } from './checkoutAdmissionRecovery.js';

// Explicit rollout evidence is operator-controlled configuration. It cannot
// be supplied in request JSON and is not asserted by a local mock/probe.
export async function createMission1Runtime({ entities, stripe, user, secrets }) {
  let evidence;
  try { evidence=JSON.parse(await secrets.get('MISSION1_ROLLOUT_EVIDENCE')); } catch { throw new Error('MISSION1_ROLLOUT_UNVERIFIED'); }
  if(evidence?.schema_revision!=='mission1_projection_v1' || evidence.base44_persistence_verified!==true ||
    evidence.exclusive_writers_verified!==true || evidence.legacy_workers_fenced!==true) throw new Error('MISSION1_ROLLOUT_UNVERIFIED');
  const connect=async(role,key)=>{
    const raw=await secrets.get(key);let url;
    try { url=new URL(raw); } catch { throw new Error('MISSION1_AUTHORITY_NOT_CONFIGURED'); }
    if(!['postgres:','postgresql:'].includes(url.protocol) || decodeURIComponent(url.username)!==role ||
      !/\.neon\.(tech|build)$/.test(url.hostname) || url.hostname!==evidence.authority_host ||
      url.pathname.slice(1)!==evidence.authority_database || !url.password || url.pathname==='/postgres') throw new Error('MISSION1_AUTHORITY_FINGERPRINT_MISMATCH');
    const sql=neon(raw);
    return async(query,args)=>{try{return await sql(query,args);}catch{throw new Error('MISSION1_AUTHORITY_QUERY_FAILED');}};
  };
  const executor=await connect('authority_executor','AUTHORITY_V1_DB_URL_DEV_EXECUTOR');
  const recorder=await connect('authority_stripe_recorder','AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER');
  const worker=await connect('authority_worker','AUTHORITY_V1_DB_URL_DEV_WORKER');
  const paymentAuthority=createMission1Authority({executor,recorder});
  const workerAuthority=createMission1Authority({executor,recorder,worker});
  const runtime={entities,stripe,user,paymentAuthority,now:()=>Date.now(),legacyWorkersFenced:true};
  const project=(op,recover=false)=>projectMission1Operation({...runtime,paymentAuthority:workerAuthority},op,{recover});
  runtime.projectRelease=context=>project(context.operation_id);
  runtime.projectReservationRelease=(_listing,context)=>project(context.operation_id);
  runtime.projectAdmissionRecovery=context=>project(context.operation_id);
  runtime.projectCheckout=op=>project(op);
  // Only these narrow jobs are callable. No raw SQL, generic acknowledgement,
  // arbitrary plan, credential, lease-stealing or field-update API is exposed.
  runtime.recoverPurchase=id=>reconcilePaymentRelease({...runtime,projectRelease:context=>project(context.operation_id,true)},id);
  runtime.recoverAdmission=(op,pi)=>reconcileCheckoutAdmission({...runtime,projectAdmissionRecovery:context=>project(context.operation_id,true)},op,pi);
  runtime.syncInventory=async listingId=>{
    const queued=await paymentAuthority.queueInventory(listingId);
    return queued.queued?project(queued.context.operation_id):{verified:false,queued:false};
  };
  runtime.recoveryStatus=()=>workerAuthority.pendingRecovery();
  runtime.drainRecovery=async()=>{
    const {operations}=await workerAuthority.pendingRecovery();const results=[];
    for(const op of operations){
      try {
        const result=op.phase==='checkout_prepared' ? await runtime.recoverAdmission(op.operation_id) : op.purchase_id && ['prepared','dispatched','blocked','committed'].includes(op.phase)
          ? await runtime.recoverPurchase(op.purchase_id)
          : await project(op.operation_id,true);
        results.push({operation_id:op.operation_id,ok:result.status?result.status===200:result.verified===true || result.ok===true});
      }catch(error){results.push({operation_id:op.operation_id,ok:false,code:error.message});}
    }
    return {ok:results.every(row=>row.ok),results};
  };
  return runtime;
}

export async function authorizeMission1Worker(req,base44,secrets) {
  const user=await base44.auth.me().catch(()=>null);
  if(user?.role==='admin') return user;
  if(user) throw new Error('MISSION1_WORKER_FORBIDDEN');
  const expected=await secrets.get('MISSION1_WORKER_TOKEN');
  const actual=req.headers.get('authorization')?.replace(/^Bearer /,'');
  if(typeof expected!=='string' || expected.length<32 || actual?.length!==expected.length) throw new Error('MISSION1_WORKER_UNAUTHORIZED');
  let diff=0;for(let i=0;i<expected.length;i++) diff|=actual.charCodeAt(i)^expected.charCodeAt(i);
  if(diff) throw new Error('MISSION1_WORKER_UNAUTHORIZED');
  return {role:'admin',id:'mission1-scheduled-worker'};
}
