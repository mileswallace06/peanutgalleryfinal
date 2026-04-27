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
    <div className="min-h-screen bg-background font-inter">
      <header className="bg-white border-b border-border sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-bold text-lg text-primary">
            🥜 Peanut Gallery
          </Link>
          <nav className="flex items-center gap-4">
            <Link to="/events" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Events
            </Link>
            {user && (
              <Link to="/my-sales" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                My Sales
              </Link>
            )}
            {user?.role === 'admin' && (
              <Link to="/admin" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Admin
              </Link>
            )}
            {user ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground hidden sm:block">{user.full_name || user.email}</span>
                <button
                  onClick={handleLogout}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <button
                onClick={() => base44.auth.redirectToLogin()}
                className="text-sm bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 transition-colors"
              >
                Sign in
              </button>
            )}
          </nav>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}