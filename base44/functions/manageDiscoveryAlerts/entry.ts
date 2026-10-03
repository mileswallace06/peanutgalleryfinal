import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { manageDiscoveryAlerts, DiscoveryAlertError } from '../../shared/discoveryAlerts.js';
import { resolveDiscoveryCityArea } from '../../shared/discoveryEventCache.js';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.id || !user?.email) return Response.json({ error: 'unauthorized' }, { status: 401 });
    const body = await req.json().catch(() => null);
    const result = await manageDiscoveryAlerts({
      entities: base44.asServiceRole.entities, user,
      resolveCity: async ({ city, state }) => {
        const key = Deno.env.get('Ticketmaster_consumer_key');
        if (!key) throw new DiscoveryAlertError('city_lookup_unavailable', 503);
        const query = new URLSearchParams({ city, stateCode: state, countryCode: 'US', size: '20', apikey: key });
        const response = await fetch(`https://app.ticketmaster.com/discovery/v2/venues.json?${query}`, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new DiscoveryAlertError('city_lookup_unavailable', 503);
        const data = await response.json();
        const venues = data?._embedded?.venues;
        const area = Array.isArray(venues) ? resolveDiscoveryCityArea(venues, city, state) : null;
        if (!area) throw new DiscoveryAlertError('city_location_not_found', 422);
        return area;
      },
    }, body);
    return Response.json({ ...result, service_active: Deno.env.get('DISCOVERY_ALERTS_ENABLED') === 'true' });
  } catch (error) {
    return Response.json({ error: error instanceof DiscoveryAlertError ? error.code : 'discovery_alerts_unavailable' },
      { status: error instanceof DiscoveryAlertError ? error.status : 503 });
  }
});
