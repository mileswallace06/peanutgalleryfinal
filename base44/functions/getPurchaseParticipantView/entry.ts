/**
 * getPurchaseParticipantView — return an allowlisted purchase view for the
 * calling participant (buyer / seller / admin).
 *
 * Two modes:
 *   1. Single record:  { purchase_id }
 *   2. List by owner:  { action: "list_mine", perspective: "buyer"|"seller"|"both", event_id? }
 *
 * PurchasePrivate is authoritative for buyer_email and seller_email.
 * No legacy fallback to Purchase identity fields for authorization or data.
 *
 * Payment flags (payment_captured, payment_capture_failed) are sourced from
 * PurchasePrivate. seller_payout is sourced from Purchase.
 *
 * Integrity detection:
 *   - Orphan PurchasePrivate (PP exists, Purchase missing) → omit + alert
 *   - Missing PurchasePrivate (Purchase exists, no PP globally) → omit + alert
 *   - Divergent identity (Purchase legacy user A, PP authoritative user B)
 *     → omit silently: no alert, no authorization, no identity exposure
 *
 * Input validation prevents MongoDB-operator objects from entering queries.
 *
 * Never exposed: emails, names, phone, location, payment_intent_id,
 * reservation_token, proof URLs, storage URIs, ProofAsset IDs,
 * dispute_reason, transfer notes, AI/fraud/risk fields, internal flags.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { getPurchasePrivate } from '../../shared/privateData.ts';

const MAX_ID_LENGTH = 200;

// ── Input validation ────────────────────────────────────────────────────────
// Prevents MongoDB-operator objects and other non-string values from entering
// entity queries. All ID fields must be plain nonempty strings ≤ 200 chars.
function validateId(value) {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > MAX_ID_LENGTH) return false;
  if (value.trim().length === 0) return false;
  return true;
}

// ── Shared safe serializer ──────────────────────────────────────────────────
function serializePurchase(p, pp, viewerEmail) {
  const authoritativeBuyerEmail = pp?.buyer_email ?? null;
  const authoritativeSellerEmail = pp?.seller_email ?? null;

  const isBuyer = authoritativeBuyerEmail === viewerEmail;
  const isSeller = authoritativeSellerEmail === viewerEmail;

  const base = {
    id: p.id,
    listing_id: p.listing_id ?? null,
    event_id: p.event_id ?? null,
    amount: p.amount ?? null,
    quantity: p.quantity ?? null,
    transfer_status: p.transfer_status ?? null,
    buyer_confirmed: !!p.buyer_confirmed,
    seller_confirmed: !!p.seller_confirmed,
    seller_confirmed_at: p.seller_confirmed_at ?? null,
    created_date: p.created_date ?? null,
    is_demo: !!p.is_demo,
    fulfillment_status: p.fulfillment_status ?? null,
    viewer_is_buyer: isBuyer,
    viewer_is_seller: isSeller,
  };

  if (isSeller) {
    base.seller_payout = p.seller_payout ?? null;
    base.payment_captured = !!pp?.payment_captured;
    base.payment_capture_failed = !!pp?.payment_capture_failed;
    base.updated_date = p.updated_date ?? null;
  }

  return base;
}

// ── Idempotent integrity alert ────────────────────────────────────────────────
// Searches for an existing unresolved alert before creating. If the lookup
// itself fails, no create is attempted (avoids duplicates). The outer catch
// ensures alert failure never throws to the caller.
async function alertIntegrityFailure(base44, title, purchase_id, description) {
  const sr = base44.asServiceRole;
  try {
    const existing = await sr.entities.AdminAlert.filter({
      title,
      reference_type: 'purchase',
      reference_id: purchase_id,
    });

    const unresolved = existing.filter(a => !a.resolved);
    if (unresolved.length > 0) return;

    await sr.entities.AdminAlert.create({
      alert_type: 'admin_action_required',
      priority: 'high',
      title,
      description,
      reference_type: 'purchase',
      reference_id: purchase_id,
    });
  } catch (_) { /* alert failure must never throw */ }
}

// ── Fetch Purchase records by ID using $in chunks (one query per ≤500 IDs) ───
async function fetchPurchasesByIds(sr, ids) {
  const CHUNK_SIZE = 500;
  const results = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const chunkResults = await sr.entities.Purchase.filter({
      id: { $in: chunk }
    }, '-created_date', CHUNK_SIZE);
    results.push(...chunkResults);
  }
  return results;
}

// ── Fetch PurchasePrivate by purchase_id using $in chunks (one query per ≤500) ─
async function fetchPurchasePrivatesByPurchaseIds(sr, ids) {
  const CHUNK_SIZE = 500;
  const results = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const chunkResults = await sr.entities.PurchasePrivate.filter({
      purchase_id: { $in: chunk }
    }, 'id', CHUNK_SIZE);
    results.push(...chunkResults);
  }
  return results;
}

// ── Stable sort: newest-first by created_date, then ID ───────────────────────
function sortByCreatedThenId(a, b) {
  const dateA = new Date(a.created_date || 0).getTime();
  const dateB = new Date(b.created_date || 0).getTime();
  if (dateB !== dateA) return dateB - dateA;
  return b.id > a.id ? 1 : b.id < a.id ? -1 : 0;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  let user;
  try { user = await base44.auth.me(); } catch (_) { return Response.json({ error: 'Unauthorized' }, { status: 401 }); }
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  const sr = base44.asServiceRole;
  const viewerEmail = user.email;

  // ── Input validation: action must be a string when supplied ──
  if (action !== undefined && typeof action !== 'string') {
    return Response.json({ error: 'action must be a string', code: 'INVALID_INPUT' }, { status: 400 });
  }

  // ── List action: list_mine ──────────────────────────────────────────────────
  if (action === 'list_mine') {
    // ── Input validation: perspective ──
    const perspective = body?.perspective;
    if (perspective !== undefined) {
      if (typeof perspective !== 'string' || !['buyer', 'seller', 'both'].includes(perspective)) {
        return Response.json({ error: 'perspective must be buyer, seller, or both', code: 'INVALID_INPUT' }, { status: 400 });
      }
    }
    const effectivePerspective = perspective || 'buyer';

    // ── Input validation: event_id ──
    const event_id = body?.event_id;
    if (event_id !== undefined && !validateId(event_id)) {
      return Response.json({ error: 'event_id must be a nonempty string', code: 'INVALID_INPUT' }, { status: 400 });
    }

    const wantsBuyer = effectivePerspective === 'buyer' || effectivePerspective === 'both';
    const wantsSeller = effectivePerspective === 'seller' || effectivePerspective === 'both';

    try {
      // ── Step 1: Fetch PurchasePrivate rows (authoritative, NO catch) ──
      let buyerPPs = [];
      let sellerPPs = [];
      if (wantsBuyer) {
        const query = { buyer_email: viewerEmail };
        if (event_id) query.event_id = event_id;
        buyerPPs = await sr.entities.PurchasePrivate.filter(query, '-created_date', 500);
      }
      if (wantsSeller) {
        const query = { seller_email: viewerEmail };
        if (event_id) query.event_id = event_id;
        sellerPPs = await sr.entities.PurchasePrivate.filter(query, '-created_date', 500);
      }

      // ── Step 2: Build PP maps (deduplicate by purchase_id) ──
      const buyerPPMap = new Map();
      for (const pp of buyerPPs) {
        if (pp.purchase_id && !buyerPPMap.has(pp.purchase_id)) buyerPPMap.set(pp.purchase_id, pp);
      }
      const sellerPPMap = new Map();
      for (const pp of sellerPPs) {
        if (pp.purchase_id && !sellerPPMap.has(pp.purchase_id)) sellerPPMap.set(pp.purchase_id, pp);
      }

      // ── Step 3: Fetch Purchase records by $in chunks (NO catch) ──
      const [buyerPurchases, sellerPurchases] = await Promise.all([
        buyerPPMap.size > 0 ? fetchPurchasesByIds(sr, [...buyerPPMap.keys()]) : Promise.resolve([]),
        sellerPPMap.size > 0 ? fetchPurchasesByIds(sr, [...sellerPPMap.keys()]) : Promise.resolve([]),
      ]);

      const buyerPurchaseMap = new Map(buyerPurchases.map(p => [p.id, p]));
      const sellerPurchaseMap = new Map(sellerPurchases.map(p => [p.id, p]));

      // ── Step 4: Detect genuinely missing sidecars ──
      // Legacy Purchase queries find purchases by legacy buyer_email/seller_email.
      // A purchase absent from the caller's role-specific PP map might:
      //   (a) have no PurchasePrivate at all (genuine missing sidecar), OR
      //   (b) have a PurchasePrivate under another authoritative identity.
      // Only (a) warrants an alert. We verify via a global PurchasePrivate
      // lookup by purchase_id. Divergent-identity purchases are silently
      // omitted — no alert, no authorization, no identity exposure.
      // No catch on any query here — failures propagate to the outer handler.
      const candidateMissingIds = new Set();

      if (wantsBuyer) {
        const legacyQuery = { buyer_email: viewerEmail };
        if (event_id) legacyQuery.event_id = event_id;
        const legacyPurchases = await sr.entities.Purchase.filter(legacyQuery, '-created_date', 500);
        for (const p of legacyPurchases) {
          if (!buyerPPMap.has(p.id)) candidateMissingIds.add(p.id);
        }
      }
      if (wantsSeller) {
        const legacyQuery = { seller_email: viewerEmail };
        if (event_id) legacyQuery.event_id = event_id;
        const legacyPurchases = await sr.entities.Purchase.filter(legacyQuery, '-created_date', 500);
        for (const p of legacyPurchases) {
          if (!sellerPPMap.has(p.id)) candidateMissingIds.add(p.id);
        }
      }

      // Batch-verify which candidates genuinely have no PurchasePrivate globally
      if (candidateMissingIds.size > 0) {
        const candidateIds = [...candidateMissingIds];
        const existingPPs = await fetchPurchasePrivatesByPurchaseIds(sr, candidateIds);
        const globalPPIds = new Set(existingPPs.map(pp => pp.purchase_id));

        for (const pid of candidateIds) {
          if (!globalPPIds.has(pid)) {
            await alertIntegrityFailure(base44, 'PurchasePrivate sidecar missing', pid,
              `Purchase ${pid} exists but has no PurchasePrivate sidecar.`);
          }
        }
      }

      // ── Step 5: Serialize + detect orphan PurchasePrivate ──
      const buyerResults = [];
      for (const [pid, pp] of buyerPPMap) {
        const p = buyerPurchaseMap.get(pid);
        if (!p) {
          await alertIntegrityFailure(base44, 'Orphan PurchasePrivate record', pid,
            `PurchasePrivate for purchase ${pid} exists but the Purchase record is missing.`);
          continue;
        }
        buyerResults.push(serializePurchase(p, pp, viewerEmail));
      }

      const sellerResults = [];
      for (const [pid, pp] of sellerPPMap) {
        const p = sellerPurchaseMap.get(pid);
        if (!p) {
          await alertIntegrityFailure(base44, 'Orphan PurchasePrivate record', pid,
            `PurchasePrivate for purchase ${pid} exists but the Purchase record is missing.`);
          continue;
        }
        sellerResults.push(serializePurchase(p, pp, viewerEmail));
      }

      // ── Step 6: Sort + limit ──
      buyerResults.sort(sortByCreatedThenId);
      sellerResults.sort(sortByCreatedThenId);

      const buyerFinal = buyerResults.slice(0, 500);
      const sellerFinal = sellerResults.slice(0, 500);

      if (effectivePerspective === 'buyer') return Response.json({ purchases: buyerFinal });
      if (effectivePerspective === 'seller') return Response.json({ sales: sellerFinal });
      return Response.json({ purchases: buyerFinal, sales: sellerFinal });
    } catch (err) {
      console.error('[getPurchaseParticipantView] list_mine failed:', err?.message || err);
      return Response.json({
        error: 'Unable to load purchase history',
        code: 'PURCHASE_HISTORY_UNAVAILABLE',
      }, { status: 500 });
    }
  }

  // ── Unknown action → 400 ──
  if (action) {
    return Response.json({ error: 'Unknown action' }, { status: 400 });
  }

  // ── Single record ──────────────────────────────────────────────────────────
  const purchase_id = body?.purchase_id;
  if (!validateId(purchase_id)) {
    return Response.json({ error: 'purchase_id must be a nonempty string', code: 'INVALID_INPUT' }, { status: 400 });
  }

  const rows = await sr.entities.Purchase.filter({ id: purchase_id });
  const p = rows[0];
  if (!p) return Response.json({ error: 'Purchase not found' }, { status: 404 });

  const pp = await getPurchasePrivate(base44, p.id);

  if (!pp) {
    if (user.role === 'admin') {
      console.error(`[getPurchaseParticipantView] integrity failure: PurchasePrivate missing for purchase ${p.id} (admin view)`);
      return Response.json({ error: 'Purchase integrity error: private record missing', code: 'INTEGRITY_ERROR' }, { status: 500 });
    }
    return Response.json({ error: 'Purchase not found' }, { status: 404 });
  }

  const isBuyer = pp.buyer_email === viewerEmail;
  const isSeller = pp.seller_email === viewerEmail;
  const isAdmin = user.role === 'admin';

  if (!isBuyer && !isSeller && !isAdmin) {
    return Response.json({ error: 'Purchase not found' }, { status: 404 });
  }

  return Response.json({ purchase: serializePurchase(p, pp, viewerEmail) });
});