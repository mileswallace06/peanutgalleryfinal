import { Outlet, Link, useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useState, useEffect, useRef } from 'react';
import { MapPin, Zap, Tag, Flame, User, Bell } from 'lucide-react';
import { getEventLiveStatus } from '@/lib/eventTiming';
import { useTheme } from '@/hooks/useTheme';
import Onboarding from '@/components/Onboarding';
import { useAuth } from '@/lib/AuthContext';
import DonationWinNotification from '@/components/donations/DonationWinNotification';

/**
 * Once a tab has been activated, keep its Outlet mounted permanently.
 * This prevents remounts / state resets on tab switches.
 */
function MountedTab({ tabKey, activeKey }) {
  const mountedRef = useRef(false);
  if (activeKey === tabKey) mountedRef.current = true;
  if (!mountedRef.current) return null;
  return <Outlet />;
}

const NAV = [
  { to: '/events', label: 'Tickets', icon: MapPin, color: '#BF5FFF', key: 'events' },
  { to: '/upgrades', label: 'Upgrades', icon: Zap, color: '#00FF87', key: 'upgrades' },
  { to: '/sell', label: 'Sell', icon: Tag, color: '#FF8C00', key: 'sell' },
  { to: '/fan-zone', label: 'Fan Zone', icon: Flame, color: '#00C8FF', key: 'fanzone' },
  { to: '/me', label: 'Me', icon: User, color: '#FF2D78', key: 'me' }
];

export default function Layout() {
  const { user } = useAuth();
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('pg_onboarded'));
  const [unreadCount, setUnreadCount] = useState(0);
  const [liveEventId, setLiveEventId] = useState(null);
  const location = useLocation();
  const scrollPositions = useRef({});
  const containerRefs = useRef({});

  useTheme();

  const getCurrentTab = () => {
    const path = location.pathname;
    return NAV.find(n => path === n.to || path.startsWith(n.to + '/'))?.key || null;
  };

  const currentTab = getCurrentTab();

  // Save scroll on every pathname change
  const prevTabRef = useRef(currentTab);
  useEffect(() => {
    const prevTab = prevTabRef.current;
    if (prevTab && prevTab !== currentTab) {
      const prev = containerRefs.current[prevTab];
      if (prev) scrollPositions.current[prevTab] = prev.scrollTop;
    }
    prevTabRef.current = currentTab;
  }, [currentTab]);

  // Restore scroll position
  useEffect(() => {
    if (!currentTab) return;
    const container = containerRefs.current[currentTab];
    if (!container) return;
    const saved = scrollPositions.current[currentTab];
    requestAnimationFrame(() => { container.scrollTop = saved || 0; });
  }, [currentTab]);

  // UX-5: Sync onboarding state
  useEffect(() => {
    if (!user) return;
    if (user.has_seen_onboarding) {
      localStorage.setItem('pg_onboarded', '1');
      setShowOnboarding(false);
    }
  }, [user?.has_seen_onboarding]);

  // Poll unread notification count
  useEffect(() => {
    if (!user?.email) return;
    const fetchUnread = () => {
      base44.entities.Notification.filter({ user_email: user.email, read: false }, '-created_date', 99)
        .then(data => setUnreadCount(data.length))
        .catch(() => {});
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 60000); // poll every 60s
    return () => clearInterval(interval);
  }, [user?.email]);

  // Reset badge when user opens notifications page
  useEffect(() => {
    if (location.pathname === '/notifications') {
      setUnreadCount(0);
    }
  }, [location.pathname]);

  // Check for live events to show pulse on Upgrades tab
  useEffect(() => {
    base44.entities.Event.filter({ status: 'live' }, '-updated_date', 5)
      .then(evs => {
        const live = evs.find(e => getEventLiveStatus(e).status === 'live');
        setLiveEventId(live?.id || null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (user) {
      console.log('[Layout] user resolved from AuthContext — email:', user.email, '| role:', user.role);
    }
  }, [user]);

  const handleOnboardingDone = () => {
    localStorage.setItem('pg_onboarded', '1');
    setShowOnboarding(false);
    base44.auth.updateMe({ has_seen_onboarding: true }).catch(() => {});
  };

  if (showOnboarding) {
    return <Onboarding onDone={handleOnboardingDone} />;
  }

  return (
    <div className="min-h-screen bg-background font-sans dark:rave-bg">
      {user?.email && <DonationWinNotification userEmail={user.email} />}
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

      {/* Notification bell — top right, only when logged in */}
      {user && (
        <Link to="/notifications"
          className="fixed right-4 z-[99] flex items-center justify-center w-9 h-9 rounded-full transition-all active:scale-95"
          style={{ top: 'calc(0.75rem + env(safe-area-inset-top))', background: unreadCount > 0 ? 'rgba(255,45,120,0.15)' : 'rgba(255,255,255,0.07)', border: `1px solid ${unreadCount > 0 ? 'rgba(255,45,120,0.4)' : 'rgba(255,255,255,0.12)'}` }}>
          <Bell className="w-4 h-4" style={{ color: unreadCount > 0 ? '#FF2D78' : 'hsl(var(--muted-foreground))' }} />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black"
              style={{ background: '#FF2D78', color: '#fff' }}>
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Link>
      )}

      {/* Stack-preserved tab containers */}
      <div className="relative w-full max-w-lg mx-auto pb-24" style={{ overscrollBehavior: 'none' }}>
        {currentTab === null && (
          <div className="overflow-y-auto" style={{ height: '100vh', overscrollBehavior: 'none' }}>
            <Outlet />
          </div>
        )}
        {NAV.map(({ key }) => (
          <div
            key={key}
            ref={el => containerRefs.current[key] = el}
            className="overflow-y-auto"
            style={{
              height: '100vh',
              overscrollBehavior: 'none',
              visibility: currentTab === key ? 'visible' : 'hidden',
              opacity: currentTab === key ? 1 : 0,
              pointerEvents: currentTab === key ? 'auto' : 'none',
              position: currentTab === key ? 'relative' : 'absolute',
              inset: currentTab === key ? 'auto' : 0,
              transition: currentTab === key ? 'opacity 0.18s ease' : 'none',
              willChange: 'opacity',
              contain: 'paint layout',
            }}>
            <MountedTab tabKey={key} activeKey={currentTab} />
          </div>
        ))}
      </div>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 frosted-bar border-t border-white/10 dark:border-white/10" style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}>
        <div className="max-w-lg mx-auto flex items-stretch">
          {NAV.map(({ to, label, icon: Icon, color, key }) => {
            const active = currentTab === key;
            const hasLivePulse = key === 'upgrades' && !!liveEventId && !active;
            return (
              <Link
                key={to}
                to={to}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                className="flex-1 flex flex-col items-center justify-center gap-0.5 py-3 relative transition-all active:scale-95"
                style={{ color: active ? color : 'hsl(var(--muted-foreground))' }}>
                {active && (
                  <span
                    className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-b"
                    style={{
                      background: `linear-gradient(90deg, ${color}00, ${color}, ${color}00)`,
                      boxShadow: `0 0 8px ${color}88`
                    }} />
                )}
                <div
                  className="w-11 h-9 flex items-center justify-center rounded-xl transition-all relative"
                  style={active ? { background: `${color}18`, boxShadow: `0 0 14px ${color}44` } : {}}>
                  <Icon
                    className="w-5 h-5"
                    style={active ? { filter: `drop-shadow(0 0 6px ${color}bb)`, strokeWidth: 2.5 } : { strokeWidth: 1.8 }} />
                  {hasLivePulse && (
                    <span className="absolute top-0.5 right-0.5 w-2.5 h-2.5 rounded-full animate-pulse"
                      style={{ background: '#FFE600', boxShadow: '0 0 6px #FFE600' }} />
                  )}
                </div>
                <span className="text-[10px] font-bold leading-none">
                  {hasLivePulse ? <span style={{ color: '#FFE600' }}>Live!</span> : label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}