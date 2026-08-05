import { Link, useLocation, useOutlet } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MapPin, Zap, Tag, Flame, User, Bell } from 'lucide-react';
import { getEventLiveStatus } from '@/lib/eventTiming';
import { useTheme } from '@/hooks/useTheme';
import Onboarding from '@/components/Onboarding';
import { useAuth } from '@/lib/AuthContext';
import DonationWinNotification from '@/components/donations/DonationWinNotification';
import FeedbackWidget from '@/components/beta/FeedbackWidget';
import { pageVariants, useNavigationDirection } from '@/lib/pageTransitions';

/**
 * Once a tab has been activated, keep its Outlet mounted permanently.
 * This prevents remounts / state resets on tab switches.
 * AnimatePresence provides iOS-native horizontal slide transitions within each tab.
 */
function MountedTab({ tabKey, activeKey, direction, pathname }) {
  const mountedRef = useRef(false);
  const outlet = useOutlet();
  if (activeKey === tabKey) mountedRef.current = true;
  if (!mountedRef.current) return null;
  return (
    <AnimatePresence mode="wait" custom={direction}>
      <motion.div
        key={pathname}
        custom={direction}
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        style={{ minHeight: '100%' }}
      >
        {outlet}
      </motion.div>
    </AnimatePresence>
  );
}

const NAV = [
  { to: '/events', label: 'Tickets', icon: MapPin, color: '#00C8FF', key: 'events' },
  { to: '/upgrades', label: 'Upgrades', sublabel: 'Better seats', icon: Zap, color: '#00C8FF', key: 'upgrades' },
  { to: '/sell', label: 'Sell', icon: Tag, color: '#00C8FF', key: 'sell' },
  { to: '/fan-zone', label: 'Fan Zone', icon: Flame, color: '#00C8FF', key: 'fanzone' },
  { to: '/me', label: 'Me', icon: User, color: '#00C8FF', key: 'me' }
];

export default function Layout() {
  const { user } = useAuth();
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('pg_onboarded'));
  const [unreadCount, setUnreadCount] = useState(0);
  const [liveEventId, setLiveEventId] = useState(null);
  const location = useLocation();
  const direction = useNavigationDirection();
  const scrollPositions = useRef({});
  const containerRefs = useRef({});

  const { theme } = useTheme();
  const isLight = theme === 'light';

  const getCurrentTab = () => {
    const path = location.pathname;
    return NAV.find(n => path === n.to || path.startsWith(n.to + '/'))?.key || null;
  };

  const currentTab = getCurrentTab();

  // Per-pathname scroll memory — saved continuously by onScroll, restored on
  // every route change. Detail pages have no saved entry → start at top.
  // Handles tab switches AND intra-tab navigation (list → detail → back).
  // Content-ready retry: list pages remount on back navigation and re-fetch
  // asynchronously, so the saved offset can exceed the current scroll height.
  // We reapply until the content is tall enough to accept it (capped ~2s).
  const pathRef = useRef(location.pathname);
  useEffect(() => {
    const tab = currentTab;
    const container = tab ? containerRefs.current[tab] : containerRefs.current['_null'];
    pathRef.current = location.pathname;
    if (!container) return;
    const saved = scrollPositions.current[location.pathname] || 0;
    let cancelled = false;
    let attempts = 0;
    const tryRestore = () => {
      if (cancelled) return;
      container.scrollTop = saved;
      attempts++;
      const reached = Math.abs(container.scrollTop - saved) <= 2;
      if (saved > 0 && !reached && attempts < 40) {
        setTimeout(tryRestore, 50);
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(tryRestore));
    return () => { cancelled = true; };
  }, [location.pathname, currentTab]);

  // Save scroll continuously for the current pathname
  const handleScroll = useCallback((e) => {
    scrollPositions.current[pathRef.current] = e.target.scrollTop;
  }, []);

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
        .then(data => setUnreadCount(data.filter(n => n.dispatch_status !== 'superseded').length))
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
    <div className="bg-background font-sans dark:rave-bg" style={{ height: '100dvh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {user?.email && <DonationWinNotification userEmail={user.email} />}
      {user && <FeedbackWidget user={user} />}
      {!user && (
        <div className="fixed right-4 z-[99]" style={{ top: 'calc(1rem + env(safe-area-inset-top))' }}>
          <button
            onClick={() => base44.auth.redirectToLogin()}
            aria-label="Sign in to Peanut Gallery"
            className="text-sm font-bold px-5 py-2.5 rounded-full"
            style={{ background: 'var(--neon-purple)', color: '#fff' }}>
            Sign in
          </button>
        </div>
      )}

      {/* Notification bell — top right, only when logged in */}
      {user && (
        <Link to="/notifications" aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
          className="fixed right-4 z-[99] flex items-center justify-center w-11 h-11 rounded-full transition-all active:scale-95"
          style={{ top: 'calc(0.75rem + env(safe-area-inset-top))', background: unreadCount > 0 ? 'rgba(var(--neon-pink-rgb), 0.1)' : 'hsl(var(--card))', border: `1px solid ${unreadCount > 0 ? 'rgba(var(--neon-pink-rgb), 0.25)' : 'hsl(var(--border))'}` }}>
          <Bell className="w-5 h-5" style={{ color: unreadCount > 0 ? 'var(--neon-pink)' : 'hsl(var(--muted-foreground))' }} />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black"
              style={{ background: 'var(--neon-pink)', color: '#fff' }}>
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Link>
      )}

      {/* Stack-preserved tab containers with iOS-native page transitions */}
      <div className="relative w-full max-w-lg mx-auto flex-1 min-h-0" style={{ overscrollBehavior: 'none' }}>
        {/* Null-tab container for non-tab routes (purchase, admin, settings, etc.) */}
        <div
          ref={el => containerRefs.current['_null'] = el}
          onScroll={handleScroll}
          style={{
            height: '100%',
            overscrollBehavior: 'none',
            overflowX: 'hidden',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            visibility: !currentTab ? 'visible' : 'hidden',
            opacity: !currentTab ? 1 : 0,
            pointerEvents: !currentTab ? 'auto' : 'none',
            position: !currentTab ? 'relative' : 'absolute',
            inset: !currentTab ? 'auto' : 0,
            transition: !currentTab ? 'opacity 0.18s ease' : 'none',
          }}>
          <MountedTab tabKey="_null" activeKey={currentTab || '_null'} direction={direction} pathname={location.pathname} />
        </div>
        {NAV.map(({ key }) => (
          <div
            key={key}
            ref={el => containerRefs.current[key] = el}
            onScroll={handleScroll}
            style={{
              height: '100%',
              overscrollBehavior: 'none',
              overflowX: 'hidden',
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
              visibility: currentTab === key ? 'visible' : 'hidden',
              opacity: currentTab === key ? 1 : 0,
              pointerEvents: currentTab === key ? 'auto' : 'none',
              position: currentTab === key ? 'relative' : 'absolute',
              inset: currentTab === key ? 'auto' : 0,
              transition: currentTab === key ? 'opacity 0.18s ease' : 'none',
            }}>
            <MountedTab tabKey={key} activeKey={currentTab || '_null'} direction={direction} pathname={location.pathname} />
          </div>
        ))}
      </div>

      {/* Bottom nav */}
      <nav aria-label="Main navigation" className="fixed bottom-0 left-0 right-0 z-50 frosted-bar border-t border-border dark:border-white/10" style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}>
        <div className="max-w-lg mx-auto flex items-stretch">
          {NAV.map(({ to, label, sublabel, icon: NavIcon, color, key }) => {
            const active = currentTab === key;
            const hasLivePulse = key === 'upgrades' && !!liveEventId && !active;
            return (
              <Link
                key={to}
                to={to}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                onClick={(e) => {
                  if (active && location.pathname === to) {
                    e.preventDefault();
                    const container = containerRefs.current[key];
                    if (container) container.scrollTo({ top: 0, behavior: 'smooth' });
                  }
                }}
                className="flex-1 flex flex-col items-center justify-center gap-0.5 py-3 relative transition-all active:scale-95"
                style={{ color: active ? color : 'hsl(var(--muted-foreground))' }}>
                {active && (
                  <span
                    className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-b"
                    style={{
                      background: `linear-gradient(90deg, ${color}00, ${color}, ${color}00)`,
                      boxShadow: isLight ? 'none' : `0 0 8px ${color}88`
                    }} />
                )}
                <div
                  className="w-11 h-9 flex items-center justify-center transition-all relative">
                  <NavIcon
                    className="w-5 h-5"
                    style={active ? { filter: isLight ? 'none' : `drop-shadow(0 0 6px ${color}bb)`, strokeWidth: 2.5 } : { strokeWidth: 1.8 }} />
                  {hasLivePulse && (
                    <span className="absolute top-0.5 right-0.5 w-2.5 h-2.5 rounded-full animate-pulse"
                      style={{ background: 'var(--neon-yellow)', boxShadow: isLight ? 'none' : '0 0 6px var(--neon-yellow)' }} />
                  )}
                </div>
                <span className="text-xs font-bold leading-none">
                  {hasLivePulse ? <span style={{ color: 'var(--neon-yellow)' }}>Live!</span> : label}
                </span>
                {sublabel && active && (
                  <span className="text-[8px] leading-none mt-0.5 opacity-60">{sublabel}</span>
                )}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}