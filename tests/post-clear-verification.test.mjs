/**
 * Post-Clear Verification Behavioral Tests (7C.9C.2)
 *
 * 9 tests: silently retain each reservation/quarantine field after
 * the clear operation and require non-2xx (ok: false).
 *
 * Tests both ListingPrivate and Listing post-clear verification.
 */
import { createMockDeps, createDefaultSeed, seedStripePI, freezeCapturedPayment, finalizeCapturedPayment, runTestSuite } from './helpers/mockDeps.mjs';

// Helper: create a frozen state ready for finalization
function createFrozenState(o = {}) {
  const { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail, token, expiry, revision } = createDefaultSeed(o);
  seed.Listing[0].status = 'hidden';
  seed.Listing[0].hidden_reason = 'checkout_quarantine';
  seed.ListingPrivate[0].checkout_quarantined = true;
  seed.ListingPrivate[0].checkout_quarantine_reason = 'Payment captured — pending finalization';
  seed.ListingPrivate[0].checkout_quarantined_at = '2026-08-01T10:00:00.000Z';
  seed.ListingPrivate[0].quarantined_purchase_id = purchaseId;
  seed.ListingPrivate[0].recovery_not_before = new Date(Date.now() + 3 * 60 * 1000).toISOString();
  seed.Purchase[0].transfer_status = 'completed';
  seed.Purchase[0].payment_captured = true;
  seed.Purchase[0].buyer_confirmed = true;
  seed.PurchasePrivate[0].payment_captured = true;
  seed.PurchasePrivate[0].frozen_reservation_token = token;
  seed.PurchasePrivate[0].frozen_buyer_email = buyerEmail;
  seed.PurchasePrivate[0].frozen_reservation_expires_at = expiry;
  seed.PurchasePrivate[0].frozen_reservation_revision = revision;
  return { seed, listingId, piId, purchaseId, buyerEmail, sellerEmail, token, expiry, revision };
}

// Helper: run finalization and check it fails when a field is silently retained
async function testRetainedField(fieldName, entity, o = {}) {
  const ctx = createFrozenState(o);
  const deps = createMockDeps({
    seed: ctx.seed,
    // Silently drop the null write for the target field (simulates non-persistence)
    silentDropFields: { [entity]: [fieldName] },
  });
  const result = await finalizeCapturedPayment(deps, ctx.listingId);
  const notOk = !result.ok;
  // The field should still have its original value (not cleared)
  const storeName = entity;
  const record = deps._state.stores[storeName][0];
  const fieldRetained = record[fieldName] !== null && record[fieldName] !== undefined;
  const passed = notOk && fieldRetained;
  return { name: `retain_${entity}_${fieldName}`, passed, not_ok: notOk, field_retained: fieldRetained, step: result.step };
}

// 1. ListingPrivate buyer retained
async function testRetainLpBuyer() {
  return testRetainedField('reserved_by_email', 'ListingPrivate');
}

// 2. ListingPrivate expiration retained
async function testRetainLpExpiry() {
  return testRetainedField('reservation_expires_at', 'ListingPrivate');
}

// 3. ListingPrivate revision retained
async function testRetainLpRevision() {
  return testRetainedField('reservation_revision', 'ListingPrivate');
}

// 4. ListingPrivate quarantine reason retained
async function testRetainLpQuarantineReason() {
  return testRetainedField('checkout_quarantine_reason', 'ListingPrivate');
}

// 5. ListingPrivate quarantine timestamp retained
async function testRetainLpQuarantineTimestamp() {
  return testRetainedField('checkout_quarantined_at', 'ListingPrivate');
}

// 6. Listing buyer retained
async function testRetainListingBuyer() {
  return testRetainedField('reserved_by_email', 'Listing');
}

// 7. Listing expiration retained
async function testRetainListingExpiry() {
  return testRetainedField('reservation_expires_at', 'Listing');
}

// 8. Listing revision retained
async function testRetainListingRevision() {
  return testRetainedField('reservation_revision', 'Listing');
}

// 9. Listing hidden reason retained
async function testRetainListingHiddenReason() {
  return testRetainedField('hidden_reason', 'Listing');
}

// ── Main runner ────────────────────────────────────────────────────────────
async function main() {
  const tests = [
    await testRetainLpBuyer(),
    await testRetainLpExpiry(),
    await testRetainLpRevision(),
    await testRetainLpQuarantineReason(),
    await testRetainLpQuarantineTimestamp(),
    await testRetainListingBuyer(),
    await testRetainListingExpiry(),
    await testRetainListingRevision(),
    await testRetainListingHiddenReason(),
  ];
  await runTestSuite('Post-Clear Verification Tests (7C.9C.2)', tests);
}
main().catch(err => { console.error('Test runner error:', err); process.exit(1); });