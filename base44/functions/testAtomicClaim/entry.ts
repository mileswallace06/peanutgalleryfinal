import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// TEMPORARY diagnostic — proves whether Base44 updateMany is a true atomic
// compare-and-set or a non-atomic read-then-write.
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const { purchase_id, mode } = await req.json();
  if (mode === 'cond') {
    // Simple conditional compare-and-set (single field, no $or).
    const res = await base44.asServiceRole.entities.Purchase.updateMany(
      { id: purchase_id, outcome_claim: null },
      { $set: { outcome_claim: 'won-simple' } }
    ).catch(e => ({ updated: 0, err: e?.message }));
    return Response.json({ mode, updated: res?.updated, has_more: res?.has_more });
  }
  if (mode === 'inc') {
    // Atomic increment test — quantity is a numeric field.
    const res = await base44.asServiceRole.entities.Purchase.updateMany(
      { id: purchase_id },
      { $inc: { quantity: 1 } }
    ).catch(e => ({ updated: 0, err: e?.message }));
    return Response.json({ mode, updated: res?.updated });
  }
  return Response.json({ error: 'mode required' });
});