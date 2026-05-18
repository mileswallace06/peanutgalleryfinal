import { Outlet, Link, useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useState, useEffect, useRef } from 'react';
import { MapPin, Zap, Tag, Flame, User } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import Onboarding from '@/components/Onboarding';
import { useAuth } from '@/lib/AuthContext';

const NAV = [
  { to: '/events', label: 'Tickets', icon: MapPin, color: '#BF5FFF', key: 'events' },
  { to: '/upgrades', label: 'Upgrades', icon: Zap, color: '#00FF87', key: 'upgrades' },
  { to: '/sell', label: 'Sell', icon: Tag, color: '#FF8C00', key: 'sell' },
  { to: '/fan-zone', label: 'Fan Zone', icon: Flame, color: '#00C8FF', key: 'fanzone' },
  { to: '/me', label: 'Me', icon: User, color: '#FF2D78', key: 'me' }
];

export default function Layout() {
  // Use AuthContext user instead of a separate auth.me() call to avoid duplicate requests
  const { user } = useAuth();
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('pg_onboarded'));
  const location = useLocation();
  const scrollPositions = useRef({});
  const containerRefs = useRef({});

  // Initialize theme hook at top level
  useTheme();

  // Get current tab key
  const getCurrentTab = () => {
    const path = location.pathname;
    return NAV.find(n => path === n.to || path.startsWith(n.to + '/'))?.key || 'events';
  };

  const currentTab = getCurrentTab();

  // Save scroll position before switching tabs
  useEffect(() => {
    const container = containerRefs.current[currentTab];
    if (container) {
      scrollPositions.current[currentTab] = container.scrollTop;
    }
  }, [location.pathname, currentTab]);

  // Restore scroll position when tab is selected
  useEffect(() => {
    const container = containerRefs.current[currentTab];
    if (container) {
      setTimeout(() => {
        container.scrollTop = scrollPositions.current[currentTab] || 0;
      }, 0);
    }
  }, [currentTab]);

  // Log when user auth state resolves in Layout (debug only)
  useEffect(() => {
    if (user) {
      console.log('[Layout] user resolved from AuthContext — email:', user.email, '| role:', user.role);
    }
  }, [user]);

  if (showOnboarding) {
    return <Onboarding onDone={() => setShowOnboarding(false)} />;
  }

  return (
    <div className="min-h-screen bg-background font-sans dark:rave-bg">
      {!user && (
        <div className="fixed right-4 z-[99]" style={{ top: 'calc(1rem + env(safe-area-inset-top))' }}>
          <button
            onClick={() => base44.auth.redirectToLogin()}
            className="text-sm font-bold px-4 py-1.5 rounded-full"
            style={{ background: '#BF5FFF', color: '#fff' }}>
            Sign in
          </button>
        </div>
      )}

      {/* Stack-preserved tab containers */}
      <div className="relative w-full max-w-lg mx-auto pb-24" style={{ overscrollBehavior: 'none' }}>
        {NAV.map(({ to, key }) => (
          <div
            key={key}
            ref={el => containerRefs.current[key] = el}
            className={`overflow-y-auto transition-opacity duration-200 ${
              currentTab === key ? 'opacity-100 relative' : 'opacity-0 absolute inset-0 pointer-events-none'
            }`}
            style={{ height: '100vh', overscrollBehavior: 'none' }}>
            {currentTab === key && <Outlet />}
          </div>
        ))}
      </div>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 frosted-bar border-t border-white/10 dark:border-white/10" style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}>
        <div className="max-w-lg mx-auto flex items-stretch">
          {NAV.map(({ to, label, icon: Icon, color, key }) => {
            const active = currentTab === key;
            return (
              <Link
                key={to}
                to={to}
                className="flex-1 flex flex-col items-center justify-center gap-0.5 py-3 relative transition-all"
                style={{ color: active ? color : 'rgba(255,255,255,0.38)' }}>
                {active && (
                  <span
                    className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-b"
                    style={{
                      background: `linear-gradient(90deg, ${color}00, ${color}, ${color}00)`,
                      boxShadow: `0 0 8px ${color}88`
                    }} />
                )}
                <div
                  className="w-11 h-9 flex items-center justify-center rounded-xl transition-all"
                  style={active ? { background: `${color}18`, boxShadow: `0 0 14px ${color}44` } : {}}>
                  <Icon
                    className="w-5 h-5"
                    style={active ? { filter: `drop-shadow(0 0 6px ${color}bb)`, strokeWidth: 2.5 } : { strokeWidth: 1.8 }} />
                </div>
                <span className="text-[10px] font-bold leading-none">{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}