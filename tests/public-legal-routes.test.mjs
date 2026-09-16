import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIC_LEGAL_PATHS } from '../src/lib/publicLegalRoutes.js';

const readSource = relativePath => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('the public/legal route contract contains only the intended exact paths', () => {
  assert.deepEqual(PUBLIC_LEGAL_PATHS, {
    terms: '/terms',
    privacy: '/privacy',
    cookies: '/cookies',
    ourStory: '/our-story',
  });
  assert.equal(Object.isFrozen(PUBLIC_LEGAL_PATHS), true);
});

test('auth-required and authenticated routing share the same lazy public route renderer', async () => {
  const source = await readSource('src/App.jsx');
  assert.match(source, /authError\.type === 'auth_required'/);
  assert.match(source, /<Suspense fallback={<RouteFallback \/>}>\s*<Routes>\s*{renderPublicLegalRoutes\(\)}/s);
  assert.equal((source.match(/{renderPublicLegalRoutes\(\)}/g) || []).length, 2);
  assert.match(source, /PUBLIC_LEGAL_PATHS\.terms/);
  assert.match(source, /PUBLIC_LEGAL_PATHS\.privacy/);
  assert.match(source, /PUBLIC_LEGAL_PATHS\.cookies/);
  assert.match(source, /PUBLIC_LEGAL_PATHS\.ourStory/);
});

test('privacy policy has visible loading, timeout failure, retry, and contact states', async () => {
  const source = await readSource('src/pages/PrivacyPolicy.jsx');
  assert.match(source, /POLICY_LOAD_TIMEOUT_MS = 12000/);
  assert.match(source, /role="status"/);
  assert.match(source, /Loading the privacy policy/);
  assert.match(source, /role="alert"/);
  assert.match(source, /Privacy policy temporarily unavailable/);
  assert.match(source, /setLoadAttempt\(attempt => attempt \+ 1\)/);
  assert.match(source, /mailto:\$\{POLICY_SUPPORT_EMAIL}/);
  assert.match(source, /MutationObserver/);
});

