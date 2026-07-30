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
 *   - Missing PurchasePrivate (Purchase exists, PP missing) → omit + alert
 *   Legacy buyer_email/seller_email queries are used ONLY for missing-sidecar
 *   detection — never to authorize, set viewer flags, cause a return, or
 *   supply response data.
 *
 * Never exposed to any role: emails, names, phone, location,
 * payment_intent_id, reservation_token, proof URLs, storage URIs,
 * ProofAsset IDs, dispute_reason, transfer notes, AI/fraud/risk fields,
 * internal flags, notification delivery fields.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { getPurchasePrivate } from '../../shared/privateData.ts';

// ── Shared safe serializer ──────────────────────────────────────────────────
function serializePurchase(p, pp, viewerEmail) {
  const authoritativeBuyerEmail = pp?.buyer_email ?? null;
  const authoritativeSellerEmail = pp?.seller_email ?? null;

  const isBuyer = authoritativeBuyerEmail === viewerEmail;
  const isSeller = authoritativeSellerEmail === viewerEmail;

  // ── Common allowlist (all roles) — normalized for stable shape ──
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

  // ── Seller-only allowlist ──
  // seller_payout from Purchase; payment flags from PurchasePrivate
  if (isSeller) {
    base.seller_payout = p.seller_payout ?? null;
    base.payment_captured = !!pp?.payment_captured;
    base.payment_capture_failed = !!pp?.payment_capture_failed;
  }

  return base;
}

// ── Idempotent integrity alert ────────────────────────────────────────────────
// Searches for an existing unresolved alert before creating. Calling
// list_mine twice against the same failure leaves exactly one alert.
async function alertIntegrityFailure(base44, title, purchase_id, description) {
  const sr = base44.asServiceRole;
  try {
    const existing = await sr.entities.AdminAlert.filter({
      title,
      reference_type: 'purchase',
      reference_id: purchase_id,
    }).catch(() => []);

    const unresolved = existing.filter(a => !a.resolved);
    if (unresolved.length > 0) return; // Idempotent — don't create duplicate

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

  // ── List action: list_mine ──────────────────────────────────────────────────
  if (action === 'list_mine') {
    const perspective = body?.perspective || 'buyer';
    if (!['buyer', 'seller', 'both'].includes(perspective)) {
      return Response.json({ error: 'Invalid perspective' }, { status: 400 });
    }
    const event_id = body?.event_id;

    const wantsBuyer = perspective === 'buyer' || perspective === 'both';
    const wantsSeller = perspective === 'seller' || perspective === 'both';

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

      // ── Step 4: Detect missing sidecars (bounded legacy query — detection only) ──
      // Legacy identity is used ONLY to find purchases that should have a PP but
      // don't. It never authorizes access, sets viewer flags, causes a return,
      // or supplies response data.
      if (wantsBuyer) {
        const legacyQuery = { buyer_email: viewerEmail };
        if (event_id) legacyQuery.event_id = event_id;
        const legacyPurchases = await sr.entities.Purchase.filter(legacyQuery, '-created_date', 500).catch(() => []);
        for (const p of legacyPurchases) {
          if (!buyerPPMap.has(p.id)) {
            await alertIntegrityFailure(base44, 'PurchasePrivate sidecar missing', p.id,
              `Purchase ${p.id} exists but has no PurchasePrivate sidecar. Detected via legacy buyer_email query.`);
          }
        }
      }
      if (wantsSeller) {
        const legacyQuery = { seller_email: viewerEmail };
        if (event_id) legacyQuery.event_id = event_id;
        const legacyPurchases = await sr.entities.Purchase.filter(legacyQuery, '-created_date', 500).catch(() => []);
        for (const p of legacyPurchases) {
          if (!sellerPPMap.has(p.id)) {
            await alertIntegrityFailure(base44, 'PurchasePrivate sidecar missing', p.id,
              `Purchase ${p.id} exists but has no PurchasePrivate sidecar. Detected via legacy seller_email query.`);
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

      if (perspective === 'buyer') return Response.json({ purchases: buyerFinal });
      if (perspective === 'seller') return Response.json({ sales: sellerFinal });
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
  if (!purchase_id) {
    return Response.json({ error: 'purchase_id required' }, { status: 400 });
  }

  const rows = await sr.entities.Purchase.filter({ id: purchase_id });
  const p = rows[0];
  if (!p) return Response.json({ error: 'Purchase not found' }, { status: 404 });

  const pp = await getPurchasePrivate(base44, p.id);

  // ── PurchasePrivate integrity check ──
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