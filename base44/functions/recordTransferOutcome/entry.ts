/**
 * recordTransferOutcome — Purchase entity-automation handler (update).
 *
 * ROLE: repair / safety net. The authoritative terminal-outcome recording lives
 * in `recordTerminalOutcome` (base44/shared/recordOutcome.ts), shared with
 * capturePayment (the single trusted terminal-transition function). This
 * handler re-fetches the Purchase by id and calls that shared logic, which is
 * fully idempotent: it re-derives trust and fills any record capturePayment
 * missed, and does nothing if capturePayment already wrote everything.
 *
 * CONCURRENCY NOTE: Base44 has no atomic compare-and-set (proven). This handler
 * performs NO claim and NO increment. Concurrent replays are safe — they
 * recompute identical state. The rare duplicate record they may create is
 * repaired to exactly-one by reconcilePurchaseOutcomes (eventual exactly-once).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { recordTerminalOutcome } from '../../shared/recordOutcome.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));

    // Extract ONLY the entity id — never trust the payload's record/emails.
    const entityId = body?.event?.entity_id || body?.data?.id;
    if (!entityId) return Response.json({ skipped: 'no entity id' });

    // Re-fetch the authoritative Purchase.
    const fetched = await base44.asServiceRole.entities.Purchase.filter({ id: entityId }).catch(() => []);
    const purchase = fetched[0];
    if (!purchase) return Response.json({ skipped: 'purchase not found' });

    // Demo purchases never affect real revenue, trust, or transfer intelligence.
    if (purchase.is_demo === true) return Response.json({ skipped: 'demo purchase' });

    // Only act on terminal statuses.
    if (!['completed', 'disputed'].includes(purchase.transfer_status)) {
      return Response.json({ skipped: 'not a terminal status' });
    }

    return Response.json(await recordTerminalOutcome(base44, purchase));
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});