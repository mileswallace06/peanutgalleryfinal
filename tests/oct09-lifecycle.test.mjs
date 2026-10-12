import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { checkListingEvent, listingEventEligibility } from '../base44/shared/listingEventEligibility.js';
import { isFlashDropViewer, projectFlashDrop, projectFlashDropWinner } from '../base44/shared/flashDropReadView.js';
import { loadEligibleFlashDropListings, ownershipLookupMessage } from '../src/lib/flashDropOwnership.js';
const end = Date.parse('2099-10-09T21:00:00Z');
const event = { id: 'fixture-boundary', title: 'Fictional Boundary Concert', event_start_utc: '2099-10-09T20:00:00Z', event_end_utc: new Date(end).toISOString(), status: 'live' };
const h = (type, props, ...children) => ({ type, props: {...props, children} });
const nodes = v => Array.isArray(v) ? v.flatMap(nodes) : v == null || v === false ? [] : [v, ...nodes(v.props?.children)];
const text = v => nodes(v).filter(n => typeof n === 'string').join(' ');
async function compile(file, globals, loader = 'jsx') {
 const source = (await readFile(new URL(file, import.meta.url), 'utf8')).replace(/^import .+\n/gm, '');
 const { code } = await transform(source, { loader, format: 'cjs', jsxFactory: 'h', jsxFragment: 'Fragment' });
 const module = { exports: {} }; vm.runInNewContext(code, { module, exports: module.exports, h, Fragment: 'fragment', ...globals }); return module.exports;
}
async function endpoint({ role='user', now=end, patch={}, readFailure=false, readFailureAt=0, disappear=false, disappearAt=0, atOwnership, maintenance=false }={}) {
 let handler, eventReads=0; const writes=[], reads=[];
 const user = role === 'guest' ? null : {id:'fixture-user',email:'fan@example.invalid',role};
 const entities = new Proxy({}, {get:(_,name)=>({
  filter: async () => { reads.push(name); if(name==='Event'){eventReads++; if(readFailure || eventReads===readFailureAt)throw Error('offline');return disappear || eventReads===disappearAt?[]:[{...event,...patch}];} if(name==='Listing'){ atOwnership?.(); return [{id:'fixture-listing',seller_email:user.email,event_id:event.id,section:'104',transfer_status:'transfer_confirmed'}];} if(name==='User')return []; if(['FlashDrop','SeatInventory','TransferOutcome'].includes(name))return []; throw Error(`Unexpected read ${name}`); },
  create: async data => {writes.push(`${name}.create`);return {id:`local-${name}`,...data};},
  update: async(id,data)=>{writes.push(`${name}.update`);return {id,...data};},
 })});
 const clock = typeof now==='function'?now:()=>now;
 class ClockDate extends Date { static now(){return clock();} }
 const client={auth:{me:async()=>user},asServiceRole:{entities}};
 await compile('../base44/functions/flashDrop/entry.ts',{ Deno:{serve:fn=>{handler=fn;}},createClientFromRequest:()=>client,Response,Date:ClockDate,console,
  checkListingEvent:(sdk,id)=>checkListingEvent(sdk,id,clock),listingEventEligibility,isFlashDropViewer,projectFlashDrop,projectFlashDropWinner,
  isMaintenanceActive:()=>maintenance,maintenance503:message=>Response.json({error:message},{status:503}),recordNotification:()=>{throw Error('No notifications expected');},
 },'ts');
 const response=await handler({json:async()=>({action:'create',event_id:event.id,section:'104',ownership_listing_id:'fixture-listing',drop_type:'immediate'})});
 return {status:response.status,body:await response.json(),writes,reads,eventReads};
}
for(const role of ['user','admin']) for(const [label,now,expected] of [['before',end-1,200],['exact',end,409],['after',end+1,409]]) test(`authoritative FlashDrop create ${role} ${label} end boundary`,async()=>{
 const result=await endpoint({role,now}); assert.equal(result.status,expected);assert.equal(result.eventReads,expected===200?2:1);
 assert.deepEqual(result.writes, expected===200?['SeatInventory.create','FlashDrop.create','SeatInventory.update']:[]);
 if(expected!==200)assert.equal(result.body.code,'EVENT_ENDED');
});
for(const role of ['user','admin']) for(const [label,options,expected] of [['read failure',{readFailure:true},503],['missing',{disappear:true},404],['cancelled',{patch:{provider_status:'cancelled'},now:end-60000},409]]) test(`authoritative ${role} ${label} fails without inventory or drop writes`,async()=>{
 const result=await endpoint({role,...options});assert.equal(result.status,expected);assert.deepEqual(result.writes,[]);
});
test('guest and maintenance gates are unchanged and precede event reads',async()=>{
 for(const options of [{role:'guest'},{role:'admin',maintenance:true},{role:'user',maintenance:true}]){
  const r=await endpoint(options);assert.equal(r.status,options.role==='guest'?401:503);assert.equal(r.eventReads,0);assert.deepEqual(r.writes,[]);
 }
});
test('unknown timing does not invent an ended event or silently redefine admission policy',async()=>{
 for(const role of ['user','admin']){const r=await endpoint({role,patch:{event_start_utc:null,date_tba:true,event_end_utc:null}});assert.equal(r.status,200);assert.equal(r.eventReads,2);}
});
test('clock crossing during ownership reads is checked again before the first write',async()=>{
 let now=end-1;const r=await endpoint({now:()=>now,atOwnership:()=>{now=end;}});assert.equal(r.status,409);assert.equal(r.eventReads,2);assert.deepEqual(r.writes,[]);
});
for(const role of ['user','admin']) for(const change of ['status','end','read-failed','missing']) test(`fresh final event read rejects ${role} ${change} during ownership validation`,async()=>{
 const patch={};const now=end-60000;
 const r=await endpoint({role,now,patch,readFailureAt:change==='read-failed'?2:0,disappearAt:change==='missing'?2:0,atOwnership:()=>{
  if(change==='status')patch.status='ended';
  if(change==='end')patch.event_end_utc=new Date(now).toISOString();
 }});
 assert.equal(r.status,change==='read-failed'?503:change==='missing'?404:409);
 assert.equal(r.eventReads,2);assert.deepEqual(r.writes,[]);
 assert.equal(r.body.code,change==='read-failed'?'EVENT_CHECK_UNAVAILABLE':change==='missing'?'EVENT_UNAVAILABLE':'EVENT_ENDED');
});
async function sheet({ now=end-60000, read=async()=>[{...event}], create=async()=>({data:{success:true,drop:{id:'local-only'}}}), role='user' }={}){
 const states=[],refs=[];let cursor=0,refCursor=0,tree; const calls={reads:0,creates:0};
 const globals={useState:initial=>{const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];},useRef:initial=>{const i=refCursor++;return refs[i]||=( {current:initial} );},useEffect:()=>{},useId:()=> 'fixture',useUpgradeClock:()=>typeof now==='function'?now():now,
  Date:{now:()=>typeof now==='function'?now():now},listingEventEligibility,checkListingEvent:(sdk,id)=>checkListingEvent(sdk,id,()=>typeof now==='function'?now():now),loadEligibleFlashDropListings,ownershipLookupMessage,
  base44:{entities:{Event:{filter:async()=>{calls.reads++;return read();}}},functions:{invoke:async(name,args)=>{assert.equal(name,'flashDrop');assert.equal(args.action,'create');calls.creates++;return create();}}},
  Dialog:Object.fromEntries(['Root','Portal','Overlay','Content','Close','Title','Description'].map(k=>[k,k])),motion:{div:'div'},X:'icon',Zap:'icon',Clock:'icon',
 };
 const {default:Component}=await compile('../src/components/flashdrops/CreateFlashDropSheet.jsx',globals);
 const render=()=>{cursor=0;refCursor=0;return tree=Component({event,user:role==='guest'?null:{email:'fan@example.invalid',role},onClose(){}});};
 const find=(type,predicate)=>nodes(tree).find(n=>n?.type===type&&predicate(n));
 render();find('button',n=>text(n).includes('Immediate Drop')).props.onClick();render();
 find('input',n=>n.props.id==='fixture-section').props.onChange({target:{value:'104'}});render();
 return{render,find,calls,get text(){return text(tree);}};
}
test('duplicate submit callbacks issue only one fresh read and one isolated create',async()=>{
 let releaseRead,releaseCreate;const app=await sheet({read:()=>new Promise(resolve=>{releaseRead=()=>resolve([event]);}),create:()=>new Promise(resolve=>{releaseCreate=()=>resolve({data:{success:true,drop:{id:'local-only'}}});})});
 const submit=app.find('button',n=>text(n).includes('Drop Now')).props.onClick;
 const first=submit();const second=submit();assert.equal(app.calls.reads,1);assert.equal(app.calls.creates,0);
 app.render();assert.equal(app.find('button',n=>text(n).includes('Creating fan gift')).props.disabled,true);
 releaseRead();await new Promise(resolve=>setImmediate(resolve));assert.equal(app.calls.creates,1);await submit();assert.equal(app.calls.creates,1);
 releaseCreate();await Promise.all([first,second]);app.render();assert.match(app.text,/Your Flash Drop|Drop is Live|live now|Flash Drop is live/i);
});
for(const [name,read] of [['ended',async()=>[{...event,status:'ended'}]],['failed',async()=>{throw Error('offline');}]]) test(`stale FlashDrop draft ${name} fresh read denies all create calls`,async()=>{
 const app=await sheet({read});await app.find('button',n=>text(n).includes('Drop Now')).props.onClick();app.render();assert.equal(app.calls.reads,1);assert.equal(app.calls.creates,0);assert.ok(app.find('p',n=>n.props.role==='alert'));
});
test('guest cannot create and a draft closes at the exact local boundary',async()=>{
 const guest=await sheet({role:'guest'});await guest.find('button',n=>text(n).includes('Drop Now')).props.onClick();assert.deepEqual(guest.calls,{reads:0,creates:0});
 let now=end-1;const app=await sheet({now:()=>now});const staleSubmit=app.find('button',n=>text(n).includes('Drop Now')).props.onClick;now=end;await staleSubmit();app.render();assert.match(app.text,/Fan gifts are closed/);assert.equal(app.find('input',()=>true),undefined);assert.deepEqual(app.calls,{reads:0,creates:0});
});
