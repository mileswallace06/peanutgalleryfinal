/**
 * dispatchSaleNotifications — the ONLY sender for sale_created AND
 * webhook-originated notifications.
 *
 * 7C.9C.1: Returns non-2xx when dispatch throws or reports integrity errors.
 * Scheduled every 1 minute.
 *
 * See base44/shared/saleNotification.ts for the delivery-integrity model.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { isMaintenanceActive } from '../../shared/maintenance.ts';
import { dispatchSaleNotifications } from '../../shared/saleNotification.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
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

  // 7C.9C.1: Do NOT swallow errors — propagate non-2xx on throw or integrity errors
  let res;
  try {
    res = await dispatchSaleNotifications(base44, { limit: body?.limit || 500 });
  } catch (err) {
    return Response.json({ error: err.message, dispatched: null }, { status: 500 });
  }

  // Check for fatal errors or integrity errors in both sale and webhook results
  const saleErrors = res?.sale?.errors || 0;
  const saleFatal = res?.sale?.fatal_error;
  const webhookErrors = res?.webhook?.errors || 0;
  const webhookFatal = res?.webhook?.fatal_error;

  if (saleFatal || saleErrors > 0 || webhookFatal || webhookErrors > 0) {
    return Response.json({ dispatched: res, warning: 'integrity errors detected' }, { status: 500 });
  }

  return Response.json({ dispatched: res });
});