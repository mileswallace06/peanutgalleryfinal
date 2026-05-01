import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Ticket, TrendingUp, Shield, LogIn } from 'lucide-react';

export default function Me() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const initials = user?.full_name ?
  user.full_name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2) :
  '?';

  if (!user) {
    return (
      <div className="rave-bg min-h-screen pb-28 flex flex-col items-center justify-center gap-6 px-5">
        <div className="text-5xl">🥜</div>
        <h2 className="font-display text-3xl text-foreground">Sign In</h2>
        <p className="text-sm text-muted-foreground text-center max-w-[240px]">
          Sign in to view your profile, tickets and sales.
        </p>
        <button
          onClick={() => base44.auth.redirectToLogin()}
          className="flex items-center gap-2 font-bold px-8 py-3.5 rounded-full neon-glow-green"
          style={{ background: 'linear-gradient(135deg, #00FF87, #00C8FF)', color: '#0D0B14' }}>
          
          <LogIn className="w-4 h-4" /> Sign In
        </button>
      </div>);

  }

  return (
    <div className="rave-bg min-h-screen pb-28">
      {/* Hero banner */}
      <div className="relative h-44 overflow-hidden">
        



        
        
        
      </div>

      {/* Avatar + name */}
      <div className="px-5 -mt-10 flex flex-col items-center text-center gap-2">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center font-display text-2xl text-white"
          style={{ background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)', boxShadow: '0 0 24px #BF5FFF66' }}>
          
          {initials}
        </div>
        <h2 className="font-display text-2xl text-foreground mt-1">{user.full_name || 'Fan'}</h2>
        <p className="text-xs text-muted-foreground">{user.email}</p>

        <div className="flex items-center gap-2 mt-1">
          {user.role === 'admin' &&
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full"
          style={{ background: '#BF5FFF18', color: '#BF5FFF', border: '1px solid #BF5FFF30' }}>
              ✦ Admin
            </span>
          }
        </div>
      </div>

      {/* Quick links */}
      <div className="px-5 mt-8 space-y-3">
        <Link to="/my-tickets"
        className="flex items-center gap-4 px-5 py-4 rounded-2xl transition-all active:scale-[0.98]"
        style={{ background: 'rgba(0,200,255,0.06)', border: '1px solid rgba(0,200,255,0.18)' }}>
          <Ticket className="w-5 h-5" style={{ color: '#00C8FF' }} />
          <div>
            <div className="font-bold text-foreground text-sm">My Tickets</div>
            <div className="text-xs text-muted-foreground">View your purchases</div>
          </div>
        </Link>

        <Link to="/my-sales"
        className="flex items-center gap-4 px-5 py-4 rounded-2xl transition-all active:scale-[0.98]"
        style={{ background: 'rgba(191,95,255,0.06)', border: '1px solid rgba(191,95,255,0.18)' }}>
          <TrendingUp className="w-5 h-5" style={{ color: '#BF5FFF' }} />
          <div>
            <div className="font-bold text-foreground text-sm">My Sales</div>
            <div className="text-xs text-muted-foreground">Track your listings</div>
          </div>
        </Link>

        {user.role === 'admin' &&
        <Link to="/admin"
        className="flex items-center gap-4 px-5 py-4 rounded-2xl transition-all active:scale-[0.98]"
        style={{ background: 'rgba(255,230,0,0.05)', border: '1px solid rgba(255,230,0,0.15)' }}>
            <Shield className="w-5 h-5" style={{ color: '#FFE600' }} />
            <div>
              <div className="font-bold text-foreground text-sm">Admin Panel</div>
              <div className="text-xs text-muted-foreground">Manage events and listings</div>
            </div>
          </Link>
        }

        <button
          onClick={() => base44.auth.logout('/')}
          className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors py-3">
          
          Sign out
        </button>
      </div>
    </div>);

}