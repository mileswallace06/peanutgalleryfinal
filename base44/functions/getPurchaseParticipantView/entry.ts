/**
 * getPurchaseParticipantView — return an allowlisted purchase view for the
 * calling participant (buyer / seller / admin).
 *
 * Two modes:
 *   1. Single record:  { purchase_id }
 *   2. List by owner:  { action: "list_mine", perspective: "buyer"|"seller"|"both", event_id? }
 *
 * PurchasePrivate is authoritative for buyer_email and seller_email.
 * No legacy fallback to Purchase identity fields.
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
  // PurchasePrivate is authoritative for identity — NO legacy fallback
  const authoritativeBuyerEmail = pp?.buyer_email ?? null;
  const authoritativeSellerEmail = pp?.seller_email ?? null;

  const isBuyer = authoritativeBuyerEmail === viewerEmail;
  const isSeller = authoritativeSellerEmail === viewerEmail;

  // ── Common allowlist (all roles) ──
  const base = {
    id: p.id,
    listing_id: p.listing_id,
    event_id: p.event_id,
    amount: p.amount,
    quantity: p.quantity,
    transfer_status: p.transfer_status,
    buyer_confirmed: p.buyer_confirmed,
    seller_confirmed: p.seller_confirmed,
    seller_confirmed_at: p.seller_confirmed_at,
    created_date: p.created_date,
    is_demo: p.is_demo,
    fulfillment_status: p.fulfillment_status,
    viewer_is_buyer: isBuyer,
    viewer_is_seller: isSeller,
  };

  // ── Seller-only allowlist ──
  if (isSeller) {
    base.seller_payout = p.seller_payout;
    base.payment_captured = p.payment_captured;
    base.payment_capture_failed = p.payment_capture_failed;
  }

  return base;
}

// ── Integrity alert helper ───────────────────────────────────────────────────
async function alertMissingSidecar(base44, purchase_id, mode) {
  try {
    await base44.asServiceRole.entities.AdminAlert.create({
      alert_type: 'admin_action_required',
      priority: 'high',
      title: `PurchasePrivate integrity failure (${mode})`,
      description: `PurchasePrivate missing for purchase ${purchase_id}. Record omitted from ${mode} results.`,
      reference_type: 'purchase',
      reference_id: purchase_id,
    });
  } catch (_) { /* alert failure must never throw */ }
}

// ── Fetch Purchase records by ID in bounded parallel batches (no N+1) ────────
async function fetchPurchasesByIds(sr, ids) {
  const BATCH = 50;
  const results = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const batchResults = await Promise.all(
      batch.map(pid => sr.entities.Purchase.filter({ id: pid }).then(r => r[0]).catch(() => null))
    );
    results.push(...batchResults.filter(Boolean));
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

    // Fetch PurchasePrivate rows (authoritative identity, no N+1)
    let buyerPPs = [];
    let sellerPPs = [];
    if (wantsBuyer) {
      const query = { buyer_email: viewerEmail };
      if (event_id) query.event_id = event_id;
      buyerPPs = await sr.entities.PurchasePrivate.filter(query, '-created_date', 500).catch(() => []);
    }
    if (wantsSeller) {
      const query = { seller_email: viewerEmail };
      if (event_id) query.event_id = event_id;
      sellerPPs = await sr.entities.PurchasePrivate.filter(query, '-created_date', 500).catch(() => []);
    }

    // Build maps (deduplicate by purchase_id)
    const buyerPPMap = new Map();
    for (const pp of buyerPPs) {
      if (pp.purchase_id && !buyerPPMap.has(pp.purchase_id)) buyerPPMap.set(pp.purchase_id, pp);
    }
    const sellerPPMap = new Map();
    for (const pp of sellerPPs) {
      if (pp.purchase_id && !sellerPPMap.has(pp.purchase_id)) sellerPPMap.set(pp.purchase_id, pp);
    }

    // Fetch matching Purchase records in bounded parallel batches
    const [buyerPurchases, sellerPurchases] = await Promise.all([
      buyerPPMap.size > 0 ? fetchPurchasesByIds(sr, [...buyerPPMap.keys()]) : Promise.resolve([]),
      sellerPPMap.size > 0 ? fetchPurchasesByIds(sr, [...sellerPPMap.keys()]) : Promise.resolve([]),
    ]);

    const buyerPurchaseMap = new Map(buyerPurchases.map(p => [p.id, p]));
    const sellerPurchaseMap = new Map(sellerPurchases.map(p => [p.id, p]));

    // Serialize + integrity check (omit missing sidecars, create alert)
    const buyerResults = [];
    for (const [pid, pp] of buyerPPMap) {
      const p = buyerPurchaseMap.get(pid);
      if (!p) {
        await alertMissingSidecar(base44, pid, 'list_mine (buyer)');
        continue;
      }
      buyerResults.push(serializePurchase(p, pp, viewerEmail));
    }

    const sellerResults = [];
    for (const [pid, pp] of sellerPPMap) {
      const p = sellerPurchaseMap.get(pid);
      if (!p) {
        await alertMissingSidecar(base44, pid, 'list_mine (seller)');
        continue;
      }
      sellerResults.push(serializePurchase(p, pp, viewerEmail));
    }

    // Stable sort: newest-first by created_date, then ID
    buyerResults.sort(sortByCreatedThenId);
    sellerResults.sort(sortByCreatedThenId);

    // Limit each role to 500
    const buyerFinal = buyerResults.slice(0, 500);
    const sellerFinal = sellerResults.slice(0, 500);

    if (perspective === 'buyer') return Response.json({ purchases: buyerFinal });
    if (perspective === 'seller') return Response.json({ sales: sellerFinal });
    return Response.json({ purchases: buyerFinal, sales: sellerFinal });
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
    // Can't determine participant status without sidecar — fail closed
    return Response.json({ error: 'Purchase not found' }, { status: 404 });
  }

  // Determine participant status from PurchasePrivate (no Purchase fallback)
  const isBuyer = pp.buyer_email === viewerEmail;
  const isSeller = pp.seller_email === viewerEmail;
  const isAdmin = user.role === 'admin';

  if (!isBuyer && !isSeller && !isAdmin) {
    return Response.json({ error: 'Purchase not found' }, { status: 404 });
  }

  return Response.json({ purchase: serializePurchase(p, pp, viewerEmail) });
});