import { Link } from 'react-router-dom';
import { ArrowRight, Shield, Zap, DollarSign } from 'lucide-react';

export default function Home() {
  return (
    <div className="px-4 py-16 pb-32 text-center">
      <div className="text-6xl mb-6">🥜</div>
      <h1 className="font-display text-5xl sm:text-6xl text-foreground mb-4 leading-tight">
        Seat Upgrades,<br />
        <span className="gradient-text-rave">Right Now.</span>
      </h1>
      <p className="text-base text-muted-foreground max-w-xs mx-auto mb-10">
        Peanut Gallery connects fans with better seats to fans who want them — all within the same venue, during the event.
      </p>
      <Link
        to="/events"
        className="inline-flex items-center gap-2 font-bold text-base px-8 py-4 rounded-full transition-all neon-glow-green"
        style={{ background: '#00FF87', color: '#0D0B14' }}
      >
        Browse Events <ArrowRight className="w-5 h-5" />
      </Link>

      <div className="grid grid-cols-1 gap-4 mt-16">
        {[
          { icon: Zap, title: 'Real-Time Listings', desc: 'Browse available seat upgrades as soon as they go live.', color: '#00C8FF' },
          { icon: Shield, title: 'Escrow Protected', desc: 'Payment is held securely until both sides confirm the transfer.', color: '#00FF87' },
          { icon: DollarSign, title: 'Fair Pricing', desc: 'Sellers price their own upgrades — you see the savings upfront.', color: '#BF5FFF' },
        ].map(({ icon: Icon, title, desc, color }) => (
          <div key={title} className="glass-card rounded-2xl p-5 text-left">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: color + '18' }}>
              <Icon className="w-5 h-5" style={{ color }} />
            </div>
            <h3 className="font-bold text-foreground mb-1">{title}</h3>
            <p className="text-sm text-muted-foreground">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}