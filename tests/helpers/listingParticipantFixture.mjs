/** Execute the real participant endpoint offline; only SDK/storage boundaries are fixtures. */
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../', import.meta.url));
const path = 'base44/functions/getListingParticipantView/entry.ts';
export const privateListingFields = {
  seller_email: 'PRIVATE_LEGACY_SELLER@example.invalid', reserved_by_email: 'PRIVATE_RESERVED@example.invalid',
  reservation_token: 'PRIVATE_RESERVATION_TOKEN', proof_url: 'PRIVATE_PROOF_URL', ticket_file_url: 'PRIVATE_TICKET_URL',
  notes: 'PRIVATE_NOTES', storage_path: 'PRIVATE_STORAGE_PATH', custody_notes: 'PRIVATE_CUSTODY_NOTES',
  fraud_score: 999, admin_only_id: 'PRIVATE_ADMIN_ID', transfer_verified_notes: 'PRIVATE_VERIFICATION_NOTES',
};
export async function invokeListingParticipant({ role = 'seller', platform = 'ticketmaster', status = 'sold', action, sourceRef, privateMissing = false, buyerLookupFailure = false, legacySellerSpoof = false, reservedForViewer = false, omitPlatform = false } = {}) {
  const listing = {
    ...privateListingFields, id: 'fixture-listing', event_id: 'fixture-event', section: '101', row: 'B', quantity: 2,
    tier: 'lower', asking_price: 15, original_price: 20, transfer_method: 'mobile_transfer', status,
    listing_mode: 'standard', listing_type: 'resale_ticket', transfer_status: 'transferable', listing_transfer_mode: 'manual',
    transfer_confidence_score: 90, last_transfer_verification: '2026-10-09T12:00:00Z', requires_location: false,
    location_requirement: null, requires_existing_ticket: false, transfer_platform: platform, created_date: '2026-10-09T12:00:00Z',
    ...(legacySellerSpoof ? { seller_email: `${role}@example.invalid` } : {}),
  };
  if (omitPlatform) delete listing.transfer_platform;
  const lp = privateMissing ? null : {
    ...privateListingFields, id: 'fixture-private-listing', listing_id: listing.id, event_id: listing.event_id,
    seller_email: 'seller@example.invalid', transfer_platform: 'PRIVATE_SIDECAR_PLATFORM', proof_status: 'approved', proof_rejection_reason: null, seats: '7–8',
    is_demo_listing: false, custody_status: 'verified',
    reserved_by_email: reservedForViewer ? `${role}@example.invalid` : null,
    reservation_expires_at: reservedForViewer ? '2099-10-10T00:00:00Z' : null,
  };
  const user = role === 'guest' ? null : { email: `${role}@example.invalid`, role: role === 'admin' ? 'admin' : 'user' };
  const calls = [];
  const sdk = { auth: { me: async () => user }, asServiceRole: { entities: {
    Listing: { filter: async query => { calls.push({ entity: 'Listing', query }); if (query.seller_email) return query.seller_email === listing.seller_email ? [listing] : []; return [listing]; } },
    ListingPrivate: { filter: async query => { calls.push({ entity: 'ListingPrivate', query }); if (!lp) return []; return !query.seller_email || query.seller_email === lp.seller_email ? [lp] : []; } },
    PurchasePrivate: { filter: async query => { calls.push({ entity: 'PurchasePrivate', query }); assert.equal(query.buyer_email, user.email); if (buyerLookupFailure) throw new Error('Fixture lookup failed'); return role === 'buyer' ? [{ purchase_id: 'fixture-sale-aaaaaaaaaaaaaaaa', listing_id: listing.id, buyer_email: user.email }] : []; } },
    AdminAlert: { filter: async () => { throw new Error('Unexpected alert read'); }, create: async () => { throw new Error('Forbidden fixture write'); } },
  } } };
  const source = (sourceRef ? execFileSync('git', ['show', `${sourceRef}:${path}`], { cwd: root, encoding: 'utf8' }) : await readFile(`${root}${path}`, 'utf8')).replace(/^import .*;$/gm, '');
  let handler;
  vm.runInNewContext(source, {
    createClientFromRequest: () => sdk, getListingPrivate: async (_sdk, id) => { assert.equal(id, listing.id); return lp; },
    isFailClosed: () => false, Deno: { serve: fn => { handler = fn; } }, Response, console: { error() {}, warn() {} },
  });
  const response = await handler({ json: async () => action ? { action, event_id: listing.event_id } : { listing_id: listing.id } });
  return { status: response.status, body: await response.json(), calls };
}
export async function browserListingResponses(sourceRef) {
  const responses = {};
  for (const role of ['seller', 'buyer', 'admin', 'unauthorized', 'guest']) {
    responses[role] = {};
    for (const platform of ['ticketmaster', 'axs', 'other', 'PRIVATE_UNKNOWN_PLATFORM']) responses[role][platform] = await invokeListingParticipant({ role, platform, sourceRef });
  }
  return responses;
}
