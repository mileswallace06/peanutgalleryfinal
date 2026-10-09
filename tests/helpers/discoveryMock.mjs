export function matches(row, query = {}) {
  return Object.entries(query).every(([key, expected]) => {
    if (key === '$and') return expected.every(part => matches(row, part));
    if (key === '$or') return expected.some(part => matches(row, part));
    const actual = row[key];
    if (expected === null) return actual == null;
    if (typeof expected !== 'object') return actual === expected;
    return Object.entries(expected).every(([op, value]) => {
      if (op === '$options') return true;
      if (op === '$exists') return Object.hasOwn(row, key) === value;
      if (op === '$regex') return new RegExp(value, expected.$options).test(actual || '');
      if (op === '$ne') return actual !== value && (value !== null || actual != null);
      if (op === '$gt') return actual != null && actual > value;
      if (op === '$gte') return actual != null && actual >= value;
      if (op === '$lt') return actual != null && actual < value;
      if (op === '$lte') return actual != null && actual <= value;
      throw new Error(`Unexpected fixture operator ${op}`);
    });
  });
}
export function discoveryMock(pg = [], tm = []) {
  const calls = [], failures = { local: false, provider: false, ongoing: false };
  return { calls, failures,
    entities: { Event: { filter: async (query, sort, limit, skip = 0) => {
      calls.push({ name: 'Event.filter', query, sort, limit, skip });
      if (failures.local) throw new Error('local unavailable');
      const desc = sort.startsWith('-'), field = desc ? sort.slice(1) : sort;
      return pg.filter(row => matches(row, query)).sort((a, b) => (desc ? -1 : 1) * String(a[field] || '').localeCompare(String(b[field] || ''))).slice(skip, skip + limit);
    } } },
    functions: { invoke: async (name, params) => {
      if (name !== 'getTicketmasterEvents') throw new Error(`Unexpected fixture call ${name}`);
      calls.push({ name, params });
      if (failures.provider || (params.discoveryWindow === 'ongoing' && failures.ongoing)) throw { status: 429, message: 'provider unavailable' };
      const asOf = params.asOf || new Date().toISOString(), since = new Date(Date.parse(asOf) - 12 * 3600000).toISOString();
      const events = tm.filter(row => (!params.city || row.city === params.city) && (!params.keyword || row.title.toLowerCase().includes(params.keyword.toLowerCase())) && (params.discoveryWindow === 'ongoing' ? row.date >= since && row.date < asOf : params.includePast || row.date >= asOf)).sort((a, b) => (params.sort === 'latest' ? -1 : 1) * a.date.localeCompare(b.date) || a.tm_id.localeCompare(b.tm_id));
      const page = params.page || 0, size = params.size || 40, hasMore = events.length > (page + 1) * size;
      return { data: { events: events.slice(page * size, (page + 1) * size), pagination: { page, size, hasMore, nextPage: hasMore ? page + 1 : null, truncated: false }, ...(params.discoveryWindow === 'ongoing' ? { coverage: { discoveryWindow: 'ongoing', lookbackHours: 12, limit: size, startDateTime: since, endDateTime: asOf } } : {}) } };
    } },
  };
}
