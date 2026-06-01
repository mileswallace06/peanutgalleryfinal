import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';

export default function Landing() {
  const navigate = useNavigate();

  // If already authenticated + approved, skip landing and go straight to app
  useEffect(() => {
    base44.auth.isAuthenticated().then(authed => {
      if (authed) navigate('/events', { replace: true });
    }).catch(() => {});
  }, []);

  const handleCreateAccount = () => {
    base44.auth.redirectToLogin(window.location.origin + '/events');
  };

  const handleLogIn = () => {
    base44.auth.redirectToLogin(window.location.origin + '/events');
  };

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden" style={{ background: 'hsl(255 10% 5%)' }}>
      {/* Background image */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'url(https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=900&q=80)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
      {/* Overlay */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(to bottom, rgba(5,3,12,0.65) 0%, rgba(5,3,12,0.4) 35%, rgba(5,3,12,0.85) 65%, rgba(5,3,12,0.99) 100%)',
        }}
      />
      {/* Accent glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 70% 40% at 50% 100%, rgba(191,95,255,0.22), transparent 70%)' }}
      />

      {/* Floating particles */}
      {[...Array(10)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full pointer-events-none"
          style={{
            width: Math.random() * 5 + 2,
            height: Math.random() * 5 + 2,
            background: i % 2 === 0 ? '#BF5FFF' : '#00FF87',
            left: `${10 + i * 8}%`,
            top: `${20 + (i % 3) * 20}%`,
            opacity: 0,
          }}
          animate={{ y: [0, -100, -200], opacity: [0, 0.7, 0], scale: [1, 1.4, 0.4] }}
          transition={{ duration: 3 + (i % 3), repeat: Infinity, delay: i * 0.4, ease: 'easeOut' }}
        />
      ))}

      {/* Main content — full height flex column with proper top padding */}
      <div
        className="relative z-10 flex flex-col flex-1 px-6"
        style={{
          paddingTop: 'calc(1.5rem + env(safe-area-inset-top))',
          paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))',
        }}
      >
        {/* Logo + brand pill — top of flow */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="flex items-center gap-3 mb-auto"
        >
          <img
            src="https://media.base44.com/images/public/69ef9900cf3862dc0ea39734/9022a5431_ChatGPTImageMay1202601_29_27PM.png"
            alt="Peanut Gallery"
            className="h-12 w-auto rounded-xl flex-shrink-0"
          />
          <span
            className="text-[11px] font-black tracking-[0.2em] px-3 py-1.5 rounded-full"
            style={{
              background: 'rgba(0,0,0,0.55)',
              color: 'rgba(255,255,255,0.9)',
              border: '1px solid rgba(191,95,255,0.45)',
              boxShadow: '0 0 10px rgba(191,95,255,0.3)',
            }}
          >
            🥜 PEANUT GALLERY
          </span>
        </motion.div>

        {/* Spacer — pushes content to lower half */}
        <div className="flex-1" style={{ minHeight: '6vh', maxHeight: '14vh' }} />

        {/* Headline */}
        <div className="font-display leading-[0.9] mb-5" style={{ fontSize: 'clamp(2.8rem, 12vw, 4.4rem)' }}>
          {[
            { text: 'Better Seats.', grad: 'linear-gradient(90deg, #00FF87, #00C8FF)', glow: '#00FF87' },
            { text: 'After It Starts.', grad: 'linear-gradient(90deg, #BF5FFF, #FF2D78)', glow: '#BF5FFF' },
            { text: 'Only On PG.', grad: 'linear-gradient(90deg, #FFE600, #FF2D78)', glow: '#FFE600' },
          ].map(({ text, grad, glow }, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 + i * 0.1 }}
              style={{
                background: grad,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                filter: `drop-shadow(0 0 18px ${glow}66)`,
              }}
            >
              {text}
            </motion.div>
          ))}
        </div>

        {/* Subheadline */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.45 }}
          className="text-base leading-relaxed mb-5"
          style={{ color: 'rgba(255,255,255,0.85)' }}
        >
          Buy live seat upgrades from fans already inside the venue —{' '}
          <span style={{ color: '#00FF87', fontWeight: 700 }}>move closer once the show starts.</span>
        </motion.p>

        {/* Value props */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.55 }}
          className="flex flex-col gap-2.5 mb-7"
        >
          {[
            { icon: '🔒', text: 'Money held safely — seller paid only after you confirm you got the tickets' },
            { icon: '📍', text: 'Location-based upgrades — only fans at the venue can buy' },
            { icon: '🎁', text: 'Free seat drops — fans give away unused seats to other fans' },
          ].map(({ icon, text }) => (
            <div key={text} className="flex items-start gap-2.5 text-sm font-medium" style={{ color: 'rgba(255,255,255,0.75)' }}>
              <span className="text-base leading-none mt-0.5">{icon}</span>
              <span className="leading-snug">{text}</span>
            </div>
          ))}
        </motion.div>

        {/* CTA buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="flex flex-col gap-3"
        >
          <button
            onClick={handleCreateAccount}
            className="w-full py-4 rounded-2xl font-black text-lg tracking-wide active:scale-95 transition-transform"
            style={{
              background: 'linear-gradient(135deg, #00FF87, #00C8FF)',
              color: '#0D0B14',
              boxShadow: '0 0 24px rgba(0,255,135,0.4)',
            }}
          >
            Create Account
          </button>
          <button
            onClick={handleLogIn}
            className="w-full py-4 rounded-2xl font-black text-lg tracking-wide active:scale-95 transition-transform"
            style={{
              background: 'rgba(255,255,255,0.08)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.2)',
            }}
          >
            Log In
          </button>
        </motion.div>

        <p className="text-[11px] text-center mt-4" style={{ color: 'rgba(255,255,255,0.28)' }}>
          By continuing you agree to our{' '}
          <a href="/terms" className="underline underline-offset-2" style={{ color: 'rgba(255,255,255,0.45)' }}>Terms of Service</a>
          {' '}and{' '}
          <a href="/privacy" className="underline underline-offset-2" style={{ color: 'rgba(255,255,255,0.45)' }}>Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}