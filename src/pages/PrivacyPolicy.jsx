import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

const SECTIONS = [
  {
    num: '1', title: 'Information We Collect',
    content: (
      <div className="space-y-3 text-muted-foreground">
        <div>
          <p className="font-semibold text-foreground mb-1">Account Information</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>name;</li>
            <li>email address;</li>
            <li>username;</li>
            <li>profile information;</li>
            <li>authentication credentials.</li>
          </ul>
        </div>
        <div>
          <p className="font-semibold text-foreground mb-1">Transaction Information</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>ticket listings;</li>
            <li>purchases;</li>
            <li>transfers;</li>
            <li>payout status;</li>
            <li>marketplace interactions.</li>
          </ul>
        </div>
        <div>
          <p className="font-semibold text-foreground mb-1">Payment Information</p>
          <p>Payment and payout information may be processed by third-party providers such as Stripe. We generally do not store full banking credentials or full payment card numbers.</p>
        </div>
        <div>
          <p className="font-semibold text-foreground mb-1">Device and Technical Data</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>IP address;</li>
            <li>browser type;</li>
            <li>operating system;</li>
            <li>app/device identifiers;</li>
            <li>usage data;</li>
            <li>crash/error logs.</li>
          </ul>
        </div>
        <div>
          <p className="font-semibold text-foreground mb-1">Location Information</p>
          <p>We may collect location information for event verification, seat donation eligibility, live upgrade systems, and fraud prevention. Location collection may depend on device permissions.</p>
        </div>
        <div>
          <p className="font-semibold text-foreground mb-1">User Content</p>
          <p>messages; listings; posts; reviews; uploaded media; donation messages.</p>
        </div>
      </div>
    ),
  },
  {
    num: '2', title: 'How We Use Information',
    content: (
      <div className="text-muted-foreground">
        <p className="mb-2">We may use information to:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>operate the Services;</li>
          <li>process transactions;</li>
          <li>facilitate transfers;</li>
          <li>prevent fraud;</li>
          <li>enforce policies;</li>
          <li>improve products;</li>
          <li>personalize experiences;</li>
          <li>communicate with users;</li>
          <li>verify event attendance;</li>
          <li>manage donation systems;</li>
          <li>administer Peanut Points and trust systems;</li>
          <li>comply with legal obligations.</li>
        </ul>
      </div>
    ),
  },
  {
    num: '3', title: 'Sharing of Information',
    content: (
      <div className="space-y-3 text-muted-foreground">
        <div>
          <p className="font-semibold text-foreground mb-1">Service Providers</p>
          <p>Including payment processors, hosting providers, analytics providers, fraud prevention vendors, and customer support vendors.</p>
        </div>
        <div>
          <p className="font-semibold text-foreground mb-1">Other Users</p>
          <p>Certain profile or transaction information may be visible to other users. We attempt to minimize unnecessary exposure of sensitive information.</p>
        </div>
        <div>
          <p className="font-semibold text-foreground mb-1">Legal Compliance</p>
          <p>We may disclose information to comply with law, in response to legal requests, to protect rights and safety, or to investigate fraud or abuse.</p>
        </div>
        <div>
          <p className="font-semibold text-foreground mb-1">Business Transfers</p>
          <p>Information may transfer in connection with mergers, acquisitions, financing, or asset sales.</p>
        </div>
      </div>
    ),
  },
  {
    num: '4', title: 'Cookies and Tracking',
    content: (
      <div className="text-muted-foreground">
        <p>We may use cookies, analytics tools, session storage, and tracking technologies to maintain sessions, improve performance, analyze usage, and personalize experiences. Users may manage cookies through browser/device settings.</p>
      </div>
    ),
  },
  {
    num: '5', title: 'Data Retention',
    content: (
      <div className="text-muted-foreground">
        <p>We retain information as reasonably necessary for operating the Services, fraud prevention, legal compliance, dispute resolution, and enforcing agreements. Retention periods may vary.</p>
      </div>
    ),
  },
  {
    num: '6', title: 'Security',
    content: (
      <div className="text-muted-foreground">
        <p>We implement reasonable security measures. However, no system is completely secure. We cannot guarantee absolute security of accounts, transmissions, or stored information. Users are responsible for safeguarding account credentials.</p>
      </div>
    ),
  },
  {
    num: '7', title: 'User Rights',
    content: (
      <div className="space-y-2 text-muted-foreground">
        <p>Depending on jurisdiction, users may have rights to:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>access information;</li>
          <li>correct information;</li>
          <li>request deletion;</li>
          <li>object to processing;</li>
          <li>request portability.</li>
        </ul>
        <p>We may require verification before fulfilling requests. Some information may be retained for legal or operational reasons.</p>
      </div>
    ),
  },
  {
    num: '8', title: "Children's Privacy",
    content: (
      <div className="text-muted-foreground">
        <p>Peanut Gallery is not intended for children under 13. We do not knowingly collect personal information from children under 13.</p>
      </div>
    ),
  },
  {
    num: '9', title: 'Third-Party Services',
    content: (
      <div className="text-muted-foreground">
        <p>Peanut Gallery may link to or integrate with third-party services. We are not responsible for third-party privacy or security practices. Users should review applicable third-party policies.</p>
      </div>
    ),
  },
  {
    num: '10', title: 'International Users',
    content: (
      <div className="text-muted-foreground">
        <p>Information may be processed and stored in jurisdictions different from your own. By using the Services, you consent to such transfers.</p>
      </div>
    ),
  },
  {
    num: '11', title: 'California Privacy Rights',
    content: (
      <div className="text-muted-foreground">
        <p>California residents may have additional rights under applicable law. We do not sell personal information in the traditional sense. Users may contact us regarding applicable rights requests.</p>
      </div>
    ),
  },
  {
    num: '12', title: 'Changes to Privacy Policy',
    content: (
      <div className="text-muted-foreground">
        <p>We may update this Privacy Policy. Continued use of Peanut Gallery after updates constitutes acceptance.</p>
      </div>
    ),
  },
  {
    num: '13', title: 'Contact',
    content: (
      <div className="text-muted-foreground">
        <p>Peanut Gallery<br />
          <a href="mailto:support@peanutgallery.store" className="underline" style={{ color: '#00FF87' }}>
            support@peanutgallery.store
          </a>
        </p>
      </div>
    ),
  },
];

export default function PrivacyPolicy() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Header */}
      <div className="sticky top-0 z-20 frosted-bar border-b border-border"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
        <div className="flex items-center gap-3 px-4 pb-3">
          <button onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="font-display text-xl text-foreground">Privacy Policy</h1>
        </div>
      </div>

      <div className="px-5 py-6 pb-32 max-w-2xl mx-auto space-y-6 text-sm text-foreground leading-relaxed">

        <p className="text-muted-foreground text-xs">Last Updated: May 27, 2026</p>

        <p className="text-muted-foreground">
          This Privacy Policy explains how Peanut Gallery ("PG," "we," "our," or "us") collects, uses, stores, and shares information. By using Peanut Gallery, you consent to this Privacy Policy.
        </p>

        {SECTIONS.map(s => (
          <section key={s.num} className="space-y-2">
            <h2 className="font-black text-base">{s.num}. {s.title}</h2>
            {s.content}
          </section>
        ))}

        <div className="px-4 py-3 rounded-2xl text-xs text-muted-foreground"
          style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
          ⚠️ This document is a general business/platform draft intended for early-stage operational protection. It is not legal advice. Peanut Gallery should have these terms reviewed by a licensed attorney before large-scale public deployment.
        </div>
      </div>
    </div>
  );
}