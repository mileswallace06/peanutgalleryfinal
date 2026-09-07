import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { secrets } from 'base44:runtime';
import { createMission1Runtime } from '../../shared/mission1Runtime.js';

// Automation payload supplies an ID only. The same authority/outbox worker
// serializes inventory with checkout and release; this handler never writes
// inventory directly from an event's status or a stale Listing read.
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const listingId = body?.event?.entity_id || body?.data?.id;
  if (typeof listingId !== 'string' || !listingId) return Response.json({ ok: true, skipped: 'no listing id' });
  try {
    const runtime = await createMission1Runtime({ entities: base44.asServiceRole.entities, secrets });
    const result = await runtime.syncInventory(listingId);
    return Response.json({ ok: true, projected: result.verified === true, queued: result.queued });
  } catch (error) {
    return Response.json({ ok: false, code: error.message }, { status: 503 });
  }
});
