import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { titleForRoute } from '../src/lib/routeMetadata.js';
test('every production route has an intentional title, with no private IDs or stale Final suffix', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const routes = [...app.matchAll(/<Route path="([^"]+)"/g)].map(m => m[1]);
  assert.equal(routes.length, 39);
  for (const route of routes) {
    const path = route.replace(/:[^/]+/g, 'fictional-private-id');
    const title = titleForRoute(path);
    assert.ok(title.endsWith(' | Peanut Gallery'));
    assert.doesNotMatch(title, /Final|fictional-private-id/);
    if (route !== '*') assert.doesNotMatch(title, /Page Not Found/);
  }
});
test('payout guide links to a disclosure without starting onboarding', async () => {
  const guide = await readFile(new URL('../src/pages/SellerPayoutGuide.jsx', import.meta.url), 'utf8');
  const settings = await readFile(new URL('../src/pages/AccountSettingsPage.jsx', import.meta.url), 'utf8');
  assert.match(guide, /to="\/account-settings#payouts"/);
  assert.match(settings, /defaultOpen=\{showPayouts\}/);
  assert.doesNotMatch(settings, /invoke\(['"]onboardSeller/);
});
