/**
 * dispatchSaleNotifications — the ONLY sender for sale_created notifications.
 *
 * Scheduled every 1 minute. Selects one canonical record per idempotency key,
 * supersedes concurrent duplicates, and dispatches only the canonical's unsent
 * channels. See base44/shared/saleNotification.ts for the delivery-integrity
 * model. Failed channels remain independently retryable on the next run.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { isMaintenanceActive } from '../../shared/maintenance.ts';
import { dispatchSaleNotifications } from '../../shared/saleNotification.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  // Allow the automation scheduler (no session) and admins; reject others.
  try {
    const user = await base44.auth.me();
    if (user && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
  } catch (_) {
    // No session = called by the scheduler — allow.
  }
  if (isMaintenanceActive()) return Response.json({ ok: true, skipped: 'maintenance mode' });
  const body = await req.json().catch(() => ({}));
  const res = await dispatchSaleNotifications(base44, { limit: body?.limit || 500 }).catch(
    (e) => ({ error: e.message })
  );
  return Response.json({ dispatched: res });
});