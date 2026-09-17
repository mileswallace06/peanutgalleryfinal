import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requiresTransferRiskAcknowledgment } from '../base44/shared/transferRisk.js';

const purchaseDialog = readFileSync(new URL('../src/components/events/PurchaseDialog.jsx', import.meta.url), 'utf8');
const checkoutOrchestrator = readFileSync(new URL('../base44/shared/checkoutOrchestrator.js', import.meta.url), 'utf8');
const confirmOrchestrator = readFileSync(new URL('../base44/shared/confirmCheckoutOrchestrator.js', import.meta.url), 'utf8');
const transferAcknowledgment = readFileSync(new URL('../src/components/listings/TransferAcknowledgment.jsx', import.meta.url), 'utf8');

test('checkout initialization failures have a visible retry instead of an infinite spinner', () => {
  assert.match(purchaseDialog, /setInitializationError/);
  assert.match(purchaseDialog, /initializationError \?/);
  assert.match(purchaseDialog, /setInitializationAttempt\(attempt => attempt \+ 1\)/);
  assert.match(purchaseDialog, />Try again<\/button>/);
});

test('authorization finalization is awaited before navigating', () => {
  assert.match(purchaseDialog, /const confirmation = await base44\.functions\.invoke\('confirmCheckoutAuthorized'/);
  assert.match(purchaseDialog, /if \(confirmation\?\.data\?\.error\) throw/);
});

test('demo checkout preserves eligibility and transfer-risk gates', () => {
  const demoStart = purchaseDialog.indexOf('const handleDemoUpgradeSubmit');
  const demoEnd = purchaseDialog.indexOf('\n\n  return (', demoStart);
  const demo = purchaseDialog.slice(demoStart, demoEnd);
  assert.match(demo, /!eligibilityPassed/);
  assert.match(demo, /transfer_status === 'transfer_disabled'/);
  assert.match(demo, /needsTransferAck && !transferAcknowledged/);
});

test('checkout does not market the Stripe authorization as escrow', () => {
  assert.doesNotMatch(purchaseDialog, /escrow/i);
  assert.match(purchaseDialog, /card is authorized first/i);
});

test('low-confidence confirmed listings still require acknowledgment and persist it', () => {
  assert.equal(requiresTransferRiskAcknowledgment({ transfer_status: 'transfer_confirmed', transfer_confidence_score: 55 }), true);
  assert.equal(requiresTransferRiskAcknowledgment({ transfer_status: 'transfer_unconfirmed', transfer_confidence_score: 95 }), true);
  assert.equal(requiresTransferRiskAcknowledgment({ transfer_status: 'transfer_confirmed', transfer_confidence_score: null }), true);
  assert.equal(requiresTransferRiskAcknowledgment({ transfer_status: 'transfer_confirmed', transfer_confidence_score: 90 }), false);
  assert.match(purchaseDialog, /requiresTransferRiskAcknowledgment\(listing\)/);
  assert.match(checkoutOrchestrator, /transfer_risk_acknowledged_at/);
  assert.match(checkoutOrchestrator, /transfer_status_at_checkout/);
  assert.match(checkoutOrchestrator, /transfer_confidence_at_checkout/);
  assert.match(confirmOrchestrator, /TRANSFER_RISK_REVIEW_REQUIRED/);
});

test('unchecking the warning revokes parent acknowledgment state', () => {
  assert.match(transferAcknowledgment, /if \(!next\) onAcknowledged\(false\)/);
});
