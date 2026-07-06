/**
 * Poster Concepts
 * --------------------------------------------------------------------
 * Movie Poster, Concert Flyer, Street Poster, Subway Ad, Neon Sign
 * Each is a fundamentally different visual world.
 */
import { NEON, NEON_RGB, TEXT, FONTS, GRADIENTS, BG } from '@/lib/marketingTokens';
import { CanvasBadge, CanvasHeadline, CanvasSubheadline, CanvasCTA, CanvasGlow, CanvasFooter, CanvasLogo } from '../CanvasPrimitives';
import { AccentLine, CornerGradient, ImageLayer, Spotlight, BackgroundNumeral } from '../DesignElements';
import BodyPresenter from '../BodyPresenter';

/** Movie Poster — cinematic, bottom-weighted, dramatic darkness. */
export function MoviePoster({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#050308', overflow: 'hidden' }}>
      {/* Atmospheric light from upper-left */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 60% 50% at 30% 15%, rgba(191,95,255,0.12), transparent 60%)' }} />
      {/* Vignette */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 90% 90% at 50% 40%, transparent 30%, rgba(0,0,0,0.6) 90%)' }} />

      {/* Content — bottom third */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: `0 ${60*u}px ${60*u}px`, zIndex: 2 }}>
        {content.badge && (
          <span style={{ fontFamily: FONTS.body, fontSize: 14*u, fontWeight: 900, letterSpacing: '0.4em', textTransform: 'uppercase', color: NEON.yellow, display: 'block', marginBottom: 16*u }}>
            {content.badge}
          </span>
        )}
        {content.headline && (
          <h1 style={{ fontFamily: FONTS.display, fontSize: 96*u, lineHeight: 0.95, color: TEXT.white, textTransform: 'uppercase', margin: 0, marginBottom: 16*u, wordBreak: 'break-word' }}>
            {content.headline}
          </h1>
        )}
        {content.subheadline && (
          <p style={{ fontFamily: FONTS.body, fontSize: 26*u, fontWeight: 400, color: 'rgba(255,255,255,0.6)', margin: 0, marginBottom: 20*u, maxWidth: '80%' }}>
            {content.subheadline}
          </p>
        )}
        {/* Credits block — tiny, tracked, like a film poster */}
        <div style={{ display: 'flex', gap: 24*u, alignItems: 'center', marginTop: 20*u }}>
          <CanvasLogo u={u} size={28} showWordmark={false} />
          <span style={{ fontFamily: FONTS.body, fontSize: 11*u, fontWeight: 600, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>
            Peanut Gallery Presents
          </span>
        </div>
      </div>
    </div>
  );
}

/** Concert Flyer — raw, rotated, overlapping, punk energy. */
export function ConcertFlyer({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000000', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      {/* Neon glow bursts */}
      <CanvasGlow u={u} rgb={NEON_RGB.green} size={400} style={{ top: '5%', left: '0%' }} />
      <CanvasGlow u={u} rgb={NEON_RGB.pink} size={350} style={{ bottom: '10%', right: '0%' }} />

      {/* Badge — rotated, starburst feel */}
      {content.badge && (
        <div style={{ transform: `rotate(-8deg)`, marginBottom: 20*u, zIndex: 2 }}>
          <span style={{ fontFamily: FONTS.body, fontSize: 16*u, fontWeight: 900, letterSpacing: '0.3em', textTransform: 'uppercase', color: NEON.green, background: 'rgba(0,0,0,0.6)', padding: `${8*u}px ${20*u}px`, border: `2px solid ${NEON.green}` }}>
            {content.badge}
          </span>
        </div>
      )}

      {/* Headline — stacked, rotated, overlapping */}
      {content.headline && (
        <div style={{ transform: `rotate(-3deg)`, zIndex: 2, textAlign: 'center' }}>
          <h1 style={{ fontFamily: FONTS.display, fontSize: 120*u, lineHeight: 0.82, color: TEXT.white, textTransform: 'uppercase', margin: 0, wordBreak: 'break-word' }}>
            {content.headline}
          </h1>
        </div>
      )}

      {/* Subheadline — underlined, urgent */}
      {content.subheadline && (
        <div style={{ marginTop: 24*u, zIndex: 2, textAlign: 'center' }}>
          <span style={{ fontFamily: FONTS.body, fontSize: 28*u, fontWeight: 800, color: NEON.pink, textTransform: 'uppercase', borderBottom: `3px solid ${NEON.pink}`, paddingBottom: 4*u }}>
            {content.subheadline}
          </span>
        </div>
      )}

      {/* Info pile — date, venue, details stacked tight */}
      {(content.body || content.cta) && (
        <div style={{ marginTop: 32*u, zIndex: 2, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8*u }}>
          {content.body && <p style={{ fontFamily: FONTS.body, fontSize: 20*u, fontWeight: 600, color: 'rgba(255,255,255,0.7)', margin: 0 }}>{content.body}</p>}
          {content.cta && <p style={{ fontFamily: FONTS.body, fontSize: 24*u, fontWeight: 900, color: NEON.green, margin: 0, letterSpacing: '0.05em' }}>★ {content.cta} ★</p>}
        </div>
      )}

      <CanvasFooter u={u} />
    </div>
  );
}

/** Street Poster — cream paper on dark wall, torn edges, stencil type. */
export function StreetPoster({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#1a1612', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {/* Wall texture */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 80% 60% at 50% 50%, rgba(60,50,40,0.3), transparent 70%)' }} />

      {/* Paper poster — torn edge feel */}
      <div style={{
        position: 'relative', zIndex: 2, width: '82%', background: '#f5f0e8',
        padding: `${50*u}px ${45*u}px`, borderRadius: 2*u,
        boxShadow: `0 ${12*u}px ${40*u}px rgba(0,0,0,0.5)`,
        // Torn edge simulation via clip-path
        clipPath: 'polygon(2% 0%, 98% 1%, 100% 3%, 97% 8%, 99% 15%, 96% 22%, 100% 30%, 97% 40%, 99% 50%, 95% 60%, 100% 70%, 96% 80%, 98% 90%, 94% 96%, 97% 100%, 3% 99%, 1% 95%, 4% 88%, 0% 78%, 3% 68%, 1% 58%, 4% 48%, 0% 38%, 3% 28%, 1% 18%, 4% 10%, 0% 5%)',
      }}>
        {content.badge && (
          <span style={{ display: 'inline-block', fontFamily: FONTS.body, fontSize: 14*u, fontWeight: 900, letterSpacing: '0.25em', textTransform: 'uppercase', color: '#1a1612', borderBottom: `3px solid ${NEON.pink}`, paddingBottom: 4*u, marginBottom: 20*u }}>
            {content.badge}
          </span>
        )}
        {content.headline && (
          <h1 style={{ fontFamily: FONTS.display, fontSize: 88*u, lineHeight: 0.9, color: '#1a1612', textTransform: 'uppercase', margin: 0, marginBottom: 16*u, wordBreak: 'break-word' }}>
            {content.headline}
          </h1>
        )}
        {content.subheadline && (
          <p style={{ fontFamily: FONTS.body, fontSize: 24*u, fontWeight: 600, color: '#4a3f35', margin: 0, marginBottom: 16*u }}>
            {content.subheadline}
          </p>
        )}
        {content.body && (
          <p style={{ fontFamily: FONTS.body, fontSize: 18*u, fontWeight: 400, color: '#5a4f45', margin: 0, lineHeight: 1.5 }}>
            {content.body}
          </p>
        )}
        {content.cta && (
          <div style={{ marginTop: 24*u }}>
            <span style={{ display: 'inline-block', fontFamily: FONTS.body, fontSize: 22*u, fontWeight: 900, color: '#f5f0e8', background: '#1a1612', padding: `${10*u}px ${24*u}px`, textTransform: 'uppercase' }}>
              {content.cta}
            </span>
          </div>
        )}
        {/* Stamp at bottom */}
        <div style={{ marginTop: 28*u, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <CanvasLogo u={u} size={24} showWordmark={false} />
          <span style={{ fontFamily: FONTS.body, fontSize: 10*u, fontWeight: 700, color: '#8a7f75', letterSpacing: '0.2em', textTransform: 'uppercase' }}>PG // EST. 2025</span>
        </div>
      </div>
    </div>
  );
}

/** Subway Advertisement — horizontal color bands, transit signage. */
export function SubwayAd({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0a0a0a', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Top color band */}
      <div style={{ height: 12*u, background: GRADIENTS.cta_primary, flexShrink: 0 }} />

      {/* Visual zone */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: `${50*u}px ${60*u}px`, position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 70% 50% at 50% 40%, rgba(0,200,255,0.08), transparent 70%)' }} />

        {/* Route bullet — like MTA */}
        {content.badge && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 56*u, height: 56*u, borderRadius: '50%',
            background: NEON.cyan, marginBottom: 24*u, zIndex: 2,
            fontFamily: FONTS.display, fontSize: 28*u, color: '#000',
          }}>
            {content.badge.charAt(0)}
          </div>
        )}

        {content.headline && (
          <h1 style={{ fontFamily: FONTS.display, fontSize: 84*u, lineHeight: 0.95, color: TEXT.white, textTransform: 'uppercase', margin: 0, marginBottom: 20*u, zIndex: 2, wordBreak: 'break-word' }}>
            {content.headline}
          </h1>
        )}

        {content.subheadline && (
          <p style={{ fontFamily: FONTS.body, fontSize: 26*u, fontWeight: 500, color: 'rgba(255,255,255,0.7)', margin: 0, maxWidth: '85%', zIndex: 2 }}>
            {content.subheadline}
          </p>
        )}

        {content.body && (
          <p style={{ fontFamily: FONTS.body, fontSize: 20*u, fontWeight: 400, color: 'rgba(255,255,255,0.5)', margin: 0, marginTop: 16*u, maxWidth: '80%', zIndex: 2 }}>
            {content.body}
          </p>
        )}
      </div>

      {/* Bottom info bar */}
      <div style={{ height: 80*u, background: '#111', borderTop: `2px solid ${NEON.cyan}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `0 ${60*u}px`, flexShrink: 0 }}>
        {content.cta && <span style={{ fontFamily: FONTS.body, fontSize: 22*u, fontWeight: 900, color: NEON.cyan, textTransform: 'uppercase', letterSpacing: '0.1em' }}>→ {content.cta}</span>}
        <CanvasLogo u={u} size={28} showWordmark={false} />
      </div>
    </div>
  );
}

/** Neon Sign — glowing tube text on dark wall. */
export function NeonSign({ content, u, w, h }) {
  const glowText = (color, size) => ({
    fontFamily: FONTS.display,
    fontSize: size * u,
    color: color,
    textShadow: `0 0 ${10*u}px ${color}, 0 0 ${20*u}px ${color}, 0 0 ${40*u}px ${color}88, 0 0 ${80*u}px ${color}44`,
    lineHeight: 1,
    textTransform: 'uppercase',
    wordBreak: 'break-word',
  });

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#020203', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      {/* Wall texture */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(30,25,35,0.5), transparent 70%)' }} />

      {/* Sign frame */}
      <div style={{
        position: 'relative', zIndex: 2,
        border: `2px solid rgba(255,255,255,0.08)`,
        borderRadius: 16*u, padding: `${60*u}px ${50*u}px`,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20*u,
      }}>
        {content.badge && (
          <span style={glowText(NEON.cyan, 18)}>{content.badge}</span>
        )}
        {content.headline && (
          <h1 style={glowText(NEON.pink, 80)}>{content.headline}</h1>
        )}
        {content.subheadline && (
          <span style={glowText(NEON.green, 28)}>{content.subheadline}</span>
        )}
        {content.body && (
          <span style={glowText(NEON.yellow, 18)}>{content.body}</span>
        )}
        {content.cta && (
          <span style={glowText(NEON.cyan, 24)}>→ {content.cta}</span>
        )}
      </div>

      {/* Mounting bolts */}
      <div style={{ position: 'absolute', top: 30*u, left: 30*u, width: 8*u, height: 8*u, borderRadius: '50%', background: 'rgba(255,255,255,0.15)' }} />
      <div style={{ position: 'absolute', top: 30*u, right: 30*u, width: 8*u, height: 8*u, borderRadius: '50%', background: 'rgba(255,255,255,0.15)' }} />
      <div style={{ position: 'absolute', bottom: 30*u, left: 30*u, width: 8*u, height: 8*u, borderRadius: '50%', background: 'rgba(255,255,255,0.15)' }} />
      <div style={{ position: 'absolute', bottom: 30*u, right: 30*u, width: 8*u, height: 8*u, borderRadius: '50%', background: 'rgba(255,255,255,0.15)' }} />
    </div>
  );
}