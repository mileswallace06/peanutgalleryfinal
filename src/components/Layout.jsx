import { Outlet, Link, useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useState, useEffect } from 'react';
import { Calendar, Ticket, TrendingUp, Shield, LogIn } from 'lucide-react';

export default function Layout() {
  const [user, setUser] = useState(null);
  const location = useLocation();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const handleLogout = () => {
    base44.auth.logout('/');
  };

  const isActive = (path) => location.pathname === path || location.pathname.startsWith(path + '/');

  const navItems = [
    { to: '/events', label: 'Events', icon: Calendar, color: '#00C8FF' },
    ...(user ? [
      { to: '/my-tickets', label: 'Tickets', icon: Ticket, color: '#00FF87' },
      { to: '/my-sales', label: 'Sales', icon: TrendingUp, color: '#BF5FFF' },
    ] : []),
    ...(user?.role === 'admin' ? [
      { to: '/admin', label: 'Admin', icon: Shield, color: '#FFE600' },
    ] : []),
  ];

  return (
    <div className="min-h-screen rave-bg font-sans">
      {/* Top brand bar */}
      <header className="frosted-bar border-b border-white/10 sticky top-0 z-50">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-bold text-lg text-primary" style={{textShadow:'0 0 12px #BF5FFF99'}}>
            🥜 Peanut Gallery
          </Link>
          {user ? (
            <button
              onClick={handleLogout}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors border border-white/10 rounded-full px-3 py-1.5"
            >
              Sign out
            </button>
          ) : (
            <button
              onClick={() => base44.auth.redirectToLogin()}
              className="text-sm font-bold px-4 py-1.5 rounded-full transition-colors"
              style={{background:'#BF5FFF', color:'#fff'}}
            >
              Sign in
            </button>
          )}
        </div>
      </header>

      {/* Page content — padded at bottom to clear nav */}
      <main className="max-w-lg mx-auto pb-24">
        <Outlet />
      </main>

      {/* Bottom nav bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 frosted-bar border-t border-white/10">
        <div className="max-w-lg mx-auto flex items-stretch">
          {navItems.map(({ to, label, icon: Icon, color }) => {
            const active = isActive(to);
            return (
              <Link
                key={to}
                to={to}
                className="flex-1 flex flex-col items-center justify-center gap-1 py-3 transition-all"
                style={{ color: active ? color : 'rgba(255,255,255,0.4)' }}
              >
                <Icon
                  className="w-5 h-5"
                  style={active ? { filter: `drop-shadow(0 0 6px ${color})` } : {}}
                />
                <span className="text-[10px] font-bold">{label}</span>
                {active && (
                  <span
                    className="absolute bottom-0 w-8 h-0.5 rounded-full"
                    style={{ background: color, boxShadow: `0 0 8px ${color}` }}
                  />
                )}
              </Link>
            );
          })}
          {!user && (
            <button
              onClick={() => base44.auth.redirectToLogin()}
              className="flex-1 flex flex-col items-center justify-center gap-1 py-3 transition-all"
              style={{ color: 'rgba(255,255,255,0.4)' }}
            >
              <LogIn className="w-5 h-5" />
              <span className="text-[10px] font-bold">Sign In</span>
            </button>
          )}
        </div>
      </nav>
    </div>
  );
}