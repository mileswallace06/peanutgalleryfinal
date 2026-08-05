/**
 * Tuple Invariant Validation Tests (7C.9C.2 — Requirement #7)
 *
 * Tests that validateIntendedTuple rejects invalid intended combinations
 * before any mutation, returning structured non-success with no writes.
 *
 * Also tests applyReservationTuple with invalid combinations to verify
 * zero entity writes occur.
 */
import {
  createMockDeps, createDefaultSeed,
  applyReservationTuple, validateIntendedTuple,
  generateClearedRevision, runTestSuite,
} from './helpers/mockDeps.mjs';

if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.randomUUID) {
  globalThis.crypto = { randomUUID: () => `uuid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}` };
}

// ════════════════════════════════════════════════════════════════════════════
// Direct validateIntendedTuple tests
// ════════════════════════════════════════════════════════════════════════════

function testValidate_ActiveStatusRequiresNonNullRevision() {
  const r = validateIntendedTuple({ status: 'active', token: null, buyer: null, expiration: null, revision: null });
  return { name: 'validate_active_requires_revision', passed: !r.valid && r.error.includes('revision'), error: r.error };
}

function testValidate_ActiveStatusRejectsUndefinedRevision() {
  const r = validateIntendedTuple({ status: 'active', token: null, buyer: null, expiration: null });
  return { name: 'validate_active_rejects_undefined_revision', passed: !r.valid && r.error.includes('revision'), error: r.error };
}

function testValidate_ActiveStatusRejectsEmptyRevision() {
  const r = validateIntendedTuple({ status: 'active', token: null, buyer: null, expiration: null, revision: '' });
  return { name: 'validate_active_rejects_empty_revision', passed: !r.valid && r.error.includes('revision'), error: r.error };
}

function testValidate_TerminalStatusRequiresNullToken() {
  const r = validateIntendedTuple({ status: 'sold', token: 'tok', buyer: null, expiration: null, revision: null });
  return { name: 'validate_terminal_requires_null_token', passed: !r.valid && r.error.includes('token'), error: r.error };
}

function testValidate_TerminalStatusRequiresNullBuyer() {
  const r = validateIntendedTuple({ status: 'sold', token: null, buyer: 'buyer@test', expiration: null, revision: null });
  return { name: 'validate_terminal_requires_null_buyer', passed: !r.valid && r.error.includes('buyer'), error: r.error };
}

function testValidate_TerminalStatusRequiresNullExpiration() {
  const r = validateIntendedTuple({ status: 'sold', token: null, buyer: null, expiration: '2026-01-01T00:00:00Z', revision: null });
  return { name: 'validate_terminal_requires_null_expiration', passed: !r.valid && r.error.includes('expiration'), error: r.error };
}

function testValidate_TerminalStatusRequiresNullRevision() {
  const r = validateIntendedTuple({ status: 'sold', token: null, buyer: null, expiration: null, revision: 'rev_1' });
  return { name: 'validate_terminal_requires_null_revision', passed: !r.valid && r.error.includes('revision'), error: r.error };
}

function testValidate_TerminalStatusRejectsUndefinedToken() {
  const r = validateIntendedTuple({ status: 'cancelled', buyer: null, expiration: null, revision: null });
  return { name: 'validate_terminal_rejects_undefined_token', passed: !r.valid && r.error.includes('token'), error: r.error };
}

function testValidate_NonNullTokenRequiresBuyer() {
  const r = validateIntendedTuple({ status: 'pending_transfer', token: 'tok', buyer: null, expiration: '2026-01-01T00:00:00Z', revision: 'rev_1' });
  return { name: 'validate_token_requires_buyer', passed: !r.valid && r.error.includes('buyer'), error: r.error };
}

function testValidate_NonNullTokenRequiresExpiration() {
  const r = validateIntendedTuple({ status: 'pending_transfer', token: 'tok', buyer: 'b@test', expiration: null, revision: 'rev_1' });
  return { name: 'validate_token_requires_expiration', passed: !r.valid && r.error.includes('expiration'), error: r.error };
}

function testValidate_NonNullTokenRequiresRevision() {
  const r = validateIntendedTuple({ status: 'pending_transfer', token: 'tok', buyer: 'b@test', expiration: '2026-01-01T00:00:00Z', revision: null });
  return { name: 'validate_token_requires_revision', passed: !r.valid && r.error.includes('revision'), error: r.error };
}

function testValidate_NonNullTokenRejectsEmptyBuyer() {
  const r = validateIntendedTuple({ status: 'pending_transfer', token: 'tok', buyer: '', expiration: '2026-01-01T00:00:00Z', revision: 'rev_1' });
  return { name: 'validate_token_rejects_empty_buyer', passed: !r.valid && r.error.includes('buyer'), error: r.error };
}

function testValidate_NonNullTokenRejectsEmptyExpiration() {
  const r = validateIntendedTuple({ status: 'pending_transfer', token: 'tok', buyer: 'b@test', expiration: '', revision: 'rev_1' });
  return { name: 'validate_token_rejects_empty_expiration', passed: !r.valid && r.error.includes('expiration'), error: r.error };
}

function testValidate_NonNullTokenRejectsEmptyToken() {
  const r = validateIntendedTuple({ status: 'pending_transfer', token: '', buyer: 'b@test', expiration: '2026-01-01T00:00:00Z', revision: 'rev_1' });
  return { name: 'validate_empty_token_rejected', passed: !r.valid && r.error.includes('token'), error: r.error };
}

function testValidate_NullTokenRequiresNullBuyer() {
  const r = validateIntendedTuple({ status: 'active', token: null, buyer: 'b@test', expiration: null, revision: generateClearedRevision() });
  return { name: 'validate_null_token_requires_null_buyer', passed: !r.valid && r.error.includes('buyer'), error: r.error };
}

function testValidate_NullTokenRequiresNullExpiration() {
  const r = validateIntendedTuple({ status: 'active', token: null, buyer: null, expiration: '2026-01-01T00:00:00Z', revision: generateClearedRevision() });
  return { name: 'validate_null_token_requires_null_expiration', passed: !r.valid && r.error.includes('expiration'), error: r.error };
}

function testValidate_QuarantineRequiresReason() {
  const r = validateIntendedTuple({ status: 'hidden', token: null, buyer: null, expiration: null, revision: generateClearedRevision(), quarantine: { checkout_quarantined: true, quarantine_at: '2026-01-01T00:00:00Z' } });
  return { name: 'validate_quarantine_requires_reason', passed: !r.valid && r.error.includes('reason'), error: r.error };
}

function testValidate_QuarantineRequiresTimestamp() {
  const r = validateIntendedTuple({ status: 'hidden', token: null, buyer: null, expiration: null, revision: generateClearedRevision(), quarantine: { checkout_quarantined: true, quarantine_reason: 'test reason' } });
  return { name: 'validate_quarantine_requires_timestamp', passed: !r.valid && r.error.includes('timestamp'), error: r.error };
}

function testValidate_QuarantineRejectsEmptyReason() {
  const r = validateIntendedTuple({ status: 'hidden', token: null, buyer: null, expiration: null, revision: generateClearedRevision(), quarantine: { checkout_quarantined: true, quarantine_reason: '', quarantine_at: '2026-01-01T00:00:00Z' } });
  return { name: 'validate_quarantine_rejects_empty_reason', passed: !r.valid && r.error.includes('reason'), error: r.error };
}

function testValidate_QuarantineRejectsMalformedTimestamp() {
  const r = validateIntendedTuple({ status: 'hidden', token: null, buyer: null, expiration: null, revision: generateClearedRevision(), quarantine: { checkout_quarantined: true, quarantine_reason: 'test', quarantine_at: 'not-a-date' } });
  return { name: 'validate_quarantine_rejects_malformed_timestamp', passed: !r.valid && r.error.includes('timestamp'), error: r.error };
}

function testValidate_ValidActiveReservation() {
  const r = validateIntendedTuple({ status: 'pending_transfer', token: 'tok_123', buyer: 'buyer@test', expiration: '2026-01-01T00:00:00Z', revision: 'rev_001' });
  return { name: 'validate_valid_active_reservation', passed: r.valid, error: r.error };
}

function testValidate_ValidActiveClearedState() {
  const r = validateIntendedTuple({ status: 'active', token: null, buyer: null, expiration: null, revision: generateClearedRevision() });
  return { name: 'validate_valid_active_cleared', passed: r.valid, error: r.error };
}

function testValidate_ValidTerminalState() {
  const r = validateIntendedTuple({ status: 'sold', token: null, buyer: null, expiration: null, revision: null });
  return { name: 'validate_valid_terminal', passed: r.valid, error: r.error };
}

function testValidate_OmittedPropertiesTerminal() {
  // Omitted properties should be treated as needing explicit null for terminal
  const r = validateIntendedTuple({ status: 'cancelled' });
  return { name: 'validate_omitted_properties_terminal', passed: !r.valid, error: r.error };
}

// ════════════════════════════════════════════════════════════════════════════
// applyReservationTuple with invalid combinations — verify NO writes occur
// ════════════════════════════════════════════════════════════════════════════
async function testApply_InvalidCombinationNoWrites() {
  const ctx = createDefaultSeed();
  const deps = createMockDeps({ seed: ctx.seed });
  const result = await applyReservationTuple(deps, ctx.listingId, {
    status: 'sold', // terminal
    token: 'should_not_be_here', // non-null on terminal
    buyer: null,
    expiration: null,
    revision: null,
  }, 'invalid_test', 'test:invalid');

  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];

  const notOk = !result.ok;
  const hasValidationError = !!result.validation_error;
  const listingUnchanged = listing.reservation_token === ctx.token; // still has original token
  const lpUnchanged = lp.reservation_token === ctx.token;
  const noWritesAttempted = !result.first_write_attempted && !result.second_write_attempted;

  const passed = notOk && hasValidationError && listingUnchanged && lpUnchanged && noWritesAttempted;
  return { name: 'apply_invalid_no_writes', passed, not_ok: notOk, has_validation_error: hasValidationError, listing_unchanged: listingUnchanged, lp_unchanged: lpUnchanged, no_writes_attempted: noWritesAttempted };
}

async function testApply_ValidActiveReservationWrites() {
  const ctx = createDefaultSeed({
    listing: { status: 'active', reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: null },
    lp: { reservation_token: null, reserved_by_email: null, reservation_expires_at: null, reservation_revision: null },
  });
  const deps = createMockDeps({ seed: ctx.seed });
  const newToken = 'new_token_456';
  const newBuyer = 'newbuyer@test';
  const newExpiry = new Date(Date.now() + 20 * 60 * 1000).toISOString();
  const newRevision = 'new_rev_002';

  const result = await applyReservationTuple(deps, ctx.listingId, {
    status: 'pending_transfer',
    token: newToken,
    buyer: newBuyer,
    expiration: newExpiry,
    revision: newRevision,
  }, 'valid_active', 'test:valid');

  const listing = deps._state.stores.Listing[0];
  const lp = deps._state.stores.ListingPrivate[0];

  const ok = result.ok;
  const listingHasToken = listing.reservation_token === newToken;
  const lpHasToken = lp.reservation_token === newToken;
  const tokensMatch = listing.reservation_token === lp.reservation_token;
  const revisionsMatch = listing.reservation_revision === lp.reservation_revision && listing.reservation_revision === newRevision;

  const passed = ok && listingHasToken && lpHasToken && tokensMatch && revisionsMatch;
  return { name: 'apply_valid_active_writes', passed, ok, listing_has_token: listingHasToken, lp_has_token: lpHasToken, tokens_match: tokensMatch, revisions_match: revisionsMatch };
}

// ── Main runner ────────────────────────────────────────────────────────────
async function main() {
  const tests = [
    testValidate_ActiveStatusRequiresNonNullRevision(),
    testValidate_ActiveStatusRejectsUndefinedRevision(),
    testValidate_ActiveStatusRejectsEmptyRevision(),
    testValidate_TerminalStatusRequiresNullToken(),
    testValidate_TerminalStatusRequiresNullBuyer(),
    testValidate_TerminalStatusRequiresNullExpiration(),
    testValidate_TerminalStatusRequiresNullRevision(),
    testValidate_TerminalStatusRejectsUndefinedToken(),
    testValidate_NonNullTokenRequiresBuyer(),
    testValidate_NonNullTokenRequiresExpiration(),
    testValidate_NonNullTokenRequiresRevision(),
    testValidate_NonNullTokenRejectsEmptyBuyer(),
    testValidate_NonNullTokenRejectsEmptyExpiration(),
    testValidate_NonNullTokenRejectsEmptyToken(),
    testValidate_NullTokenRequiresNullBuyer(),
    testValidate_NullTokenRequiresNullExpiration(),
    testValidate_QuarantineRequiresReason(),
    testValidate_QuarantineRequiresTimestamp(),
    testValidate_QuarantineRejectsEmptyReason(),
    testValidate_QuarantineRejectsMalformedTimestamp(),
    testValidate_ValidActiveReservation(),
    testValidate_ValidActiveClearedState(),
    testValidate_ValidTerminalState(),
    testValidate_OmittedPropertiesTerminal(),
    await testApply_InvalidCombinationNoWrites(),
    await testApply_ValidActiveReservationWrites(),
  ];
  await runTestSuite('Tuple Invariant Validation Tests (7C.9C.2 — Requirement #7)', tests);
}
main().catch(err => { console.error('Test runner error:', err); process.exit(1); });