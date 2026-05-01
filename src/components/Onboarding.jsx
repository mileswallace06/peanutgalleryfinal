import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

const SLIDES = [
  {
    emoji: '🎫',
    title: 'Upgrade Your Seats',
    text: 'Buy better seats from fans already at the event',
    color: '#BF5FFF',
  },
  {
    emoji: '🔒',
    title: 'Pay Safely',
    text: 'Your payment is held until you confirm your seats',
    color: '#00C8FF',
  },
  {
    emoji: '💸',
    title: 'Sell Your Tickets',
    text: "Can't use your seats? Sell them instantly to other fans",
    color: '#FF2D78',
  },
  {
    emoji: '🚀',
    title: 'Ready?',
    text: 'Browse upgrades and move closer now',
    color: '#00FF87',
    cta: true,
  },
];

export default function Onboarding({ onDone }) {
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const navigate = useNavigate();

  const slide = SLIDES[index];
  const isLast = index === SLIDES.length - 1;

  const advance = (delta = 1) => {
    setDir(delta);
    setIndex(i => i + delta);
  };

  const finish = () => {
    localStorage.setItem('pg_onboarded', '1');
    onDone();
    navigate('/events');
  };

  return (
    <div className="fixed inset-0 z-[100] rave-bg flex flex-col items-center justify-between px-6 py-10">
      {/* Skip */}
      <div className="w-full flex justify-end">
        <button
          onClick={finish}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors border border-white/10 rounded-full px-3 py-1.5"
        >
          Skip
        </button>
      </div>

      {/* Slide */}
      <div className="flex-1 flex items-center justify-center w-full">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={index}
            custom={dir}
            initial={{ opacity: 0, x: dir * 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -60 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="flex flex-col items-center text-center gap-6 w-full max-w-xs"
          >
            {/* Emoji glow orb */}
            <div
              className="w-28 h-28 rounded-full flex items-center justify-center text-6xl"
              style={{
                background: `radial-gradient(circle, ${slide.color}22, transparent 70%)`,
                boxShadow: `0 0 40px ${slide.color}44`,
                border: `1px solid ${slide.color}33`,
              }}
            >
              {slide.emoji}
            </div>

            <div className="space-y-3">
              <h1
                className="font-display text-4xl leading-tight"
                style={{ color: slide.color, textShadow: `0 0 20px ${slide.color}66` }}
              >
                {slide.title}
              </h1>
              <p className="text-base text-muted-foreground leading-relaxed">{slide.text}</p>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Dots */}
      <div className="flex gap-2 mb-6">
        {SLIDES.map((s, i) => (
          <div
            key={i}
            className="rounded-full transition-all duration-300"
            style={{
              width: i === index ? 24 : 8,
              height: 8,
              background: i === index ? slide.color : 'rgba(255,255,255,0.2)',
              boxShadow: i === index ? `0 0 8px ${slide.color}` : 'none',
            }}
          />
        ))}
      </div>

      {/* CTA */}
      <div className="w-full max-w-xs space-y-3">
        {isLast ? (
          <button
            onClick={finish}
            className="w-full py-4 rounded-full font-bold text-base transition-all active:scale-95"
            style={{
              background: '#00FF87',
              color: '#0D0B14',
              boxShadow: '0 0 20px #00FF8766, 0 0 40px #00FF8733',
            }}
          >
            Start Browsing 🎫
          </button>
        ) : (
          <button
            onClick={() => advance(1)}
            className="w-full py-4 rounded-full font-bold text-base transition-all active:scale-95"
            style={{
              background: slide.color,
              color: '#0D0B14',
              boxShadow: `0 0 20px ${slide.color}66`,
            }}
          >
            Next →
          </button>
        )}

        {index > 0 && (
          <button
            onClick={() => advance(-1)}
            className="w-full py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back
          </button>
        )}
      </div>
    </div>
  );
}