import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminAccess } from '../src/lib/adminAccess.js';

const admin = { id: 'admin-1', role: 'admin' };
const verified = {
  user: admin,
  authChecked: true,
  isAuthenticated: true,
  isLoadingAuth: false,
  authError: null,
};

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('admin access opens only for a completed successful admin authentication', () => {
  assert.equal(adminAccess(verified), 'admin');
  assert.equal(adminAccess({ ...verified, user: { role: 'Admin' } }), 'denied');
  assert.equal(adminAccess({ ...verified, user: { role: 'user' } }), 'denied');
  assert.equal(adminAccess({ ...verified, user: null }), 'denied');
});

test('loading, unresolved, stale, and errored authentication fail closed', () => {
  assert.equal(adminAccess(), 'checking');
  assert.equal(adminAccess({ ...verified, isLoadingAuth: true }), 'checking');
  assert.equal(adminAccess({ ...verified, authChecked: false }), 'checking');
  assert.equal(adminAccess({ ...verified, authChecked: false, authError: { type: 'unknown' } }), 'denied');
  assert.equal(adminAccess({ ...verified, isAuthenticated: false }), 'denied');
  assert.equal(adminAccess({ ...verified, authError: { type: 'unknown' } }), 'denied');
});

test('executable client source contains no hardcoded admin password or storage bypass', () => {
  const srcDir = new URL('../src/', import.meta.url);
  const executable = readdirSync(srcDir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && ['.js', '.jsx', '.ts', '.tsx'].includes(extname(entry.name)))
    .map(entry => join(entry.parentPath, entry.name));

  for (const file of executable) {
    const contents = readFileSync(file, 'utf8');
    assert.doesNotMatch(contents, /ADMIN_PASSWORD|pg_admin_unlocked|peanut2026/, file);
  }
});

test('every protected admin or beta page uses the fail-closed access resolver', () => {
  for (const file of [
    'src/pages/AdminMode.jsx',
    'src/pages/AdminCommandCenter.jsx',
    'src/pages/FounderDashboard.jsx',
    'src/pages/FounderBetaChecklist.jsx',
    'src/pages/BetaRecruitment.jsx',
    'src/pages/BetaQA.jsx',
  ]) {
    assert.match(source(file), /adminAccess\(auth\)/, file);
  }

  const recruitment = source('src/pages/BetaRecruitment.jsx');
  assert.ok(
    recruitment.indexOf("if (access !== 'admin') return;") < recruitment.indexOf('base44.entities.BetaTester.list'),
    'BetaTester records must not load before verified admin access',
  );

  const legacy = source('src/pages/AdminMode.jsx');
  assert.ok(
    legacy.indexOf("if (access !== 'admin') return;") < legacy.indexOf('loadData();'),
    'legacy admin data must not load before verified admin access',
  );
});

test('event admin affordances and navigation telemetry no longer trust session storage', () => {
  const detail = source('src/pages/EventDetail.jsx');
  const logger = source('src/lib/navLogger.js');
  assert.match(detail, /isVerifiedAdmin = adminAccess\(auth\) === 'admin'/);
  assert.match(logger, /base44\.auth\.me\(\{ fresh: true \}\)/);
  assert.doesNotMatch(`${detail}\n${logger}`, /pg_admin_unlocked/);
});
