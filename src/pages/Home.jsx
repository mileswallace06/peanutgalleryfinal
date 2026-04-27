import { Link } from 'react-router-dom';
import { ArrowRight, Shield, Zap, DollarSign } from 'lucide-react';

export default function Home() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-16 text-center">
      <div className="text-6xl mb-6">🥜</div>
      <h1 className="text-4xl sm:text-5xl font-extrabold text-foreground mb-4 leading-tight">
        Seat Upgrades,<br />
        <span className="text-primary">Right Now.</span>
      </h1>
      <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-8">
        Peanut Gallery connects fans with better seats to fans who want them — all within the same venue, during the event.
      </p>
      <Link
        to="/events"
        className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-xl font-bold text-base hover:bg-primary/90 transition-colors"
      >
        Browse Events <ArrowRight className="w-5 h-5" />
      </Link>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mt-16">
        {[
          { icon: Zap, title: 'Real-Time Listings', desc: 'Browse available seat upgrades as soon as they go live.' },
          { icon: Shield, title: 'Escrow Protected', desc: 'Payment is held securely until both sides confirm the transfer.' },
          { icon: DollarSign, title: 'Fair Pricing', desc: 'Sellers price their own upgrades — you see the savings upfront.' },
        ].map(({ icon: Icon, title, desc }) => (
          <div key={title} className="bg-white border border-border rounded-2xl p-5 text-left">
            <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center mb-3">
              <Icon className="w-5 h-5 text-primary" />
            </div>
            <h3 className="font-bold text-foreground mb-1">{title}</h3>
            <p className="text-sm text-muted-foreground">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}