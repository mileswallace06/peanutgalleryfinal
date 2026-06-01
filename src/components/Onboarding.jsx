import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring } from 'framer-motion';

const SLIDES = [
  {
    tag: '🥜 PEANUT GALLERY',
    tagColor: '#00FF87',
    tagStyle: { background: 'rgba(0,255,135,0.12)', color: '#00FF87', border: '1px solid rgba(0,255,135,0.35)' },
    headlineWords: [
      { text: 'Find.', color: '#00FF87', glow: '#00FF87' },
      { text: 'Upgrade.', color: '#BF5FFF', glow: '#BF5FFF' },
      { text: 'Experience.', color: '#FFE600', glow: '#FFE600' },
    ],
    body: 'The only app that lets fans inside the venue buy and sell seat upgrades after the event starts. Better seats, fair prices, no scalpers.',
    visual: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=1200&q=90',
    btnGradient: 'linear-gradient(135deg, #00FF87, #BF5FFF, #FFE600)',
    btnColor: '#0D0B14',
    accentDot: '#00FF87',
    overlayAccent: 'radial-gradient(ellipse 80% 60% at 50% 110%, rgba(0,255,135,0.25), transparent 60%)',
  },
  {
    tag: 'SEAT UPGRADES',
    tagColor: '#FF2D78',
    tagStyle: { background: 'rgba(255,45,120,0.12)', color: '#FF2D78', border: '1px solid rgba(255,45,120,0.35)' },
    headlineWords: [
      { text: 'Stuck In', color: '#fff', glow: null },
      { text: 'The Back', color: '#fff', glow: null },
      { text: 'Row?', color: '#FF2D78', glow: '#FF2D78' },
    ],
    body: "Fans who couldn't sell their seats before the event list them cheap on Peanut Gallery — the only place to buy upgrades live at the venue. Location-locked so only people actually there can buy. No scalpers, ever.",
    visual: 'https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=1200&q=90',
    btnGradient: 'linear-gradient(135deg, #FF2D78, #BF5FFF)',
    btnColor: '#fff',
    accentDot: '#FF2D78',
    overlayAccent: 'radial-gradient(ellipse 80% 60% at 50% 110%, rgba(255,45,120,0.25), transparent 60%)',
  },
  {
    tag: 'ZERO RISK',
    tagColor: '#00C8FF',
    tagStyle: { background: 'rgba(0,200,255,0.12)', color: '#00C8FF', border: '1px solid rgba(0,200,255,0.35)' },
    headlineWords: [
      { text: 'Your', color: '#fff', glow: null },
      { text: 'Money', color: '#fff', glow: null },
      { text: 'Is Safe.', color: '#00FF87', glow: '#00FF87' },
      { text: 'Period.', color: '#fff', glow: null },
    ],
    body: "We hold your payment in escrow. The seller doesn't get a single cent until you physically receive the tickets and tap confirm. Scammers can't win here.",
    visual: 'https://images.unsplash.com/photo-1505236858219-8359eb29e329?w=1200&q=90',
    btnGradient: 'linear-gradient(135deg, #00FF87, #00C8FF)',
    btnColor: '#0D0B14',
    accentDot: '#00C8FF',
    overlayAccent: 'radial-gradient(ellipse 80% 60% at 50% 110%, rgba(0,200,255,0.25), transparent 60%)',
  },
  {
    tag: 'SELL INSTANTLY',
    tagColor: '#FFE600',
    tagStyle: { background: 'rgba(255,230,0,0.12)', color: '#FFE600', border: '1px solid rgba(255,230,0,0.35)' },
    headlineWords: [
      { text: 'Got Seats', color: '#fff', glow: null },
      { text: "You Can't", color: '#fff', glow: null },
      { text: 'Use?', color: '#FFE600', glow: '#FFE600' },
    ],
    body: 'List your tickets from anywhere in the world in 60 seconds. Buyers at the venue see them instantly. Get paid the moment they confirm receipt. Fast transfers. Instant confirmation.',
    visual: 'https://images.unsplash.com/photo-1574272374294-2c5e0b0a6a0d?w=1200&q=90',
    btnGradient: 'linear-gradient(135deg, #FF8C00, #FFE600)',
    btnColor: '#0D0B14',
    accentDot: '#FFE600',
    overlayAccent: 'radial-gradient(ellipse 80% 60% at 50% 110%, rgba(255,230,0,0.2), transparent 60%)',
  },
  {
    tag: "🔥 LET'S GO",
    tagColor: '#BF5FFF',
    tagStyle: { background: 'rgba(191,95,255,0.15)', color: '#fff', border: '1px solid rgba(191,95,255,0.4)' },
    headlineWords: [
      { text: 'Your', color: '#fff', glow: null },
      { text: 'Seat Is', color: '#BF5FFF', glow: '#BF5FFF' },
      { text: 'Waiting.', color: '#00FF87', glow: '#00FF87' },
    ],
    body: "Stop watching from the back. Every great show has empty floor seats 20 minutes in. They're yours for the taking — right now, from fans already there.",
    visual: 'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=1200&q=90',
    btnGradient: 'linear-gradient(135deg, #BF5FFF, #FF2D78, #FFE600)',
    btnColor: '#fff',
    accentDot: '#BF5FFF',
    overlayAccent: 'radial-gradient(ellipse 90% 70% at 50% 100%, rgba(191,95,255,0.35), transparent 55%)',
    isLast: true,
    btnLabel: '🎫 Find My Upgrade Now',
  },
];

// Floating particle component
function Particle({ color, delay, startX, duration }) {
  return (
    <motion.div
      className="absolute rounded-full pointer-events-none"
      style={{
        width: Math.random() * 4 + 2,
        height: Math.random() * 4 + 2,
        background: color,
        left: `${startX}%`,
        bottom: '15%',
        boxShadow: `0 0 6px ${color}`,
      }}
      animate={{
        y: [0, -180, -360],
        x: [0, (Math.random() - 0.5) * 60],
        opacity: [0, 0.9, 0],
        scale: [0.5, 1.2, 0.3],
      }}
      transition={{
        duration,
        repeat: Infinity,
        delay,
        ease: 'easeOut',
      }}
    />
  );
}

// Light streak component
function LightStreak({ color, delay, startX }) {
  return (
    <motion.div
      className="absolute pointer-events-none"
      style={{
        width: 1.5,
        height: 60,
        background: `linear-gradient(to top, transparent, ${color}, transparent)`,
        left: `${startX}%`,
        bottom: '20%',
        boxShadow: `0 0 8px ${color}`,
        opacity: 0,
      }}
      animate={{
        y: [0, -200],
        opacity: [0, 0.8, 0],
        scaleY: [0.5, 1.5, 0.3],
      }}
      transition={{
        duration: 1.8,
        repeat: Infinity,
        delay,
        ease: 'easeOut',
      }}
    />
  );
}

export default function Onboarding({ onDone }) {
  const [index, setIndex] = useState(0);
  const [touchStart, setTouchStart] = useState(null);
  const [btnHovered, setBtnHovered] = useState(false);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const springX = useSpring(mouseX, { stiffness: 60, damping: 20 });
  const springY = useSpring(mouseY, { stiffness: 60, damping: 20 });

  const slide = SLIDES[index];
  const isLast = !!slide.isLast;

  const next = () => { if (!isLast) setIndex(i => i + 1); };
  const finish = () => {
    localStorage.setItem('pg_onboarded', '1');
    onDone();
  };

  const handleTouchStart = (e) => setTouchStart(e.touches[0].clientX);
  const handleTouchEnd = (e) => {
    if (touchStart === null) return;
    const diff = touchStart - e.changedTouches[0].clientX;
    if (diff > 50 && !isLast) next();
    if (diff < -50 && index > 0) setIndex(i => i - 1);
    setTouchStart(null);
  };

  const handleMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseX.set((e.clientX - rect.left - rect.width / 2) / rect.width * 18);
    mouseY.set((e.clientY - rect.top - rect.height / 2) / rect.height * 12);
  };

  // Particle config per slide
  const particles = [
    { color: slide.accentDot, delay: 0, startX: 15, duration: 2.2 },
    { color: '#BF5FFF', delay: 0.5, startX: 35, duration: 2.8 },
    { color: slide.accentDot, delay: 1.0, startX: 55, duration: 2.0 },
    { color: '#FF2D78', delay: 1.5, startX: 72, duration: 3.0 },
    { color: '#FFE600', delay: 0.8, startX: 85, duration: 2.5 },
    { color: slide.accentDot, delay: 1.8, startX: 25, duration: 2.6 },
    { color: '#00C8FF', delay: 0.3, startX: 63, duration: 3.2 },
  ];

  const streaks = [
    { color: slide.accentDot, delay: 0.2, startX: 20 },
    { color: '#BF5FFF', delay: 0.9, startX: 50 },
    { color: '#FFE600', delay: 1.6, startX: 78 },
    { color: slide.accentDot, delay: 2.3, startX: 40 },
  ];

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col overflow-hidden"
      style={{ background: '#000', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onMouseMove={handleMouseMove}
    >
      {/* Background image with parallax */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`bg-${index}`}
          className="absolute inset-[-8%]"
          initial={{ opacity: 0, scale: 1.15 }}
          animate={{ opacity: 1, scale: 1.08, x: springX, y: springY }}
          exit={{ opacity: 0, scale: 1.02 }}
          transition={{ opacity: { duration: 0.6 }, scale: { duration: 0.7 } }}
          style={{
            backgroundImage: `url(${slide.visual})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center top',
          }}
        />
      </AnimatePresence>

      {/* Multi-layer overlay */}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.45) 30%, rgba(0,0,0,0.82) 62%, rgba(0,0,0,0.97) 100%)' }} />

      {/* Colored accent glow at bottom — changes per slide */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`glow-${index}`}
          className="absolute inset-0 pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.7 }}
          style={{ background: slide.overlayAccent }}
        />
      </AnimatePresence>

      {/* Vignette edges */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 100% 100% at 50% 50%, transparent 40%, rgba(0,0,0,0.6) 100%)' }} />

      {/* Floating particles */}
      {particles.map((p, i) => <Particle key={`${index}-p${i}`} {...p} />)}

      {/* Light streaks */}
      {streaks.map((s, i) => <LightStreak key={`${index}-s${i}`} {...s} />)}

      {/* Logo + skip — top */}
      <motion.div
        className="relative z-10 px-5 pt-4 flex items-center justify-between"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="flex flex-col leading-none">
          <span
            className="font-display text-3xl"
            style={{
              background: 'linear-gradient(90deg, #00FF87, #BF5FFF, #FFE600)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              filter: 'none',
            }}
          >
            peanut
          </span>
          <span className="text-[10px] font-black tracking-[0.3em] text-white/60">GALLERY</span>
        </div>
        <button
          onClick={finish}
          className="text-xs font-black uppercase tracking-widest px-3 py-1.5 rounded-full"
          style={{ color: 'rgba(255,255,255,0.55)', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
        >
          SKIP ✕
        </button>
      </motion.div>

      {/* Content — bottom */}
      <div className="relative z-10 flex-1 flex flex-col justify-end px-5 pb-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            {/* Tag pill */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.05 }}
            >
              <span
                className="inline-block text-[11px] font-black tracking-[0.2em] px-4 py-1.5 rounded-full"
                style={slide.tagStyle}
              >
                {slide.tag}
              </span>
            </motion.div>

            {/* Headline — word by word stagger */}
            <div className="font-display leading-[1.0] whitespace-pre-line" style={{ fontSize: 'clamp(2.2rem, 10vw, 3.4rem)' }}>
              {slide.headlineWords.map((word, wi) => (
                <motion.div
                  key={`${index}-w${wi}`}
                  initial={{ opacity: 0, y: 30, skewX: -4 }}
                  animate={{ opacity: 1, y: 0, skewX: 0 }}
                  transition={{ delay: 0.1 + wi * 0.1, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  style={{
                    color: word.color,
                    display: 'block',
                    textShadow: '0 2px 20px rgba(0,0,0,0.8)',
                  }}
                >
                  {word.text}
                </motion.div>
              ))}
            </div>

            {/* Body */}
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + slide.headlineWords.length * 0.1 + 0.1 }}
              className="text-sm leading-relaxed"
              style={{ color: 'rgba(255,255,255,0.82)', maxWidth: '38ch' }}
            >
              {slide.body}
            </motion.p>
          </motion.div>
        </AnimatePresence>

        {/* Progress dots */}
        <div className="flex gap-2 mt-5 mb-4">
          {SLIDES.map((_, i) => (
            <motion.div
              key={i}
              className="rounded-full cursor-pointer"
              onClick={() => setIndex(i)}
              animate={{
                width: i === index ? 32 : 7,
                background: i === index ? slide.accentDot : 'rgba(255,255,255,0.2)',
                boxShadow: 'none',
              }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              style={{ height: 6 }}
            />
          ))}
        </div>

        {/* Back */}
        {index > 0 && (
          <motion.button
            onClick={() => setIndex(i => i - 1)}
            className="text-xs font-black uppercase tracking-widest text-center mb-3"
            style={{ color: 'rgba(255,255,255,0.35)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            ← BACK
          </motion.button>
        )}

        {/* CTA Button — animated gradient */}
        <motion.button
          onClick={isLast ? finish : next}
          onHoverStart={() => setBtnHovered(true)}
          onHoverEnd={() => setBtnHovered(false)}
          whileTap={{ scale: 0.96 }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="w-full rounded-2xl font-black tracking-wide overflow-hidden relative"
          style={{
            padding: isLast ? '22px 0' : '20px 0',
            fontSize: isLast ? '1.15rem' : '1.05rem',
            color: slide.btnColor,
            boxShadow: `0 4px 24px rgba(0,0,0,0.4)`,
          }}
        >
          {/* Animated gradient background */}
          <motion.div
            className="absolute inset-0"
            animate={{
              background: [
                slide.btnGradient,
                slide.btnGradient.replace('135deg', '180deg'),
                slide.btnGradient.replace('135deg', '90deg'),
                slide.btnGradient,
              ],
            }}
            transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
          />
          {/* Shimmer sweep */}
          <motion.div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.25) 50%, transparent 70%)',
              backgroundSize: '200% 100%',
            }}
            animate={{ backgroundPosition: ['-100% 0', '200% 0'] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear', repeatDelay: 1 }}
          />
          <span className="relative z-10">
            {isLast ? (slide.btnLabel || '🎫 Find My Upgrade Now') : 'Next →'}
          </span>
        </motion.button>

        {/* Final slide trust line */}
        {isLast && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="text-center text-[11px] mt-3 font-semibold"
            style={{ color: 'rgba(255,255,255,0.4)' }}
          >
            Free to join · No credit card required
          </motion.p>
        )}
      </div>
    </div>
  );
}