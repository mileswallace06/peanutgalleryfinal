// Fictional local records mirror the audit's sparse shapes, never production IDs.
const base = { venue: 'Fixture Arena', city: 'Phoenix', state: 'AZ', date: '2026-05-07T01:00:00Z', status: 'upcoming', source: 'pg', listing_count: 0 };
const row = (id, title, patch = {}) => ({ ...base, id, title, search_text_normalized: `${title} fixture arena phoenix az`.toLowerCase(), ...patch });
export const identityEvents = [
  row('fixture-hail-a', 'Fixture Hail the Sun'), row('fixture-hail-b', 'Fixture Hail the Sun'),
  ...['a', 'b', 'c'].map(id => row(`fixture-baseball-${id}`, 'Fixture Diamondbacks / Pirates')),
  row('fixture-knocked-a', 'Fixture Knocked Loose'), row('fixture-knocked-b', 'Fixture Knocked Loose'),
  row('fixture-alias-a', 'Fixture Provider Alias', { tm_id: 'fixture-provider-one', venue_timezone: 'America/Phoenix' }),
  row('fixture-alias-b', 'Fixture Provider Alias', { tm_id: 'fixture-provider-one', venue_timezone: 'America/Phoenix' }),
  row('fixture-verified-a', 'Fixture Verified Alias', { tm_id: 'fixture-provider-old', provider_aliases_verified: true, provider_aliases: ['fixture-provider-new'] }),
  row('fixture-verified-b', 'Fixture Verified Alias', { tm_id: 'fixture-provider-new' }),
  row('fixture-recurring-a', 'Fixture Recurring Show', { date: '2026-05-08T01:00:00Z', venue_timezone: 'America/Los_Angeles' }),
  row('fixture-recurring-b', 'Fixture Recurring Show', { date: '2026-05-09T01:00:00Z', venue_timezone: 'America/Los_Angeles' }),
  row('fixture-session-a', 'Fixture Session Show', { session_id: 'matinee', session_name: 'Matinee' }),
  row('fixture-session-b', 'Fixture Session Show', { session_id: 'evening', session_name: 'Evening' }),
  row('fixture-inventory-a', 'Fixture Inventory Show', { tm_id: 'fixture-inventory-provider', listing_count: 2, inventory_id: 'fixture-owner-a' }),
  row('fixture-inventory-b', 'Fixture Inventory Show', { tm_id: 'fixture-inventory-provider', listing_count: 3, inventory_id: 'fixture-owner-b' }),
  row('fixture-sparse', 'Fixture Sparse Event', { date: null, venue: null, city: null, state: null, time_tba: true }),
];
