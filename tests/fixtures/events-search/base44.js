// Test-only SDK boundary. The page, query builder, cache, merger, and hooks are real.
const fixture = window.searchFixture = { calls: [], pg: [], tm: [], tmError: null, pgError: false, delays: {} };
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
export const base44 = {
  auth: { me: async () => ({ role: 'user' }) },
  entities: { Event: { filter: async (query, sort, limit, offset) => {
    fixture.calls.push({ name: 'PG', query, sort, limit, offset });
    if (fixture.pgError) throw new Error('fixture PG failure');
    return fixture.pg.filter(event => Object.entries(query).every(([key, value]) =>
      value.$regex ? new RegExp(value.$regex, value.$options).test(event[key] || '') : event[key] != null
    )).slice(offset, offset + limit);
  } } },
  functions: { invoke: async (name, params) => {
    fixture.calls.push({ name, params });
    if (name === 'suggestCities') return { data: { cities: [
      { city: 'Phoenix', state: 'AZ', label: 'Phoenix, AZ' },
      { city: 'Boston', state: 'MA', label: 'Boston, MA' },
    ].filter(city => city.city.toLowerCase().includes(params.keyword.toLowerCase())) } };
    if (name !== 'getTicketmasterEvents') return { data: {} };
    const response = fixture.tm.filter(event => !params.city || event.city === params.city);
    const error = fixture.tmError;
    await wait(fixture.delays[params.keyword] || 0);
    if (error) throw { status: error, message: 'fixture provider failure' };
    return { data: { events: response } };
  } },
};
