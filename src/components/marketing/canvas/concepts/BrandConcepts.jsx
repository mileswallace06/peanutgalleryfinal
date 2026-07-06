/**
 * Brand Concepts
 * --------------------------------------------------------------------
 * Luxury Fashion Ad, Sports Broadcast, Financial Report, Formula 1
 */
import { NEON, NEON_RGB, TEXT, FONTS, GRADIENTS } from '@/lib/marketingTokens';
import { CanvasLogo, CanvasCTA, CanvasGlow } from '../CanvasPrimitives';
import { AccentLine, CornerGradient, ImageLayer } from '../DesignElements';

/** Luxury Fashion Ad — full-bleed visual, minimal text, refined. */
export function LuxuryFashion({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0a0808', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Visual zone — top 72% */}
      <div style={{ flex: '0 0 72%', position: 'relative', overflow: 'hidden' }}>
        {content.image_url ? (
          <img src={content.image_url} alt="" crossOrigin="anonymous"
            style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(0.7) saturate(1.1)' }} />
        ) : (
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 70% 60% at 50% 40%, rgba(191,95,255,0.10), transparent 70%), #050308' }} />
        )}
        {/* Subtle gradient overlay */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 60%, rgba(10,8,8,0.8) 100%)' }} />

        {/* Badge — top left, minimal */}
        {content.badge && (
          <div style={{ position: 'absolute', top: 40*u, left: 50*u }}>
            <span style={{ fontFamily: FONTS.body, fontSize: 11*u, fontWeight: 500, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.4em', textTransform: 'uppercase' }}>
              {content.badge}
            </span>
          </div>
        )}
      </div>

      {/* Text bar — bottom 28%, whisper-quiet */}
      <div style={{ flex: 1, padding: `${20*u}px ${50*u}px`, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
        {content.headline && (
          <h1 style={{ fontFamily: FONTS.body, fontSize: 32*u, fontWeight: 300, color: 'rgba(255,255,255,0.85)', margin: 0, marginBottom: 8*u, lineHeight: 1.2, letterSpacing: '0.02em', wordBreak: 'break-word' }}>
            {content.headline}
          </h1>
        )}
        {content.subheadline && (
          <p style={{ fontFamily: FONTS.body, fontSize: 16*u, fontWeight: 300, color: 'rgba(255,255,255,0.4)', margin: 0, fontStyle: 'italic' }}>
            {content.subheadline}
          </p>
        )}
        {content.cta && (
          <p style={{ fontFamily: FONTS.body, fontSize: 12*u, fontWeight: 500, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.2em', textTransform: 'uppercase', margin: 0, marginTop: 12*u }}>
            {content.cta}
          </p>
        )}
        {/* Brand wordmark */}
        <div style={{ marginTop: 12*u }}>
          <span style={{ fontFamily: FONTS.display, fontSize: 18*u, color: 'rgba(255,255,255,0.3)', textTransform: 'lowercase', letterSpacing: '0.02em' }}>peanut gallery</span>
        </div>
      </div>
    </div>
  );
}

/** Sports Broadcast — bold colors, stat boxes, dynamic angles. */
export function SportsBroadcast({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: NEON.orange, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Diagonal stripe accents */}
      <div style={{ position: 'absolute', top: -20*u, right: -30*u, width: 200*u, height: 40*u, background: 'rgba(0,0,0,0.15)', transform: 'rotate(-15deg)' }} />
      <div style={{ position: 'absolute', bottom: -20*u, left: -30*u, width: 200*u, height: 40*u, background: 'rgba(0,0,0,0.15)', transform: 'rotate(-15deg)' }} />

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 2, padding: `${60*u}px`, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        {/* Badge / record */}
        {content.badge && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8*u, marginBottom: 20*u }}>
            <div style={{ background: '#000', padding: `${4*u}px ${10*u}px`, borderRadius: 4*u }}>
              <span style={{ fontFamily: FONTS.body, fontSize: 11*u, fontWeight: 900, color: NEON.orange, letterSpacing: '0.1em' }}>{content.badge}</span>
            </div>
          </div>
        )}

        {/* Headline — angled, bold */}
        {content.headline && (
          <h1 style={{ fontFamily: FONTS.display, fontSize: 88*u, lineHeight: 0.9, color: '#000000', textTransform: 'uppercase', margin: 0, marginBottom: 16*u, wordBreak: 'break-word', transform: 'skewX(-3deg)' }}>
            {content.headline}
          </h1>
        )}

        {content.subheadline && (
          <p style={{ fontFamily: FONTS.body, fontSize: 24*u, fontWeight: 800, color: 'rgba(0,0,0,0.7)', margin: 0, marginBottom: 24*u, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {content.subheadline}
          </p>
        )}

        {/* Stat boxes */}
        <div style={{ display: 'flex', gap: 16*u }}>
          {content.body && (
            <div style={{ background: '#000', padding: `${16*u}px ${24*u}px`, borderRadius: 8*u, border: `2px solid rgba(255,255,255,0.1)` }}>
              <div style={{ fontFamily: FONTS.body, fontSize: 10*u, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>INFO</div>
              <div style={{ fontFamily: FONTS.display, fontSize: 22*u, color: NEON.orange, marginTop: 4*u }}>
                {content.body.length > 20 ? content.body.slice(0, 17) + '...' : content.body}
              </div>
            </div>
          )}
          {content.cta && (
            <div style={{ background: '#000', padding: `${16*u}px ${24*u}px`, borderRadius: 8*u, border: `2px solid rgba(255,255,255,0.1)` }}>
              <div style={{ fontFamily: FONTS.body, fontSize: 10*u, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>ACTION</div>
              <div style={{ fontFamily: FONTS.display, fontSize: 22*u, color: NEON.orange, marginTop: 4*u }}>
                {content.cta}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Broadcast frame */}
      <div style={{ position: 'absolute', inset: 16*u, border: `2px solid rgba(0,0,0,0.2)`, borderRadius: 8*u, pointerEvents: 'none', zIndex: 1 }} />

      {/* Corner bug */}
      <div style={{ position: 'absolute', top: 24*u, right: 24*u, zIndex: 3 }}>
        <CanvasLogo u={u} size={24} showWordmark={false} />
      </div>
    </div>
  );
}

/** Financial Report — clean data grid, professional, muted. */
export function FinancialReport({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0a0a0f', overflow: 'hidden' }}>
      {/* Subtle grid */}
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)', backgroundSize: `${40*u}px ${40*u}px` }} />

      <div style={{ position: 'relative', zIndex: 2, padding: `${50*u}px`, height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32*u, paddingBottom: 16*u, borderBottom: `1px solid rgba(255,255,255,0.1)` }}>
          {content.badge && <span style={{ fontFamily: FONTS.body, fontSize: 12*u, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.2em', textTransform: 'uppercase' }}>{content.badge}</span>}
          <span style={{ fontFamily: FONTS.body, fontSize: 11*u, fontWeight: 600, color: 'rgba(255,255,255,0.3)' }}>PEANUT GALLERY · REPORT</span>
        </div>

        {/* Key stat */}
        {content.headline && (
          <div style={{ marginBottom: 32*u }}>
            <div style={{ fontFamily: FONTS.body, fontSize: 11*u, fontWeight: 700, color: NEON.green, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 8*u }}>KEY METRIC</div>
            <h1 style={{ fontFamily: FONTS.body, fontSize: 72*u, fontWeight: 800, color: TEXT.white, margin: 0, lineHeight: 1, letterSpacing: '-0.02em', wordBreak: 'break-word' }}>
              {content.headline}
            </h1>
          </div>
        )}

        {/* Data grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16*u, flex: 1 }}>
          {content.subheadline && (
            <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 8*u, padding: `${20*u}px` }}>
              <div style={{ fontFamily: FONTS.body, fontSize: 10*u, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 8*u }}>SUMMARY</div>
              <p style={{ fontFamily: FONTS.body, fontSize: 18*u, fontWeight: 600, color: 'rgba(255,255,255,0.8)', margin: 0, lineHeight: 1.3 }}>{content.subheadline}</p>
            </div>
          )}
          {content.body && (
            <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 8*u, padding: `${20*u}px` }}>
              <div style={{ fontFamily: FONTS.body, fontSize: 10*u, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 8*u }}>DETAILS</div>
              <p style={{ fontFamily: FONTS.body, fontSize: 14*u, fontWeight: 400, color: 'rgba(255,255,255,0.5)', margin: 0, lineHeight: 1.5 }}>{content.body}</p>
            </div>
          )}
          {content.cta && (
            <div style={{ background: `rgba(0,255,135,0.05)`, border: `1px solid rgba(0,255,135,0.2)`, borderRadius: 8*u, padding: `${20*u}px`, gridColumn: 'span 2' }}>
              <div style={{ fontFamily: FONTS.body, fontSize: 10*u, fontWeight: 700, color: NEON.green, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 8*u }}>RECOMMENDATION</div>
              <p style={{ fontFamily: FONTS.body, fontSize: 18*u, fontWeight: 700, color: NEON.green, margin: 0 }}>→ {content.cta}</p>
            </div>
          )}
        </div>

        {/* Source citation */}
        <div style={{ marginTop: 20*u, fontFamily: FONTS.body, fontSize: 10*u, color: 'rgba(255,255,255,0.25)' }}>
          Source: Peanut Gallery · {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
      </div>
    </div>
  );
}

/** Formula 1 — carbon fiber, speed lines, dynamic angles. */
export function FormulaOne({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0a0a0a', overflow: 'hidden' }}>
      {/* Carbon fiber texture */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `
          repeating-linear-gradient(45deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 2px, transparent 2px, transparent 4px),
          repeating-linear-gradient(-45deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 2px, transparent 2px, transparent 4px)
        `,
        backgroundSize: `${8*u}px ${8*u}px`,
      }} />

      {/* Speed lines */}
      {[20, 35, 50, 65, 80].map((top, i) => (
        <div key={i} style={{
          position: 'absolute', top: `${top}%`, left: '-5%',
          width: `${30 + i * 10}%`, height: 1*u,
          background: `linear-gradient(90deg, transparent, ${i % 2 === 0 ? NEON.orange : 'rgba(255,255,255,0.1)'}, transparent)`,
        }} />
      ))}

      {/* Content — angled, implying motion */}
      <div style={{ position: 'relative', zIndex: 2, padding: `${60*u}px`, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        {content.badge && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8*u, marginBottom: 20*u, transform: 'skewX(-8deg)' }}>
            <span style={{ fontFamily: FONTS.body, fontSize: 11*u, fontWeight: 900, color: NEON.orange, background: 'rgba(255,140,0,0.1)', padding: `${4*u}px ${12*u}px`, border: `1px solid rgba(255,140,0,0.3)`, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
              {content.badge}
            </span>
          </div>
        )}

        {content.headline && (
          <h1 style={{
            fontFamily: FONTS.display, fontSize: 96*u, lineHeight: 0.9, margin: 0, marginBottom: 16*u,
            color: TEXT.white, textTransform: 'uppercase', wordBreak: 'break-word',
            transform: 'skewX(-5deg)',
            textShadow: `2px 0 ${NEON.orange}44`,
          }}>
            {content.headline}
          </h1>
        )}

        {content.subheadline && (
          <p style={{ fontFamily: FONTS.body, fontSize: 24*u, fontWeight: 700, color: 'rgba(255,255,255,0.6)', margin: 0, marginBottom: 24*u, transform: 'skewX(-5deg)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {content.subheadline}
          </p>
        )}

        {/* Chevron accents + body */}
        {content.body && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12*u, marginBottom: 20*u }}>
            <div style={{ display: 'flex', gap: 2*u }}>
              <div style={{ width: 0, height: 0, borderTop: `${8*u}px solid transparent`, borderBottom: `${8*u}px solid transparent`, borderLeft: `${12*u}px solid ${NEON.orange}` }} />
              <div style={{ width: 0, height: 0, borderTop: `${8*u}px solid transparent`, borderBottom: `${8*u}px solid transparent`, borderLeft: `${12*u}px solid ${NEON.orange}` }} />
            </div>
            <p style={{ fontFamily: FONTS.body, fontSize: 18*u, fontWeight: 600, color: 'rgba(255,255,255,0.5)', margin: 0 }}>{content.body}</p>
          </div>
        )}

        {content.cta && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12*u }}>
            <span style={{ fontFamily: FONTS.body, fontSize: 20*u, fontWeight: 900, color: NEON.orange, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {content.cta}
            </span>
            <div style={{ width: 0, height: 0, borderTop: `${10*u}px solid transparent`, borderBottom: `${10*u}px solid transparent`, borderLeft: `${16*u}px solid ${NEON.orange}` }} />
          </div>
        )}

        {/* Racing number */}
        <div style={{ position: 'absolute', top: 50*u, right: 60*u, fontFamily: FONTS.display, fontSize: 80*u, color: 'rgba(255,140,0,0.15)', lineHeight: 1 }}>
          44
        </div>
      </div>
    </div>
  );
}