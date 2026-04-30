import { Outlet, Link, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useState, useEffect } from 'react';

export default function Layout() {
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const handleLogout = () => {
    base44.auth.logout('/');
  };

  return (
    <div className="min-h-screen rave-bg font-sans">
      <header className="frosted-bar border-b border-white/10 sticky top-0 z-50">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-bold text-lg text-primary neon-glow-purple" style={{textShadow:'0 0 12px #BF5FFF99'}}>
            🥜 Peanut Gallery
          </Link>
          <nav className="flex items-center gap-3">
            <Link to="/events" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Events
            </Link>
            {user && (
              <Link to="/my-tickets" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Tickets
              </Link>
            )}
            {user && (
              <Link to="/my-sales" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Sales
              </Link>
            )}
            {user?.role === 'admin' && (
              <Link to="/admin" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Admin
              </Link>
            )}
            {user ? (
              <button
                onClick={handleLogout}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors border border-white/10 rounded-full px-3 py-1"
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
          </nav>
        </div>
      </header>
      <main className="max-w-lg mx-auto">
        <Outlet />
      </main>
    </div>
  );
}