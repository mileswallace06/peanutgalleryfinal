/**
 * Atmospheric Concepts
 * --------------------------------------------------------------------
 * Broken Glass, Empty Seat, Spotlight, Arena Lighting,
 * Black & White Documentary
 */
import { NEON, NEON_RGB, TEXT, FONTS, GRADIENTS } from '@/lib/marketingTokens';
import { CanvasLogo, CanvasGlow, CanvasFooter } from '../CanvasPrimitives';
import { Spotlight as SpotlightCone, CornerGradient, ImageLayer, BackgroundNumeral } from '../DesignElements';

/** Broken Glass — crack overlays, fractured type, shard fragments. */
export function BrokenGlass({ content, u, w, h }) {
  const cracks = [
    { top: '8%', left: '38%', width: 1.5, height: '84%', rotate: 4 },
    { top: '15%', left: '42%', width: 1, height: '50%', rotate: -12 },
    { top: '35%', left: '35%', width: 1, height: '40%', rotate: 22 },
    { top: '20%', left: '50%', width: 1, height: '60%', rotate: -8 },
  ];
  const shards = [
    { top: '12%', right: '8%', size: 14, rotate: 22 },
    { top: '55%', left: '10%', size: 10, rotate: -15 },
    { top: '70%', right: '15%', size: 8, rotate: 45 },
    { top: '30%', left: '8%', size: 6, rotate: 30 },
  ];

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#030208', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      {/* Ambient glow */}
      <CanvasGlow u={u} rgb={NEON_RGB.purple} size={500} style={{ top: '20%', left: '30%' }} />

      {/* Crack lines */}
      {cracks.map((c, i) => (
        <div key={i} style={{
          position: 'absolute', top: c.top, left: c.left,
          width: c.width * u, height: c.height,
          background: 'linear-gradient(to bottom, transparent 0%, rgba(255,255,255,0.5) 20%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.4) 80%, transparent 100%)',
          transform: `rotate(${c.rotate}deg)`,
          pointerEvents: 'none',
        }} />
      ))}

      {/* Glass shard fragments */}
      {shards.map((s, i) => (
        <div key={i} style={{
          position: 'absolute', top: s.top, ...(s.left ? { left: s.left } : { right: s.right }),
          width: s.size * u, height: s.size * u,
          background: 'rgba(255,255,255,0.05)',
          border: `1px solid rgba(255,255,255,0.2)`,
          transform: `rotate(${s.rotate}deg)`,
          borderRadius: 2 * u,
          pointerEvents: 'none',
        }} />
      ))}

      {/* Content — fractured headline */}
      <div style={{ position: 'relative', zIndex: 2, textAlign: 'center', maxWidth: '80%' }}>
        {content.badge && (
          <span style={{ fontFamily: FONTS.body, fontSize: 13*u, fontWeight: 900, color: NEON.pink, letterSpacing: '0.3em', textTransform: 'uppercase', display: 'block', marginBottom: 20*u }}>
            {content.badge}
          </span>
        )}
        {content.headline && (
          <h1 style={{
            fontFamily: FONTS.display, fontSize: 100*u, lineHeight: 1.05, margin: 0, marginBottom: 20*u,
            textTransform: 'uppercase', wordBreak: 'break-word',
            background: GRADIENTS.broken,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
            {content.headline}
          </h1>
        )}
        {content.subheadline && (
          <p style={{ fontFamily: FONTS.body, fontSize: 24*u, fontWeight: 500, color: 'rgba(255,255,255,0.5)', margin: 0, maxWidth: '70%', marginLeft: 'auto', marginRight: 'auto' }}>
            {content.subheadline}
          </p>
        )}
        {content.body && (
          <p style={{ fontFamily: FONTS.body, fontSize: 18*u, fontWeight: 400, color: 'rgba(255,255,255,0.35)', margin: 0, marginTop: 16*u, maxWidth: '60%', marginLeft: 'auto', marginRight: 'auto' }}>
            {content.body}
          </p>
        )}
        {content.cta && (
          <div style={{ marginTop: 28*u }}>
            <span style={{ fontFamily: FONTS.body, fontSize: 20*u, fontWeight: 900, color: NEON.pink, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {content.cta}
            </span>
          </div>
        )}
      </div>

      <CanvasFooter u={u} />
    </div>
  );
}

/** Empty Seat — vast dark space, single light point, tiny text. */
export function EmptySeat({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#020203', overflow: 'hidden' }}>
      {/* Single soft warm glow — the "seat" */}
      <div style={{
        position: 'absolute', top: '38%', left: '50%', transform: 'translateX(-50%)',
        width: 120*u, height: 120*u, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(255,180,80,0.15) 0%, transparent 70%)',
      }} />

      {/* Subtle floor line */}
      <div style={{
        position: 'absolute', top: '55%', left: 0, right: 0, height: 1,
        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.04), transparent)',
      }} />

      {/* Content — lower third, small, restrained */}
      <div style={{ position: 'absolute', bottom: 80*u, left: 0, right: 0, textAlign: 'center', zIndex: 2, padding: `0 ${60*u}px` }}>
        {content.headline && (
          <h1 style={{ fontFamily: FONTS.body, fontSize: 44*u, fontWeight: 300, color: 'rgba(255,255,255,0.7)', margin: 0, marginBottom: 16*u, lineHeight: 1.2, wordBreak: 'break-word' }}>
            {content.headline}
          </h1>
        )}
        {content.subheadline && (
          <p style={{ fontFamily: FONTS.body, fontSize: 20*u, fontWeight: 300, color: 'rgba(255,255,255,0.35)', margin: 0, lineHeight: 1.4 }}>
            {content.subheadline}
          </p>
        )}
        {content.body && (
          <p style={{ fontFamily: FONTS.body, fontSize: 16*u, fontWeight: 300, color: 'rgba(255,255,255,0.2)', margin: 0, marginTop: 12*u, lineHeight: 1.5 }}>
            {content.body}
          </p>
        )}
        {content.cta && (
          <p style={{ fontFamily: FONTS.body, fontSize: 16*u, fontWeight: 500, color: 'rgba(255,180,80,0.5)', margin: 0, marginTop: 20*u }}>
            {content.cta}
          </p>
        )}
        {content.badge && (
          <p style={{ fontFamily: FONTS.body, fontSize: 11*u, fontWeight: 500, color: 'rgba(255,255,255,0.15)', letterSpacing: '0.3em', textTransform: 'uppercase', margin: 0, marginTop: 24*u }}>
            {content.badge}
          </p>
        )}
      </div>

      {/* Tiny logo */}
      <div style={{ position: 'absolute', bottom: 30*u, left: '50%', transform: 'translateX(-50%)', opacity: 0.2 }}>
        <CanvasLogo u={u} size={20} showWordmark={false} />
      </div>
    </div>
  );
}

/** Spotlight — dark stage, cone of light, content in the beam. */
export function Spotlight({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#020203', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      {/* Light fixture glow at top */}
      <div style={{
        position: 'absolute', top: -10*u, left: '50%', transform: 'translateX(-50%)',
        width: 60*u, height: 30*u, borderRadius: '0 0 30*u 30*u',
        background: 'rgba(255,230,0,0.1)',
      }} />

      {/* Spotlight cone */}
      <SpotlightCone u={u} color={NEON.yellow} width={700} opacity={0.08} />

      {/* Content in the light pool */}
      <div style={{ position: 'relative', zIndex: 2, textAlign: 'center', maxWidth: '72%' }}>
        {content.badge && (
          <span style={{ fontFamily: FONTS.body, fontSize: 13*u, fontWeight: 900, color: NEON.yellow, letterSpacing: '0.3em', textTransform: 'uppercase', display: 'block', marginBottom: 20*u }}>
            {content.badge}
          </span>
        )}
        {content.headline && (
          <h1 style={{ fontFamily: FONTS.display, fontSize: 92*u, lineHeight: 0.95, color: TEXT.white, textTransform: 'uppercase', margin: 0, marginBottom: 20*u, wordBreak: 'break-word' }}>
            {content.headline}
          </h1>
        )}
        {content.subheadline && (
          <p style={{ fontFamily: FONTS.body, fontSize: 26*u, fontWeight: 500, color: 'rgba(255,255,255,0.6)', margin: 0, maxWidth: '80%', marginLeft: 'auto', marginRight: 'auto' }}>
            {content.subheadline}
          </p>
        )}
        {content.body && (
          <p style={{ fontFamily: FONTS.body, fontSize: 18*u, fontWeight: 400, color: 'rgba(255,255,255,0.35)', margin: 0, marginTop: 16*u, maxWidth: '65%', marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.5 }}>
            {content.body}
          </p>
        )}
        {content.cta && (
          <div style={{ marginTop: 28*u }}>
            <span style={{ fontFamily: FONTS.body, fontSize: 22*u, fontWeight: 900, color: NEON.yellow, textTransform: 'uppercase' }}>
              {content.cta}
            </span>
          </div>
        )}
      </div>

      {/* Stage floor line */}
      <div style={{ position: 'absolute', bottom: 40*u, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent 20%, rgba(255,230,0,0.08) 50%, transparent 80%)' }} />

      <CanvasFooter u={u} />
    </div>
  );
}

/** Arena Lighting — colored beams, haze, high energy. */
export function ArenaLighting({ content, u, w, h }) {
  const beams = [
    { color: NEON.purple, left: '15%', rotate: 15 },
    { color: NEON.pink, left: '35%', rotate: -10 },
    { color: NEON.green, left: '55%', rotate: 20 },
    { color: NEON.cyan, left: '75%', rotate: -15 },
  ];

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#030208', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      {/* Light beams from top */}
      {beams.map((beam, i) => {
        const rgb = NEON_RGB[Object.keys(NEON).find(k => NEON[k] === beam.color)];
        return (
          <div key={i} style={{
            position: 'absolute', top: '-10%', left: beam.left,
            width: 120*u, height: '120%',
            background: `linear-gradient(180deg, rgba(${rgb},0.15) 0%, rgba(${rgb},0.05) 40%, transparent 80%)`,
            transform: `rotate(${beam.rotate}deg)`,
            transformOrigin: 'top center',
            clipPath: 'polygon(35% 0%, 65% 0%, 100% 100%, 0% 100%)',
            pointerEvents: 'none',
          }} />
        );
      })}

      {/* Color washes */}
      <CanvasGlow u={u} rgb={NEON_RGB.purple} size={500} style={{ top: '30%', left: '10%' }} />
      <CanvasGlow u={u} rgb={NEON_RGB.green} size={400} style={{ bottom: '20%', right: '10%' }} />

      {/* Content — in the beam intersection */}
      <div style={{ position: 'relative', zIndex: 2, textAlign: 'center', maxWidth: '78%' }}>
        {content.badge && (
          <span style={{ fontFamily: FONTS.body, fontSize: 13*u, fontWeight: 900, color: NEON.cyan, letterSpacing: '0.3em', textTransform: 'uppercase', display: 'block', marginBottom: 20*u }}>
            {content.badge}
          </span>
        )}
        {content.headline && (
          <h1 style={{
            fontFamily: FONTS.display, fontSize: 96*u, lineHeight: 1.0, margin: 0, marginBottom: 20*u,
            textTransform: 'uppercase', wordBreak: 'break-word',
            background: GRADIENTS.brand,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
            {content.headline}
          </h1>
        )}
        {content.subheadline && (
          <p style={{ fontFamily: FONTS.body, fontSize: 26*u, fontWeight: 600, color: 'rgba(255,255,255,0.7)', margin: 0, maxWidth: '75%', marginLeft: 'auto', marginRight: 'auto' }}>
            {content.subheadline}
          </p>
        )}
        {content.body && (
          <p style={{ fontFamily: FONTS.body, fontSize: 18*u, fontWeight: 400, color: 'rgba(255,255,255,0.4)', margin: 0, marginTop: 16*u, maxWidth: '65%', marginLeft: 'auto', marginRight: 'auto' }}>
            {content.body}
          </p>
        )}
        {content.cta && (
          <div style={{ marginTop: 28*u }}>
            <span style={{ fontFamily: FONTS.body, fontSize: 22*u, fontWeight: 900, color: NEON.green, textTransform: 'uppercase' }}>
              {content.cta}
            </span>
          </div>
        )}
      </div>

      <CanvasFooter u={u} />
    </div>
  );
}

/** Black & White Documentary — grayscale, photojournalistic, caption style. */
export function BWDocumentary({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000000', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Image zone — top 60% (grayscale) */}
      <div style={{ flex: '0 0 60%', position: 'relative', overflow: 'hidden' }}>
        {content.image_url ? (
          <img src={content.image_url} alt="" crossOrigin="anonymous"
            style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'grayscale(1) contrast(1.2) brightness(0.5)' }} />
        ) : (
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #1a1a1a, #0a0a0a)' }} />
        )}
        {/* Grain overlay */}
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 80% 60% at 50% 50%, transparent 40%, rgba(0,0,0,0.4) 100%)' }} />

        {/* Headline overlay on image */}
        {content.headline && (
          <h1 style={{
            position: 'absolute', bottom: 30*u, left: 50*u, right: 50*u,
            fontFamily: FONTS.display, fontSize: 72*u, lineHeight: 0.95,
            color: '#ffffff', textTransform: 'uppercase', margin: 0, wordBreak: 'break-word',
            textShadow: '0 2px 8px rgba(0,0,0,0.8)',
          }}>
            {content.headline}
          </h1>
        )}
      </div>

      {/* Caption zone — bottom 40% */}
      <div style={{ flex: 1, background: '#0a0a0a', padding: `${30*u}px ${50*u}px`, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        {content.badge && (
          <span style={{ fontFamily: FONTS.body, fontSize: 10*u, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.3em', textTransform: 'uppercase', marginBottom: 12*u }}>
            {content.badge}
          </span>
        )}
        {content.subheadline && (
          <p style={{ fontFamily: FONTS.body, fontSize: 20*u, fontWeight: 600, color: 'rgba(255,255,255,0.7)', margin: 0, marginBottom: 12*u, lineHeight: 1.3 }}>
            {content.subheadline}
          </p>
        )}
        {content.body && (
          <p style={{ fontFamily: FONTS.body, fontSize: 15*u, fontWeight: 400, color: 'rgba(255,255,255,0.4)', margin: 0, lineHeight: 1.5 }}>
            {content.body}
          </p>
        )}
        {/* Photo credit */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20*u, borderTop: `1px solid rgba(255,255,255,0.1)`, paddingTop: 12*u }}>
          {content.cta && <span style={{ fontFamily: FONTS.body, fontSize: 12*u, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{content.cta}</span>}
          <span style={{ fontFamily: FONTS.body, fontSize: 10*u, color: 'rgba(255,255,255,0.25)' }}>PHOTO: PEANUT GALLERY</span>
        </div>
      </div>
    </div>
  );
}