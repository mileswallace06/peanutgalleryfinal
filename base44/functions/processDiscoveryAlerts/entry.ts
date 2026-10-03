import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { refreshWatchedDiscoveryEvents } from '../../shared/discoveryEventCache.js';
import { discoveryWorkerAuthorized, processDiscoveryAlerts, DiscoveryAlertError } from '../../shared/discoveryAlerts.js';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    const authorized = await discoveryWorkerAuthorized({ user,
      providedSecret: req.headers.get('x-discovery-scheduler-secret'),
      configuredSecret: Deno.env.get('DISCOVERY_ALERT_SCHEDULER_SECRET'),
    });
    if (!authorized) return Response.json({ error: 'forbidden' }, { status: 403 });
    // Missing auth is never treated as a scheduler. No x-base44-service-role shortcut.
    if (Deno.env.get('DISCOVERY_ALERTS_ENABLED') !== 'true') {
      return Response.json({ error: 'discovery_alerts_not_enabled' }, { status: 503 });
    }
    const entities = base44.asServiceRole.entities;
    return Response.json(await processDiscoveryAlerts({ entities,
      refreshWatchedEvents: async (events, now) => refreshWatchedDiscoveryEvents(entities, events, async (id) => {
        const key = Deno.env.get('Ticketmaster_consumer_key');
        if (!key) throw new Error('provider_key_missing');
        const query = new URLSearchParams({ apikey: key });
        const response = await fetch(`https://app.ticketmaster.com/discovery/v2/events/${encodeURIComponent(id)}.json?${query}`,
          { signal: AbortSignal.timeout(5000) });
        if (response.status === 404) return null;
        if (!response.ok) throw new Error('provider_refresh_unavailable');
        return await response.json();
      }, now),
    }));
  } catch (error) {
    return Response.json({ error: error instanceof DiscoveryAlertError ? error.code : 'discovery_alert_processing_failed' },
      { status: error instanceof DiscoveryAlertError ? error.status : 503 });
  }
});
