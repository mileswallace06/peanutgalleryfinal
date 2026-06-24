/**
 * checkStripeWebhook
 * ───────────────────
 * Admin-only diagnostic: verifies Stripe webhook endpoint is registered and
 * subscribed to the correct events. Run before launch and periodically.
 *
 * Returns:
 *   { webhook_endpoints: [...], required_events: [...], missing_events: [...], status }
 *
 * Also checks whether any webhook events have been received recently by
 * looking for the last event timestamp.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const REQUIRED_EVENTS = [
  'payment_intent.payment_failed',
  'payment_intent.succeeded',
  'payout.failed',
  'transfer.failed',
  'charge.dispute.created',
  'charge.refunded',
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden — admin only' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const autoFix = body.auto_fix === true;

    const secretKey = Deno.env.get('STRIPELIVESECRETKEY');
    if (!secretKey) {
      return Response.json({ error: 'STRIPELIVESECRETKEY not set' }, { status: 500 });
    }

    const stripe = new Stripe(secretKey);
    const isLive = secretKey.startsWith('sk_live_');

    // List all webhook endpoints for this Stripe account
    const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });

    const webhookInfo = endpoints.data.map(ep => ({
      id: ep.id,
      url: ep.url,
      enabled: ep.enabled !== false, // treat undefined/null as enabled
      events: ep.enabled_events,
      api_version: ep.api_version,
      created: new Date(ep.created * 1000).toISOString(),
    }));

    // Check which required events are covered by ANY enabled endpoint
    const allSubscribedEvents = endpoints.data
      .filter(ep => ep.enabled !== false)
      .flatMap(ep => ep.enabled_events);

    const missingEvents = REQUIRED_EVENTS.filter(
      ev => !allSubscribedEvents.includes(ev)
    );

    // Check recent events to see if the webhook is actually receiving traffic
    let recentEvents = [];
    try {
      const events = await stripe.events.list({ limit: 10 });
      recentEvents = events.data.map(e => ({
        id: e.id,
        type: e.type,
        created: new Date(e.created * 1000).toISOString(),
      }));
    } catch (_) {
      // Event listing may not be available in all Stripe configs
    }

    const lastEventAt = recentEvents.length > 0
      ? recentEvents[0].created
      : null;

    // Auto-fix: add missing events to an existing enabled webhook endpoint
    let autoFixResult = null;
    if (autoFix && missingEvents.length > 0 && webhookInfo.length > 0) {
      const targetEndpoint = webhookInfo[0]; // first enabled endpoint
      try {
        const mergedEvents = [...new Set([...targetEndpoint.events, ...missingEvents])];
        await stripe.webhookEndpoints.update(targetEndpoint.id, {
          enabled_events: mergedEvents,
        });
        autoFixResult = {
          endpoint_id: targetEndpoint.id,
          added_events: missingEvents,
          total_events: mergedEvents,
          success: true,
        };
        // Re-check missing after fix
        const stillMissing = REQUIRED_EVENTS.filter(
          ev => !mergedEvents.includes(ev)
        );
        return Response.json({
          mode: isLive ? 'live' : 'test',
          webhook_endpoints: webhookInfo,
          required_events: REQUIRED_EVENTS,
          missing_events: stillMissing,
          recent_events: recentEvents,
          last_event_at: lastEventAt,
          auto_fix: autoFixResult,
          status: stillMissing.length === 0 ? 'ok' : 'incomplete',
        });
      } catch (fixErr) {
        autoFixResult = { success: false, error: fixErr.message };
      }
    }

    return Response.json({
      mode: isLive ? 'live' : 'test',
      webhook_endpoints: webhookInfo,
      required_events: REQUIRED_EVENTS,
      missing_events: missingEvents,
      recent_events: recentEvents,
      last_event_at: lastEventAt,
      auto_fix: autoFixResult,
      status: missingEvents.length === 0 ? 'ok' : 'incomplete',
      action_required: missingEvents.length > 0
        ? `Add missing events via: base44.functions.invoke('checkStripeWebhook', { auto_fix: true })`
        : null,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});