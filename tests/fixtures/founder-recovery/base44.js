import { guardFixtureSdk } from '../../helpers/fixtureSdkGuard.js';
const params = new URLSearchParams(location.search);
const state = { calls: [], writes: [], unexpected: [], modes: {}, pending: {}, alerts: [], data: {
  Purchase: [{ id: 'purchase-fixture', transfer_status: 'completed', platform_fee: 4 }],
  Listing: [{ id: 'listing-fixture', status: 'active', listing_transfer_mode: 'instant_transfer_ready', event_title: 'Fictional Show', created_date: '2026-10-09T10:00:00Z' }],
  AdminAlert: [], SeatDonation: [{ id: 'donation-fixture', donation_status: 'active' }],
  TransferOutcome: [{ id: 'outcome-fixture', transfer_successful: true, minutes_to_transfer: 6 }],
  EventNavigationLog: params.has('spike') ? Array.from({ length: 3 }, (_, i) => ({ id: `nav-${i}`, result: 'navigation_error', timestamp: '2026-10-09T10:00:00Z', source_page: 'Fixture', event_title: 'Fictional Show' })) : [{ id: 'nav-ok', result: 'success' }],
  Event: [{ id: 'event-fixture', title: 'Fictional Show', date: '2026-10-10', status: 'upcoming' }], FlashDrop: [], FlashDropEntry: [],
}};
for (const key of (params.get('fail') || '').split(',').filter(Boolean)) state.modes[key] = 'error';
for (const key of (params.get('unavailable') || '').split(',').filter(Boolean)) state.modes[key] = 'unavailable';
for (const key of (params.get('delay') || '').split(',').filter(Boolean)) state.modes[key] = 'delay';
if (params.has('empty')) for (const key of Object.keys(state.data)) state.data[key] = [];
state.release = (key, mode = 'ready') => { state.modes[key] = mode; for (const resolve of state.pending[key] || []) resolve(); state.pending[key] = []; };
window.founderFixture = state;
async function read(key, method, args) {
 state.calls.push({ key, method, args });
 if (state.modes[key] === 'delay') await new Promise(resolve => (state.pending[key] ||= []).push(resolve));
 if (state.modes[key] === 'error') throw new Error(`Synthetic ${key} read failure`);
 if (state.modes[key] === 'unavailable') return undefined;
 return key === 'AdminAlert' ? [...state.data.AdminAlert, ...state.alerts] : [...state.data[key]];
}
const entities = Object.fromEntries(Object.keys(state.data).map(key => [key, {
 list: (...args) => read(key, 'list', args), filter: (...args) => read(key, 'filter', args),
 create: async value => { state.writes.push({ key, method: 'create', value }); if (key === 'AdminAlert') { const row = { id: `synthetic-alert-${state.alerts.length}`, ...value }; state.alerts.push(row); return row; } window.__PG_RECORD_FIXTURE_BLOCK__?.({ kind: 'sdk', name: `${key}.mutation` }); throw new Error('Blocked fixture mutation'); },
 update: async (...args) => { state.writes.push({ key, method: 'update', args }); window.__PG_RECORD_FIXTURE_BLOCK__?.({ kind: 'sdk', name: `${key}.mutation` }); throw new Error('Blocked fixture mutation'); },
}]));
const sdk = { entities: new Proxy(entities, { get(target, key) { if (!(key in target)) { state.unexpected.push(String(key)); window.__PG_RECORD_FIXTURE_BLOCK__?.({ kind: 'sdk', name: String(key) }); throw new Error(`Unmocked fixture entity ${String(key)}`); } return target[key]; } }) };

export const base44 = guardFixtureSdk(sdk, name => state.unexpected.push(name));
