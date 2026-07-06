/**
 * Tech Concepts
 * --------------------------------------------------------------------
 * Apple Keynote, Tech Launch, Spotify Wrapped, Blueprint,
 * Jumbotron, Seat Map
 */
import { NEON, NEON_RGB, TEXT, FONTS, GRADIENTS } from '@/lib/marketingTokens';
import { CanvasLogo, CanvasCTA, CanvasGlow } from '../CanvasPrimitives';
import { AccentLine, CornerGradient, ImageLayer, BackgroundNumeral } from '../DesignElements';

/** Apple Keynote — pure black, one statement, nothing else. */
export function AppleKeynote({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000000', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', maxWidth: '80%', padding: `0 ${40*u}px` }}>
        {content.headline && (
          <h1 style={{ fontFamily: FONTS.body, fontSize: 72*u, fontWeight: 800, color: TEXT.white, margin: 0, lineHeight: 1.1, wordBreak: 'break-word', letterSpacing: '-0.02em' }}>
            {content.headline}
          </h1>
        )}
        {content.subheadline && (
          <p style={{ fontFamily: FONTS.body, fontSize: 28*u, fontWeight: 400, color: 'rgba(255,255,255,0.5)', margin: 0, marginTop: 20*u, lineHeight: 1.3 }}>
            {content.subheadline}
          </p>
        )}
        {content.cta && (
          <p style={{ fontFamily: FONTS.body, fontSize: 22*u, fontWeight: 600, color: NEON.cyan, margin: 0, marginTop: 32*u }}>
            {content.cta} →
          </p>
        )}
      </div>
      {content.badge && (
        <div style={{ position: 'absolute', top: 40*u, left: '50%', transform: 'translateX(-50%)' }}>
          <span style={{ fontFamily: FONTS.body, fontSize: 13*u, fontWeight: 600, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.3em', textTransform: 'uppercase' }}>
            {content.badge}
          </span>
        </div>
      )}
    </div>
  );
}

/** Tech Launch — dark gradient, product showcase, gradient accent. */
export function TechLaunch({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#060309', overflow: 'hidden' }}>
      {/* Gradient mesh background */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 60% 50% at 20% 20%, rgba(0,200,255,0.10), transparent 60%), radial-gradient(ellipse 50% 40% at 80% 80%, rgba(0,255,135,0.08), transparent 60%)' }} />

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 2, padding: `${60*u}px`, display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%' }}>
        {/* Version badge */}
        {content.badge && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8*u, marginBottom: 24*u }}>
            <span style={{ fontFamily: FONTS.body, fontSize: 12*u, fontWeight: 700, color: NEON.green, background: `rgba(0,255,135,0.1)`, padding: `${4*u}px ${10*u}px`, borderRadius: 4*u, border: `1px solid rgba(0,255,135,0.2)`, letterSpacing: '0.1em' }}>
              {content.badge}
            </span>
          </div>
        )}

        {content.headline && (
          <h1 style={{
            fontFamily: FONTS.body, fontSize: 76*u, fontWeight: 800, margin: 0, marginBottom: 20*u,
            lineHeight: 1.05, wordBreak: 'break-word',
            background: GRADIENTS.cta_primary,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
            {content.headline}
          </h1>
        )}

        {/* Gradient accent line */}
        <div style={{ width: 80*u, height: 3*u, background: GRADIENTS.cta_primary, borderRadius: 2*u, marginBottom: 24*u }} />

        {content.subheadline && (
          <p style={{ fontFamily: FONTS.body, fontSize: 26*u, fontWeight: 500, color: 'rgba(255,255,255,0.6)', margin: 0, marginBottom: 28*u, maxWidth: '75%', lineHeight: 1.35 }}>
            {content.subheadline}
          </p>
        )}

        {/* Feature stack */}
        {content.body && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12*u, marginBottom: 28*u, maxWidth: '70%' }}>
            {content.body.split('\n').filter(l => l.trim()).slice(0, 4).map((line, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12*u }}>
                <div style={{ width: 6*u, height: 6*u, borderRadius: '50%', background: NEON.green, flexShrink: 0 }} />
                <span style={{ fontFamily: FONTS.body, fontSize: 18*u, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>
                  {line.replace(/^[-•*]\s*/, '')}
                </span>
              </div>
            ))}
          </div>
        )}

        {content.cta && (
          <div>
            <CanvasCTA u={u} gradient={GRADIENTS.cta_primary}>{content.cta} →</CanvasCTA>
          </div>
        )}

        {/* Bottom logo */}
        <div style={{ position: 'absolute', bottom: 40*u, left: 60*u }}>
          <CanvasLogo u={u} size={28} />
        </div>
      </div>
    </div>
  );
}

/** Spotify Wrapped — vibrant solid color, massive stats, playful. */
export function SpotifyWrapped({ content, u, w, h }) {
  const bgColors = [NEON.green, NEON.purple, NEON.pink];
  const bgColor = bgColors[(content.headline || '').length % 3];

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: bgColor, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: `${50*u}px` }}>
      {/* Decorative color blocks */}
      <div style={{ position: 'absolute', top: -50*u, right: -50*u, width: 200*u, height: 200*u, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
      <div style={{ position: 'absolute', bottom: -80*u, left: -60*u, width: 250*u, height: 250*u, borderRadius: '50%', background: 'rgba(0,0,0,0.08)' }} />

      {/* Badge */}
      {content.badge && (
        <span style={{ position: 'relative', zIndex: 2, fontFamily: FONTS.body, fontSize: 14*u, fontWeight: 900, color: '#000', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 16*u }}>
          {content.badge}
        </span>
      )}

      {/* Massive stat or headline */}
      {content.headline && (
        <h1 style={{ position: 'relative', zIndex: 2, fontFamily: FONTS.display, fontSize: 120*u, lineHeight: 0.85, color: '#000', margin: 0, marginBottom: 16*u, wordBreak: 'break-word', textTransform: 'uppercase' }}>
          {content.headline}
        </h1>
      )}

      {content.subheadline && (
        <p style={{ position: 'relative', zIndex: 2, fontFamily: FONTS.body, fontSize: 32*u, fontWeight: 800, color: '#000', margin: 0, marginBottom: 20*u, lineHeight: 1.1 }}>
          {content.subheadline}
        </p>
      )}

      {content.body && (
        <p style={{ position: 'relative', zIndex: 2, fontFamily: FONTS.body, fontSize: 18*u, fontWeight: 600, color: 'rgba(0,0,0,0.6)', margin: 0, maxWidth: '70%', lineHeight: 1.3 }}>
          {content.body}
        </p>
      )}

      {/* CTA */}
      {content.cta && (
        <div style={{ position: 'relative', zIndex: 2, marginTop: 24*u }}>
          <span style={{ display: 'inline-block', fontFamily: FONTS.body, fontSize: 20*u, fontWeight: 900, color: bgColor, background: '#000', padding: `${10*u}px ${24*u}px`, borderRadius: 999*u }}>
            {content.cta}
          </span>
        </div>
      )}

      {/* Logo */}
      <div style={{ position: 'absolute', top: 40*u, right: 40*u, zIndex: 3 }}>
        <CanvasLogo u={u} size={28} showWordmark={false} />
      </div>
    </div>
  );
}

/** Blueprint — navy bg, cyan grid, technical annotations. */
export function Blueprint({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0a1929', overflow: 'hidden' }}>
      {/* Grid pattern */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `
          linear-gradient(rgba(0,200,255,0.08) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0,200,255,0.08) 1px, transparent 1px)
        `,
        backgroundSize: `${40*u}px ${40*u}px`,
      }} />
      {/* Major grid lines */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `
          linear-gradient(rgba(0,200,255,0.15) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0,200,255,0.15) 1px, transparent 1px)
        `,
        backgroundSize: `${160*u}px ${160*u}px`,
      }} />

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 2, padding: `${60*u}px`, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        {/* Annotation label */}
        {content.badge && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8*u, marginBottom: 20*u }}>
            <div style={{ width: 20*u, height: 1.5*u, background: NEON.cyan }} />
            <span style={{ fontFamily: FONTS.body, fontSize: 12*u, fontWeight: 700, color: NEON.cyan, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
              {content.badge}
            </span>
          </div>
        )}

        {content.headline && (
          <h1 style={{ fontFamily: FONTS.body, fontSize: 64*u, fontWeight: 700, color: TEXT.white, margin: 0, marginBottom: 16*u, lineHeight: 1.05, wordBreak: 'break-word', letterSpacing: '-0.01em' }}>
            {content.headline}
          </h1>
        )}

        {/* Dimension line */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8*u, marginBottom: 24*u }}>
          <div style={{ width: 6*u, height: 6*u, border: `1px solid ${NEON.cyan}` }} />
          <div style={{ width: 200*u, height: 1, background: NEON.cyan }} />
          <div style={{ width: 6*u, height: 6*u, border: `1px solid ${NEON.cyan}` }} />
          <span style={{ fontFamily: FONTS.body, fontSize: 10*u, fontWeight: 600, color: NEON.cyan, letterSpacing: '0.1em' }}>DIM. A</span>
        </div>

        {content.subheadline && (
          <p style={{ fontFamily: FONTS.body, fontSize: 22*u, fontWeight: 500, color: 'rgba(255,255,255,0.6)', margin: 0, marginBottom: 20*u, maxWidth: '70%', lineHeight: 1.35 }}>
            {content.subheadline}
          </p>
        )}

        {content.body && (
          <p style={{ fontFamily: FONTS.body, fontSize: 16*u, fontWeight: 400, color: 'rgba(255,255,255,0.4)', margin: 0, maxWidth: '60%', lineHeight: 1.5 }}>
            {content.body}
          </p>
        )}

        {content.cta && (
          <div style={{ marginTop: 24*u }}>
            <span style={{ fontFamily: FONTS.body, fontSize: 16*u, fontWeight: 700, color: NEON.cyan, letterSpacing: '0.1em', textTransform: 'uppercase', border: `1px solid ${NEON.cyan}`, padding: `${8*u}px ${16*u}px` }}>
              {content.cta}
            </span>
          </div>
        )}
      </div>

      {/* Title block — bottom right */}
      <div style={{ position: 'absolute', bottom: 30*u, right: 30*u, zIndex: 3, border: `1px solid ${NEON.cyan}55`, padding: `${12*u}px ${16*u}px`, background: 'rgba(0,200,255,0.05)' }}>
        <div style={{ fontFamily: FONTS.body, fontSize: 9*u, fontWeight: 700, color: NEON.cyan, letterSpacing: '0.15em', textTransform: 'uppercase' }}>DRAWN BY</div>
        <div style={{ fontFamily: FONTS.body, fontSize: 11*u, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>PEANUT GALLERY</div>
        <div style={{ fontFamily: FONTS.body, fontSize: 9*u, color: 'rgba(255,255,255,0.4)', marginTop: 4*u }}>SHEET 01/01</div>
      </div>

      {/* Corner annotations */}
      <div style={{ position: 'absolute', top: 30*u, left: 30*u, fontFamily: FONTS.body, fontSize: 9*u, fontWeight: 600, color: NEON.cyan, opacity: 0.5 }}>+ 00.00</div>
      <div style={{ position: 'absolute', top: 30*u, right: 30*u, fontFamily: FONTS.body, fontSize: 9*u, fontWeight: 600, color: NEON.cyan, opacity: 0.5 }}>REV. A</div>
    </div>
  );
}

/** Jumbotron — LED dot pattern, scoreboard frame, bright text. */
export function Jumbotron({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000000', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* LED dot pattern */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)`,
        backgroundSize: `${8*u}px ${8*u}px`,
      }} />

      {/* Scoreboard frame */}
      <div style={{ position: 'relative', zIndex: 2, margin: `${24*u}px`, flex: 1, border: `3px solid rgba(255,255,255,0.15)`, borderRadius: 8*u, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header bar */}
        <div style={{ background: 'rgba(255,255,255,0.05)', padding: `${10*u}px ${20*u}px`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `2px solid rgba(255,255,255,0.1)` }}>
          {content.badge && <span style={{ fontFamily: FONTS.body, fontSize: 12*u, fontWeight: 900, color: NEON.yellow, letterSpacing: '0.2em', textTransform: 'uppercase' }}>{content.badge}</span>}
          <span style={{ fontFamily: FONTS.body, fontSize: 12*u, fontWeight: 900, color: NEON.green, letterSpacing: '0.15em' }}>● LIVE</span>
        </div>

        {/* Main display */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: `${20*u}px` }}>
          {content.headline && (
            <h1 style={{ fontFamily: FONTS.display, fontSize: 100*u, lineHeight: 0.9, color: NEON.green, margin: 0, textTransform: 'uppercase', wordBreak: 'break-word', textShadow: `0 0 ${20*u}px ${NEON.green}66` }}>
              {content.headline}
            </h1>
          )}
          {content.subheadline && (
            <p style={{ fontFamily: FONTS.body, fontSize: 24*u, fontWeight: 900, color: NEON.cyan, margin: 0, marginTop: 12*u, letterSpacing: '0.1em', textTransform: 'uppercase', textShadow: `0 0 ${12*u}px ${NEON.cyan}44` }}>
              {content.subheadline}
            </p>
          )}
        </div>

        {/* Stat row */}
        <div style={{ background: 'rgba(255,255,255,0.03)', padding: `${10*u}px ${20*u}px`, display: 'flex', justifyContent: 'space-around', alignItems: 'center', borderTop: `2px solid rgba(255,255,255,0.1)` }}>
          {content.body && <span style={{ fontFamily: FONTS.body, fontSize: 14*u, fontWeight: 700, color: NEON.yellow }}>{content.body.length > 30 ? content.body.slice(0, 27) + '...' : content.body}</span>}
          {content.cta && <span style={{ fontFamily: FONTS.body, fontSize: 14*u, fontWeight: 700, color: NEON.pink }}>→ {content.cta}</span>}
        </div>
      </div>
    </div>
  );
}

/** Seat Map — overhead venue view, seat grid, highlighted section. */
export function SeatMap({ content, u, w, h }) {
  // Generate seat grid
  const rows = 8;
  const cols = 14;
  const highlightedRow = 3;
  const highlightedCols = [5, 6, 7, 8];

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#080810', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Stage */}
      <div style={{ marginTop: 40*u, display: 'flex', justifyContent: 'center' }}>
        <div style={{
          width: '60%', height: 24*u, background: 'rgba(255,255,255,0.1)',
          borderRadius: `${12*u}px ${12*u}px 0 0`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontFamily: FONTS.body, fontSize: 11*u, fontWeight: 900, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.3em', textTransform: 'uppercase' }}>Stage</span>
        </div>
      </div>

      {/* Seat grid */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6*u, padding: `${20*u}px` }}>
        {Array.from({ length: rows }).map((_, row) => (
          <div key={row} style={{ display: 'flex', gap: 6*u }}>
            {Array.from({ length: cols }).map((_, col) => {
              const isHighlighted = row === highlightedRow && highlightedCols.includes(col);
              return (
                <div key={col} style={{
                  width: 14*u, height: 14*u, borderRadius: 3*u,
                  background: isHighlighted ? NEON.cyan : 'rgba(255,255,255,0.08)',
                  boxShadow: isHighlighted ? `0 0 ${8*u}px ${NEON.cyan}66` : 'none',
                }} />
              );
            })}
          </div>
        ))}
      </div>

      {/* Highlighted section label */}
      <div style={{ position: 'absolute', top: '48%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 3, textAlign: 'center' }}>
        {content.headline && (
          <h1 style={{ fontFamily: FONTS.display, fontSize: 56*u, lineHeight: 0.9, color: TEXT.white, textTransform: 'uppercase', margin: 0, wordBreak: 'break-word' }}>
            {content.headline}
          </h1>
        )}
        {content.subheadline && (
          <p style={{ fontFamily: FONTS.body, fontSize: 20*u, fontWeight: 700, color: NEON.cyan, margin: 0, marginTop: 8*u, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            {content.subheadline}
          </p>
        )}
      </div>

      {/* Bottom info bar */}
      <div style={{ padding: `${16*u}px ${40*u}px`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid rgba(255,255,255,0.08)` }}>
        {content.badge && <span style={{ fontFamily: FONTS.body, fontSize: 12*u, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>{content.badge}</span>}
        {content.body && <span style={{ fontFamily: FONTS.body, fontSize: 13*u, fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>{content.body}</span>}
        {content.cta && <span style={{ fontFamily: FONTS.body, fontSize: 13*u, fontWeight: 800, color: NEON.cyan }}>→ {content.cta}</span>}
      </div>
    </div>
  );
}