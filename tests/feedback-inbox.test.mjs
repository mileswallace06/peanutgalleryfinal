import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedbackAccess, loadFeedbackPage, FEEDBACK_CATEGORIES, FEEDBACK_PAGE_SIZE } from '../src/lib/feedbackInbox.js';
const admin = {id:'sample-admin',role:'admin'};
test('admin access waits for definitive authentication, including a stale admin user', () => {
  const auth={user:admin,authChecked:true,isAuthenticated:true,isLoadingAuth:false};
  assert.equal(feedbackAccess(auth),'admin');
  assert.equal(feedbackAccess({...auth,authChecked:false}),'checking');
  assert.equal(feedbackAccess({...auth,isLoadingAuth:true}),'checking');
  assert.equal(feedbackAccess({...auth,isAuthenticated:false}),'denied');
  for(const user of [null,{}, {role:'user'}, {role:'Admin'}]) assert.equal(feedbackAccess({...auth,user}),'denied');
});
test('the loader never fetches for non-admin users or invalid queries', async()=>{
 let calls=0; const client={entities:{BetaFeedbackEvent:{filter:async()=>{calls++;return []}}}};
 for(const user of [null,{}, {role:'user'}]) await assert.rejects(loadFeedbackPage(client,user));
 await assert.rejects(loadFeedbackPage(client,admin,'questionnaire'));
 await assert.rejects(loadFeedbackPage(client,admin,'all',-1));
 assert.equal(calls,0);
});
test('all four categories use the existing entity and descending creation order',async()=>{
 const calls=[]; const client={entities:{BetaFeedbackEvent:{filter:async(...args)=>{calls.push(args);return []}}}};
 assert.deepEqual(Object.keys(FEEDBACK_CATEGORIES),['bug','confused','love','idea']);
 for(const category of ['all',...Object.keys(FEEDBACK_CATEGORIES)]){
  assert.deepEqual(await loadFeedbackPage(client,admin,category),{rows:[],hasMore:false});
  assert.deepEqual(calls.at(-1),[category==='all'?{}:{feedback_type:category},'-created_date',51,0]);
 }
});
test('lookahead pagination neither drops nor repeats the boundary record', async()=>{
 const data=Array.from({length:57},(_,i)=>({id:`synthetic-${i}`,message:'SAMPLE ONLY'}));
 const client={entities:{BetaFeedbackEvent:{filter:async(_q,_sort,limit,offset)=>data.slice(offset,offset+limit)}}};
 const first=await loadFeedbackPage(client,admin);
 assert.equal(first.rows.length,FEEDBACK_PAGE_SIZE);assert.equal(first.hasMore,true);
 const second=await loadFeedbackPage(client,admin,'all',first.rows.length);
 assert.equal(second.rows.length,7);assert.equal(second.hasMore,false);
 assert.deepEqual([...first.rows,...second.rows],data);
});
test('provider failures and malformed responses propagate rather than becoming empty feedback',async()=>{
 for(const filter of [async()=>{throw Error('unavailable')},async()=>({error:'denied'}),async()=>null]){
  await assert.rejects(loadFeedbackPage({entities:{BetaFeedbackEvent:{filter}}},admin));
 }
});
