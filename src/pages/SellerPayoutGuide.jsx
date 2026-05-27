import { Link } from 'react-router-dom';
import { ArrowLeft, Shield, CreditCard, Clock, CheckCircle, Banknote, Lock, Eye, EyeOff, User, Building2, AlertCircle } from 'lucide-react';
import FaqAccordion from '@/components/education/FaqAccordion';

const ORANGE = '#FF8C00';
const GREEN = '#00FF87';
const PURPLE = '#BF5FFF';
const CYAN = '#00C8FF';

function SectionLabel({ children, color = ORANGE }) {
  return (
    <p className="text-[10px] font-black tracking-widest uppercase mb-4 flex items-center gap-2" style={{ color }}>
      <span className="w-4 h-px inline-block" style={{ background: color }} />
      {children}
    </p>
  );
}

// ── Step timeline data — REAL Stripe flow ───────────────────────────────────
const STEPS = [
  {
    num: '1',
    emoji: '📱',
    title: 'Tap "Set Up Payouts"',
    desc: 'On the Sell tab, tap the orange "Set Up Payouts with Stripe" button. You\'ll be redirected to Stripe\'s secure site.',
    tip: 'Look for "stripe.com" in your browser bar — that\'s how you know you\'re on their official page.',
    color: ORANGE,
  },
  {
    num: '2',
    emoji: '📧',
    title: 'Enter your email address',
    desc: 'Stripe asks for an email to create your payout account. Use any personal email — this is just for receiving receipts and payout summaries.',
    tip: 'You can use Gmail, iCloud, Yahoo — any email works. This is NOT creating a "business account."',
    color: '#FF2D78',
  },
  {
    num: '3',
    emoji: '👤',
    title: 'Select "Individual" as your type',
    desc: 'Stripe will ask what type of account you want. Select Individual — this is the correct option for fans selling personal tickets.',
    highlight: 'You are NOT a business. Select Individual and keep going.',
    color: PURPLE,
  },
  {
    num: '4',
    emoji: '🪪',
    title: 'Enter your name & personal details',
    desc: 'Stripe asks for your legal name, date of birth, and the last 4 digits of your SSN. This is standard for anyone receiving money in the US.',
    tip: 'This is the same kind of info you\'d give a bank or Venmo. It\'s how they verify you\'re a real person — not a scammer.',
    color: CYAN,
  },
  {
    num: '5',
    emoji: '🌐',
    title: 'No website? No problem.',
    desc: 'Stripe may ask for a website. Most Peanut Gallery sellers don\'t have one — and that\'s completely fine.',
    highlight: 'Click "Don\'t have a website? Add product description instead" — then type: Peanut Gallery Ticket Seller',
    color: '#FF8C00',
  },
  {
    num: '6',
    emoji: '🏦',
    title: 'Connect your bank account',
    desc: 'Enter your bank routing and account number, or use the instant bank login option (via Plaid). Checking or savings both work.',
    tip: 'Not sure where to find these? Open your banking app → account details. Routing is usually 9 digits.',
    color: GREEN,
  },
  {
    num: '7',
    emoji: '✅',
    title: 'Review & tap "Agree and submit"',
    desc: 'Stripe shows you a summary of your info. Review it, then hit "Agree and submit." That\'s it — you\'re done.',
    tip: 'Most accounts are approved instantly. You\'ll be redirected back to Peanut Gallery automatically.',
    color: GREEN,
  },
];

const WHAT_YOU_NEED = [
  { emoji: '📧', item: 'Your email address' },
  { emoji: '🪪', item: 'Your legal name (first + last)' },
  { emoji: '📅', item: 'Your date of birth' },
  { emoji: '🔢', item: 'Last 4 digits of your SSN' },
  { emoji: '🏦', item: 'Bank routing + account number' },
];

const WHAT_YOU_DONT_NEED = [
  'A business or LLC',
  'A company website',
  'A tax EIN',
  'Any business registration',
  'A Stripe account already',
];

const STRIPE_SEES = [
  { icon: <CheckCircle className="w-4 h-4" />, label: 'Your identity (name, DOB, SSN last 4)', color: ORANGE },
  { icon: <CheckCircle className="w-4 h-4" />, label: 'Your bank account for payouts', color: ORANGE },
];

const PG_SEES = [
  { icon: <EyeOff className="w-4 h-4" />, label: 'Your bank account details — never', color: GREEN },
  { icon: <EyeOff className="w-4 h-4" />, label: 'Your SSN — never', color: GREEN },
  { icon: <Eye className="w-4 h-4" />, label: 'Only: a Stripe account ID to send your payout', color: CYAN },
];

const PAYOUT_FACTS = [
  { icon: '⏱️', title: '2–7 Business Days', desc: 'After a sale, your money moves from escrow to your bank within 2–7 business days. This is Stripe\'s standard timeline — not something PG controls.' },
  { icon: '🐢', title: 'First Payout Is a Bit Slower', desc: 'Stripe holds your very first payout for up to 7 days. This is normal for ALL new accounts — it\'s their anti-fraud protection. Every seller goes through it.' },
  { icon: '💸', title: 'You Keep 95%', desc: 'Peanut Gallery takes a 5% service fee (minimum $1). The rest goes straight to your bank. No invoices. No paperwork.' },
  { icon: '🔁', title: 'Multiple Sales = One Transfer', desc: 'If you sell multiple tickets, Stripe batches them into one bank deposit — keeping things clean.' },
];

const FAQS = [
  {
    q: 'Do I need a business to sell on Peanut Gallery?',
    a: 'Absolutely not. You\'re just a fan selling your own tickets. When Stripe asks for your "account type," always select Individual. No LLC, EIN, or business registration needed — ever.',
  },
  {
    q: 'Why does Stripe ask for my legal name?',
    a: 'US payment law requires anyone receiving money electronically to verify their real identity. It\'s the same reason Venmo, PayPal, and Cash App ask for your name. It protects you from fraud and ensures payouts reach the right person.',
  },
  {
    q: 'Why do they need the last 4 digits of my SSN?',
    a: 'This is a standard US federal requirement (FinCEN rules) for any electronic money transfer. It\'s just identity verification — not a credit check, not a background check. Stripe uses it to confirm you\'re a real person.',
  },
  {
    q: 'Why does Stripe ask for a website?',
    a: 'Stripe uses this for business customers. Most Peanut Gallery sellers don\'t have a website — and that\'s fine. When you see the website field, click "Don\'t have a website? Add product description instead" and enter: Peanut Gallery Ticket Seller.',
  },
  {
    q: 'Why can\'t Peanut Gallery just send me money directly?',
    a: 'We\'d love to keep it even simpler! But US regulations require a licensed payment processor for any money transfer. Stripe is that processor — they\'re licensed, insured, and trusted by millions. This is the safest, most legal way to get paid.',
  },
  {
    q: 'Does PG see my bank account or SSN?',
    a: 'Never. All your personal and banking details go directly to Stripe on their secure servers. Peanut Gallery receives only a Stripe account ID — kind of like a token — to route your payout. We literally cannot see your bank info.',
  },
  {
    q: 'How long do payouts take?',
    a: 'Your first payout takes up to 7 days (Stripe\'s standard new-account hold). After that, payouts typically arrive in 2–5 business days. You\'ll get a Stripe summary email each month.',
  },
  {
    q: 'Why might my balance show $0 at first?',
    a: 'New Stripe accounts sometimes show $0 in the dashboard while the first transfer processes. This is normal — it doesn\'t mean anything went wrong. Check back after 24 hours, or check your bank directly.',
  },
  {
    q: 'Can I use a savings account?',
    a: 'Yes. Both checking and savings accounts work. Just make sure it\'s a US bank account with a routing number.',
  },
  {
    q: 'Can I change my bank account later?',
    a: 'Yes, anytime. Log into your Stripe Express dashboard (accessible from your Account Settings in Peanut Gallery) and update your bank account whenever you need to.',
  },
];

export default function SellerPayoutGuide() {
  return (
    <div className="max-w-lg mx-auto px-4 pb-32"
      style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top))' }}>

      {/* Back */}
      <Link to="/sell"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-8 transition-colors">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Sell
      </Link>

      {/* ── Hero ─────────────────────────────────────────── */}
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-black mb-4"
          style={{ background: 'rgba(255,140,0,0.12)', border: '1px solid rgba(255,140,0,0.3)', color: ORANGE }}>
          🏦 Getting Paid Guide
        </div>
        <h1 className="font-display leading-none mb-3"
          style={{ fontSize: 'clamp(2.4rem, 10vw, 3.5rem)', background: `linear-gradient(135deg, ${ORANGE}, #FF2D78)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
          Getting paid<br />is simple.
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
          You don't need a business, a website, or an LLC. You're just a fan connecting a bank account so we can send you money after you sell.
        </p>
      </div>

      {/* ── Big reassurance card ─────────────────────────── */}
      <div className="mb-8 rounded-2xl p-5"
        style={{ background: 'rgba(0,255,135,0.06)', border: '1px solid rgba(0,255,135,0.25)' }}>
        <div className="flex items-center gap-2 mb-4">
          <CheckCircle className="w-5 h-5 flex-shrink-0" style={{ color: GREEN }} />
          <p className="font-black text-sm text-foreground">You do NOT need any of this:</p>
        </div>
        <div className="space-y-2">
          {WHAT_YOU_DONT_NEED.map((item, i) => (
            <div key={i} className="flex items-center gap-2.5 text-sm"
              style={{ color: 'hsl(var(--muted-foreground))' }}>
              <span className="text-base">❌</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-4 text-sm font-semibold text-foreground"
          style={{ borderTop: '1px solid rgba(0,255,135,0.2)' }}>
          ✅ You just need: <span style={{ color: GREEN }}>your name, bank account, and 2 minutes.</span>
        </div>
      </div>

      {/* ── What you need ────────────────────────────────── */}
      <div className="mb-8">
        <SectionLabel color={ORANGE}>What to have ready</SectionLabel>
        <div className="space-y-2">
          {WHAT_YOU_NEED.map((r, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl"
              style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <span className="text-lg flex-shrink-0">{r.emoji}</span>
              <span className="text-sm text-foreground">{r.item}</span>
              <CheckCircle className="w-4 h-4 flex-shrink-0 ml-auto" style={{ color: GREEN }} />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
          That's the whole list. US bank accounts only at this time.
        </p>
      </div>

      {/* ── Why Stripe ───────────────────────────────────── */}
      <div className="mb-8 rounded-2xl p-5"
        style={{ background: 'rgba(191,95,255,0.06)', border: '1px solid rgba(191,95,255,0.2)' }}>
        <SectionLabel color={PURPLE}>Why we use Stripe</SectionLabel>
        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
          We can't just send you money via email — US law requires a licensed payment company to handle that. Stripe is that company. They're the same platform behind Shopify, DoorDash, and millions of other apps. Think of them as the secure middleman that moves your money safely.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { icon: <Lock className="w-3.5 h-3.5" />, label: 'Bank-grade encryption' },
            { icon: <Shield className="w-3.5 h-3.5" />, label: 'PG never sees your bank' },
            { icon: <CreditCard className="w-3.5 h-3.5" />, label: 'Stripe-regulated & insured' },
            { icon: <CheckCircle className="w-3.5 h-3.5" />, label: 'Used by millions of people' },
          ].map((b, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium"
              style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <span style={{ color: PURPLE }}>{b.icon}</span>
              <span className="text-foreground">{b.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Step-by-step walkthrough ─────────────────────── */}
      <div className="mb-8">
        <SectionLabel color={CYAN}>Your step-by-step walkthrough</SectionLabel>
        <p className="text-xs text-muted-foreground mb-5 leading-relaxed">
          Here's exactly what you'll see in Stripe — no surprises.
        </p>

        <div className="relative">
          {/* Vertical timeline line */}
          <div className="absolute left-5 top-6 bottom-6 w-px"
            style={{ background: 'linear-gradient(to bottom, rgba(255,140,0,0.4), rgba(0,255,135,0.4))' }} />

          <div className="space-y-4">
            {STEPS.map((step, i) => (
              <div key={i} className="flex gap-4">
                {/* Circle */}
                <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-black text-sm z-10"
                  style={{ background: `${step.color}18`, border: `2px solid ${step.color}50`, color: step.color }}>
                  {step.num}
                </div>

                {/* Card */}
                <div className="flex-1 rounded-2xl p-4 mb-1"
                  style={{ background: 'hsl(var(--card))', border: `1px solid ${step.color}20` }}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-lg">{step.emoji}</span>
                    <p className="font-bold text-sm text-foreground">{step.title}</p>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{step.desc}</p>

                  {/* Highlighted instruction */}
                  {step.highlight && (
                    <div className="mt-3 px-3 py-2.5 rounded-xl text-xs font-semibold leading-relaxed"
                      style={{ background: `${step.color}12`, border: `1px solid ${step.color}35`, color: step.color }}>
                      👉 {step.highlight}
                    </div>
                  )}

                  {/* Tip */}
                  {step.tip && (
                    <div className="mt-2 px-3 py-2 rounded-xl text-xs text-muted-foreground leading-relaxed"
                      style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))' }}>
                      💡 {step.tip}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── What Stripe sees vs what PG sees ────────────── */}
      <div className="mb-8">
        <SectionLabel color={ORANGE}>What gets shared — and with who</SectionLabel>
        <div className="grid grid-cols-1 gap-3">

          <div className="rounded-2xl p-4" style={{ background: 'rgba(255,140,0,0.06)', border: '1px solid rgba(255,140,0,0.2)' }}>
            <div className="flex items-center gap-2 mb-3">
              <Building2 className="w-4 h-4 flex-shrink-0" style={{ color: ORANGE }} />
              <p className="font-bold text-sm text-foreground">What Stripe verifies</p>
            </div>
            <div className="space-y-2">
              {STRIPE_SEES.map((s, i) => (
                <div key={i} className="flex items-center gap-2.5 text-xs text-muted-foreground">
                  <span style={{ color: s.color }}>{s.icon}</span>
                  <span>{s.label}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed"
              style={{ paddingTop: '0.75rem', borderTop: '1px solid rgba(255,140,0,0.15)' }}>
              Stripe uses this to confirm you're a real person eligible to receive payouts. Required by US law.
            </p>
          </div>

          <div className="rounded-2xl p-4" style={{ background: 'rgba(0,255,135,0.05)', border: '1px solid rgba(0,255,135,0.2)' }}>
            <div className="flex items-center gap-2 mb-3">
              <User className="w-4 h-4 flex-shrink-0" style={{ color: GREEN }} />
              <p className="font-bold text-sm text-foreground">What Peanut Gallery sees</p>
            </div>
            <div className="space-y-2">
              {PG_SEES.map((s, i) => (
                <div key={i} className="flex items-center gap-2.5 text-xs text-muted-foreground">
                  <span style={{ color: s.color }}>{s.icon}</span>
                  <span>{s.label}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed"
              style={{ paddingTop: '0.75rem', borderTop: '1px solid rgba(0,255,135,0.15)' }}>
              We receive a Stripe account ID — a unique token — nothing else. Your real banking data never touches our servers.
            </p>
          </div>
        </div>
      </div>

      {/* ── How payouts work ─────────────────────────────── */}
      <div className="mb-8">
        <SectionLabel color={GREEN}>How & when you get paid</SectionLabel>
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

      {/* ── "Why Stripe asks for this" explainer ─────────── */}
      <div className="mb-8 rounded-2xl p-5"
        style={{ background: 'rgba(0,200,255,0.05)', border: '1px solid rgba(0,200,255,0.2)' }}>
        <SectionLabel color={CYAN}>Why Stripe asks for personal info</SectionLabel>
        <div className="space-y-4">
          {[
            { icon: '🪪', title: 'Identity verification', body: 'Stripe needs to confirm you\'re a real person before sending real money. It\'s the same reason banks ask for your ID when you open an account.' },
            { icon: '🛡️', title: 'Fraud prevention', body: 'Verifying identity helps protect everyone — buyers, sellers, and Peanut Gallery — from bad actors trying to abuse the marketplace.' },
            { icon: '⚖️', title: 'Legal requirement', body: 'US law (FinCEN) requires identity verification for electronic payouts. This isn\'t Stripe\'s choice — it\'s the law. Every payout platform must do this.' },
            { icon: '🔒', title: 'Banking security', body: 'Confirming your identity ensures payouts can only go to YOUR bank account — preventing anyone from redirecting your money.' },
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="text-xl flex-shrink-0 mt-0.5">{item.icon}</span>
              <div>
                <p className="font-bold text-xs text-foreground mb-0.5">{item.title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{item.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Common concerns FAQ ──────────────────────────── */}
      <div className="mb-8">
        <SectionLabel>Common questions & concerns</SectionLabel>
        <FaqAccordion items={FAQS} accentColor={ORANGE} />
      </div>

      {/* ── Final reassurance ─────────────────────────────── */}
      <div className="mb-10 rounded-2xl p-5 text-center"
        style={{ background: 'rgba(0,255,135,0.05)', border: '1px solid rgba(0,255,135,0.2)' }}>
        <div className="text-3xl mb-3">🥜</div>
        <p className="font-black text-sm text-foreground mb-2">You're just a fan selling tickets.</p>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-xs mx-auto">
          Thousands of fans do this every day. The setup takes about 2 minutes and you never have to think about it again. Stripe handles all the complexity — you just get paid.
        </p>
      </div>

      {/* ── CTAs ─────────────────────────────────────────── */}
      <div className="space-y-3">
        <Link to="/sell"
          className="flex items-center justify-center gap-2 w-full py-4 rounded-full font-black text-sm"
          style={{ background: `linear-gradient(135deg, ${ORANGE}, #FF2D78)`, color: '#fff', boxShadow: `0 0 18px rgba(255,140,0,0.25)` }}>
          <Banknote className="w-4 h-4" /> Set Up My Payouts →
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