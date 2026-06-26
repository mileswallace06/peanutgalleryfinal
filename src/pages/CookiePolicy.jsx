import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

const SECTIONS = [
  {
    num: '1', title: 'What Are Cookies',
    content: (
      <div className="space-y-2 text-muted-foreground">
        <p>Cookies are small text files stored on your device when you visit a website or use a mobile application. They are widely used to make websites and apps work efficiently and to provide information to the owners.</p>
        <p>Peanut Gallery is a mobile-first application. Because our app runs inside a web view rather than a traditional browser, our use of cookies and similar technologies is limited compared to a typical website.</p>
      </div>
    ),
  },
  {
    num: '2', title: 'How We Use Cookies and Similar Technologies',
    content: (
      <div className="space-y-2 text-muted-foreground">
        <p>We use the following categories of technologies:</p>
        <div>
          <p className="font-semibold text-foreground mb-1">Strictly Necessary</p>
          <p>These are essential for the app to function. They allow you to sign in, maintain your session, and navigate securely. The app cannot operate properly without them.</p>
        </div>
        <div>
          <p className="font-semibold text-foreground mb-1">Authentication Tokens</p>
          <p>When you sign in, an authentication token is stored on your device so you stay logged in between sessions. This is not a tracking cookie — it is used solely to verify your identity and protect your account.</p>
        </div>
        <div>
          <p className="font-semibold text-foreground mb-1">Local Storage</p>
          <p>The app uses browser-level local storage and session storage to remember preferences such as your onboarding status, saved location, and theme selection. This data stays on your device and is not shared with advertisers.</p>
        </div>
        <div>
          <p className="font-semibold text-foreground mb-1">Analytics</p>
          <p>We use built-in platform analytics to understand aggregate usage — page visits, session duration, and custom events. This is anonymized or pseudonymized and is not used to build a profile of you for advertising.</p>
        </div>
      </div>
    ),
  },
  {
    num: '3', title: 'Third-Party Services',
    content: (
      <div className="space-y-2 text-muted-foreground">
        <p>Some third-party services we integrate with may set their own cookies or use similar technologies when you interact with them:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><span className="font-semibold text-foreground">Stripe</span> — payment processing. Stripe may use cookies on its own domains to prevent fraud.</li>
          <li><span className="font-semibold text-foreground">OneSignal</span> — push notifications. Uses device identifiers to deliver notifications.</li>
          <li><span className="font-semibold text-foreground">Ticketmaster</span> — event data syndication. Their services may set cookies if you follow links to their site.</li>
          <li><span className="font-semibold text-foreground">Google Maps / Geolocation</span> — used only when you grant location permission for nearby events.</li>
        </ul>
        <p>We do not control these third-party cookies. Each provider has its own cookie and privacy policy that governs their use.</p>
      </div>
    ),
  },
  {
    num: '4', title: 'Cookies We Do Not Use',
    content: (
      <div className="space-y-2 text-muted-foreground">
        <p>We do <span className="font-semibold text-foreground">not</span> use the following:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Advertising or retargeting cookies</li>
          <li>Third-party tracking pixels for ad networks</li>
          <li>Cross-site tracking cookies</li>
          <li>Device fingerprinting for advertising</li>
        </ul>
      </div>
    ),
  },
  {
    num: '5', title: 'Managing Cookies',
    content: (
      <div className="space-y-2 text-muted-foreground">
        <p>Because Peanut Gallery is a mobile application, you manage cookies and stored data through your device settings:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><span className="font-semibold text-foreground">Sign out</span> — clears your authentication token from the device.</li>
          <li><span className="font-semibold text-foreground">Delete account</span> — permanently removes your data, including stored preferences.</li>
          <li><span className="font-semibold text-foreground">App settings</span> — clearing app data or reinstalling will remove local storage and session tokens.</li>
          <li><span className="font-semibold text-foreground">Device permissions</span> — you can revoke location or notification permissions in your device settings at any time.</li>
        </ul>
        <p>Disabling strictly necessary tokens will prevent you from signing in or using the app.</p>
      </div>
    ),
  },
  {
    num: '6', title: 'Changes to This Policy',
    content: (
      <p className="text-muted-foreground">We may update this Cookie Policy from time to time. We will update the "Last Updated" date at the top of this page when we do. Continued use of the app after changes constitutes acceptance of the revised policy.</p>
    ),
  },
  {
    num: '7', title: 'Contact Us',
    content: (
      <p className="text-muted-foreground">If you have questions about this Cookie Policy or how we use cookies and similar technologies, contact us through the support option in your account settings.</p>
    ),
  },
];

export default function CookiePolicy() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Header */}
      <div className="sticky top-0 z-20 frosted-bar border-b border-border"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
        <div className="flex items-center gap-3 px-4 pb-3">
          <button onClick={() => window.history.length > 1 ? navigate(-1) : navigate('/')}
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="font-display text-xl text-foreground">Cookie Policy</h1>
        </div>
      </div>

      <div className="px-5 py-6 pb-32 max-w-2xl mx-auto space-y-6 text-sm text-foreground leading-relaxed">

        <p className="text-muted-foreground text-xs">Last Updated: June 26, 2026</p>

        <p className="text-muted-foreground">
          This Cookie Policy explains how Peanut Gallery uses cookies and similar technologies (such as local storage and authentication tokens) when you use our mobile application and website. By using Peanut Gallery, you consent to the use of these technologies as described below.
        </p>

        {SECTIONS.map(s => (
          <section key={s.num} className="space-y-2">
            <h2 className="font-black text-base">{s.num}. {s.title}</h2>
            {s.content}
          </section>
        ))}

        <div className="px-4 py-3 rounded-2xl text-xs text-muted-foreground"
          style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
          ⚠️ This document is a general business/platform draft intended for early-stage operational protection. It is not legal advice. Peanut Gallery should have this policy reviewed by a licensed attorney before large-scale public deployment.
        </div>
      </div>
    </div>
  );
}