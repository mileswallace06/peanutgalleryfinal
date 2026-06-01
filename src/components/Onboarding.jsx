import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const SLIDES = [
  {
    tag: '🥜 PEANUT GALLERY',
    tagStyle: { background: 'rgba(0,0,0,0.6)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)' },
    headline: (
      <>
        <span style={{ color: '#00FF87' }}>Find.</span>{'\n'}
        <span style={{ color: '#BF5FFF' }}>Upgrade.</span>{'\n'}
        <span style={{ color: '#FFE600' }}>Experience.</span>
      </>
    ),
    body: 'The only app that lets fans inside the venue buy and sell seat upgrades after the event starts. Better seats, fair prices, no scalpers.',
    visual: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=900&q=80',
    btnGradient: 'linear-gradient(135deg, #00FF87, #BF5FFF)',
    btnColor: '#0D0B14',
    accentDot: '#00FF87',
  },
  {
    tag: 'SEAT UPGRADES',
    tagStyle: { background: 'rgba(0,0,0,0.55)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' },
    headline: (
      <>
        <span style={{ color: '#fff' }}>Stuck In{'\n'}The Back </span>
        <span style={{ color: '#FF2D78' }}>Row?</span>
      </>
    ),
    body: "Fans who couldn't sell their seats before the event list them cheap on Peanut Gallery — the only place to buy upgrades live at the venue. Location-locked so only people actually there can buy. No scalpers, ever.",
    visual: 'https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=900&q=80',
    btnGradient: 'linear-gradient(135deg, #FF2D78, #BF5FFF)',
    btnColor: '#fff',
    accentDot: '#FF2D78',
  },
  {
    tag: 'ZERO RISK',
    tagStyle: { background: 'rgba(0,0,0,0.55)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' },
    headline: (
      <>
        <span style={{ color: '#fff' }}>Your{'\n'}Money </span>
        <span style={{ color: '#00FF87' }}>Is Safe.</span>
        <span style={{ color: '#fff' }}>{'\n'}Period.</span>
      </>
    ),
    body: "We hold your payment in escrow. The seller doesn't get a single cent until you physically receive the tickets and tap confirm. Scammers can't win here.",
    visual: 'https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?w=900&q=80',
    btnGradient: 'linear-gradient(135deg, #00FF87, #00C8FF)',
    btnColor: '#0D0B14',
    accentDot: '#00C8FF',
  },
  {
    tag: 'SELL INSTANTLY',
    tagStyle: { background: 'rgba(0,0,0,0.55)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' },
    headline: (
      <>
        <span style={{ color: '#fff' }}>Got Seats{'\n'}You Can't </span>
        <span style={{ color: '#FFE600' }}>Use?</span>
      </>
    ),
    body: 'List your tickets from anywhere in the world in 60 seconds. Buyers at the venue see them instantly. Get paid the moment they confirm receipt. Fast transfers. Instant confirmation.',
    visual: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=900&q=80',
    btnGradient: 'linear-gradient(135deg, #FF8C00, #FFE600)',
    btnColor: '#0D0B14',
    accentDot: '#FF8C00',
  },
  {
    tag: "LET'S GO",
    tagStyle: { background: 'rgba(0,0,0,0.55)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' },
    headline: (
      <>
        <span style={{ color: '#fff' }}>Stop{'\n'}Watching </span>
        <span style={{ color: '#00FF87' }}>From Far.</span>
      </>
    ),
    body: "Real fans deserve real seats. Whether it's a concert, game, or show — find an upgrade and move closer once the action is already underway.",
    visual: 'https://images.unsplash.com/photo-1598387993441-a364f854cfba?w=900&q=80',
    btnGradient: 'linear-gradient(135deg, #00FF87, #BF5FFF)',
    btnColor: '#0D0B14',
    accentDot: '#00FF87',
    isLast: true,
    btnLabel: 'Find My Upgrade 🎫',
  },
];

export default function Onboarding({ onDone }) {
  const [index, setIndex] = useState(0);
  const [touchStart, setTouchStart] = useState(null);

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

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col overflow-hidden"
      style={{ background: '#000', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Background image */}
      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          className="absolute inset-0"
          initial={{ opacity: 0, scale: 1.06 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          style={{
            backgroundImage: `url(${slide.visual})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center top',
          }}
        />
      </AnimatePresence>

      {/* Dark overlay — heavier at bottom for readability */}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.5) 35%, rgba(0,0,0,0.88) 65%, rgba(0,0,0,0.97) 100%)' }} />

      {/* Logo — top left */}
      <div className="relative z-10 px-5 pt-4 flex items-center justify-between">
        <img
          src="https://media.base44.com/images/public/69ef9900cf3862dc0ea39734/9022a5431_ChatGPTImageMay1202601_29_27PM.png"
          alt="Peanut Gallery"
          className="h-12 w-auto rounded-xl"
        />
        <button
          onClick={finish}
          className="text-xs font-bold uppercase tracking-widest"
          style={{ color: 'rgba(255,255,255,0.5)' }}
        >
          SKIP ✕
        </button>
      </div>

      {/* Content — bottom half */}
      <div className="relative z-10 flex-1 flex flex-col justify-end px-5 pb-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.38 }}
            className="space-y-4"
          >
            {/* Tag pill */}
            <div>
              <span
                className="inline-block text-[11px] font-black tracking-[0.18em] px-4 py-1.5 rounded-full"
                style={slide.tagStyle}
              >
                {slide.tag}
              </span>
            </div>

            {/* Big headline */}
            <h2
              className="font-display leading-[1.05] whitespace-pre-line"
              style={{ fontSize: 'clamp(2.6rem, 12vw, 4rem)', textShadow: '0 2px 24px rgba(0,0,0,0.6)' }}
            >
              {slide.headline}
            </h2>

            {/* Body */}
            <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.78)', maxWidth: '38ch' }}>
              {slide.body}
            </p>
          </motion.div>
        </AnimatePresence>

        {/* Dots */}
        <div className="flex gap-2 mt-5 mb-4">
          {SLIDES.map((_, i) => (
            <motion.div
              key={i}
              className="rounded-full"
              animate={{
                width: i === index ? 28 : 7,
                background: i === index ? slide.accentDot : 'rgba(255,255,255,0.25)',
              }}
              transition={{ duration: 0.3 }}
              style={{ height: 6, boxShadow: i === index ? `0 0 8px ${slide.accentDot}` : 'none' }}
            />
          ))}
        </div>

        {/* Back */}
        {index > 0 && (
          <button
            onClick={() => setIndex(i => i - 1)}
            className="text-xs font-bold uppercase tracking-widest text-center mb-3"
            style={{ color: 'rgba(255,255,255,0.4)' }}
          >
            ← BACK
          </button>
        )}

        {/* CTA Button */}
        <button
          onClick={isLast ? finish : next}
          className="w-full py-5 rounded-2xl font-black text-lg tracking-wide active:scale-95 transition-transform"
          style={{
            background: slide.btnGradient,
            color: slide.btnColor,
            boxShadow: `0 0 28px ${slide.accentDot}55`,
          }}
        >
          {isLast ? (slide.btnLabel || 'Find My Upgrade 🎫') : 'Next →'}
        </button>
      </div>
    </div>
  );
}