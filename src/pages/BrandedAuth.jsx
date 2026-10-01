import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import PGAuthShell from '@/components/auth/PGAuthShell';
import { authPageHref, createAuthSubmission, performBrandedAuth, safeAuthReturn } from '@/lib/brandedAuth';

const COPY = {
  login: ['Welcome back.', 'Sign in to your Peanut Gallery account.'],
  register: ['Join the crowd.', 'Create your Peanut Gallery account.'],
  verify: ['Check your inbox.', 'Enter the verification code sent to your email.'],
  forgot: ['Let’s get you back in.', 'Enter your account email to request a password reset.'],
  reset: ['A fresh start.', 'Choose a new password for your account.'],
};
const INPUT_CLASS = 'pg-auth-input';
const SECONDARY_CLASS = 'pg-public-action pg-public-action--secondary w-full min-h-12 text-base';

// resetToken is intentionally injected only by a caller with a verified reset-link
// contract. Do not guess a query parameter or treat an ordinary login token as one.
export default function BrandedAuth({ mode = 'login', resetToken = '', providers = ['google', 'apple'] }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { checkUserAuth } = useAuth();
  const [step, setStep] = useState(mode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(location.state?.authNotice ? { ok: true, message: location.state.authNotice } : null);
  const submitOnce = useRef(createAuthSubmission());
  const origin = window.location.origin;
  const returnTo = safeAuthReturn(new URLSearchParams(location.search).get('from_url'), origin);
  const [title, description] = COPY[step] || COPY.login;
  const isEmailStep = ['login', 'register', 'forgot'].includes(step);
  const isPasswordStep = ['login', 'register', 'reset'].includes(step);
  const needsConfirmation = ['register', 'reset'].includes(step);
  const resetUnavailable = step === 'reset' && !resetToken;

  useEffect(() => {
    setStep(mode);
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setOtpCode('');
    setNotice(location.state?.authNotice ? { ok: true, message: location.state.authNotice } : null);
  }, [mode, location.key]);

  async function run(action, provider) {
    return submitOnce.current(async () => {
      if (needsConfirmation && ['register', 'reset'].includes(action) && password !== confirmPassword) {
        setNotice({ ok: false, message: 'The passwords don’t match. Please enter them again.' });
        return;
      }
      setBusy(true);
      setNotice(null);
      try {
        const result = await performBrandedAuth({
          action, auth: base44.auth, input: { email, password, otpCode, resetToken, provider },
          checkUserAuth, navigate, returnTo, origin,
        });
        setNotice(result);
        if (result.ok && result.nextStep === 'verify') {
          setPassword('');
          setConfirmPassword('');
          setStep('verify');
        }
        if (result.ok && result.nextStep === 'login') {
          setPassword('');
          setConfirmPassword('');
          setOtpCode('');
          navigate(authPageHref('/login', returnTo), { replace: true, state: { authNotice: result.message } });
        }
      } finally {
        setBusy(false);
      }
    });
  }

  return (
    <PGAuthShell title={title} description={description}>
      <form onSubmit={(event) => { event.preventDefault(); run(step); }} aria-busy={busy} className="space-y-5">
        <fieldset disabled={busy || resetUnavailable} className="space-y-5 min-w-0">
          {isEmailStep && <label className="block text-sm font-semibold" htmlFor="pg-auth-email">Email
            <input id="pg-auth-email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required
              value={email} onChange={(event) => setEmail(event.target.value)} className={INPUT_CLASS} />
          </label>}
          {step === 'verify' && <>
            <p className="text-sm pg-public-muted break-words">Sent to {email}</p>
            <label className="block text-sm font-semibold" htmlFor="pg-auth-code">Verification code
              <input id="pg-auth-code" type="text" inputMode="numeric" autoComplete="one-time-code" required
                value={otpCode} onChange={(event) => setOtpCode(event.target.value)} className={INPUT_CLASS} />
            </label>
          </>}
          {isPasswordStep && <label className="block text-sm font-semibold" htmlFor="pg-auth-password">{step === 'reset' ? 'New password' : 'Password'}
            <input id="pg-auth-password" type="password" autoComplete={step === 'login' ? 'current-password' : 'new-password'} required
              value={password} onChange={(event) => setPassword(event.target.value)} className={INPUT_CLASS} />
          </label>}
          {needsConfirmation && <label className="block text-sm font-semibold" htmlFor="pg-auth-confirm">Confirm password
            <input id="pg-auth-confirm" type="password" autoComplete="new-password" required
              value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className={INPUT_CLASS} />
          </label>}
          {step === 'login' && <Link className="pg-public-link text-sm" to={authPageHref('/forgot-password', returnTo)}>Forgot password?</Link>}
          <button type="submit" className="pg-public-action w-full min-h-12 text-base">
            {busy ? 'Please wait…' : ({ login: 'Sign in', register: 'Create account', verify: 'Verify email', forgot: 'Send reset link', reset: 'Reset password' }[step] || 'Continue')}
          </button>
        </fieldset>
        {resetUnavailable && <div role="alert" className="text-sm leading-relaxed pg-auth-notice--error">
          This reset link could not be opened. <Link className="underline underline-offset-4" to={authPageHref('/forgot-password', returnTo)}>Request a new reset link.</Link>
        </div>}
        {notice?.message && <p role={notice.ok ? 'status' : 'alert'} aria-live="polite" className={`text-sm leading-relaxed ${notice.ok ? 'pg-auth-notice--success' : 'pg-auth-notice--error'}`}>{notice.message}</p>}
      </form>

      {['login', 'register'].includes(step) && <>
        <div className="pg-auth-divider"><span />or<span /></div>
        <div className="space-y-3">
          {providers.includes('google') && <button type="button" disabled={busy} onClick={() => run('provider', 'google')} className={SECONDARY_CLASS}>Continue with Google</button>}
          {providers.includes('apple') && <button type="button" disabled={busy} onClick={() => run('provider', 'apple')} className={SECONDARY_CLASS}>Continue with Apple</button>}
        </div>
        <p className="mt-6 text-sm pg-public-muted">{step === 'login' ? 'New to Peanut Gallery? ' : 'Already have an account? '}
          <Link className="pg-public-link font-bold" to={authPageHref(step === 'login' ? '/register' : '/login', returnTo)}>
            {step === 'login' ? 'Create account' : 'Sign in'}
          </Link>
        </p>
      </>}
      {step === 'verify' && <div className="mt-5 space-y-3">
        <button type="button" disabled={busy} onClick={() => run('resend')} className={SECONDARY_CLASS}>Send another code</button>
        <button type="button" disabled={busy} onClick={() => { setStep('register'); setOtpCode(''); setNotice(null); }} className="pg-public-link text-sm">Use a different email</button>
      </div>}
      {['forgot', 'reset'].includes(step) && <Link className="pg-public-link mt-5 text-sm" to={authPageHref('/login', returnTo)}>Back to sign in</Link>}
    </PGAuthShell>
  );
}
