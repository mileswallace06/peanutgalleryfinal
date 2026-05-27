import { Link } from 'react-router-dom';
import { ArrowLeft, Zap, Shield, Clock, CheckCircle, ArrowRight, Lock, Star, Users, Truck } from 'lucide-react';
import FaqAccordion from '@/components/education/FaqAccordion';

const CYAN = '#00C8FF';
const GREEN = '#00FF87';

function SectionLabel({ children, color = CYAN }) {
  return (
    <p className="text-[10px] font-black tracking-widest uppercase mb-4 flex items-center gap-2" style={{ color }}>
      <span className="w-4 h-px inline-block" style={{ background: color }} />
      {children}
    </p>
  );
}

function TrustBadge({ icon, label }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
      style={{ background: 'rgba(0,200,255,0.06)', border: '1px solid rgba(0,200,255,0.2)' }}>
      <span className="text-lg flex-shrink-0">{icon}</span>
      <span className="text-xs font-semibold text-foreground">{label}</span>
    </div>
  );
}

const SELLER_STEPS = [
  { icon: '🎟️', title: 'Transfer Your Ticket to PG', desc: 'Send your ticket to experience@peanutgallery.com via Ticketmaster, SeatGeek, or email — before your listing goes live.' },
  { icon: '📸', title: 'Upload Transfer Proof', desc: 'Screenshot the confirmation and upload it. Takes 30 seconds.' },
  { icon: '✅', title: 'PG Verifies Custody', desc: 'Our team reviews your transfer proof, usually within a few hours. You\'ll be notified once approved.' },
  { icon: '⚡', title: 'Your Listing Goes Live', desc: 'Your listing appears with the ⚡ Instant Transfer badge. You don\'t need to be online or available again.' },
  { icon: '💰', title: 'Get Paid After Sale', desc: 'Once a buyer confirms receipt, payment is released from escrow directly to your bank. Automatic.' },
];

const BUYER_STEPS = [
  { icon: '🔍', title: 'Find a Listing', desc: 'Look for listings with the ⚡ Instant Transfer badge — these are PG-verified tickets already in our custody.' },
  { icon: '🛒', title: 'Buy with Escrow Protection', desc: 'Your payment is held safely in escrow. The seller never gets paid until you confirm receipt.' },
  { icon: '📬', title: 'PG Transfers the Ticket', desc: 'We forward the ticket directly to your email or transfer account — no waiting on the original seller.' },
  { icon: '✅', title: 'Confirm + Enjoy', desc: 'Confirm receipt in the app and your payment is released. That\'s it. No last-minute anxiety.' },
];

const FAQS = [
  { q: 'What does "PG custody" actually mean?', a: 'It means the ticket has been physically transferred from the seller to Peanut Gallery\'s verified account before the listing is published. We hold it until a buyer purchases — then we forward it to the buyer directly.' },
  { q: 'Does the seller still get paid?', a: 'Yes. After the buyer confirms ticket receipt, the escrowed payment is released to the seller\'s bank account via Stripe. Sellers keep 95% of the sale price.' },
  { q: 'What if my transfer proof gets rejected?', a: 'Our team will let you know the reason. Common issues: screenshot not showing both accounts clearly, incomplete transfer, or the ticket was already transferred elsewhere. You can resubmit with a clearer screenshot.' },
  { q: 'Can I cancel my Instant Listing?', a: 'Before verification, yes — contact support and we\'ll return the ticket to you. After a buyer has purchased, cancellation is not possible as the transfer process begins immediately.' },
  { q: 'What ticket platforms can I transfer from?', a: 'We accept transfers from Ticketmaster, AXS, SeatGeek, and email-transferable tickets. The transfer email is experience@peanutgallery.com.' },
  { q: 'What if the buyer says they didn\'t receive the ticket?', a: 'All transfers are logged and verified. Our team can audit the delivery chain and resolve disputes. Buyer funds stay in escrow until the issue is resolved.' },
  { q: 'How long does PG verification take?', a: 'Typically a few hours during business hours. We aim to verify within 24 hours in all cases.' },
  { q: 'Is this available for all events?', a: 'Instant Transfer listings are available for all events on Peanut Gallery. The listing type is optional — you can always choose Standard mode instead.' },
];

export default function InstantListingsGuide() {
  return (
    <div className="max-w-lg mx-auto px-4 pb-32 dark:rave-bg"
      style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top))' }}>

      {/* Back */}
      <Link to="/create-listing"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-8 transition-colors">
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </Link>

      {/* Hero */}
      <div className="mb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-black mb-4"
          style={{ background: 'rgba(0,200,255,0.12)', border: '1px solid rgba(0,200,255,0.3)', color: CYAN }}>
          ⚡ Instant Transfer — How It Works
        </div>
        <h1 className="font-display leading-none mb-3"
          style={{ fontSize: 'clamp(2.4rem, 10vw, 3.5rem)', background: `linear-gradient(135deg, ${CYAN}, ${GREEN})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
          Transfer Once.<br />Sell Instantly.
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
          PG-verified inventory means tickets are already in our hands before your listing goes live. Buyers get instant, guaranteed delivery. Sellers don't need to be online.
        </p>
      </div>

      {/* Trust badges */}
      <div className="grid grid-cols-2 gap-2 mb-10">
        <TrustBadge icon="🔒" label="Escrow Protected" />
        <TrustBadge icon="⚡" label="Instant Delivery" />
        <TrustBadge icon="✅" label="PG Verified Inventory" />
        <TrustBadge icon="🚫" label="No Seller Ghosting" />
      </div>

      {/* What is Instant Transfer */}
      <div className="mb-10 rounded-2xl p-5"
        style={{ background: 'rgba(0,200,255,0.06)', border: '1px solid rgba(0,200,255,0.2)' }}>
        <SectionLabel>What Is Instant Transfer?</SectionLabel>
        <p className="text-sm text-foreground leading-relaxed mb-3">
          Instant Transfer is a listing mode where the seller gives their ticket to Peanut Gallery <strong>before</strong> listing it for sale.
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          This means when a buyer purchases, there's no waiting for the seller to respond, no last-minute cancellations, no "sorry I already sold it" — the ticket is already ours. We transfer it to the buyer immediately.
        </p>
      </div>

      {/* Why it's safer */}
      <div className="mb-10">
        <SectionLabel color={GREEN}>Why This Is Safer & Faster</SectionLabel>
        <div className="space-y-3">
          {[
            { icon: <Shield className="w-4 h-4" style={{ color: GREEN }} />, title: 'No Seller Dependency', desc: 'The seller doesn\'t need to be online, awake, or responsive after listing. We handle delivery.' },
            { icon: <Clock className="w-4 h-4" style={{ color: CYAN }} />, title: 'Instant Delivery', desc: 'Buyers receive their ticket within minutes of purchase — not hours or days.' },
            { icon: <Lock className="w-4 h-4" style={{ color: '#BF5FFF' }} />, title: 'Verified Ownership', desc: 'We physically confirm the ticket before listing it. No duplicates, no fakes.' },
            { icon: <Star className="w-4 h-4" style={{ color: '#FFE600' }} />, title: 'Event-Day Confidence', desc: 'Know your ticket is real and waiting for you. Zero last-minute stress.' },
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-4 px-4 py-4 rounded-2xl"
              style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(0,200,255,0.08)' }}>
                {item.icon}
              </div>
              <div>
                <p className="font-bold text-sm text-foreground">{item.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Seller flow */}
      <div className="mb-10">
        <SectionLabel color="#BF5FFF">For Sellers — How It Works</SectionLabel>
        <div className="space-y-3 relative">
          <div className="absolute left-[1.4rem] top-8 bottom-8 w-px" style={{ background: 'rgba(191,95,255,0.2)' }} />
          {SELLER_STEPS.map((step, i) => (
            <div key={i} className="flex items-start gap-4 pl-2">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-xl flex-shrink-0 z-10"
                style={{ background: 'hsl(var(--card))', border: '1px solid rgba(191,95,255,0.3)' }}>
                {step.icon}
              </div>
              <div className="flex-1 pb-2">
                <p className="font-bold text-sm text-foreground">{step.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Buyer flow */}
      <div className="mb-10">
        <SectionLabel color={CYAN}>For Buyers — How It Works</SectionLabel>
        <div className="space-y-3 relative">
          <div className="absolute left-[1.4rem] top-8 bottom-8 w-px" style={{ background: 'rgba(0,200,255,0.2)' }} />
          {BUYER_STEPS.map((step, i) => (
            <div key={i} className="flex items-start gap-4 pl-2">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-xl flex-shrink-0 z-10"
                style={{ background: 'hsl(var(--card))', border: '1px solid rgba(0,200,255,0.3)' }}>
                {step.icon}
              </div>
              <div className="flex-1 pb-2">
                <p className="font-bold text-sm text-foreground">{step.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Escrow callout */}
      <div className="mb-10 rounded-2xl p-5"
        style={{ background: 'rgba(0,255,135,0.06)', border: '1px solid rgba(0,255,135,0.2)' }}>
        <div className="flex items-center gap-3 mb-3">
          <Lock className="w-5 h-5 flex-shrink-0" style={{ color: GREEN }} />
          <p className="font-black text-base text-foreground">Escrow + Payout Protection</p>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Every Peanut Gallery purchase — Instant or Standard — is escrow-protected. Your payment is held securely until you confirm you received the ticket. The seller never receives funds until delivery is confirmed. Powered by Stripe.
        </p>
      </div>

      {/* Recommended Listing Timeline */}
      <div className="mb-10">
        <SectionLabel color="#FFE600">When should you list?</SectionLabel>
        <p className="text-sm text-muted-foreground leading-relaxed mb-5">
          The earlier you list, the better your chances of selling. Here's what we've seen from real sales data:
        </p>

        <div className="space-y-4">

          {/* 7+ days */}
          <div className="rounded-2xl p-4" style={{ background: 'hsl(var(--card))', border: `1px solid rgba(0,255,135,0.25)` }}>
            <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
              <span className="font-black text-xs text-muted-foreground">7+ days before</span>
              <span className="text-[10px] font-black px-2.5 py-1 rounded-full" style={{ background: 'rgba(0,255,135,0.12)', color: GREEN, border: '1px solid rgba(0,255,135,0.3)' }}>🟢 Prime Window</span>
            </div>
            <p className="font-bold text-sm text-foreground mb-1">Maximum exposure + easiest hands-off experience</p>
            <p className="text-xs text-muted-foreground leading-relaxed mb-2">This is the best time to list if you already know you can't attend. Your ticket gets maximum visibility, buyers have more time to plan, and Instant Transfer inventory has plenty of time to be verified by PG before event day.</p>
            <p className="text-xs text-muted-foreground leading-relaxed mb-2">If you want the fully hands-off experience, use Instant Transfer and transfer your ticket to PG early. Once verified, PG can handle fulfillment for you automatically if your ticket sells.</p>
            <p className="text-xs text-muted-foreground leading-relaxed">If you'd rather keep the ticket yourself until it sells, that's completely fine too — tickets can still be sold all the way until the event ends. You'll just need to be available to manually transfer the ticket to the buyer after purchase in order to receive payout.</p>
            <div className="mt-3 px-3 py-2 rounded-xl text-xs font-semibold" style={{ background: 'rgba(0,255,135,0.08)', border: '1px solid rgba(0,255,135,0.2)', color: GREEN }}>
              💡 Earlier Instant Transfer verification = smoother fulfillment later.
            </div>
          </div>

          {/* 2–6 days */}
          <div className="rounded-2xl p-4" style={{ background: 'hsl(var(--card))', border: `1px solid rgba(0,255,135,0.2)` }}>
            <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
              <span className="font-black text-xs text-muted-foreground">2–6 days before</span>
              <span className="text-[10px] font-black px-2.5 py-1 rounded-full" style={{ background: 'rgba(0,255,135,0.12)', color: GREEN, border: '1px solid rgba(0,255,135,0.3)' }}>🟢 Strong Window</span>
            </div>
            <p className="font-bold text-sm text-foreground mb-1">High buyer activity + verification advantage</p>
            <p className="text-xs text-muted-foreground leading-relaxed mb-2">Demand starts accelerating quickly here. Buyers begin locking in plans and verified inventory becomes much more valuable.</p>
            <p className="text-xs text-muted-foreground leading-relaxed mb-2">Instant Transfer sellers have a major advantage because their inventory is already verified and ready for fast fulfillment.</p>
            <p className="text-xs text-muted-foreground leading-relaxed">Standard listings can still absolutely sell at any point before the event ends — including during the event itself — but sellers must remain available to manually transfer tickets after purchase.</p>
            <div className="mt-3 px-3 py-2 rounded-xl text-xs font-semibold" style={{ background: 'rgba(0,255,135,0.08)', border: '1px solid rgba(0,255,135,0.2)', color: GREEN }}>
              💡 Want the easiest experience? Transfer inventory to PG early.
            </div>
          </div>

          {/* Day before */}
          <div className="rounded-2xl p-4" style={{ background: 'hsl(var(--card))', border: `1px solid rgba(255,230,0,0.2)` }}>
            <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
              <span className="font-black text-xs text-muted-foreground">Day before the event</span>
              <span className="text-[10px] font-black px-2.5 py-1 rounded-full" style={{ background: 'rgba(255,230,0,0.1)', color: '#FFE600', border: '1px solid rgba(255,230,0,0.3)' }}>🟡 High Demand</span>
            </div>
            <p className="font-bold text-sm text-foreground mb-1">Urgency starts taking over</p>
            <p className="text-xs text-muted-foreground leading-relaxed mb-2">A huge percentage of buyers shop the day before events. Buyers now heavily prioritize fast delivery, verified inventory, and trusted fulfillment.</p>
            <p className="text-xs text-muted-foreground leading-relaxed mb-2">Instant Transfer becomes especially valuable here because buyers do not want to risk slow seller response times.</p>
            <p className="text-xs text-muted-foreground leading-relaxed">Standard listings can still sell perfectly fine, but sellers should expect to stay near their phone/device in case a buyer purchases and needs immediate transfer.</p>
            <div className="mt-3 px-3 py-2 rounded-xl text-xs font-semibold" style={{ background: 'rgba(255,230,0,0.08)', border: '1px solid rgba(255,230,0,0.2)', color: '#c8b800' }}>
              💡 Instant Transfer removes the need to babysit your listings.
            </div>
          </div>

          {/* Day of */}
          <div className="rounded-2xl p-4" style={{ background: 'hsl(var(--card))', border: `1px solid rgba(255,140,0,0.2)` }}>
            <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
              <span className="font-black text-xs text-muted-foreground">Day of the event</span>
              <span className="text-[10px] font-black px-2.5 py-1 rounded-full" style={{ background: 'rgba(255,140,0,0.1)', color: '#FF8C00', border: '1px solid rgba(255,140,0,0.3)' }}>🟠 Peak Urgency</span>
            </div>
            <p className="font-bold text-sm text-foreground mb-1">Fast fulfillment matters most</p>
            <p className="text-xs text-muted-foreground leading-relaxed mb-2">Day-of buyers are making fast decisions and want immediate fulfillment. This is where Peanut Gallery becomes very different from traditional resale marketplaces.</p>
            <p className="text-xs text-muted-foreground leading-relaxed mb-2">Tickets can still be sold throughout the event, including as live upgrades. However, Instant Transfer inventory is already verified and ready — standard listings still require the seller to manually transfer tickets after purchase.</p>
            <p className="text-xs text-muted-foreground leading-relaxed">If a seller cannot complete transfer, payout cannot be released.</p>
            <div className="mt-3 px-3 py-2 rounded-xl text-xs font-semibold" style={{ background: 'rgba(255,140,0,0.08)', border: '1px solid rgba(255,140,0,0.2)', color: '#FF8C00' }}>
              💡 If you know you won't be available later, transfer inventory to PG early for the fully hands-off experience.
            </div>
          </div>

          {/* After event starts */}
          <div className="rounded-2xl p-4" style={{ background: 'hsl(var(--card))', border: `1px solid rgba(0,200,255,0.2)` }}>
            <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
              <span className="font-black text-xs text-muted-foreground">After the event starts</span>
              <span className="text-[10px] font-black px-2.5 py-1 rounded-full" style={{ background: 'rgba(0,200,255,0.1)', color: CYAN, border: '1px solid rgba(0,200,255,0.3)' }}>⚡ Live Upgrade Window</span>
            </div>
            <p className="font-bold text-sm text-foreground mb-1">Where Peanut Gallery becomes different</p>
            <p className="text-xs text-muted-foreground leading-relaxed mb-2">Traditional resale marketplaces effectively stop once an event begins. Peanut Gallery is designed for live event demand.</p>
            <p className="text-xs text-muted-foreground leading-relaxed mb-2">Fans already inside the venue may move closer, upgrade sections, grab newly available seats, or improve their experience mid-event. Tickets can continue selling until the event ends.</p>
            <p className="text-xs text-muted-foreground leading-relaxed">Instant Transfer inventory becomes incredibly valuable here because PG already has custody and can begin fulfillment immediately. Standard listings can still sell too — sellers just need to remain available to manually transfer tickets to buyers after purchase in order to receive payout.</p>
            <div className="mt-3 px-3 py-2 rounded-xl text-xs font-semibold" style={{ background: 'rgba(0,200,255,0.08)', border: '1px solid rgba(0,200,255,0.2)', color: CYAN }}>
              💡 Instant Transfer is the easiest way to participate in live upgrades without needing to monitor your phone during the event.
            </div>
          </div>

        </div>

        {/* CTA nudge */}
        <div className="mt-5 rounded-2xl p-4 text-center"
          style={{ background: 'rgba(0,200,255,0.06)', border: '1px solid rgba(0,200,255,0.2)' }}>
          <p className="font-black text-sm text-foreground mb-1">📅 Just found out you can't make it?</p>
          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">List right now — every hour you wait is a potential buyer you miss.</p>
          <Link to="/create-listing"
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full font-black text-xs"
            style={{ background: `linear-gradient(135deg, ${CYAN}, ${GREEN})`, color: '#0D0B14' }}>
            <Zap className="w-3.5 h-3.5" /> List My Tickets Now
          </Link>
        </div>
      </div>

      {/* FAQ */}
      <div className="mb-10">
        <SectionLabel color={CYAN}>Frequently Asked Questions</SectionLabel>
        <FaqAccordion items={FAQS} accentColor={CYAN} />
      </div>

      {/* CTAs */}
      <div className="space-y-3">
        <Link to="/create-listing"
          className="flex items-center justify-center gap-2 w-full py-4 rounded-full font-black text-sm"
          style={{ background: `linear-gradient(135deg, ${CYAN}, ${GREEN})`, color: '#0D0B14', boxShadow: `0 0 18px rgba(0,200,255,0.25)` }}>
          <Zap className="w-4 h-4" /> Create Instant Listing
        </Link>
        <Link to="/seller-payout-guide"
          className="flex items-center justify-center gap-2 w-full py-3.5 rounded-full font-semibold text-sm"
          style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}>
          Learn About Payouts <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}