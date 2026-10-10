import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryBackLink, discoveryReturnContext, saveDiscoveryReturn, readDiscoveryReturn, clearDiscoveryReturn, upgradeViewFromSearch, upgradeSearchFromView, safeUpgradesReturnTo } from '../src/lib/eventDiscoveryState.js';
const storage = () => { const values = new Map(); return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };
const route = (key = 'entryA', search = '?browse=1&q=Knocked+Loose', extras = {}) => ({ pathname: '/events', search, key, ...extras });

test('return snapshots belong to one history entry, including repeated equal queries', () => {
 const store = storage(), original = discoveryReturnContext(route(), 'PUSH');
 saveDiscoveryReturn(original, { eventId: 'visited', pages: 5 }, store);
 assert.equal(readDiscoveryReturn(original, store), null, 'a fresh push never restores');
 assert.equal(readDiscoveryReturn(discoveryReturnContext(route(), 'POP'), store).eventId, 'visited');
 assert.equal(readDiscoveryReturn(discoveryReturnContext(route('entryB'), 'POP'), store), null, 'a fresh equal URL has a distinct entry');
 assert.equal(readDiscoveryReturn(discoveryReturnContext(route('entryA', '?browse=1&q=Other'), 'POP'), store), null, 'changed URL cannot use an earlier snapshot');
 const explicit = discoveryReturnContext(route('newEntry', undefined, {state:{restoreDiscoveryEntry:'entryA'}}), 'PUSH');
 assert.equal(readDiscoveryReturn(explicit, store).pages, 5, 'in-app Back carries original context');
 clearDiscoveryReturn(explicit, store);
 assert.equal(readDiscoveryReturn(discoveryReturnContext(route(), 'POP'), store), null, 'explicit same-query refresh clears only its entry');
});

test('initial document identity survives reload without changing router history and new direct visit is fresh', () => {
 const history = { state: { idx: 3, usr: { retain: true } }, replaceState(value, unused) { this.state = value; assert.equal(unused, ''); } };
 const store = storage(), original = discoveryReturnContext(route('default'), 'POP', history);
 saveDiscoveryReturn(original, {eventId:'visited'}, store);
 assert.equal(history.state.idx,3);assert.deepEqual(history.state.usr,{retain:true});
 assert.equal(readDiscoveryReturn(discoveryReturnContext(route('default'),'POP',history),store).eventId,'visited');
 const fresh = {state:{idx:0},replaceState(value){this.state=value;}};
 assert.equal(readDiscoveryReturn(discoveryReturnContext(route('default'),'POP',fresh),store),null);
});

test('Upgrades URL view has intentional defaults and supports safe links', () => {
 for (const input of ['', '?view=upcoming', '?view=LIVE', '?view=invalid', '?view=']) assert.equal(upgradeViewFromSearch(input),'upcoming');
 assert.equal(upgradeViewFromSearch('?view=live'),'live');
 assert.equal(upgradeSearchFromView('?keep=context','live'),'?keep=context&view=live');
 assert.equal(upgradeSearchFromView('?keep=context&view=live','upcoming'),'?keep=context');
 for (const value of ['https://bad.example/upgrades','//bad.example/upgrades','/upgrades/foreign','/events?view=live']) assert.equal(safeUpgradesReturnTo(value),'/upgrades');
 assert.equal(safeUpgradesReturnTo('/upgrades?view=live'),'/upgrades?view=live');
});

test('malformed or expired snapshots fail closed; Events and Upgrades do not share positions', () => {
 const store = storage(), events = discoveryReturnContext(route(),'POP'), upgrades = discoveryReturnContext(route('entryA','?view=live',{pathname:'/upgrades'}),'POP');
 saveDiscoveryReturn(events,{eventId:'event'},store);assert.equal(readDiscoveryReturn(upgrades,store),null);
 const corrupt = {getItem:()=>'{broken'};assert.equal(readDiscoveryReturn(events,corrupt),null);
 const stale = {getItem:()=>JSON.stringify({...events,eventId:'old',savedAt:Date.now()-3600001})};assert.equal(readDiscoveryReturn(events,stale),null);
 assert.equal(readDiscoveryReturn(discoveryReturnContext(route('entryB',undefined,{state:{restoreDiscoveryEntry:'../../bad'}}),'PUSH'),store),null);
});


test('detail Back defaults intentionally and accepts only local originating list targets', () => {
 assert.deepEqual(discoveryBackLink({upgradesReturnTo:'/upgrades?view=live',upgradesReturnKey:'live-entry'}),{to:'/upgrades?view=live',state:{restoreDiscoveryEntry:'live-entry'},label:'Upgrades'});
 assert.deepEqual(discoveryBackLink({discoveryReturnTo:'/events?browse=1&q=Artist',discoveryReturnKey:'events-entry'},'upgrades'),{to:'/events?browse=1&q=Artist',state:{restoreDiscoveryEntry:'events-entry'},label:'Events'});
 assert.equal(discoveryBackLink({upgradesReturnTo:'https://bad.example/upgrades'}).to,'/events');
 assert.equal(discoveryBackLink(undefined,'upgrades').to,'/upgrades');
});
