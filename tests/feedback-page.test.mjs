import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identifyFeedbackPage } from '../src/lib/feedbackPage.js';

test('known pages expose a readable name and the exact saved pathname',()=>{
 for(const [path,name] of [['/fan-zone','Fan Zone'],['/create-listing','Create Listing'],['/upgrades','Upgrades'],['/me','Me'],['/events/','Events']]){
  assert.deepEqual(identifyFeedbackPage(path),{status:'valid',name,path,href:path});
 }
});
test('existing dynamic event routes retain only their validated path',()=>{
 for(const [path,name] of [['/events/tm/Z7r9_sample-1','Ticketmaster Event'],['/events/abcdef012345','Event Details'],['/upgrades/sample-id','Upgrade Details'],['/purchase/sample-id','Purchase Details'],['/event-mode/sample-id','Event Mode']]){
  const page=identifyFeedbackPage(path);assert.equal(page.href,path);assert.equal(page.name,name);
 }
});
test('missing pages are distinguished from malformed or retired routes',()=>{
 for(const path of [null,undefined,'','  ']) assert.equal(identifyFeedbackPage(path).name,'Page not recorded');
 for(const path of [42,{},'/retired-page','/events/a/extra','/events/tm/'+ 'a'.repeat(129)]){
  assert.deepEqual(identifyFeedbackPage(path),{status:'invalid',name:'Page unavailable',path:null,href:null});
 }
});
test('stored external URLs, encoded navigation and unsafe paths never become links',()=>{
 for(const path of ['https://example.invalid/','https://peanutgallery.store/me','//example.invalid','///me','javascript:alert(1)','data:text/html,sample','/\\example.invalid','/events/../me','/events/%2e%2e/me','/%2f%2fexample.invalid','/events/%252f','/me\n',' /me','/me\u0000','/me#details','/events?keyword=sample','/me/?sample=1','/events//sample','/events/😀']){
  const page=identifyFeedbackPage(path);assert.equal(page.href,null,path);assert.equal(page.path,null,path);assert.equal(page.name,'Page unavailable',path);
 }
});
test('valid navigation does not invent saved searches or add query state',()=>{
 const page=identifyFeedbackPage('/create-listing');assert.equal(page.href,'/create-listing');
 assert.equal(identifyFeedbackPage('/create-listing?q=sample').href,null);
});
