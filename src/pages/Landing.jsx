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

      {/* Logo — top left */}
      <div className="absolute top-5 left-4 z-20">
        <img
          src="https://media.base44.com/images/public/69ef9900cf3862dc0ea39734/9022a5431_ChatGPTImageMay1202601_29_27PM.png"
          alt="Peanut Gallery"
          className="h-20 w-auto rounded-2xl"
        />
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-col justify-end flex-1 px-6 pb-10">
        {/* Tag */}
        <motion.span
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
          className="text-[11px] font-black tracking-[0.25em] px-3 py-1 rounded-full w-fit mb-5"
          style={{
            background: 'rgba(0,0,0,0.55)',
            color: '#fff',
            border: '1px solid rgba(191,95,255,0.5)',
            boxShadow: '0 0 10px rgba(191,95,255,0.4)',
          }}
        >
          🥜 PEANUT GALLERY
        </motion.span>

        {/* Headline */}
        <div className="font-display leading-[0.92] mb-6" style={{ fontSize: 'clamp(3.2rem, 14vw, 5rem)' }}>
          {[
            { text: 'Buy.', grad: 'linear-gradient(90deg, #00FF87, #00C8FF)', glow: '#00FF87' },
            { text: 'Upgrade.', grad: 'linear-gradient(90deg, #BF5FFF, #FF2D78)', glow: '#BF5FFF' },
            { text: 'Experience.', grad: 'linear-gradient(90deg, #FFE600, #FF2D78)', glow: '#FFE600' },
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

        {/* Value props */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mb-8 space-y-2"
        >
          <p className="text-base leading-relaxed" style={{ color: 'rgba(255,255,255,0.78)' }}>
            Buy tickets before the event.{' '}
            <span style={{ color: '#00FF87', fontWeight: 700 }}>Upgrade your seats</span> after it starts.
          </p>
          <div className="flex flex-col gap-1.5 mt-3">
            {[
              { icon: '🔒', text: 'Escrow protection — seller paid only after you confirm' },
              { icon: '📍', text: 'Location-locked upgrades — real fans only, no scalpers' },
              { icon: '⚡', text: 'Instant transfers — 60-second listing, live payouts' },
            ].map(({ icon, text }) => (
              <div key={text} className="flex items-center gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
                <span>{icon}</span>
                <span>{text}</span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* CTA buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.65 }}
          className="flex flex-col gap-3"
        >
          <button
            onClick={handleCreateAccount}
            className="w-full py-4 rounded-2xl font-black text-lg tracking-wide active:scale-95 transition-transform"
            style={{
              background: 'linear-gradient(135deg, #00FF87, #00C8FF)',
              color: '#0D0B14',
              boxShadow: '0 0 20px rgba(0,255,135,0.35)',
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
              border: '1px solid rgba(255,255,255,0.18)',
            }}
          >
            Log In
          </button>
        </motion.div>

        <p className="text-[11px] text-center mt-5" style={{ color: 'rgba(255,255,255,0.2)' }}>
          By continuing you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}