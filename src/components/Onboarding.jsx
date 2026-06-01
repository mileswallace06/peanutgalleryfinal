import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const SLIDES = [
  {
    emoji: '🎟',
    accent: '#00FF87',
    tag: 'LIVE UPGRADES',
    title: 'Better Seats After The Event Starts',
    body: 'Fans inside the venue sell their unused or extra seats cheap. Move closer once the game or concert has already started.',
    visual: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800&q=80',
  },
  {
    emoji: '🎁',
    accent: '#FFE600',
    tag: 'FREE SEAT GIVEAWAYS',
    title: 'Win Free Seats Through Flash Drops',
    body: 'Fans sometimes donate their unused seats for free. Enter in one tap. A winner is randomly selected in 60 seconds.',
    visual: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=800&q=80',
  },
  {
    emoji: '🔒',
    accent: '#00C8FF',
    tag: 'BUYER PROTECTION',
    title: 'Your Money Is Held Safely',
    body: 'We hold your payment until you confirm you received the tickets. Seller gets nothing until you say so. No risk, ever.',
    visual: 'https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?w=800&q=80',
  },
];

export default function Onboarding({ onDone }) {
  const [index, setIndex] = useState(0);
  const [touchStart, setTouchStart] = useState(null);

  const slide = SLIDES[index];
  const isLast = index === SLIDES.length - 1;

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
      className="fixed inset-0 z-[100] flex flex-col"
      style={{ background: 'hsl(0 0% 0%)', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
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
          transition={{ duration: 0.45 }}
          style={{ backgroundImage: `url(${slide.visual})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
        />
      </AnimatePresence>
      <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(5,3,12,0.55) 0%, rgba(5,3,12,0.92) 55%, rgba(5,3,12,0.99) 100%)' }} />

      {/* Accent glow */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(ellipse 70% 35% at 50% 100%, ${slide.accent}28, transparent 70%)` }} />

      {/* Skip */}
      <div className="relative z-10 flex justify-end px-6 pt-4">
        <button onClick={finish} className="text-xs font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Skip ✕
        </button>
      </div>

      {/* Logo */}
      <div className="relative z-10 flex justify-center mt-6">
        <img
          src="https://media.base44.com/images/public/69ef9900cf3862dc0ea39734/9022a5431_ChatGPTImageMay1202601_29_27PM.png"
          alt="Peanut Gallery"
          className="h-16 w-auto rounded-2xl"
        />
      </div>

      {/* Content */}
      <div className="relative z-10 flex-1 flex flex-col justify-end px-6 pb-2">
        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.35 }}
            className="space-y-4"
          >
            {/* Emoji + tag */}
            <div className="flex items-center gap-2">
              <span className="text-3xl">{slide.emoji}</span>
              <span className="text-[10px] font-black tracking-[0.25em] px-3 py-1 rounded-full"
                style={{ background: 'rgba(0,0,0,0.5)', color: slide.accent, border: `1px solid ${slide.accent}60` }}>
                {slide.tag}
              </span>
            </div>

            {/* Title */}
            <h2 className="font-display leading-tight text-white" style={{ fontSize: 'clamp(2rem, 9vw, 3rem)', textShadow: `0 0 40px ${slide.accent}55` }}>
              {slide.title}
            </h2>

            {/* Body */}
            <p className="text-base leading-relaxed" style={{ color: 'rgba(255,255,255,0.75)' }}>
              {slide.body}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom controls */}
      <div className="relative z-10 px-6 pb-8 pt-5 flex flex-col gap-4">
        {/* Dots */}
        <div className="flex gap-2">
          {SLIDES.map((_, i) => (
            <motion.div
              key={i}
              className="rounded-full"
              animate={{ width: i === index ? 28 : 8, background: i === index ? slide.accent : 'rgba(255,255,255,0.2)' }}
              transition={{ duration: 0.3 }}
              style={{ height: 6, boxShadow: i === index ? `0 0 8px ${slide.accent}` : 'none' }}
            />
          ))}
        </div>

        {/* CTA */}
        {isLast ? (
          <button
            onClick={finish}
            className="w-full py-5 rounded-2xl font-black text-lg tracking-wide active:scale-95 transition-transform"
            style={{ background: `linear-gradient(135deg, #00FF87, #00C8FF)`, color: '#0D0B14', boxShadow: '0 0 24px rgba(0,255,135,0.4)' }}
          >
            Start Exploring 🎫
          </button>
        ) : (
          <button
            onClick={next}
            className="w-full py-5 rounded-2xl font-black text-lg tracking-wide active:scale-95 transition-transform"
            style={{ background: `linear-gradient(135deg, ${slide.accent}, ${slide.accent}99)`, color: '#0D0B14' }}
          >
            Next →
          </button>
        )}

        {index > 0 && (
          <button onClick={() => setIndex(i => i - 1)} className="text-xs text-center uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.35)' }}>
            ← Back
          </button>
        )}
      </div>
    </div>
  );
}