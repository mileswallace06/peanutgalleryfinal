import { Link } from 'react-router-dom';
import { ArrowRight, Shield, Zap, MapPin } from 'lucide-react';

const FEATURES = [
  {
    icon: Zap,
    title: 'Browse live upgrades',
    desc: 'See available seats the moment fans list them.',
    color: '#00C8FF',
  },
  {
    icon: Shield,
    title: 'Pay safely with escrow',
    desc: 'Your money is held until you confirm receipt.',
    color: '#00FF87',
  },
  {
    icon: MapPin,
    title: 'Move closer instantly',
    desc: 'Better seats, better experience — right now.',
    color: '#BF5FFF',
  },
];

export default function Home() {
  return (
    <div className="flex flex-col min-h-[calc(100vh-7rem)] px-5 pb-32 pt-12">

      {/* ── Hero ── */}
      <div className="flex flex-col items-center text-center gap-4 mb-14">
        <h1
          className="font-display leading-[0.92]"
          style={{ fontSize: 'clamp(3.4rem, 15vw, 5.5rem)' }}
        >
          <span className="block" style={{ color: '#00FF87', filter: 'drop-shadow(0 0 20px #00FF8766)' }}>Find.</span>
          <span className="block" style={{ color: '#BF5FFF', filter: 'drop-shadow(0 0 20px #BF5FFF66)' }}>Upgrade.</span>
          <span className="block" style={{ color: '#FF2D78', filter: 'drop-shadow(0 0 20px #FF2D7866)' }}>Enjoy.</span>
        </h1>
        <p className="text-sm text-muted-foreground max-w-[240px] leading-relaxed">
          Upgrade your seats during the event
        </p>
      </div>

      {/* ── Feature cards ── */}
      <div className="flex flex-col gap-3 mb-14">
        {FEATURES.map(({ icon: Icon, title, desc, color }) => (
          <div
            key={title}
            className="glass-card rounded-2xl px-5 py-4 flex items-center gap-4"
            style={{ boxShadow: `0 0 24px ${color}18` }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: color + '18', boxShadow: `0 0 14px ${color}44` }}
            >
              <Icon className="w-5 h-5" style={{ color }} />
            </div>
            <div>
              <p className="font-bold text-foreground text-sm">{title}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── CTAs ── */}
      <div className="flex flex-col items-center gap-3">
        <Link
          to="/events"
          className="w-full flex items-center justify-center gap-2 font-bold text-base py-4 rounded-full transition-all active:scale-95 neon-glow-green"
          style={{ background: '#00FF87', color: '#0D0B14' }}
        >
          Browse Events <ArrowRight className="w-5 h-5" />
        </Link>
        <Link
          to="/create-listing"
          className="text-sm font-semibold py-2 px-6 rounded-full transition-all active:scale-95"
          style={{
            background: 'rgba(255,255,255,0.06)',
            color: 'rgba(255,255,255,0.6)',
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          List Your Seats
        </Link>
      </div>

    </div>
  );
}