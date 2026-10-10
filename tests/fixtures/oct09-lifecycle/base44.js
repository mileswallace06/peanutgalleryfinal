import { guardFixtureSdk } from '../../helpers/fixtureSdkGuard.js';
import { base44 as original, fixture, fixtureUser } from '../ticket-design/base44.js';
const params = new URLSearchParams(location.search);
const target = fixture.events[0];
Object.assign(target, { title: 'Fictional Boundary Concert', event_start_utc: '2099-10-09T20:00:00Z', date: '2099-10-09T20:00:00Z', event_end_utc: '2099-10-09T21:00:00Z', status: 'upcoming' });
if (params.get('phase') === 'unknown') Object.assign(target, { event_start_utc: null, date: null, event_end_utc: null, time_tba: true });
fixture.listings.push({ ...fixture.listings.find(l => l.id === 'fixture-seller-active'), id: 'fixture-owned-live', event_id: target.id, section: '104', row: 'B', seats: '7–8', seller_email: fixtureUser.email });
export const state = window.lifecycleFixture = { writes: [], reads: [], fresh: null, failRead: false, deferRead: false, resolveRead: null, created: [], deferCreate: false, resolveCreate: null };
Object.assign(state, { uploads: [], pendingUploads: [], uploadOutcome: 'reject' });
const fail = name => { window.__PG_RECORD_FIXTURE_BLOCK__?.({ kind: 'sdk', name }); state.writes.push(name); throw new Error(`Isolated fixture forbids ${name}`); };
const sdk = {
 ...original,
 entities: new Proxy(original.entities, { get(o, name) {
   if (name !== 'Event') return o[name];
   return { get: id => o.Event.get(id), list: (...args) => o.Event.list(...args), filter: async (...args) => {
     state.reads.push(args);
     if (state.deferRead) await new Promise(resolve => { state.resolveRead = resolve; });
     if (state.failRead) throw new Error('Fictional event read failure');
     const rows = await o.Event.filter(...args);
     return rows.map(row => row.id === target.id && state.fresh ? { ...row, ...state.fresh } : row);
   }, create: () => fail('Event.create'), update: () => fail('Event.update') };
 } }),
 functions: { invoke: async (name, args) => {
   if (name === 'flashDrop' && args.action === 'create') {
     if (params.get('allowFixtureDrop') !== '1') return fail('flashDrop.create');
     state.created.push(structuredClone(args));
     if (state.deferCreate) await new Promise(resolve => { state.resolveCreate = resolve; });
     return { data: { success: true, drop: { id: 'local-only-drop', ...args, status: 'pending' } } };
   }
   if (name === 'getListingParticipantView' && args.action === 'list_active_by_event') return { data: { listings: [] } };
   return original.functions.invoke(name, args);
 } },
 integrations: { Core: new Proxy({}, { get: (_, method) => method === 'UploadFile' ? async ({ file }) => {
   if (params.get('allowFixtureUpload') !== '1') return fail('Core.UploadFile');
   const index = state.uploads.length;
   const outcome = state.uploadOutcome;
   state.uploads.push({ name: file.name, type: file.type, size: file.size, outcome });
   await new Promise(resolve => { state.pendingUploads[index] = resolve; });
   if (outcome === 'reject') throw new Error('Synthetic upload failure');
   if (outcome === 'malformed') return { file_url: '' };
   return { file_url: `data:image/png;base64,c3ludGhldGljLXByb29m-${index}` };
 } : () => fail(`Core.${String(method)}`) }) },
};

export const base44 = guardFixtureSdk(sdk, name => state.writes.push(name));
