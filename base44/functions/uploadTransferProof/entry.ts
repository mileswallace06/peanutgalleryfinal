/**
 * uploadTransferProof — private upload of a transfer/fulfillment proof asset.
 * Same hardening as uploadListingProof but authorizes against a Purchase
 * (buyer_email or seller_email) and references it.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf'];
const MAX_BYTES = 10 * 1024 * 1024;
const MAGIC = {
  'image/png': [0x89, 0x50, 0x4E, 0x47],
  'image/jpeg': [0xFF, 0xD8, 0xFF],
  'image/jpg': [0xFF, 0xD8, 0xFF],
  'image/webp': [0x52, 0x49, 0x46, 0x46],
  'application/pdf': [0x25, 0x50, 0x44, 0x46],
};

function matchesMagic(bytes, mime) {
  const sig = MAGIC[mime];
  if (!sig) return false;
  return sig.every((b, i) => bytes[i] === b);
}

async function sha256(buf) {
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

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

  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 12));
  if (!matchesMagic(head, contentType)) return Response.json({ error: 'File magic bytes do not match declared type' }, { status: 415 });
  const checksum = await sha256(buf);

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

  try {
    const asset = await base44.asServiceRole.entities.ProofAsset.create({
      owner_email: user.email, reference_type: 'purchase', reference_id: purchase_id, proof_type,
      private_file_id: file_uri, storage_uri: file_uri, content_type: contentType, checksum,
      scan_status: 'pending', uploaded_at: new Date().toISOString(),
      legacy_public_url: null, migration_status: 'private',
    });
    return Response.json({ proof_asset_id: asset.id, scan_status: 'pending', storage: 'private' });
  } catch (e) {
    return Response.json({ error: 'ProofAsset creation failed; orphan private upload', orphan_file_uri: file_uri, details: e?.message }, { status: 500 });
  }
});