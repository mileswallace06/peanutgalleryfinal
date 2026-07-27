/**
 * getAuthorizedProofUrl — issue a short-lived signed URL for a private proof.
 *
 * - authenticates first
 * - authorizes: owner_email === user.email OR admin; otherwise 403
 * - signed URL TTL ≤ 5 minutes (300s)
 * - never exposes the private file_uri / storage_uri to the client
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  let user;
  try { user = await base44.auth.me(); } catch (_) { return Response.json({ error: 'Unauthorized' }, { status: 401 }); }
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { proof_asset_id, reference_type, reference_id } = body;

  let asset;
  if (proof_asset_id) {
    const rows = await base44.asServiceRole.entities.ProofAsset.filter({ id: proof_asset_id });
    asset = rows[0];
  } else if (reference_type && reference_id) {
    const rows = await base44.asServiceRole.entities.ProofAsset.filter({ reference_type, reference_id });
    asset = rows[0];
  } else {
    return Response.json({ error: 'proof_asset_id or (reference_type, reference_id) required' }, { status: 400 });
  }
  if (!asset) return Response.json({ error: 'Proof asset not found' }, { status: 404 });

  if (asset.owner_email !== user.email && user.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const res = await base44.integrations.Core.CreateFileSignedUrl({ file_uri: asset.storage_uri, expires_in: 300 });
    return Response.json({ signed_url: res.signed_url, expires_in: 300 });
  } catch (e) {
    return Response.json({ error: 'Signed URL issuance failed', details: e?.message }, { status: 500 });
  }
});