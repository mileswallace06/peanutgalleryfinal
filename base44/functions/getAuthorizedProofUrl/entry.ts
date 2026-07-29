/**
 * getAuthorizedProofUrl — issue a short-lived signed URL for a private proof.
 *
 * Hardened:
 *  - exact proof_asset_id selection (no loose reference lookup)
 *  - authorization derived from the authoritative Listing/Purchase referenced
 *    by the asset (seller / buyer / admin) — NOT a request-supplied email
 *  - signed URL issued ONLY when scan_status === 'clean'
 *  - TTL ≤ 5 minutes (300s); private file_uri never exposed
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { isProofScanningEnabled, proofScannerUnavailable503 } from '../../shared/maintenance.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  let user;
  try { user = await base44.auth.me(); } catch (_) { return Response.json({ error: 'Unauthorized' }, { status: 401 }); }
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  if (!isProofScanningEnabled()) return proofScannerUnavailable503();

  const body = await req.json().catch(() => ({}));
  const { proof_asset_id } = body;
  if (!proof_asset_id) return Response.json({ error: 'proof_asset_id required' }, { status: 400 });

  let asset;
  try {
    const rows = await base44.asServiceRole.entities.ProofAsset.filter({ id: proof_asset_id });
    asset = rows[0];
  } catch (_) {
    return Response.json({ error: 'Proof asset not found' }, { status: 404 });
  }
  if (!asset) return Response.json({ error: 'Proof asset not found' }, { status: 404 });

  // Authorize against the authoritative referenced entity.
  let authorized = user.role === 'admin';
  if (!authorized) {
    if (asset.reference_type === 'listing') {
      const [l] = await base44.asServiceRole.entities.Listing.filter({ id: asset.reference_id });
      authorized = !!l && l.seller_email === user.email;
    } else if (asset.reference_type === 'purchase') {
      const [p] = await base44.asServiceRole.entities.Purchase.filter({ id: asset.reference_id });
      authorized = !!p && (p.buyer_email === user.email || p.seller_email === user.email);
    } else {
      authorized = asset.owner_email === user.email;
    }
  }
  if (!authorized) return Response.json({ error: 'Forbidden' }, { status: 403 });

  // Signed URLs only for clean-scanned assets.
  if (asset.scan_status !== 'clean') {
    return Response.json({ error: 'Proof has not passed scan clearance', scan_status: asset.scan_status }, { status: 403 });
  }

  try {
    const res = await base44.integrations.Core.CreateFileSignedUrl({ file_uri: asset.storage_uri, expires_in: 300 });
    return Response.json({ signed_url: res.signed_url, expires_in: 300 });
  } catch (e) {
    return Response.json({ error: 'Signed URL issuance failed', details: e?.message }, { status: 500 });
  }
});