import { guardFixtureSdk } from '../../helpers/fixtureSdkGuard.js';
// Test-only read boundary. No real SDK, credentials, network or mutation API.
const cities = [
  { city: 'Phoenix', state: 'AZ', country: 'US', label: 'Phoenix, AZ' },
  { city: 'Boston', state: 'MA', country: 'US', label: 'Boston, MA' },
];
const controls = window.fanBehavior = { gps: [], calls: [], unexpected: [], cityReads: [] };
export { controls };
const sdk = {
  functions: { invoke: async (name, args = {}) => {
    controls.calls.push({ name, args });
    if (name !== 'suggestCities') {
      window.__PG_RECORD_FIXTURE_BLOCK__?.({ kind: 'sdk', name });
      controls.unexpected.push(name);
      throw new Error(`Isolated Fan fixture rejects ${name}`);
    }
    const rows = cities.filter(city => city.city.toLowerCase().startsWith(args.keyword.toLowerCase()));
    if (window.__FAN_BEHAVIOR_CONFIG__?.deferPhoenix && args.keyword === 'Phoenix') {
      return new Promise(resolve => controls.cityReads.push(() => resolve({ data: { cities: rows } })));
    }
    return { data: { cities: rows } };
  } },
};

export const base44 = guardFixtureSdk(sdk, name => controls.unexpected.push(name));
