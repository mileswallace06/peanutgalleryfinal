import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const key = Deno.env.get('STRIPELIVEPUBLISHABLEKEY');
  if (!key || (!key.startsWith('pk_test_') && !key.startsWith('pk_live_'))) {
    return Response.json({ error: 'Stripe publishable key misconfigured' }, { status: 500 });
  }
  return Response.json({ publishableKey: key });
});