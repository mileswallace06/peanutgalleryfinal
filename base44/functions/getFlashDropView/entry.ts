import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { flashDropLeaders, isFlashDropViewer, projectFlashDrop, validFlashDropId } from '../../shared/flashDropReadView.js';

// Read-only replacement for members' direct FlashDrop entity queries. Existing
// read availability during maintenance is preserved; no mutation gate changes.
Deno.serve(async (req) => {
  let base44;
  let user;
  try {
    base44 = createClientFromRequest(req);
    user = await base44.auth.me();
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isFlashDropViewer(user)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || Array.isArray(body) || typeof body !== 'object' || !validFlashDropId(body.event_id)) {
    return Response.json({ error: 'Valid event_id required' }, { status: 400 });
  }

  try {
    const drops = await base44.asServiceRole.entities.FlashDrop.filter({ event_id: body.event_id });
    if (!Array.isArray(drops)) throw new Error('Invalid record collection');
    return Response.json({
      drops: drops.map(drop => projectFlashDrop(drop, user)),
      leaders: flashDropLeaders(drops),
    });
  } catch {
    return Response.json({ error: 'Could not load fan gifts. Please try again.' }, { status: 503 });
  }
});
