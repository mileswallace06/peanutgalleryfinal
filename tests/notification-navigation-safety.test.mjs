import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { getSafeNotificationRoute } from '../src/lib/notificationRoute.js';

test('allows known notification destinations emitted by the backend', () => {
  for (const route of [
    '/my-sales',
    '/my-tickets',
    '/purchase/purchase_123',
    '/upgrades/event-123',
    '/events/tm/Z7r9jZ1Ad',
  ]) {
    assert.equal(getSafeNotificationRoute(route), route);
  }
});

test('fails closed for external, malformed, stateful, and nonexistent routes', () => {
  for (const route of [
    'https://evil.example/path',
    '//evil.example/path',
    'javascript:alert(1)',
    '/leaderboard?tab=community',
    '/purchase/abc#details',
    '/purchase/%2e%2e/events',
    '/purchase/abc/extra',
    '/not-a-real-screen',
    '/events\\evil',
    ' /events',
    '',
    null,
  ]) {
    assert.equal(getSafeNotificationRoute(route), null, String(route));
  }
});

test('notification opening uses one read handler and never routes raw persisted data', async () => {
  const source = await readFile(new URL('../src/pages/Notifications.jsx', import.meta.url), 'utf8');
  assert.equal(source.includes('to={notif.action_url}'), false);
  assert.equal(source.includes('to={safeActionUrl}'), true);
  assert.equal((source.match(/onMarkRead\(notif\.id\)/g) || []).length, 1);
  assert.match(source, /markReadInFlight\.current\.has\(id\)/);
  assert.match(source, /markedReadIds\.current\.has\(id\)/);
  assert.match(source, /await base44\.entities\.Notification\.update\(id, \{ read: true \}\);[\s\S]*setNotifs/);
});

test('community impact links to an existing leaderboard screen without a nonexistent tab', async () => {
  const source = await readFile(new URL('../src/components/donations/CommunityImpactCard.jsx', import.meta.url), 'utf8');
  assert.match(source, /<Link to="\/leaderboard"/);
  assert.equal(source.includes('/leaderboard?tab=community'), false);
});
