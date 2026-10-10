import { guardFixtureSdk } from '../../helpers/fixtureSdkGuard.js';
import { base44 as client, fixture } from '../ticket-design/base44';
import { identityEvents } from './catalog.mjs';
fixture.events.splice(0, fixture.events.length, ...identityEvents);
fixture.listings.splice(0);
fixture.purchases.splice(0);
fixture.sales.splice(0);
const invoke = client.functions.invoke;
client.functions.invoke = async (name, args) => {
  if (name === 'getTicketmasterEvents') return { data: { events: [], pagination: { page: args.page || 0, size: 40, hasMore: false, nextPage: null, truncated: false } } };
  if (['getListingParticipantView', 'getPurchaseParticipantView'].includes(name) || (name === 'manageDiscoveryAlerts' && args.action === 'get_event')) return invoke(name, args);
  window.__PG_RECORD_FIXTURE_BLOCK__?.({ kind: 'sdk', name });
  fixture.blocked.push({ name, args });
  throw new Error(`Identity fixture forbids function: ${name}`);
};
const sdk = { ...client, entities: new Proxy(client.entities, { get(target, name) {
  const entity = target[name];
  if (name !== 'Event') return entity;
  return new Proxy(entity, { get(record, method) {
    if (method !== 'list') return record[method];
    return async (...args) => {
    if (window.identityFailNextEventList) {
      window.identityFailNextEventList = false;
      throw new Error('Isolated event-list read failure');
    }
      return record.list(...args);
    };
  } });
} }) };

export const base44 = guardFixtureSdk(sdk, name => fixture.blocked.push(name));
