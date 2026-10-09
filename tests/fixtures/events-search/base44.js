import { matches } from '../../helpers/discoveryMock.mjs';
// Test-only SDK boundary. Fail closed on unexpected functions or mutations.
const fixture = window.searchFixture = { calls: [], pg: [], tm: [], tmError: null, pgError: false, delays: {}, ...window.initialSearchFixture };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
export const base44 = {
  auth: { me: async () => ({ role: 'user' }) },
  entities: { Event: { filter: async (query, sort = 'date', limit = 40, offset = 0) => {
    fixture.calls.push({ name: 'PG', query, sort, limit, offset });
    if (fixture.pgError) throw new Error('fixture PG failure');
    const field = sort.replace(/^-/, ''), direction = sort.startsWith('-') ? -1 : 1;
    return fixture.pg.filter(event => matches(event, query)).sort((a, b) => direction * String(a[field] || '').localeCompare(String(b[field] || ''))).slice(offset, offset + limit);
  } } },
  functions: { invoke: async (name, params) => {
    fixture.calls.push({ name, params });
    if (name === 'suggestCities') { await wait(fixture.cityDelay || 0); return { data: { cities: [
      { city: 'Phoenix', state: 'AZ', label: 'Phoenix, AZ' },
      { city: 'Boston', state: 'MA', label: 'Boston, MA' },
    ].filter(city => city.city.toLowerCase().includes(params.keyword.toLowerCase())) } }; }
    if (name !== 'getTicketmasterEvents') throw new Error(`Unexpected fixture function: ${name}`);
    const rows = fixture.tm.filter(event => (!params.city || event.city === params.city) && (!params.latlong || event.city === 'Phoenix') && (!params.keyword || event.title.toLowerCase().includes(params.keyword.toLowerCase()) || event.attraction === params.keyword) && (params.includePast || event.date >= params.asOf)).sort((a, b) => (params.sort === 'latest' ? -1 : 1) * a.date.localeCompare(b.date) || a.tm_id.localeCompare(b.tm_id));
    const error = fixture.tmError;
    await wait(fixture.delays[params.keyword] || 0);
    if (error) throw { status: error, message: 'fixture provider failure' };
    const page = params.page || 0, size = params.size || 40, hasMore = (page + 1) * size < rows.length;
    return { data: { events: rows.slice(page * size, (page + 1) * size), pagination: { page, size, hasMore, nextPage: hasMore ? page + 1 : null, truncated: false } } };
  } },
};
