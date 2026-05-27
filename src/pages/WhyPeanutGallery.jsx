import { Link } from 'react-router-dom';
import { ArrowLeft, Shield, Zap, CheckCircle, X, Users, Lock, TrendingUp, Heart } from 'lucide-react';
import FaqAccordion from '@/components/education/FaqAccordion';

const GREEN = '#00FF87';
const CYAN = '#00C8FF';
const PURPLE = '#BF5FFF';
const PINK = '#FF2D78';

function SectionLabel({ children, color = PURPLE }) {
  return (
    <p className="text-[10px] font-black tracking-widest uppercase mb-4 flex items-center gap-2" style={{ color }}>
      <span className="w-4 h-px inline-block" style={{ background: color }} />
      {children}
    </p>
  );
}

const COMPARE = [
  {
    feature: 'Payment held in escrow',
    pg: true,
    them: false,
    detail: 'Buyers pay before the event — but the seller doesn\'t get paid until delivery is confirmed.',
  },
  {
    feature: 'Verified ticket proof',
    pg: true,
    them: false,
    detail: 'Sellers upload ticket screenshots for admin review before listing goes live.',
  },
  {
    feature: 'Instant Transfer option',
    pg: true,
    them: false,
    detail: 'PG holds the ticket before listing — no waiting on the seller after purchase.',
  },
  {
    feature: 'No last-minute seller ghosting',
    pg: true,
    them: false,
    detail: 'Escrow + Instant Transfer removes seller incentive to back out after listing.',
  },
  {
    feature: 'Anti-scalper focused',
    pg: true,
    them: false,
    detail: 'PG is built for real fans who have real tickets. Not bulk-buyback scalper bots.',
  },
  {
    feature: 'Self-service dispute resolution',
    pg: true,
    them: 'partial',
    detail: 'Admin-reviewed disputes with clear escalation paths for both parties.',
  },
  {
    feature: 'Transparent fees',
    pg: true,
    them: 'partial',
    detail: 'A single 5% service fee (min $1). Shown clearly before you pay. No surprise add-ons.',
  },
];

const FEATURES = [
  {
    icon: <Lock className="w-5 h-5" />,
    color: GREEN,
    title: 'Escrow Protection',
    desc: 'Every transaction is held in escrow. Buyers don\'t release funds until they confirm receipt. Sellers don\'t get paid until delivery. Simple.',
  },
  {
    icon: <Shield className="w-5 h-5" />,
    color: CYAN,
    title: 'Verified Inventory',
    desc: 'Sellers submit proof of ownership. Our team reviews and approves listings. Listings marked Verified have passed a human review.',
  },
  {
    icon: <Zap className="w-5 h-5" />,
    color: PURPLE,
    title: 'Instant Transfer',
    desc: 'With Instant listings, the ticket is already in PG\'s hands before the listing goes live. Buyers get guaranteed instant delivery.',
  },
  {
    icon: <Users className="w-5 h-5" />,
    color: PINK,
    title: 'Fan-First Marketplace',
    desc: 'Built for fans who have real tickets they can\'t use — not for scalpers who mass-buy inventory. The vibe is different here.',
  },
  {
    icon: <TrendingUp className="w-5 h-5" />,
    color: '#FFE600',
    title: 'Seller-Friendly Economics',
    desc: 'Sellers keep 95% of the sale price — one of the highest rates in the resale market. No hidden listing fees or withdrawal minimums.',
  },
  {
    icon: <Heart className="w-5 h-5" />,
    color: GREEN,
    title: 'Anti-Ghosting Design',
    desc: 'Seller behavior is tracked. Buyers can leave feedback. Escrow + Instant Transfer remove the main incentives to ghost after listing.',
  },
];


const FAQS = [
  { q: 'What happens if the ticket turns out to be fake?', a: 'All listings go through a verification process. For Instant listings, we physically hold the ticket. If a ticket is ever found to be fraudulent, the buyer receives a full refund and the seller\'s account is permanently suspended. Escrow means nobody gets paid until delivery is confirmed.' },
  { q: 'Can I trust a seller I\'ve never heard of?', a: 'You don\'t have to. Our escrow system means you pay upfront but the seller doesn\'t receive a cent until you confirm the ticket was delivered. If anything goes wrong, you can dispute — and we hold the funds until it\'s resolved.' },
  { q: 'Is Peanut Gallery for season ticket holders?', a: 'Yes — and it\'s ideal. Season ticket holders often have games or shows they can\'t attend. PG gives them a safe, fan-friendly way to sell individual games without worrying about getting ghosted by buyers or not getting paid.' },
  { q: 'How does PG prevent scalping?', a: 'We can\'t prevent all resale, but we\'re not built for scalpers. There are no bulk-listing tools, no bot-friendly APIs, and the verification process creates friction for anyone trying to list fake or duplicate inventory.' },
  { q: 'What if the seller cancels after I pay?', a: 'Funds are in escrow — the seller can\'t take them. If a seller backs out after a purchase, the buyer receives a full refund and the seller is penalized or removed from the platform.' },
  { q: 'Does PG take a big cut?', a: 'Just 5% (minimum $1). That\'s it. No listing fee, no withdrawal fee, no payment processing fee on top. Compare that to StubHub\'s 15–25% combined buyer/seller fees.' },
  { q: 'Is my payment info secure?', a: 'Yes. All payments are processed by Stripe, which is PCI DSS Level 1 certified — the highest level of card security. PG never stores your card number or banking details.' },
  { q: 'What\'s the Fan Zone?', a: 'The Fan Zone is a social feed for fans — share seat upgrades, show off your row, and connect with other fans at the same events. It\'s the community layer on top of the marketplace.' },
];

export default function WhyPeanutGallery() {
  return (
    <div className="max-w-lg mx-auto px-4 pb-32 dark:rave-bg"
      style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top))' }}>

      {/* Back */}
      <Link to="/me"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-8 transition-colors">
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </Link>

      {/* Hero */}
      <div className="mb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-black mb-4"
          style={{ background: 'rgba(191,95,255,0.12)', border: '1px solid rgba(191,95,255,0.3)', color: PURPLE }}>
          🥜 Built by fans, for fans.
        </div>
        <h1 className="font-display leading-none mb-3"
          style={{ fontSize: 'clamp(2.4rem, 10vw, 3.5rem)', background: `linear-gradient(135deg, ${PURPLE}, ${PINK}, ${GREEN})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
          Why Peanut<br />Gallery?
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
          The resale market is broken. Fans get burned every day by fake tickets, ghosted sellers, and opaque fees. We built PG to fix that.
        </p>
      </div>

      {/* The problem */}
      <div className="mb-10 rounded-2xl p-5"
        style={{ background: 'rgba(255,45,120,0.06)', border: '1px solid rgba(255,45,120,0.2)' }}>
        <SectionLabel color={PINK}>The Problem With Ticket Resale</SectionLabel>
        <div className="space-y-3">
          {[
            'Sellers ghost buyers after listing — especially at face value.',
            'Fake or duplicate tickets slip through on major platforms.',
            'Buyers pay 25–35% in combined hidden fees.',
            'No verification that the seller actually owns the ticket.',
            'Disputes take weeks and often favor neither side.',
            'The market is dominated by scalper bots, not real fans.',
          ].map((prob, i) => (
            <div key={i} className="flex items-start gap-3">
              <X className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: PINK }} />
              <span className="text-sm text-muted-foreground">{prob}</span>
            </div>
          ))}
        </div>
      </div>

      {/* How PG is different */}
      <div className="mb-10">
        <SectionLabel color={GREEN}>How PG Is Different</SectionLabel>
        <div className="space-y-3">
          {FEATURES.map((f, i) => (
            <div key={i} className="flex items-start gap-4 px-4 py-4 rounded-2xl"
              style={{ background: 'hsl(var(--card))', border: `1px solid ${f.color}22` }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: `${f.color}12`, color: f.color }}>
                {f.icon}
              </div>
              <div>
                <p className="font-bold text-sm text-foreground">{f.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Comparison */}
      <div className="mb-10">
        <SectionLabel color={CYAN}>PG vs. Traditional Resale</SectionLabel>
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid hsl(var(--border))' }}>
          {/* Header */}
          <div className="grid grid-cols-3 px-4 py-3 text-xs font-black"
            style={{ background: 'hsl(var(--muted))', borderBottom: '1px solid hsl(var(--border))' }}>
            <div className="text-muted-foreground">Feature</div>
            <div className="text-center" style={{ color: GREEN }}>🥜 PG</div>
            <div className="text-center text-muted-foreground">Others</div>
          </div>
          {COMPARE.map((row, i) => (
            <div key={i} className="grid grid-cols-3 px-4 py-3 items-center gap-2 text-xs"
              style={{ background: i % 2 === 0 ? 'hsl(var(--card))' : 'transparent', borderBottom: i < COMPARE.length - 1 ? '1px solid hsl(var(--border))' : 'none' }}>
              <div className="text-foreground font-medium leading-snug">{row.feature}</div>
              <div className="flex justify-center">
                <CheckCircle className="w-4 h-4" style={{ color: GREEN }} />
              </div>
              <div className="flex justify-center">
                {row.them === true
                  ? <CheckCircle className="w-4 h-4 text-muted-foreground" />
                  : row.them === 'partial'
                  ? <span className="text-muted-foreground font-bold">〜</span>
                  : <X className="w-4 h-4" style={{ color: PINK }} />
                }
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Season ticket holders */}
      <div className="mb-10 rounded-2xl p-5"
        style={{ background: 'rgba(0,200,255,0.06)', border: '1px solid rgba(0,200,255,0.2)' }}>
        <SectionLabel color={CYAN}>Perfect for Season Ticket Holders</SectionLabel>
        <p className="text-sm text-muted-foreground leading-relaxed mb-3">
          Got a handful of games you can't make this season? Peanut Gallery is built for you. List your seats, set your price, and walk away. Escrow handles everything — you don't need to be online when the ticket sells.
        </p>
        <div className="space-y-2">
          {[
            'No pressure to monitor your listing after posting',
            'Get paid automatically after buyer confirms',
            'Use Instant Transfer to fully automate the handoff',
            'Keep 95% — no nickel-and-diming',
          ].map((pt, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-foreground">
              <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: CYAN }} />
              {pt}
            </div>
          ))}
        </div>
      </div>


      {/* Fan-first callout */}
      <div className="mb-10 rounded-2xl p-5 text-center"
        style={{ background: 'rgba(191,95,255,0.06)', border: '1px solid rgba(191,95,255,0.2)' }}>
        <div className="text-4xl mb-3">🥜</div>
        <h2 className="font-display text-2xl mb-2" style={{ color: PURPLE }}>Built by fans, for fans.</h2>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">
          We started Peanut Gallery because we got burned buying resale tickets. We built the marketplace we wish had existed. Every feature exists to protect real fans — not to maximize platform take rates.
        </p>
      </div>

      {/* FAQ */}
      <div className="mb-10">
        <SectionLabel>Frequently Asked Questions</SectionLabel>
        <FaqAccordion items={FAQS} accentColor={PURPLE} />
      </div>

      {/* CTAs */}
      <div className="space-y-3">
        <Link to="/events"
          className="flex items-center justify-center gap-2 w-full py-4 rounded-full font-black text-sm"
          style={{ background: `linear-gradient(135deg, ${PURPLE}, ${PINK})`, color: '#fff', boxShadow: `0 0 18px rgba(191,95,255,0.25)` }}>
          Browse Events
        </Link>
        <Link to="/sell"
          className="flex items-center justify-center gap-2 w-full py-3.5 rounded-full font-semibold text-sm"
          style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}>
          Start Selling
        </Link>
      </div>
    </div>
  );
}