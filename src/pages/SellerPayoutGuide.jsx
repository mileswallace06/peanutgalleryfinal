import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Shield, CreditCard, Clock, CheckCircle, AlertCircle, ExternalLink, Banknote, Lock } from 'lucide-react';
import FaqAccordion from '@/components/education/FaqAccordion';

const ORANGE = '#FF8C00';
const GREEN = '#00FF87';
const PURPLE = '#BF5FFF';

function SectionLabel({ children, color = ORANGE }) {
  return (
    <p className="text-[10px] font-black tracking-widest uppercase mb-4 flex items-center gap-2" style={{ color }}>
      <span className="w-4 h-px inline-block" style={{ background: color }} />
      {children}
    </p>
  );
}

const STEPS = [
  {
    num: '01',
    title: 'Go to the Sell Page',
    desc: 'Navigate to the Sell tab in the bottom nav. Tap "Set Up Payouts with Stripe" to begin.',
    detail: 'If you already started setup but didn\'t finish, tap "Finish Payout Setup" instead.',
    color: ORANGE,
  },
  {
    num: '02',
    title: 'Stripe Redirect',
    desc: 'You\'ll be taken to Stripe\'s secure onboarding. Peanut Gallery never sees or stores your banking details.',
    detail: 'Look for the Stripe logo and HTTPS in the URL bar — this confirms you\'re on Stripe\'s official page.',
    color: '#FF2D78',
  },
  {
    num: '03',
    title: 'Enter Your Personal Info',
    desc: 'Stripe asks for your full name, date of birth, and last 4 of SSN for identity verification.',
    detail: 'This is standard for any US payment processor. It\'s required by federal law (FinCEN regulations) to prevent money laundering.',
    color: PURPLE,
  },
  {
    num: '04',
    title: 'Link Your Bank Account',
    desc: 'Enter your routing and account number, or use Stripe\'s instant bank link via Plaid.',
    detail: 'Stripe supports most US checking and savings accounts. Business accounts work too.',
    color: '#00C8FF',
  },
  {
    num: '05',
    title: 'Review & Submit',
    desc: 'Review your information and submit. Stripe will verify your identity and bank details.',
    detail: 'Most accounts are approved instantly. In some cases Stripe may request additional documents within a few days.',
    color: GREEN,
  },
  {
    num: '06',
    title: 'You\'re Ready to List',
    desc: 'Return to Peanut Gallery. Your payout account is now active — list your first ticket immediately.',
    detail: 'If the page shows "onboarding incomplete," tap the refresh icon. Sometimes the redirect takes a moment.',
    color: GREEN,
  },
];

const PAYOUT_FACTS = [
  { icon: '⏱️', title: 'Standard Payout: 2–7 Business Days', desc: 'After your first successful sale, funds move from escrow to your Stripe balance within 2–7 business days. This is Stripe\'s standard timeline.' },
  { icon: '⚡', title: 'First Payout Is Slower', desc: 'Stripe holds the first payout for up to 7 days as fraud protection. This is normal and applies to all new Stripe Express accounts — not just PG sellers.' },
  { icon: '💸', title: 'Instant Payouts Available', desc: 'Once your account is established, you may be eligible for Stripe\'s Instant Payout feature (for an additional fee). Check your Stripe dashboard.' },
  { icon: '🧾', title: '95% Goes to You', desc: 'Peanut Gallery charges a 5% service fee (minimum $1). Everything else goes to your bank — automatically, no invoicing needed.' },
];

const ISSUES = [
  { problem: 'Onboarding shows incomplete after finishing', fix: 'Return to the Sell page and wait 30 seconds — the page checks Stripe status automatically. Try refreshing if it doesn\'t update.' },
  { problem: '"Identity verification failed"', fix: 'Double-check that your name, date of birth, and SSN match your government ID exactly. Common issue: using a nickname instead of your legal name.' },
  { problem: 'Bank account rejected', fix: 'Verify your routing and account numbers are correct. Try logging into your bank app to confirm. Joint accounts and business accounts should work.' },
  { problem: 'Balance looks wrong or shows $0', fix: 'New accounts may show a temporary $0 balance even after a sale while Stripe processes the transfer. Check back after 24 hours.' },
  { problem: 'Didn\'t receive payout email', fix: 'Payouts go to your bank — no email is sent per payout. Check your bank statement. Stripe also sends a monthly summary to your Stripe email.' },
];

const FAQS = [
  { q: 'Does PG store my bank account information?', a: 'Never. All banking details are entered directly on Stripe\'s secure platform. Peanut Gallery only receives a seller account ID from Stripe — never your actual bank details.' },
  { q: 'What is a Stripe Express account?', a: 'Stripe Express is a simplified version of Stripe designed for marketplace sellers. It takes about 2 minutes to set up and requires less documentation than a full Stripe account.' },
  { q: 'Can I use a debit card instead of a bank account?', a: 'Stripe\'s standard payout requires a bank account. However, if you have a debit card linked to a bank account, you may be able to use Stripe\'s Instant Payout to a debit card once eligible.' },
  { q: 'What about taxes? Will I get a 1099?', a: 'If your earnings exceed IRS thresholds ($600+ in a calendar year), Stripe will issue a 1099-K on behalf of Peanut Gallery. This is sent to the email on your Stripe account in January.' },
  { q: 'Can I change my bank account later?', a: 'Yes. Log into your Stripe Express dashboard (link available in your Account Settings) and update your bank account at any time.' },
  { q: 'What if I sell in multiple events — does each payout happen separately?', a: 'Stripe typically batches payouts. Multiple sales within the same payout cycle are combined into a single bank transfer.' },
  { q: 'Is there a minimum payout amount?', a: 'Stripe has no minimum payout amount. Even a single $10 sale will be transferred to your bank on the next payout cycle.' },
];

export default function SellerPayoutGuide() {
  return (
    <div className="max-w-lg mx-auto px-4 pb-32 dark:rave-bg"
      style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top))' }}>

      {/* Back */}
      <Link to="/sell"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-8 transition-colors">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Sell
      </Link>

      {/* Hero */}
      <div className="mb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-black mb-4"
          style={{ background: 'rgba(255,140,0,0.12)', border: '1px solid rgba(255,140,0,0.3)', color: ORANGE }}>
          🏦 Seller Payout Guide
        </div>
        <h1 className="font-display leading-none mb-3"
          style={{ fontSize: 'clamp(2.4rem, 10vw, 3.5rem)', background: `linear-gradient(135deg, ${ORANGE}, #FF2D78)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
          Get Paid.<br />Simple.
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
          Everything you need to know about setting up payouts, connecting your bank, and getting paid after you sell.
        </p>
      </div>

      {/* Why Stripe */}
      <div className="mb-10 rounded-2xl p-5"
        style={{ background: 'rgba(255,140,0,0.06)', border: '1px solid rgba(255,140,0,0.2)' }}>
        <SectionLabel>Why PG Uses Stripe</SectionLabel>
        <p className="text-sm text-muted-foreground leading-relaxed mb-3">
          Stripe is the world's most trusted payment infrastructure — the same technology used by Shopify, Amazon, and DoorDash. We use <strong className="text-foreground">Stripe Connect Express</strong> so sellers can receive money directly from buyers without Peanut Gallery ever touching it.
        </p>
        <div className="grid grid-cols-2 gap-2 mt-4">
          {[
            { icon: <Lock className="w-3.5 h-3.5" />, label: 'Bank-grade encryption' },
            { icon: <Shield className="w-3.5 h-3.5" />, label: 'PG never stores bank info' },
            { icon: <CreditCard className="w-3.5 h-3.5" />, label: 'Stripe-regulated' },
            { icon: <CheckCircle className="w-3.5 h-3.5" />, label: 'Trusted by millions' },
          ].map((b, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium"
              style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}>
              <span style={{ color: ORANGE }}>{b.icon}</span> {b.label}
            </div>
          ))}
        </div>
      </div>

      {/* What you need */}
      <div className="mb-10">
        <SectionLabel>What You Need Before Starting</SectionLabel>
        <div className="space-y-2">
          {[
            { emoji: '🪪', item: 'Full legal name (must match your ID)' },
            { emoji: '📅', item: 'Date of birth' },
            { emoji: '🔢', item: 'Last 4 digits of your SSN' },
            { emoji: '🏦', item: 'Bank routing + account number (or Plaid login)' },
            { emoji: '📧', item: 'An email address to register your Stripe account' },
          ].map((r, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl"
              style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <span className="text-lg flex-shrink-0">{r.emoji}</span>
              <span className="text-sm text-foreground">{r.item}</span>
              <CheckCircle className="w-4 h-4 flex-shrink-0 ml-auto" style={{ color: GREEN }} />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
          US sellers only at this time. All info is submitted directly to Stripe — Peanut Gallery never sees your banking data.
        </p>
      </div>

      {/* Step-by-step */}
      <div className="mb-10">
        <SectionLabel color={PURPLE}>Step-by-Step Walkthrough</SectionLabel>
        <div className="space-y-4">
          {STEPS.map((step, i) => (
            <div key={i} className="rounded-2xl p-4 flex gap-4"
              style={{ background: 'hsl(var(--card))', border: `1px solid ${step.color}22` }}>
              <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-display text-lg"
                style={{ background: `${step.color}15`, border: `1px solid ${step.color}30`, color: step.color }}>
                {step.num}
              </div>
              <div>
                <p className="font-bold text-sm text-foreground mb-1">{step.title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{step.desc}</p>
                {step.detail && (
                  <div className="mt-2 px-3 py-2 rounded-xl text-xs text-muted-foreground leading-relaxed"
                    style={{ background: `${step.color}08`, border: `1px solid ${step.color}20` }}>
                    💡 {step.detail}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* How payouts work */}
      <div className="mb-10">
        <SectionLabel color={GREEN}>How Payouts Work</SectionLabel>
        <div className="space-y-3">
          {PAYOUT_FACTS.map((fact, i) => (
            <div key={i} className="flex items-start gap-4 px-4 py-4 rounded-2xl"
              style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <span className="text-2xl flex-shrink-0">{fact.icon}</span>
              <div>
                <p className="font-bold text-sm text-foreground">{fact.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{fact.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Common issues */}
      <div className="mb-10">
        <SectionLabel color="#FF2D78">Common Issues & Fixes</SectionLabel>
        <div className="space-y-3">
          {ISSUES.map((issue, i) => (
            <div key={i} className="rounded-2xl p-4"
              style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <div className="flex items-start gap-2 mb-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#FF2D78' }} />
                <p className="font-bold text-sm text-foreground">{issue.problem}</p>
              </div>
              <div className="flex items-start gap-2 pl-6">
                <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: GREEN }} />
                <p className="text-xs text-muted-foreground leading-relaxed">{issue.fix}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* FAQ */}
      <div className="mb-10">
        <SectionLabel>Frequently Asked Questions</SectionLabel>
        <FaqAccordion items={FAQS} accentColor={ORANGE} />
      </div>

      {/* Security callout */}
      <div className="mb-10 rounded-2xl p-5"
        style={{ background: 'rgba(0,255,135,0.05)', border: '1px solid rgba(0,255,135,0.2)' }}>
        <div className="flex items-center gap-3 mb-2">
          <Shield className="w-5 h-5" style={{ color: GREEN }} />
          <p className="font-black text-sm text-foreground">Stripe secures your banking info. PG never stores it.</p>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Peanut Gallery uses Stripe's Connect Express platform. Your bank details, SSN, and identity documents are handled exclusively by Stripe under their PCI DSS Level 1 certification — the highest level of payment security. We receive only a seller account ID.
        </p>
      </div>

      {/* CTAs */}
      <div className="space-y-3">
        <Link to="/sell"
          className="flex items-center justify-center gap-2 w-full py-4 rounded-full font-black text-sm"
          style={{ background: `linear-gradient(135deg, ${ORANGE}, #FF2D78)`, color: '#fff', boxShadow: `0 0 18px rgba(255,140,0,0.25)` }}>
          <Banknote className="w-4 h-4" /> Start Seller Setup
        </Link>
        <Link to="/sell"
          className="flex items-center justify-center gap-2 w-full py-3.5 rounded-full font-semibold text-sm"
          style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}>
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Sell
        </Link>
      </div>
    </div>
  );
}