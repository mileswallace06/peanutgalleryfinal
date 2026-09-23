import test from 'node:test';
import assert from 'node:assert/strict';
import { authPageHref, createAuthSubmission, performBrandedAuth, safeAuthReturn } from '../src/lib/brandedAuth.js';

const origin = 'https://peanutgallery.store';
function setup(overrides = {}) {
  const calls = [];
  const auth = Object.fromEntries(['loginViaEmailPassword', 'register', 'verifyOtp', 'resendOtp', 'resetPasswordRequest', 'resetPassword', 'loginWithProvider'].map(name => [name, async (...args) => { calls.push([name, ...args]); }]));
  return { calls, options: { auth, origin, returnTo: '/my-tickets', checkUserAuth: async () => { calls.push(['refresh']); return { id: 'existing-user' }; }, navigate: (...args) => calls.push(['navigate', ...args]), ...overrides } };
}

test('returns only local destinations and rejects auth loops, API routes and hostile forms', () => {
  assert.equal(safeAuthReturn('/events?city=Denver#nearby', origin), '/events?city=Denver#nearby');
  assert.equal(safeAuthReturn(`${origin}/my-tickets`, origin), '/my-tickets');
  for (const input of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/login?from_url=/events', '/register/', '/%6cogin', '/api/data', '/%2f/evil.example', '\nhttps://evil.example', null]) {
    assert.equal(safeAuthReturn(input, origin), '/events', String(input));
  }
  for (const key of ['access_token', 'token', 'app_id', 'app_base_url', 'functions_version', 'clear_access_token', 'from_url']) {
    assert.equal(safeAuthReturn(`/my-tickets?${key}=injected`, origin), '/events', key);
    assert.equal(safeAuthReturn(`${origin}/my-tickets?city=Denver&${key.toUpperCase()}=injected`, origin), '/events', key);
  }
  assert.equal(safeAuthReturn('/my-tickets?%61ccess_token=injected', origin), '/events');
  assert.equal(authPageHref('/login', '/events?city=Denver'), '/login?from_url=%2Fevents%3Fcity%3DDenver');
});

test('existing email user logs in through SDK, refreshes identity then navigates; never registers', async () => {
  const { calls, options } = setup();
  assert.deepEqual(await performBrandedAuth({ ...options, action: 'login', input: { email: ' fan@example.test ', password: 'private-test-value' } }), { ok: true });
  assert.deepEqual(calls, [['loginViaEmailPassword', 'fan@example.test', 'private-test-value', undefined], ['refresh'], ['navigate', '/my-tickets', { replace: true }]]);
});

test('login failure redacts provider text and never refreshes or navigates', async () => {
  const { calls, options } = setup();
  options.auth.loginViaEmailPassword = async () => { throw new Error('credential private-test-value for known account fan@example.test'); };
  const result = await performBrandedAuth({ ...options, action: 'login', input: { email: 'fan@example.test', password: 'private-test-value' } });
  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify(result), /private-test-value|fan@example.test|known account/);
  assert.deepEqual(calls, []);
});

test('failed fresh identity cannot navigate even after successful credential submission', async () => {
  for (const checkUserAuth of [async () => null, async () => { throw new Error('identity unavailable'); }]) {
    const { calls, options } = setup({ checkUserAuth });
    const result = await performBrandedAuth({ ...options, action: 'login', input: { email: 'fan@example.test', password: 'example' } });
    assert.equal(result.ok, false);
    assert.equal(calls.some(([name]) => name === 'navigate'), false);
  }
});

test('registration sends the documented payload and transitions to OTP without logging in', async () => {
  const { calls, options } = setup();
  const result = await performBrandedAuth({ ...options, action: 'register', input: { email: 'fan@example.test', password: 'example', turnstileToken: 'test-captcha' } });
  assert.equal(result.nextStep, 'verify');
  assert.deepEqual(calls, [['register', { email: 'fan@example.test', password: 'example', turnstile_token: 'test-captcha' }]]);
});

test('OTP success requests a fresh sign-in; invalid codes do not advance', async () => {
  const { calls, options } = setup();
  const result = await performBrandedAuth({ ...options, action: 'verify', input: { email: 'fan@example.test', otpCode: ' 123456 ' } });
  assert.equal(result.nextStep, 'login');
  assert.deepEqual(calls, [['verifyOtp', { email: 'fan@example.test', otpCode: '123456' }]]);
  options.auth.verifyOtp = async () => { throw new Error('private provider trace'); };
  const rejected = await performBrandedAuth({ ...options, action: 'verify', input: { email: 'fan@example.test', otpCode: 'bad' } });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.nextStep, undefined);
  assert.doesNotMatch(rejected.message, /trace/);
});

test('recovery and resend conceal account existence for both success and rejection', async () => {
  for (const [action, method] of [['forgot', 'resetPasswordRequest'], ['resend', 'resendOtp']]) {
    const { options } = setup();
    const params = { ...options, action, input: { email: 'fan@example.test' } };
    const successful = await performBrandedAuth(params);
    options.auth[method] = async () => { throw new Error('unknown account fan@example.test'); };
    assert.deepEqual(await performBrandedAuth(params), successful);
  }
});

test('reset requires an explicit token and delegates to SDK without silently logging in', async () => {
  const { calls, options } = setup();
  assert.equal((await performBrandedAuth({ ...options, action: 'reset', input: { password: 'new-example' } })).ok, false);
  assert.deepEqual(calls, []);
  const result = await performBrandedAuth({ ...options, action: 'reset', input: { resetToken: 'test-reset-token', password: 'new-example' } });
  assert.equal(result.nextStep, 'login');
  assert.deepEqual(calls, [['resetPassword', { resetToken: 'test-reset-token', newPassword: 'new-example' }]]);
});

test('Google and Apple use safe SDK redirects and allow manual retry when popup call resolves without navigation', async () => {
  for (const provider of ['google', 'apple']) {
    const { calls, options } = setup({ returnTo: 'https://evil.example' });
    const submit = createAuthSubmission();
    const request = () => performBrandedAuth({ ...options, action: 'provider', input: { provider } });
    const result = await submit(request);
    assert.equal(result.ok, false);
    assert.equal(result.retryable, true);
    assert.equal(result.redirecting, undefined);
    assert.match(result.message, /select your provider again/);
    assert.deepEqual(calls, [['loginWithProvider', provider, `${origin}/events`]]);
    assert.equal((await submit(request)).retryable, true);
    assert.equal(calls.length, 2);
  }
});

test('unsupported providers cannot trigger SDK navigation', async () => {
  const { calls, options } = setup();
  assert.equal((await performBrandedAuth({ ...options, action: 'provider', input: { provider: 'other' } })).ok, false);
  assert.deepEqual(calls, []);
});

test('expired reset, registration rejection and failed provider start expose only fixed messages', async () => {
  for (const [action, method, input] of [
    ['reset', 'resetPassword', { resetToken: 'example-reset-token', password: 'example-password' }],
    ['register', 'register', { email: 'fan@example.test', password: 'example-password' }],
    ['provider', 'loginWithProvider', { provider: 'google' }],
  ]) {
    const { calls, options } = setup();
    options.auth[method] = async () => { throw new Error('private: example-password example-reset-token fan@example.test'); };
    const result = await performBrandedAuth({ ...options, action, input });
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /private:|example-password|example-reset-token|fan@example.test/);
    assert.equal(result.nextStep, undefined);
    assert.deepEqual(calls, []);
  }
});

test('submission guard blocks same-frame duplicate actions and releases after rejection', async () => {
  const submit = createAuthSubmission();
  let release;
  let count = 0;
  const first = submit(() => { count++; return new Promise(resolve => { release = resolve; }); });
  assert.deepEqual(await submit(() => { count++; }), { skipped: true });
  release('done');
  assert.equal(await first, 'done');
  await assert.rejects(submit(async () => { throw new Error('failure'); }));
  assert.equal(await submit(async () => ++count), 2);
});
