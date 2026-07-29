/**
 * uploadListingProof — private upload of a listing/ownership proof asset.
 *
 * Hardened:
 *  - authenticates first; owner email derived from auth (never request-supplied)
 *  - authorizes against the authoritative Listing (seller_email === user.email)
 *  - validates MIME allowlist, size, AND file magic bytes
 *  - computes SHA-256 checksum
 *  - on ProofAsset creation failure, returns the orphan file_uri for purge
 *    (platform has no private-file delete API; pre-upload validation minimizes orphans)
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { isMaintenanceActive, maintenance503 } from '../../shared/maintenance.ts';
import { getListingPrivate } from '../../shared/privateData.ts';

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

  if (isMaintenanceActive()) return maintenance503('Proof uploads are temporarily unavailable for scheduled maintenance.');

  const formData = await req.formData().catch(() => null);
  if (!formData) return Response.json({ error: 'multipart/form-data with a file is required' }, { status: 400 });
  const file = formData.get('file');
  const listing_id = formData.get('listing_id');
  const proof_type = formData.get('proof_type') || 'listing_proof';
  if (!file || typeof file === 'string') return Response.json({ error: 'file is required' }, { status: 400 });
  if (!listing_id) return Response.json({ error: 'listing_id is required' }, { status: 400 });

  const contentType = file.type;
  if (!ALLOWED_MIME.includes(contentType)) return Response.json({ error: 'Unsupported file type' }, { status: 415 });
  if (file.size > MAX_BYTES) return Response.json({ error: 'File too large (max 10MB)' }, { status: 413 });

  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 12));
  if (!matchesMagic(head, contentType)) return Response.json({ error: 'File magic bytes do not match declared type' }, { status: 415 });
  const checksum = await sha256(buf);

  const listings = await base44.asServiceRole.entities.Listing.filter({ id: listing_id });
  const listing = listings[0];
  if (!listing) return Response.json({ error: 'Listing not found' }, { status: 404 });
  // Phase 1B: read authoritative seller_email from ListingPrivate
  const lp = await getListingPrivate(base44, listing.id);
  const authoritativeSellerEmail = lp?.seller_email ?? listing.seller_email;
  if (authoritativeSellerEmail !== user.email && user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

  let file_uri;
  try {
    const up = await base44.integrations.Core.UploadPrivateFile({ file });
    file_uri = up.file_uri;
  } catch (e) {
    return Response.json({ error: 'Private upload failed', details: e?.message }, { status: 500 });
  }

  try {
    const asset = await base44.asServiceRole.entities.ProofAsset.create({
      owner_email: user.email, reference_type: 'listing', reference_id: listing_id, proof_type,
      private_file_id: file_uri, storage_uri: file_uri, content_type: contentType, checksum,
      scan_status: 'pending', uploaded_at: new Date().toISOString(),
      legacy_public_url: null, migration_status: 'private',
    });
    return Response.json({ proof_asset_id: asset.id, scan_status: 'pending', storage: 'private' });
  } catch (e) {
    // Orphan: platform has no private-file delete API. Surface the uri for manual purge.
    return Response.json({ error: 'ProofAsset creation failed; orphan private upload', orphan_file_uri: file_uri, details: e?.message }, { status: 500 });
  }
});