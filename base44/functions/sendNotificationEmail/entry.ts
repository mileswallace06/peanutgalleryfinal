/**
 * sendNotificationEmail
 * ─────────────────────
 * Internal utility: send a transactional email via the Base44 Core integration.
 * Called by other backend functions — not intended for direct frontend invocation.
 *
 * Payload:
 *   { to, subject, body }
 *
 * Always returns { sent: true } or { sent: false, error: string }.
 * NEVER throws — callers must not be broken by email failures.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const FROM_NAME = 'Peanut Gallery';
const SUPPORT_EMAIL = 'experience@peanutgallery.store';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const { to, subject, body } = await req.json();

  if (!to || !subject || !body) {
    return Response.json({ sent: false, error: 'Missing required fields: to, subject, body' }, { status: 400 });
  }

  try {
    await base44.asServiceRole.integrations.Core.SendEmail({
      from_name: FROM_NAME,
      to,
      subject,
      body,
    });
    console.log('[sendNotificationEmail] ✅ sent to', to, '| subject:', subject);
    return Response.json({ sent: true });
  } catch (err) {
    console.error('[sendNotificationEmail] ❌ failed to', to, '| subject:', subject, '| error:', err?.message);
    return Response.json({ sent: false, error: err?.message || 'Email send failed' });
  }
});