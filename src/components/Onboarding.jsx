import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

const SLIDES = [
{
  bg: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800&q=80', // stadium crowd overhead
  accent: '#00FF87',
  accent2: '#BF5FFF',
  tag: '🥜 PEANUT GALLERY',
  slogan: true,
  title: ['Find.', 'Upgrade.', 'Experience.'],
  titleHighlight: -1, // all white — slogan gets special treatment
  highlightColor: '#00FF87',
  body: 'The only app that lets fans inside the venue buy and sell seat upgrades after the event starts. Better seats, fair prices, no scalpers.',
  cta: null
},
{
  bg: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800&q=80', // packed concert crowd
  accent: '#BF5FFF',
  accent2: '#FF2D78',
  tag: 'SEAT UPGRADES',
  title: ['Stuck In', 'The Back', 'Row?'],
  titleHighlight: 2,
  highlightColor: '#FF2D78',
  body: 'Fans who couldn\'t sell their seats before the event list them cheap on Peanut Gallery — the only place to buy upgrades live at the venue. Location-locked so only people actually there can buy. No scalpers, ever.',
  cta: null
},
{
  bg: 'https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?w=800&q=80', // stadium football
  accent: '#00C8FF',
  accent2: '#00FF87',
  tag: 'ZERO RISK',
  title: ['Your Money', 'Is Safe.', 'Period.'],
  titleHighlight: 1,
  highlightColor: '#00FF87',
  body: 'We hold your payment in escrow. The seller doesn\'t get a single cent until you physically receive the tickets and tap confirm. Scammers can\'t win here.',
  cta: null
},
{
  bg: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=800&q=80', // festival crowd
  accent: '#FF2D78',
  accent2: '#FFE600',
  tag: 'SELL INSTANTLY',
  title: ['Got Seats', 'You Can\'t', 'Use?'],
  titleHighlight: 2,
  highlightColor: '#FFE600',
  body: 'List your tickets from anywhere in the world in 60 seconds. Buyers at the venue see them instantly. Get paid the moment they confirm receipt. No waiting, no BS.',
  cta: null
},
{
  bg: 'https://images.unsplash.com/photo-1598387993441-a364f854c3e1?w=800&q=80', // stage lights
  accent: '#00FF87',
  accent2: '#BF5FFF',
  tag: 'LET\'S GO',
  title: ['Stop', 'Watching', 'From Far.'],
  titleHighlight: 2,
  highlightColor: '#00FF87',
  body: 'Real fans deserve real seats. Whether it\'s a concert, game, or show — find an upgrade and move closer once the action is already underway.',
  cta: 'Find My Upgrade 🎫'
}];


// Floating particle component
function Particles({ color }) {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {[...Array(12)].map((_, i) =>
      <motion.div
        key={i}
        className="absolute rounded-full"
        style={{
          width: Math.random() * 6 + 2,
          height: Math.random() * 6 + 2,
          background: i % 2 === 0 ? color : '#ffffff',
          left: `${Math.random() * 100}%`,
          top: `${Math.random() * 100}%`,
          opacity: 0
        }}
        animate={{
          y: [0, -80, -160],
          opacity: [0, 0.8, 0],
          scale: [1, 1.5, 0.5]
        }}
        transition={{
          duration: 2 + Math.random() * 2,
          repeat: Infinity,
          delay: Math.random() * 2,
          ease: 'easeOut'
        }} />

      )}
    </div>);

}

export default function Onboarding({ onDone }) {
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const navigate = useNavigate();

  const slide = SLIDES[index];
  const isLast = index === SLIDES.length - 1;

  const advance = (delta = 1) => {
    setDir(delta);
    setIndex((i) => Math.max(0, Math.min(SLIDES.length - 1, i + delta)));
  };

  const finish = () => {
    localStorage.setItem('pg_onboarded', '1');
    onDone();
    navigate('/events');
  };

  // Swipe support
  const [touchStart, setTouchStart] = useState(null);
  const handleTouchStart = (e) => setTouchStart(e.touches[0].clientX);
  const handleTouchEnd = (e) => {
    if (touchStart === null) return;
    const diff = touchStart - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      if (diff > 0 && !isLast) advance(1);else
      if (diff < 0 && index > 0) advance(-1);
    }
    setTouchStart(null);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}>
      
      {/* Background image with overlay */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`bg-${index}`}
          className="absolute inset-0"
          initial={{ opacity: 0, scale: 1.08 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.5 }}
          style={{
            backgroundImage: `url(${slide.bg})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center'
          }} />
        
      </AnimatePresence>

      {/* Dark gradient overlay — heavy at bottom, lighter at top */}
      <div className="absolute inset-0"
      style={{
        background: `linear-gradient(to bottom, rgba(5,3,12,0.55) 0%, rgba(5,3,12,0.3) 30%, rgba(5,3,12,0.75) 60%, rgba(5,3,12,0.97) 100%)`
      }} />
      

      {/* Accent color splash */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`splash-${index}`}
          className="absolute inset-0 pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          style={{
            background: `radial-gradient(ellipse 70% 40% at 50% 100%, ${slide.accent}30, transparent 70%)`
          }} />
        
      </AnimatePresence>

      {/* Particles */}
      <Particles color={slide.accent} />

      {/* Skip button */}
      <div className="relative z-10 flex justify-end px-6 pt-12 pb-4">
        <button
          onClick={finish} className="px-1 h-24 w-auto">

          
          Skip ✕
        </button>
      </div>

      {/* Main content — bottom aligned */}
      <div className="relative z-10 flex-1 flex flex-col justify-end px-6 pb-4">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={`content-${index}`}
            custom={dir}
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="flex flex-col gap-4">
            
            {/* Tag */}
            <motion.span
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              className="text-xs font-black tracking-[0.25em] px-3 py-1 rounded-full w-fit"
              style={{
                background: `rgba(0,0,0,0.55)`,
                color: '#fff',
                border: `1px solid ${slide.accent}90`,
                boxShadow: `0 0 10px ${slide.accent}55`
              }}>
              
              {slide.tag}
            </motion.span>

            {/* Title — multi-color */}
            <div className="font-display leading-[0.95]" style={{ fontSize: slide.slogan ? 'clamp(3rem, 12vw, 5rem)' : 'clamp(2.8rem, 14vw, 4.5rem)' }}>
              {slide.title.map((word, i) => {
                const SLOGAN_GRADIENTS = [
                { grad: 'linear-gradient(90deg, #00FF87, #00C8FF)', glow: '#00FF87' },
                { grad: 'linear-gradient(90deg, #BF5FFF, #FF2D78)', glow: '#BF5FFF' },
                { grad: 'linear-gradient(90deg, #FFE600, #FF2D78)', glow: '#FFE600' }];

                const isHighlighted = slide.slogan ? true : i === slide.titleHighlight;

                if (slide.slogan) {
                  const { grad, glow } = SLOGAN_GRADIENTS[i % SLOGAN_GRADIENTS.length];
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -30 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.15 + i * 0.08 }}
                      style={{
                        background: grad,
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                        filter: `drop-shadow(0 0 18px ${glow}88)`
                      }}>
                      
                      {word}
                    </motion.div>);

                }

                const wordColor = isHighlighted ? slide.highlightColor : '#fff';
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -30 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.15 + i * 0.08 }}
                    style={{
                      color: wordColor,
                      textShadow: isHighlighted ?
                      `0 0 30px ${wordColor}99, 0 0 60px ${wordColor}44` :
                      '0 2px 20px rgba(0,0,0,0.8)'
                    }}>
                    
                    {word}
                  </motion.div>);

              })}
            </div>

            {/* Body */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-base text-white/75 leading-relaxed max-w-sm">
              
              {slide.body}
            </motion.p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom controls */}
      <div className="relative z-10 px-6 pb-10 pt-4 flex flex-col gap-4">
        {/* Dots */}
        <div className="flex gap-2">
          {SLIDES.map((_, i) =>
          <motion.div
            key={i}
            className="rounded-full"
            animate={{
              width: i === index ? 28 : 8,
              background: i === index ? slide.accent : 'rgba(255,255,255,0.25)'
            }}
            transition={{ duration: 0.3 }}
            style={{ height: 6, boxShadow: i === index ? `0 0 10px ${slide.accent}` : 'none' }} />

          )}
        </div>

        {/* Back button */}
        {index > 0 &&
        <button
          onClick={() => advance(-1)}
          className="text-xs text-white/40 hover:text-white/70 transition-colors text-center tracking-widest uppercase">
          
            ← Back
          </button>
        }

        {/* CTA button */}
        <AnimatePresence mode="wait">
          {isLast ?
          <motion.button
            key="finish"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={finish}
            className="w-full py-5 rounded-2xl font-black text-lg tracking-wide active:scale-95 transition-transform"
            style={{
              background: `linear-gradient(135deg, ${slide.accent}, ${slide.accent2})`,
              color: '#0D0B14',
              boxShadow: `0 0 30px ${slide.accent}88, 0 0 60px ${slide.accent}44`
            }}>
            
              Find My Upgrade 🎫
            </motion.button> :

          <motion.button
            key="next"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            onClick={() => advance(1)}
            className="w-full py-5 rounded-2xl font-black text-lg tracking-wide active:scale-95 transition-transform"
            style={{
              background: `linear-gradient(135deg, ${slide.accent}, ${slide.accent2})`,
              color: '#0D0B14',
              boxShadow: `0 0 20px ${slide.accent}66`
            }}>
            
              Next →
            </motion.button>
          }
        </AnimatePresence>
      </div>
    </div>);

}