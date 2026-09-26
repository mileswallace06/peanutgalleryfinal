import test from 'node:test';
import assert from 'node:assert/strict';
import { memberAccess } from '../src/lib/memberAccess.js';

const member = { isAuthenticated: true, user: { id: 'existing-member' } };
test('anonymous success from public settings does not grant member access', () => {
  assert.equal(memberAccess({ isAuthenticated: false, authError: null }), 'login');
});
test('stale user after rejection, timeout or network failure cannot grant access', () => {
  assert.equal(memberAccess({ ...member, isAuthenticated: false }), 'login');
  assert.equal(memberAccess({ ...member, authError: { type: 'auth_required' } }), 'login');
  assert.equal(memberAccess({ ...member, authError: { type: 'unknown' } }), 'unavailable');
});
test('member content waits for both outstanding checks', () => {
  assert.equal(memberAccess({ ...member, isLoadingAuth: true }), 'loading');
  assert.equal(memberAccess({ ...member, isLoadingPublicSettings: true }), 'loading');
});
test('provider rejection and disabled accounts do not inherit old member access', () => {
  assert.equal(memberAccess({ ...member, authError: { type: 'user_not_registered' } }), 'unregistered');
  assert.equal(memberAccess({ ...member, user: { id: 'existing-member', disabled: true } }), 'login');
});
test('only verified current account mounts member routes', () => {
  assert.equal(memberAccess(member), 'member');
  assert.equal(memberAccess({ isAuthenticated: true, user: {} }), 'login');
  assert.equal(memberAccess({ isAuthenticated: true, user: null }), 'login');
});
