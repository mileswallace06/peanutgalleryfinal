import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { findLegalFragment, scrollLegalFragment } from '../src/lib/legalDocument.js';
import { REFUND_POLICY_COPY, REFUND_POLICY_REVIEW } from '../src/lib/refundPolicyCopy.js';

const fakeRoot = elements => ({ querySelectorAll: () => elements });
const element = (id, name) => ({ id, getAttribute: key => key === 'name' ? name : null });

test('legal fragments match exact IDs and legacy named anchors without selector interpolation', () => {
  const byId = element('returnno');
  const byName = element('', 'cookies-and-policy');
  const punctuation = element('section:one [special]');
  const root = fakeRoot([byId, byName, punctuation]);
  assert.equal(findLegalFragment(root, '#returnno'), byId);
  assert.equal(findLegalFragment(root, '#cookies-and-policy'), byName);
  assert.equal(findLegalFragment(root, '#section%3Aone%20%5Bspecial%5D'), punctuation);
  assert.equal(findLegalFragment(root, '#unknown'), null);
  assert.equal(findLegalFragment(root, '#%E0%A4%A'), null);
  assert.equal(findLegalFragment(root, '#'), null);
});

test('legal fragment scroll accounts for internal scroller and actual sticky header and focuses target heading', () => {
  const calls = [];
  const heading = {
    hasAttribute: () => false,
    setAttribute: (...args) => calls.push(['attribute', ...args]),
    focus: options => calls.push(['focus', options]),
  };
  const target = { matches: () => false, querySelector: () => heading, getBoundingClientRect: () => ({ top: 360 }) };
  const scroller = {
    scrollTop: 500,
    style: { setProperty: (...args) => calls.push(['style', ...args]) },
    querySelector: () => ({ getBoundingClientRect: () => ({ height: 76 }) }),
    getBoundingClientRect: () => ({ top: 10 }),
    scrollTo: options => calls.push(['scroll', options]),
  };
  assert.equal(scrollLegalFragment(scroller, target), true);
  assert.deepEqual(calls, [
    ['style', '--pg-public-scroll-offset', '92px'],
    ['scroll', { top: 758, behavior: 'instant' }],
    ['attribute', 'tabindex', '-1'],
    ['focus', { preventScroll: true }],
  ]);
});

test('missing/legal top targets are safe; optional focus never steals user focus', () => {
  let top;
  const target = { getBoundingClientRect: () => ({ top: 0 }) };
  const scroller = { scrollTop: 0, style: { setProperty() {} }, querySelector: () => null, getBoundingClientRect: () => ({ top: 0 }), scrollTo: options => { top = options.top; } };
  assert.equal(scrollLegalFragment(scroller, null), false);
  assert.equal(scrollLegalFragment(null, target), false);
  assert.equal(scrollLegalFragment(scroller, target, { focus: false }), true);
  assert.equal(top, 0);
});

test('refund policy remains explicitly unapproved and centralized without inventing commitments', async () => {
  assert.equal(REFUND_POLICY_REVIEW.status, 'owner-decision-required');
  assert.equal(REFUND_POLICY_REVIEW.approvedWording, null);
  assert.equal(REFUND_POLICY_COPY.terms, 'All sales are final and no refund will be issued.');
  assert.match(REFUND_POLICY_COPY.fraudulentTicketFaq, /buyer receives a full refund/);
  assert.match(REFUND_POLICY_COPY.sellerCancellationFaq, /buyer receives a full refund/);
  const tos = await readFile(new URL('../src/lib/tosHtml.js', import.meta.url), 'utf8');
  const faq = await readFile(new URL('../src/pages/WhyPeanutGallery.jsx', import.meta.url), 'utf8');
  assert.ok(tos.includes('${REFUND_POLICY_COPY.terms}'));
  assert.match(faq, /a: REFUND_POLICY_COPY\.fraudulentTicketFaq/);
  assert.match(faq, /a: REFUND_POLICY_COPY\.sellerCancellationFaq/);
});

test('all legal pages provide a named main landmark and Terms source no longer adds a second document h1', async () => {
  for (const [page, title] of [['TermsOfService', 'terms'], ['PrivacyPolicy', 'privacy'], ['CookiePolicy', 'cookies']]) {
    const source = await readFile(new URL(`../src/pages/${page}.jsx`, import.meta.url), 'utf8');
    assert.match(source, new RegExp(`<main aria-labelledby="${title}-title"`));
    assert.match(source, new RegExp(`<h1 id="${title}-title"`));
  }
  const tos = await readFile(new URL('../src/lib/tosHtml.js', import.meta.url), 'utf8');
  assert.doesNotMatch(tos, /<h1>/);
});
