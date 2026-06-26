import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

const SECTIONS = [
  {
    num: '1', title: 'Eligibility',
    content: (
      <div className="space-y-2 text-muted-foreground">
        <p>You must:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>be at least 18 years old or the age of majority in your jurisdiction;</li>
          <li>have the legal authority to enter into these Terms;</li>
          <li>provide accurate account information;</li>
          <li>comply with all applicable laws.</li>
        </ul>
        <p>By using Peanut Gallery, you represent and warrant that you satisfy these requirements.</p>
        <p>We reserve the right to suspend or terminate accounts that violate eligibility requirements.</p>
      </div>
    ),
  },
  {
    num: '2', title: 'Nature of the Platform',
    content: (
      <div className="space-y-2 text-muted-foreground">
        <p>Peanut Gallery is a technology platform and marketplace that facilitates: fan-to-fan ticket listings; live seat upgrades; instant transfer inventory; community seat donations; event-related engagement systems; loyalty/reputation systems; and related marketplace interactions.</p>
        <p>Except where Peanut Gallery explicitly takes custody of tickets through designated "Instant Transfer" flows, Peanut Gallery is not the seller, owner, issuer, venue operator, promoter, artist, sports team, or organizer of listed tickets.</p>
        <p>Users are solely responsible for listings, ticket ownership, transfer completion, account activity, compliance with venue/event restrictions, applicable taxes, and legal obligations.</p>
        <p>Peanut Gallery does not guarantee ticket availability, event admission, seat quality, event accuracy, uninterrupted Services, successful resale, successful upgrades, or donation eligibility.</p>
      </div>
    ),
  },
  {
    num: '3', title: 'Accounts',
    content: (
      <div className="space-y-2 text-muted-foreground">
        <p>You are responsible for maintaining account security, safeguarding credentials, and all activity under your account.</p>
        <p>You agree not to impersonate others, create fraudulent accounts, share accounts improperly, bypass suspensions, or manipulate marketplace systems.</p>
        <p>We may suspend, restrict, or terminate accounts at our sole discretion for fraud, abuse, chargebacks, suspicious activity, policy violations, legal compliance, or risk mitigation.</p>
      </div>
    ),
  },
  {
    num: '4', title: 'Ticket Listings',
    content: (
      <div className="space-y-2 text-muted-foreground">
        <p>By creating a listing, you represent and warrant that you legally possess the ticket(s), have authority to transfer them, the listing information is accurate, the tickets are valid and transferable, and transfer does not violate applicable law or event restrictions.</p>
        <p>You may not list fake tickets, list speculative inventory you do not possess, manipulate prices fraudulently, intentionally misrepresent seating, or engage in scalping prohibited by law.</p>
        <p>Peanut Gallery reserves the right to remove listings, reject transfers, request verification, require proof of ownership, freeze payouts, or cancel suspicious activity.</p>
      </div>
    ),
  },
  {
    num: '5', title: 'Instant Transfer Inventory',
    content: (
      <div className="space-y-2 text-muted-foreground">
        <p>Certain listings may use Peanut Gallery's "Instant Transfer" system. Under Instant Transfer, users may voluntarily transfer tickets into Peanut Gallery-managed custody workflows. Peanut Gallery may verify, hold, or facilitate later fulfillment and may reject or remove inventory at any time.</p>
        <p>Peanut Gallery does not guarantee transfer timing, sale success, uninterrupted availability, or immediate verification. Users remain responsible for ensuring tickets are valid and transferable.</p>
      </div>
    ),
  },
  {
    num: '6', title: 'Seat Donations',
    content: (
      <div className="space-y-2 text-muted-foreground">
        <p>Peanut Gallery may offer community donation systems allowing users to donate seats or upgrades to other users. Seat donations are voluntary, have no cash value, are not guaranteed, and may use weighted selection systems with eligibility requirements.</p>
        <p>Peanut Gallery reserves sole discretion regarding recipient selection, eligibility, distribution logic, donation cancellation, and fraud prevention. Donation systems are promotional/community features and may be suspended or discontinued at any time.</p>
      </div>
    ),
  },
  {
    num: '7', title: 'Peanut Points / Reputation Systems',
    content: (
      <div className="space-y-2 text-muted-foreground">
        <p>Peanut Gallery may provide Peanut Points, trust scores, badges, rankings, leaderboards, and reputation systems. These systems have no monetary value, are not transferable, are revocable, and are promotional only.</p>
        <p>Peanut Gallery may modify scoring, revoke points, remove badges, reset rankings, or suspend users from rewards systems at any time. Users have no ownership interest in Peanut Points or related systems.</p>
      </div>
    ),
  },
  {
    num: '8', title: 'Payments and Payouts',
    content: (
      <div className="space-y-2 text-muted-foreground">
        <p>Payments and payouts may be processed through third-party providers including Stripe. By using Peanut Gallery, you authorize payment processing, payout routing, transaction verification, escrow-style workflows, and fraud checks.</p>
        <p>Peanut Gallery may hold funds, delay payouts, reverse transactions, freeze balances, investigate disputes, or comply with legal requests. Payout timing is not guaranteed.</p>
        <p>Users are solely responsible for tax obligations, banking accuracy, and compliance with financial regulations. Peanut Gallery does not store full banking credentials. Third-party providers may impose separate terms.</p>
      </div>
    ),
  },
  {
    num: '9', title: 'Fees',
    content: (
      <div className="space-y-2 text-muted-foreground">
        <p>Peanut Gallery may charge service fees, marketplace fees, processing fees, seller fees, and upgrade-related fees. Fees may change at any time. Users authorize Peanut Gallery to deduct applicable fees from transactions. Except where legally required, fees are non-refundable.</p>
      </div>
    ),
  },
  {
    num: '10', title: 'Event Changes and Cancellations',
    content: (
      <div className="space-y-2 text-muted-foreground">
        <p>Events may change, move, postpone, or cancel. Peanut Gallery is not responsible for event cancellations, venue policies, artist/team changes, weather, admission denial, or seating changes.</p>
        <p>Refund eligibility may depend on issuer policies, venue policies, marketplace rules, and payment provider rules.</p>
      </div>
    ),
  },
  {
    num: '11', title: 'Prohibited Conduct',
    content: (
      <div className="space-y-2 text-muted-foreground">
        <p>You agree not to: violate laws; infringe intellectual property; engage in fraud; harass users; manipulate pricing; exploit bugs; reverse engineer the Services; scrape data; spam; use bots without authorization; circumvent security; abuse donation systems; or abuse rewards systems.</p>
        <p>We may investigate and cooperate with law enforcement.</p>
      </div>
    ),
  },
  {
    num: '12', title: 'User Content',
    content: (
      <div className="space-y-2 text-muted-foreground">
        <p>You retain ownership of content you submit. However, you grant Peanut Gallery a worldwide, non-exclusive, royalty-free license to host, display, reproduce, distribute, modify, promote, operate, and improve the Services using your content.</p>
        <p>You represent that you possess all rights necessary to grant this license.</p>
      </div>
    ),
  },
  {
    num: '13', title: 'Intellectual Property',
    content: (
      <div className="space-y-2 text-muted-foreground">
        <p>All Peanut Gallery branding, software, design, trademarks, logos, interfaces, and systems are owned by Peanut Gallery or its licensors. You may not copy, distribute, reverse engineer, reproduce, create derivative works from, or commercially exploit the Services without permission.</p>
      </div>
    ),
  },
  {
    num: '14', title: 'Privacy',
    content: (
      <div className="space-y-2 text-muted-foreground">
        <p>Your use of Peanut Gallery is also governed by our Privacy Policy. By using the Services, you consent to data collection, processing, storage, and sharing as described in the Privacy Policy.</p>
      </div>
    ),
  },
  {
    num: '15', title: 'Disclaimers',
    content: (
      <div className="space-y-2 text-muted-foreground">
        <p className="font-semibold text-foreground">THE SERVICES ARE PROVIDED "AS IS" AND "AS AVAILABLE."</p>
        <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, PEANUT GALLERY DISCLAIMS ALL WARRANTIES, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, UNINTERRUPTED AVAILABILITY, ACCURACY, AND RELIABILITY.</p>
        <p>Peanut Gallery does not guarantee successful transactions, event admission, platform uptime, error-free operation, uninterrupted service, or transfer completion.</p>
      </div>
    ),
  },
  {
    num: '16', title: 'Limitation of Liability',
    content: (
      <div className="space-y-2 text-muted-foreground">
        <p className="font-semibold text-foreground">TO THE MAXIMUM EXTENT PERMITTED BY LAW, PEANUT GALLERY SHALL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, CONSEQUENTIAL, OR SPECIAL DAMAGES, LOST PROFITS, REPUTATIONAL HARM, LOST DATA, OR EVENT-RELATED LOSSES.</p>
        <p>IN NO EVENT SHALL PEANUT GALLERY'S TOTAL LIABILITY EXCEED THE GREATER OF $100 USD OR THE AMOUNT OF FEES PAID TO PEANUT GALLERY BY YOU IN THE PRIOR 12 MONTHS.</p>
        <p>Some jurisdictions may not allow certain limitations.</p>
      </div>
    ),
  },
  {
    num: '17', title: 'Indemnification',
    content: (
      <div className="space-y-2 text-muted-foreground">
        <p>You agree to defend, indemnify, and hold harmless Peanut Gallery and its affiliates, officers, employees, contractors, and agents from claims arising from your use of the Services, your listings, your violations of law, your violations of these Terms, or your fraud or misconduct.</p>
      </div>
    ),
  },
  {
    num: '18', title: 'Arbitration and Class Action Waiver',
    content: (
      <div className="space-y-2 text-muted-foreground">
        <p className="font-semibold text-foreground">PLEASE READ THIS SECTION CAREFULLY.</p>
        <p>You agree that disputes shall be resolved through binding individual arbitration, except where prohibited by law. You waive jury trials, class actions, class arbitration, and representative actions.</p>
        <p>Arbitration shall occur in Arizona unless otherwise required by law. Either party may seek small claims relief where permitted.</p>
      </div>
    ),
  },
  {
    num: '19', title: 'Governing Law',
    content: (
      <div className="space-y-2 text-muted-foreground">
        <p>These Terms shall be governed by the laws of the State of Arizona, without regard to conflict-of-law principles.</p>
      </div>
    ),
  },
  {
    num: '20', title: 'Changes to Terms',
    content: (
      <div className="space-y-2 text-muted-foreground">
        <p>We may modify these Terms at any time. Continued use of the Services after updates constitutes acceptance.</p>
      </div>
    ),
  },
  {
    num: '21', title: 'Termination',
    content: (
      <div className="space-y-2 text-muted-foreground">
        <p>We may suspend or terminate access immediately for violations of these Terms, fraud, abuse, legal risk, or operational/security concerns. Sections intended to survive termination shall survive.</p>
      </div>
    ),
  },
  {
    num: '22', title: 'Contact',
    content: (
      <div className="text-muted-foreground">
        <p>Peanut Gallery<br />
          <a href="mailto:experience@peanutgallery.store" className="underline" style={{ color: '#BF5FFF' }}>
            experience@peanutgallery.store
          </a>
        </p>
      </div>
    ),
  },
];

export default function TermsOfService() {
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
          <h1 className="font-display text-xl text-foreground">Terms of Service</h1>
        </div>
      </div>

      <div className="px-5 py-6 pb-32 max-w-2xl mx-auto space-y-6 text-sm text-foreground leading-relaxed">

        {/* Important notice */}
        <div className="px-4 py-3 rounded-2xl text-xs font-semibold"
          style={{ background: 'rgba(255,45,120,0.08)', border: '1px solid rgba(255,45,120,0.25)', color: '#FF2D78' }}>
          ⚠️ IMPORTANT: THESE TERMS CONTAIN DISCLAIMERS, LIABILITY LIMITATIONS, ARBITRATION PROVISIONS, CLASS ACTION WAIVERS, AND OTHER LEGAL TERMS THAT AFFECT YOUR RIGHTS.
        </div>

        <p className="text-muted-foreground text-xs">Last Updated: May 27, 2026</p>

        <p className="text-muted-foreground">
          These Terms of Service ("Terms") govern your access to and use of Peanut Gallery, including our websites, mobile applications, services, marketplaces, live event tools, seat upgrade systems, donation systems, and related features (collectively, the "Services"). By accessing or using Peanut Gallery, you agree to these Terms. If you do not agree, do not use the Services.
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