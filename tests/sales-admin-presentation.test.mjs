import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import * as dateFns from 'date-fns';
import * as salesPresentation from '../src/lib/salesPresentation.js';
import * as queuePresentation from '../src/lib/adminQueuePresentation.js';
import { isVerificationExpired } from '../src/lib/transferConfidence.js';

const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value == null || value === false ? [] : [value, ...nodes(value.props?.children)];
const text = value => nodes(value).filter(v => typeof v === 'string' || typeof v === 'number').join(' ');
function element(type, props, ...children) {
  return typeof type === 'function' ? type({ ...props, children }) : { type, props: { ...props, children } };
}
async function renderHarness(path, dependencies = {}, initialState = []) {
  const state = [...initialState];
  let slot = 0;
  const effects = [];
  const react = {
    useState(initial) {
      const current = slot++;
      if (!(current in state)) state[current] = typeof initial === 'function' ? initial() : initial;
      return [state[current], next => { state[current] = typeof next === 'function' ? next(state[current]) : next; }];
    },
    useEffect(callback) { effects.push(callback); },
    useCallback(callback) { return callback; },
  };
  const known = {
    react,
    'date-fns': dateFns,
    'lucide-react': new Proxy({}, { get: (_, name) => name }),
    'react-router-dom': { Link: 'a', Navigate: 'navigate' },
    '@/lib/salesPresentation': salesPresentation,
    '@/lib/adminQueuePresentation': queuePresentation,
    '@/lib/transferConfidence': { isVerificationExpired },
    '@/components/sales/SellerMetrics': { default: 'seller-metrics' },
    '@/components/listings/ListingStatusBanner': { default: 'listing-status' },
    '@/components/sales/ListingShareControl': { default: 'listing-share' },
    '@/components/ClarityUI': { PageIntro: 'page-intro', Disclosure: 'disclosure' },
    ...dependencies,
  };
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { code } = await transform(source, { loader: 'jsx', format: 'cjs', jsxFactory: 'h', jsxFragment: 'Fragment' });
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, h: element, Fragment: 'fragment', console,
    require(name) {
      if (name.endsWith('.css')) return {};
      if (!(name in known)) throw new Error(`Unmocked dependency ${name}`);
      return known[name];
    },
  });
  return { effects, state, render(props = {}) { slot = 0; return module.exports.default(props); } };
}

const sale = { id: 'fixture-sale-a', event_id: 'fixture-deleted-event', listing_id: 'fixture-archived-listing', transfer_status: 'completed', seller_payout: 48, amount: 52, payment_captured: true, created_date: '2026-10-01T12:00:00Z' };

test('completed seller summary includes archived history, excludes demos and flags missing amounts', () => {
  const summary = salesPresentation.summarizeSellerHistory([
    sale, { ...sale, id: 'fixture-sale-b', seller_payout: null, seller_confirmed: false },
    { ...sale, id: 'demo', is_demo: true, seller_payout: 1000 },
    { ...sale, id: 'pending', transfer_status: 'pending_transfer', seller_payout: 1000 },
  ]);
  assert.deepEqual(summary, { completedCount: 2, recordedAmount: 48, missingAmounts: 1 });
  assert.deepEqual(salesPresentation.summarizeSellerHistory([]), { completedCount: 0, recordedAmount: 0, missingAmounts: 0 });
  assert.equal(salesPresentation.formatRecordedAmount(null), 'Amount unavailable');
  assert.equal(salesPresentation.formatRecordedAmount(0), '$0.00');
  assert.equal(salesPresentation.formatRecordedAmount(NaN), 'Amount unavailable');
});

test('capture and ticket transfer are never treated as bank payout evidence', () => {
  assert.equal(salesPresentation.salePaymentStatus(sale).label, 'Payment captured');
  assert.equal(salesPresentation.salePaymentStatus({ payment_captured: false }).label, 'Payment capture not confirmed');
  assert.equal(salesPresentation.salePaymentStatus({}).label, 'Payment status unavailable');
  assert.equal(salesPresentation.salePaymentStatus({ payment_captured: true, payment_capture_failed: true }).label, 'Payment capture failed');
  for (const s of [sale, {}, { payment_captured: false }, { payment_capture_failed: true }]) {
    assert.doesNotMatch(salesPresentation.salePaymentStatus(s).label, /paid out|deposited|not yet captured/);
  }
});

test('payout display requires explicit payout evidence and exposes checking/error/retry truthfully', async () => {
  let retries = 0;
  const sdk = { functions: { invoke: async () => { throw new Error('Unexpected Stripe onboarding action'); } } };
  const harness = await renderHarness('../src/components/account/StripePayoutSection.jsx', { '@/api/base44Client': { base44: sdk } });
  const base = { defaultOpen: true, onRetry: () => { retries++; }, stripeStatus: { details_submitted: true, charges_enabled: true } };
  const checking = text(harness.render({ ...base, loading: true }));
  assert.match(checking, /Checking Stripe status/);
  assert.doesNotMatch(checking, /Not connected|Payouts enabled|Stripe Setup/);
  const failed = harness.render({ ...base, error: true });
  assert.match(text(failed), /Stripe status unavailable/);
  assert.doesNotMatch(text(failed), /Not connected|Payouts enabled|Stripe Setup/);
  nodes(failed).find(n => n.type === 'button' && text(n).includes('Retry Stripe status')).props.onClick();
  assert.equal(retries, 1);
  const unknown = text(harness.render(base));
  assert.match(unknown, /Payout status not confirmed/);
  assert.match(unknown, /Charges enabled/);
  assert.doesNotMatch(unknown, /Payouts enabled|payouts routed automatically/i);
  const disabled = text(harness.render({ ...base, stripeStatus: { ...base.stripeStatus, payouts_enabled: false } }));
  assert.match(disabled, /Payouts disabled/);
  assert.doesNotMatch(disabled, /Payouts enabled/);
  const enabled = text(harness.render({ ...base, stripeStatus: { ...base.stripeStatus, payouts_enabled: true } }));
  assert.match(enabled, /Payouts enabled/);
  assert.match(enabled, /does not confirm any individual bank deposit/);
  const incomplete = text(harness.render({ ...base, stripeStatus: { details_submitted: false, charges_enabled: false } }));
  assert.match(incomplete, /Stripe setup incomplete/);
  assert.doesNotMatch(incomplete, /Not connected/);
});

test('sparse same-amount same-date sales remain distinguishable by full authorized reference', () => {
  const first = salesPresentation.saleIdentity(sale);
  const second = salesPresentation.saleIdentity({ ...sale, id: 'fixture-sale-b' });
  assert.notEqual(first.reference, second.reference);
  assert.equal(first.title, 'Event details unavailable');
  assert.equal(first.eventLabel, '');
  const known = salesPresentation.saleIdentity(sale, { title: 'Fictional performance', venue: 'Fictional hall', event_start_utc: '2026-10-06T20:00:00Z', venue_timezone: 'America/Phoenix' }, { section: '104', row: 'B', seats: '7–8' });
  assert.match(known.eventLabel, /1:00 PM MST/);
  assert.equal(known.venue, 'Fictional hall');
  assert.match(known.seats, /Section 104 · Row B · Seats 7–8/);
});

test('MySales distinguishes inaccessible metadata from failed reads and retry restores identity', async () => {
  let failHydration = false;
  let restored = false;
  const calls = [];
  const sdk = {
    auth: { me: async () => ({ id: 'fixture-seller' }) },
    functions: { invoke: async (name, args) => {
      calls.push([name, args.action]);
      if (name === 'getListingParticipantView') return { data: { listings: [] } };
      if (name === 'getPurchaseParticipantView') return { data: { sales: [sale, { ...sale, id: 'fixture-sale-b', seller_payout: null }] } };
      throw new Error(`Forbidden fixture SDK call ${name}`);
    } },
    entities: { Event: { filter: async () => {
      if (failHydration) throw new Error('Fixture read failure');
      return restored ? [{ title: 'Restored fixture event', venue: 'Fictional hall' }] : [];
    } } },
  };
  const harness = await renderHarness('../src/pages/MySales.jsx', { '@/api/base44Client': { base44: sdk } });
  assert.match(text(harness.render()), /Loading your sales/);
  await harness.effects[0]();
  // Effects start the async loader; settle its participant and hydration reads.
  await new Promise(resolve => setImmediate(resolve));
  let page = harness.render();
  assert.match(text(page), /Sale reference: fixture-sale-a/);
  assert.match(text(page), /Sale reference: fixture-sale-b/);
  assert.match(text(page), /metadata is missing or no longer accessible/);
  assert.match(text(page), /Recorded seller amount:\s+Amount unavailable/);
  assert.doesNotMatch(text(page), /paid out|Stripe deposits/);
  failHydration = true;
  await harness.effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  page = harness.render();
  assert.match(text(page), /Event details could not be loaded/);
  const retry = nodes(page).find(n => n.type === 'button' && text(n).includes('Retry event details'));
  assert.ok(retry);
  failHydration = false; restored = true;
  await retry.props.onClick();
  assert.match(text(harness.render()), /Restored fixture event/);
  assert.ok(calls.every(([name]) => name.startsWith('get')));
});

test('settings shows unavailable and incomplete amounts instead of verified zero earnings', async () => {
  const harness = await renderHarness('../src/components/account/TransactionHistorySection.jsx');
  assert.match(text(harness.render({ purchases: [], sales: [], status: 'loading' })), /Loading/);
  assert.doesNotMatch(text(harness.render({ purchases: [], sales: [], status: 'error' })), /\$0\.00/);
  const partial = text(harness.render({ purchases: [], sales: [sale, { ...sale, id: 'b', seller_payout: null }], status: 'ready' }));
  assert.match(partial, /Amount incomplete/);
  assert.match(partial, /not confirmed bank payouts/);
  assert.doesNotMatch(partial, /Earned/);
});

test('independent queue summaries retain open work when transaction feed is clear', () => {
  assert.equal(queuePresentation.summarizeAdminQueue('alerts', [{ resolved: false }, { resolved: true }]).count, 1);
  assert.equal(queuePresentation.summarizeAdminQueue('reviews', [{ id: 'review' }]).count, 1);
  assert.equal(queuePresentation.summarizeAdminQueue('transfers', [{ status: 'active' }, { status: 'sold' }]).count, 1);
  assert.equal(queuePresentation.queueStatusLabel({ status: 'error' }), 'Unavailable — retry');
  assert.equal(queuePresentation.queueStatusLabel(), 'Loading…');
  assert.equal(queuePresentation.queueStatusLabel(queuePresentation.summarizeAdminQueue('alerts', [])), '0 in loaded records');
  assert.throws(() => queuePresentation.summarizeAdminQueue('alerts', null));
});

test('empty transaction issue feed is scoped and read errors never render all-clear', async () => {
  const harness = await renderHarness('../src/components/admin/cc/IssueFeed.jsx', { '@/api/base44Client': { base44: {} } });
  const props = { purchases: [], listings: [], events: {}, donations: [] };
  const clear = text(harness.render(props));
  assert.match(clear, /No matching issues in the loaded transaction feed/);
  assert.match(clear, /does not clear the separate alert, review or transfer intelligence queues/);
  assert.doesNotMatch(clear, /Everything looks healthy/);
  assert.match(text(harness.render({ ...props, loading: true })), /Loading transaction issues/);
  const failed = text(harness.render({ ...props, error: true }));
  assert.match(failed, /could not be loaded/);
  assert.doesNotMatch(failed, /No matching issues/);
});

test('admin event fallback keeps full stable reference instead of Unknown Event', () => {
  assert.equal(salesPresentation.adminEventIdentity(null, 'fixture-full-reference'), 'Event details unavailable · Event reference: fixture-full-reference');
  assert.equal(salesPresentation.adminEventIdentity({ title: 'Fictional event' }, 'fixture-id'), 'Fictional event');
});

test('admin dashboard renders independent queue indicators and preserves partial queue errors', async () => {
  let alertFailure = false;
  const sdk = {
    entities: {
      Purchase: { list: async () => [] },
      SeatDonation: { list: async () => [] },
      Listing: {
        list: async (_sort, limit) => limit === 200 ? [{ id: 'fixture-reverify', status: 'active' }] : [],
        filter: async query => {
          assert.equal(query.proof_status, 'pending_review');
          return [{ id: 'fixture-review' }];
        },
      },
      AdminAlert: { list: async () => { if (alertFailure) throw new Error('Fixture queue failure'); return [{ id: 'fixture-alert', resolved: false }]; } },
      Event: { filter: async () => [] },
    },
    functions: { invoke: async name => {
      assert.equal(name, 'getStripeMode');
      return { data: { mode: 'test' } };
    } },
  };
  const source = await readFile(new URL('../src/pages/AdminCommandCenter.jsx', import.meta.url), 'utf8');
  const adminDependencies = Object.fromEntries([...source.matchAll(/import (\w+) from '(@\/components\/admin\/[^']+)';/g)].map(([, name, path]) => [path, { default: name }]));
  const harness = await renderHarness('../src/pages/AdminCommandCenter.jsx', {
    ...adminDependencies,
    '@/api/base44Client': { base44: sdk },
    '@/lib/isAdmin': { isAdmin: () => true },
    '@/lib/AuthContext': { useAuth: () => ({ user: { id: 'fixture-admin' }, isLoadingAuth: false }) },
  });
  assert.match(text(harness.render()), /Loading transaction summary/);
  harness.effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  let page = harness.render();
  assert.equal((text(page).match(/1 in loaded records/g) || []).length, 3);
  assert.match(text(page), /Counts are not global totals/);
  alertFailure = true;
  await nodes(page).find(n => n.type === 'button' && n.props['aria-label'] === 'Refresh admin dashboard and queues').props.onClick();
  page = harness.render();
  assert.match(text(page), /Unavailable — retry/);
  assert.equal((text(page).match(/1 in loaded records/g) || []).length, 2);
  assert.doesNotMatch(text(page), /Transaction summary unavailable/);
});

test('summary cards name the transaction/custody scope instead of clearing other review queues', async () => {
  const harness = await renderHarness('../src/components/admin/cc/CommandSummaryBar.jsx');
  const summary = text(harness.render({ purchases: [], listings: [], donations: [], stripeMode: { consistent: true, overallMode: 'test' } }));
  assert.match(summary, /Transaction & custody review/);
  assert.match(summary, /None in loaded feed/);
  assert.match(summary, /Separate alert, listing-review and reverification queues are below/);
  assert.doesNotMatch(summary, /Key mismatch/);
});
