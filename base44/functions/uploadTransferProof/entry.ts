/**
 * uploadTransferProof — private upload of a transfer/fulfillment proof asset.
 *
 * - authenticates first; owner email derived from auth (never request-supplied)
 * - authorizes against the authoritative Purchase (buyer_email or seller_email)
 * - validates MIME type (image/pdf) and size (≤ 10MB)
 * - stores the private file via UploadPrivateFile and records a ProofAsset
 * - unrelated users receive 403
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf'];
const MAX_BYTES = 10 * 1024 * 1024;

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  let user;
  try { user = await base44.auth.me(); } catch (_) { return Response.json({ error: 'Unauthorized' }, { status: 401 }); }
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await req.formData().catch(() => null);
  if (!formData) return Response.json({ error: 'multipart/form-data with a file is required' }, { status: 400 });
  const file = formData.get('file');
  const purchase_id = formData.get('purchase_id');
  const proof_type = formData.get('proof_type') || 'transfer_proof';
  if (!file || typeof file === 'string') return Response.json({ error: 'file is required' }, { status: 400 });
  if (!purchase_id) return Response.json({ error: 'purchase_id is required' }, { status: 400 });

  const contentType = file.type;
  if (!ALLOWED_MIME.includes(contentType)) return Response.json({ error: 'Unsupported file type' }, { status: 415 });
  if (file.size > MAX_BYTES) return Response.json({ error: 'File too large (max 10MB)' }, { status: 413 });

  const purchases = await base44.asServiceRole.entities.Purchase.filter({ id: purchase_id });
  const purchase = purchases[0];
  if (!purchase) return Response.json({ error: 'Purchase not found' }, { status: 404 });
  if (purchase.buyer_email !== user.email && purchase.seller_email !== user.email && user.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  let file_uri;
  try {
    const up = await base44.integrations.Core.UploadPrivateFile({ file });
    file_uri = up.file_uri;
  } catch (e) {
    return Response.json({ error: 'Private upload failed', details: e?.message }, { status: 500 });
  }

  const asset = await base44.asServiceRole.entities.ProofAsset.create({
    owner_email: user.email,
    reference_type: 'purchase',
    reference_id: purchase_id,
    proof_type,
    private_file_id: file_uri,
    storage_uri: file_uri,
    content_type: contentType,
    checksum: null,
    scan_status: 'pending',
    uploaded_at: new Date().toISOString(),
    legacy_public_url: null,
    migration_status: 'private',
  });

  return Response.json({ proof_asset_id: asset.id, scan_status: 'pending', storage: 'private' });
});