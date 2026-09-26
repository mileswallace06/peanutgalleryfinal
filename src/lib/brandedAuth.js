const AUTH_PATHS = new Set(['/login', '/register', '/forgot-password', '/reset-password']);
const AUTH_CONTROL_QUERY_KEYS = new Set([
  'access_token', 'token', 'app_id', 'app_base_url', 'functions_version', 'clear_access_token', 'from_url',
]);

// Return a local destination, never a URL supplied by another origin.
export function safeAuthReturn(value, origin) {
  if (typeof value !== 'string' || !value.trim() || /[\\\u0000-\u001f\u007f]/.test(value)) return '/events';
  try {
    const base = new URL(origin);
    const target = new URL(value, base);
    const path = decodeURIComponent(target.pathname).replace(/\/+$/, '') || '/';
    if (!['http:', 'https:'].includes(base.protocol)
      || target.origin !== base.origin || target.username || target.password
      || /[\\\u0000-\u001f\u007f]/.test(path) || path.startsWith('//') || path.startsWith('/api/') || path === '/api'
      || AUTH_PATHS.has(path.toLowerCase())
      || [...target.searchParams.keys()].some(key => AUTH_CONTROL_QUERY_KEYS.has(key.toLowerCase()))) return '/events';
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return '/events';
  }
}

export function authPageHref(path, returnTo) {
  return `${path}?${new URLSearchParams({ from_url: returnTo })}`;
}

// React state updates are asynchronous; a closure also prevents a second submit
// in the same frame, including a provider button racing an email submit.
export function createAuthSubmission() {
  let pending = false;
  return async (action) => {
    if (pending) return { skipped: true };
    pending = true;
    try {
      return await action();
    } finally {
      pending = false;
    }
  };
}

const FORGOT_MESSAGE = 'If this email has an account that supports password sign-in, you will receive a reset link. Check your inbox and spam folder.';
const RESEND_MESSAGE = 'If a verification code can be sent to this address, it will arrive shortly. Check your inbox and spam folder.';

const FAILURE_MESSAGES = Object.freeze({
  login: 'We couldn’t sign you in. Check your details or use “Forgot password?” to recover access.',
  register: 'We couldn’t complete registration. Try again, or sign in if you already have an account.',
  verify: 'We couldn’t verify that code. Try again or request a new code.',
  reset: 'We couldn’t reset your password. Request a new reset link and try again.',
  provider: 'We couldn’t open sign-in. Please try again.',
});

// Credentials stay in the caller's memory and are passed only to SDK methods.
// Provider exceptions can contain submitted values, so they never leave here.
export async function performBrandedAuth({ action, auth, input = {}, checkUserAuth, navigate, returnTo, origin }) {
  const destination = safeAuthReturn(returnTo, origin);
  try {
    switch (action) {
      case 'login': {
        await auth.loginViaEmailPassword(input.email.trim(), input.password, input.turnstileToken);
        const user = await checkUserAuth();
        if (!user?.id) return { ok: false, message: 'Sign-in could not be confirmed. Please try again.' };
        navigate(destination, { replace: true });
        return { ok: true };
      }
      case 'register':
        await auth.register({ email: input.email.trim(), password: input.password,
          ...(input.turnstileToken ? { turnstile_token: input.turnstileToken } : {}) });
        return { ok: true, nextStep: 'verify', message: 'Check your email for a verification code.' };
      case 'verify':
        await auth.verifyOtp({ email: input.email.trim(), otpCode: input.otpCode.trim() });
        return { ok: true, nextStep: 'login', message: 'Your email is verified. Sign in to continue.' };
      case 'resend':
        await auth.resendOtp(input.email.trim());
        return { ok: true, message: RESEND_MESSAGE };
      case 'forgot':
        await auth.resetPasswordRequest(input.email.trim());
        return { ok: true, message: FORGOT_MESSAGE };
      case 'reset':
        if (typeof input.resetToken !== 'string' || !input.resetToken.trim()) {
          return { ok: false, message: 'This reset link is incomplete. Request a new reset link.' };
        }
        await auth.resetPassword({ resetToken: input.resetToken, newPassword: input.password });
        return { ok: true, nextStep: 'login', message: 'Your password has been reset. Sign in to continue.' };
      case 'provider':
        if (!['google', 'apple'].includes(input.provider)) return { ok: false, message: FAILURE_MESSAGES.provider };
        await auth.loginWithProvider(input.provider, new URL(destination, origin).href);
        // A resolved SDK call is not proof of authentication: popup cancellation
        // can also resolve. Full-page success leaves this page via the SDK.
        return { ok: false, retryable: true, message: 'If sign-in didn’t open or was closed, select your provider again. Allow the sign-in window if your browser blocked it.' };
      default:
        return { ok: false, message: 'This action is unavailable. Please return to sign-in.' };
    }
  } catch {
    // Do not reveal whether an address exists from password recovery responses.
    if (action === 'forgot') return { ok: true, message: FORGOT_MESSAGE };
    if (action === 'resend') return { ok: true, message: RESEND_MESSAGE };
    return { ok: false, message: FAILURE_MESSAGES[action] || 'We couldn’t complete that request. Please try again.' };
  }
}
