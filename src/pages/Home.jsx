import { Link } from 'react-router-dom';
import { ArrowRight, Shield, Zap, DollarSign } from 'lucide-react';

const FEATURES = [
  {
    icon: Zap,
    title: 'Real-Time Listings',
    desc: 'Browse available seat upgrades as soon as they go live.',
    color: '#00C8FF',
    grad: 'linear-gradient(135deg, #00C8FF22, #00C8FF08)',
  },
  {
    icon: Shield,
    title: 'Escrow Protected',
    desc: 'Payment is held securely until both sides confirm the transfer.',
    color: '#00FF87',
    grad: 'linear-gradient(135deg, #00FF8722, #00FF8708)',
  },
  {
    icon: DollarSign,
    title: 'Fair Pricing',
    desc: 'Sellers price their own upgrades — you see the savings upfront.',
    color: '#BF5FFF',
    grad: 'linear-gradient(135deg, #BF5FFF22, #BF5FFF08)',
  },
];

export default function Home() {
  return (
    <div className="flex flex-col min-h-[calc(100vh-7rem)] px-5 pb-32">

      {/* Hero */}
      <div className="flex flex-col items-center text-center pt-14 pb-10">
        {/* Pill badge */}
        <div
          className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase px-4 py-1.5 rounded-full mb-8"
          style={{
            background: 'rgba(191,95,255,0.12)',
            border: '1px solid rgba(191,95,255,0.3)',
            color: '#BF5FFF',
            boxShadow: '0 0 20px #BF5FFF33',
          }}
        >
          🥜 Peanut Gallery
        </div>

        <h1 className="font-display leading-[0.9] mb-5" style={{ fontSize: 'clamp(3.2rem, 14vw, 5rem)' }}>
          <span className="block text-foreground">Seat Upgrades,</span>
          <span className="block gradient-text-rave">Right Now.</span>
        </h1>

        <p className="text-base text-muted-foreground max-w-[280px] leading-relaxed mb-10">
          Buy & sell seat upgrades live at the venue — no scalpers, just fans.
        </p>

        <Link
          to="/events"
          className="inline-flex items-center gap-2 font-bold text-base px-8 py-4 rounded-full transition-all active:scale-95 neon-glow-green"
          style={{ background: '#00FF87', color: '#0D0B14' }}
        >
          Browse Events <ArrowRight className="w-5 h-5" />
        </Link>
      </div>

      {/* Divider */}
      <div
        className="h-px mx-auto w-3/4 mb-10"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)' }}
      />

      {/* Feature cards */}
      <div className="grid grid-cols-1 gap-3">
        {FEATURES.map(({ icon: Icon, title, desc, color, grad }) => (
          <div
            key={title}
            className="rounded-2xl p-5 flex items-start gap-4"
            style={{
              background: grad,
              border: `1px solid ${color}22`,
            }}
          >
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ background: color + '18', boxShadow: `0 0 16px ${color}33` }}
            >
              <Icon className="w-5 h-5" style={{ color }} />
            </div>
            <div>
              <h3 className="font-bold text-foreground mb-1 text-base">{title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Bottom CTA strip */}
      <div
        className="mt-8 rounded-2xl p-5 text-center"
        style={{
          background: 'linear-gradient(135deg, rgba(191,95,255,0.1), rgba(255,45,120,0.08))',
          border: '1px solid rgba(191,95,255,0.2)',
        }}
      >
        <p className="text-sm text-muted-foreground mb-3">Already at an event? Sell your spare seats in 60 seconds.</p>
        <Link
          to="/create-listing"
          className="inline-flex items-center gap-2 text-sm font-bold px-6 py-2.5 rounded-full"
          style={{ background: 'rgba(191,95,255,0.2)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.4)' }}
        >
          Sell My Seats →
        </Link>
      </div>

    </div>
  );
}