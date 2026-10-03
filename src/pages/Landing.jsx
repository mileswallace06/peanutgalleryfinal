import PublicPage from '@/components/PublicPage';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

export default function Landing() {
  const navigate = useNavigate();

  const handleCreateAccount = () => {
    navigate('/register');
  };

  const handleLogIn = () => {
    navigate('/login');
  };

  return (
    <PublicPage as="main" aria-labelledby="landing-title" className="pg-public-page--photo relative h-[100dvh] flex flex-col overflow-y-auto overflow-x-hidden">
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
      {/* Main content — full height flex column with proper top padding */}
      <div
        className="relative z-10 flex flex-col flex-1 px-6 min-h-dvh w-full max-w-xl mx-auto"
        style={{
          paddingTop: 'calc(1.5rem + env(safe-area-inset-top))',
          paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))',
        }}
      >
        {/* Logo + brand — top of flow */}
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
            className="pg-landing-brand"
          >
            🥜 PEANUT GALLERY
          </span>
        </motion.div>

        {/* Spacer — pushes content to lower half */}
        <div className="flex-1" style={{ minHeight: '6vh', maxHeight: '14vh' }} />

        {/* Headline */}
        <h1 id="landing-title" aria-label="Find. Upgrade. Experience." className="font-display leading-[0.95] mb-4" style={{ fontSize: 'clamp(2rem, 9vw, 3rem)' }}>
          {[
            { text: 'Find.', grad: 'linear-gradient(90deg, #00FF87, #00C8FF)' },
            { text: 'Upgrade.', grad: 'linear-gradient(90deg, #BF5FFF, #FF2D78)' },
            { text: 'Experience.', grad: 'linear-gradient(90deg, #FFE600, #FF2D78)' },
          ].map(({ text, grad }, i) => (
            <motion.span
              key={i}
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 + i * 0.1 }}
              className="block"
              style={{
                background: grad,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              {text}
            </motion.span>
          ))}
        </h1>

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
          className="pg-landing-actions flex flex-col gap-3"
        >
          <button
            onClick={handleCreateAccount}
            className="pg-public-action w-full tracking-wide"
          >
            Create Account
          </button>
          <button
            onClick={handleLogIn}
            className="pg-public-action pg-public-action--secondary w-full tracking-wide"
          >
            Log In
          </button>
        </motion.div>

        <p className="text-xs text-center mt-4" style={{ color: 'rgba(255,255,255,0.75)' }}>
          By continuing you agree to our{' '}
          <a href="/terms" className="underline underline-offset-2" style={{ color: 'rgba(255,255,255,0.9)' }}>Terms of Service</a>
          {' '}and{' '}
          <a href="/privacy" className="underline underline-offset-2" style={{ color: 'rgba(255,255,255,0.9)' }}>Privacy Policy</a>.
        </p>
      </div>
    </PublicPage>
  );
}
