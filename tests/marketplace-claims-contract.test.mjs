import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const customerFacingFiles = [
  'src/components/Onboarding.jsx',
  'src/components/WhatIsPGOverlay.jsx',
  'src/components/events/EventsEmptyState.jsx',
  'src/components/events/ListingCard.jsx',
  'src/components/admin/cc/StripePanel.jsx',
  'src/components/admin/cc/IssueFeed.jsx',
  'src/components/admin/cc/CommandSummaryBar.jsx',
  'src/components/admin/FeeComparisonReport.jsx',
  'src/components/beta/BetaFeedbackForm.jsx',
  'src/components/beta/QAChecklist.jsx',
  'src/components/beta/OperationalRiskChecklist.jsx',
  'src/pages/EventDetail.jsx',
  'src/pages/Home.jsx',
  'src/pages/InstantListingsGuide.jsx',
  'src/pages/FounderBetaChecklist.jsx',
  'src/pages/PurchaseSuccess.jsx',
  'src/pages/SellerPayoutGuide.jsx',
  'src/pages/WhyPeanutGallery.jsx',
];

test('customer-facing payment copy does not describe a Stripe authorization as escrow', () => {
  for (const path of customerFacingFiles) {
    const source = read(path).replace('This is not a bank escrow account.', '');
    assert.doesNotMatch(source, /escrow/i, path);
  }
});

test('onboarding avoids unsupported zero-risk, worldwide, and exclusivity promises', () => {
  const source = read('src/components/Onboarding.jsx');
  for (const claim of [
    'ZERO RISK',
    'Scammers can\'t win here',
    'anywhere in the world',
    'The only app',
    'the only place',
    'No scalpers',
  ]) {
    assert.equal(source.includes(claim), false, claim);
  }
  assert.match(source, /supported U\.S\. events/);
  assert.match(source, /authorization hold/);
});

test('custody guide says the authorization is not a bank escrow account', () => {
  const source = read('src/pages/InstantListingsGuide.jsx');
  assert.match(source, /This is not a bank escrow account\./);
  assert.doesNotMatch(source, /guaranteed delivery/i);
  assert.doesNotMatch(source, /Instant Transfer listings are available for all events/i);
});
