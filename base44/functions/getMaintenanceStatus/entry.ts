/**
 * getMaintenanceStatus — admin-only maintenance status.
 *
 * Returns ONLY { maintenance_active: true|false }. Never returns the secret
 * value. Non-admins receive 403; unauthenticated callers receive 401.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { isMaintenanceActive } from '../../shared/maintenance.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
  return Response.json({ maintenance_active: isMaintenanceActive() });
});