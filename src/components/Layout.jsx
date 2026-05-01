import { Outlet, Link, useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useState, useEffect } from 'react';
import { MapPin, Zap, Tag, Flame, User } from 'lucide-react';
import Onboarding from '@/components/Onboarding';

const NAV = [
{ to: '/events', label: 'Tickets', icon: MapPin, color: '#00C8FF' },
{ to: '/upgrades', label: 'Upgrades', icon: Zap, color: '#00FF87' },
{ to: '/sell', label: 'Sell', icon: Tag, color: '#FF2D78' },
{ to: '/fan-zone', label: 'Fan Zone', icon: Flame, color: '#FFE600' },
{ to: '/me', label: 'Me', icon: User, color: '#BF5FFF' }];


export default function Layout() {
  const [user, setUser] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('pg_onboarded'));
  const location = useLocation();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  if (showOnboarding) {
    return <Onboarding onDone={() => setShowOnboarding(false)} />;
  }

  return (
    <div className="min-h-screen rave-bg font-sans">
      {/* Black banner at top */}
      <div className="fixed top-0 right-0 h-12 bg-black z-[99] rounded-b-2xl opacity-30 hidden" />
      
      {/* Logo */}
      <Link to="/" className="opacity-100 fixed -top-16 left-0 right-0 z-[100] flex items-center justify-center pointer-events-auto hidden">
        <img
          src="https://media.base44.com/images/public/69ef9900cf3862dc0ea39734/f15cb860e_ChatGPTImageMay1202601_38_44PM.png"
          alt="Peanut Gallery"
          className="h-48 w-auto object-contain"
          style={{ mixBlendMode: 'screen' }} />
        
      </Link>
      
      {!user &&
      <button
        onClick={() => base44.auth.redirectToLogin()}
        className="fixed top-4 right-4 z-[99] text-sm font-bold px-4 py-1.5 rounded-full"
        style={{ background: '#BF5FFF', color: '#fff' }}>
        
          Sign in
        </button>
      }

      {/* Page content */}
      <main className="max-w-lg mx-auto pb-24">
        <Outlet />
      </main>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 frosted-bar border-t border-white/10">
        <div className="max-w-lg mx-auto flex items-stretch">
          {NAV.map(({ to, label, icon: Icon, color }) => {
            const active = location.pathname === to || location.pathname.startsWith(to + '/');
            return (
              <Link
                key={to}
                to={to}
                className="flex-1 flex flex-col items-center justify-center gap-0.5 py-3 relative transition-all"
                style={{ color: active ? color : 'rgba(255,255,255,0.38)' }}>
                
                {active &&
                <span
                  className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-b"
                  style={{
                    background: `linear-gradient(90deg, ${color}00, ${color}, ${color}00)`,
                    boxShadow: `0 0 8px ${color}88`
                  }} />

                }
                <div
                  className="w-11 h-9 flex items-center justify-center rounded-xl transition-all"
                  style={active ? { background: `${color}18`, boxShadow: `0 0 14px ${color}44` } : {}}>
                  
                  <Icon
                    className="w-5 h-5"
                    style={active ? { filter: `drop-shadow(0 0 6px ${color}bb)`, strokeWidth: 2.5 } : { strokeWidth: 1.8 }} />
                  
                </div>
                <span className="text-[10px] font-bold leading-none">{label}</span>
              </Link>);

          })}
        </div>
      </nav>
    </div>);

}