/**
 * Editorial Concepts
 * --------------------------------------------------------------------
 * Magazine Cover, Minimal Editorial, Newspaper, Breaking News,
 * Premium Invitation, Handwritten Notes
 */
import { NEON, NEON_RGB, TEXT, FONTS, GRADIENTS } from '@/lib/marketingTokens';
import { CanvasLogo, CanvasGlow, CanvasCTA } from '../CanvasPrimitives';
import { AccentLine, CornerGradient, ImageLayer, NumberBlock, DropCapText, BackgroundNumeral } from '../DesignElements';

/** Magazine Cover — masthead, cover lines, issue info. */
export function MagazineCover({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0a0a0f', overflow: 'hidden' }}>
      {/* Full-bleed image or gradient */}
      {content.image_url ? (
        <ImageLayer u={u} src={content.image_url} treatment="darken" overlayOpacity={0.55} />
      ) : (
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 80% 60% at 50% 30%, rgba(191,95,255,0.12), transparent 70%)' }} />
      )}

      {/* Masthead */}
      <div style={{ position: 'absolute', top: 40*u, left: 50*u, right: 50*u, zIndex: 3 }}>
        <h1 style={{ fontFamily: FONTS.display, fontSize: 52*u, lineHeight: 0.9, color: TEXT.white, textTransform: 'uppercase', margin: 0, letterSpacing: '0.01em' }}>
          {content.badge || 'Peanut Gallery'}
        </h1>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6*u }}>
          <span style={{ fontFamily: FONTS.body, fontSize: 12*u, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
            {new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })}
          </span>
          <span style={{ fontFamily: FONTS.body, fontSize: 12*u, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.2em' }}>NO. 01</span>
        </div>
      </div>

      {/* Cover headline — center */}
      <div style={{ position: 'absolute', top: '38%', left: 50*u, right: 50*u, zIndex: 3 }}>
        {content.headline && (
          <h2 style={{ fontFamily: FONTS.display, fontSize: 88*u, lineHeight: 0.88, color: TEXT.white, textTransform: 'uppercase', margin: 0, wordBreak: 'break-word' }}>
            {content.headline}
          </h2>
        )}
      </div>

      {/* Cover lines — left and right flanks */}
      <div style={{ position: 'absolute', bottom: 80*u, left: 50*u, right: 50*u, zIndex: 3, display: 'flex', justifyContent: 'space-between', gap: 30*u }}>
        <div style={{ flex: 1 }}>
          {content.subheadline && (
            <p style={{ fontFamily: FONTS.body, fontSize: 18*u, fontWeight: 700, color: NEON.cyan, margin: 0, lineHeight: 1.2 }}>
              → {content.subheadline}
            </p>
          )}
        </div>
        <div style={{ flex: 1, textAlign: 'right' }}>
          {content.body && (
            <p style={{ fontFamily: FONTS.body, fontSize: 16*u, fontWeight: 600, color: 'rgba(255,255,255,0.7)', margin: 0, lineHeight: 1.2 }}>
              {content.body.length > 60 ? content.body.slice(0, 57) + '...' : content.body}
            </p>
          )}
        </div>
      </div>

      {/* Barcode + price */}
      <div style={{ position: 'absolute', bottom: 30*u, left: 50*u, right: 50*u, zIndex: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: FONTS.body, fontSize: 11*u, fontWeight: 700, color: 'rgba(255,255,255,0.4)' }}>${content.cta || 'FREE'}</span>
        <div style={{ display: 'flex', gap: 1.5*u, height: 24*u, alignItems: 'flex-end' }}>
          {Array.from({ length: 24 }).map((_, i) => (
            <div key={i} style={{ width: 2*u, height: `${40 + (i % 3) * 20}%`, background: 'rgba(255,255,255,0.4)' }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Minimal Editorial — extreme whitespace, tiny centered content. */
export function MinimalEditorial({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#050505', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: `0 0 ${100*u}px` }}>
      <div style={{ textAlign: 'center', maxWidth: '60%', margin: '0 auto' }}>
        {content.badge && (
          <p style={{ fontFamily: FONTS.body, fontSize: 11*u, fontWeight: 500, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.3em', textTransform: 'uppercase', margin: 0, marginBottom: 20*u }}>
            {content.badge}
          </p>
        )}
        {content.headline && (
          <h1 style={{ fontFamily: FONTS.body, fontSize: 42*u, fontWeight: 300, color: 'rgba(255,255,255,0.9)', margin: 0, marginBottom: 20*u, lineHeight: 1.2, wordBreak: 'break-word' }}>
            {content.headline}
          </h1>
        )}
        {/* Single hairline accent */}
        <div style={{ width: 40*u, height: 1, background: 'rgba(255,255,255,0.2)', margin: '0 auto 20*u' }} />
        {content.subheadline && (
          <p style={{ fontFamily: FONTS.body, fontSize: 18*u, fontWeight: 300, color: 'rgba(255,255,255,0.5)', margin: 0, lineHeight: 1.5 }}>
            {content.subheadline}
          </p>
        )}
        {content.body && (
          <p style={{ fontFamily: FONTS.body, fontSize: 14*u, fontWeight: 300, color: 'rgba(255,255,255,0.35)', margin: '16*u 0 0', lineHeight: 1.6 }}>
            {content.body}
          </p>
        )}
        {content.cta && (
          <p style={{ fontFamily: FONTS.body, fontSize: 13*u, fontWeight: 500, color: 'rgba(255,255,255,0.4)', margin: '24*u 0 0', letterSpacing: '0.1em' }}>
            {content.cta}
          </p>
        )}
        <div style={{ marginTop: 32*u }}>
          <CanvasLogo u={u} size={20} showWordmark={false} style={{ justifyContent: 'center' }} />
        </div>
      </div>
    </div>
  );
}

/** Newspaper — multi-column, masthead, rules, newsprint. */
export function Newspaper({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0d0b0f', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {/* Newsprint card */}
      <div style={{ width: '88%', height: '84%', background: '#f5f0e4', padding: `${32*u}px`, position: 'relative', zIndex: 2, boxShadow: `0 ${8*u}px ${32*u}px rgba(0,0,0,0.4)` }}>
        {/* Masthead */}
        <div style={{ textAlign: 'center', borderBottom: `3px double #1a1612`, paddingBottom: 12*u, marginBottom: 16*u }}>
          <div style={{ fontFamily: FONTS.display, fontSize: 36*u, color: '#1a1612', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
            {content.badge || 'The Gallery Times'}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6*u }}>
            <span style={{ fontFamily: FONTS.body, fontSize: 10*u, color: '#6a5f55' }}>{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
            <span style={{ fontFamily: FONTS.body, fontSize: 10*u, color: '#6a5f55' }}>VOL. I · NO. 1</span>
            <span style={{ fontFamily: FONTS.body, fontSize: 10*u, color: '#6a5f55' }}>peanutgallery.app</span>
          </div>
        </div>

        {/* Headline */}
        {content.headline && (
          <h1 style={{ fontFamily: FONTS.display, fontSize: 56*u, lineHeight: 0.95, color: '#1a1612', margin: 0, marginBottom: 8*u, wordBreak: 'break-word' }}>
            {content.headline}
          </h1>
        )}
        {content.subheadline && (
          <p style={{ fontFamily: FONTS.body, fontSize: 18*u, fontWeight: 600, color: '#4a3f35', margin: 0, marginBottom: 16*u, fontStyle: 'italic' }}>
            {content.subheadline}
          </p>
        )}

        {/* Column rule */}
        <div style={{ borderTop: `1px solid #1a1612`, opacity: 0.3, marginBottom: 16*u }} />

        {/* Two-column body */}
        <div style={{ display: 'flex', gap: 20*u }}>
          <div style={{ flex: 1 }}>
            {content.body && (
              <p style={{ fontFamily: FONTS.body, fontSize: 13*u, color: '#1a1612', lineHeight: 1.6, margin: 0, textAlign: 'justify' }}>
                {content.body}
              </p>
            )}
          </div>
          <div style={{ width: 1, background: '#1a1612', opacity: 0.2 }} />
          <div style={{ flex: 1 }}>
            <p style={{ fontFamily: FONTS.body, fontSize: 13*u, color: '#1a1612', lineHeight: 1.6, margin: 0, textAlign: 'justify' }}>
              {content.cta ? content.cta : 'Visit peanutgallery.app to learn more about how we\'re transforming the ticket marketplace. Join thousands of fans who\'ve already discovered a better way to buy and sell tickets.'}
            </p>
          </div>
        </div>

        {/* Folio */}
        <div style={{ position: 'absolute', bottom: 12*u, left: 32*u, right: 32*u, display: 'flex', justifyContent: 'space-between', borderTop: `1px solid #1a1612`, paddingTop: 8*u, opacity: 0.5 }}>
          <span style={{ fontFamily: FONTS.body, fontSize: 9*u, color: '#6a5f55' }}>PEANUT GALLERY</span>
          <span style={{ fontFamily: FONTS.body, fontSize: 9*u, color: '#6a5f55' }}>PAGE A1</span>
        </div>
      </div>
    </div>
  );
}

/** Breaking News — red banner, lower-third, ticker bar. */
export function BreakingNews({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0a0a0a', overflow: 'hidden' }}>
      {/* Visual zone — dark with subtle gradient */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 60% 50% at 50% 40%, rgba(255,45,120,0.06), transparent 70%)' }} />

      {/* Breaking banner — top */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        background: NEON.pink, padding: `${14*u}px ${50*u}px`,
        display: 'flex', alignItems: 'center', gap: 16*u, zIndex: 3,
      }}>
        {/* Live dot */}
        <div style={{ width: 10*u, height: 10*u, borderRadius: '50%', background: '#fff' }} />
        <span style={{ fontFamily: FONTS.display, fontSize: 22*u, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Breaking</span>
        {content.badge && <span style={{ fontFamily: FONTS.body, fontSize: 14*u, fontWeight: 700, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>— {content.badge}</span>}
        <span style={{ marginLeft: 'auto', fontFamily: FONTS.body, fontSize: 12*u, fontWeight: 600, color: 'rgba(255,255,255,0.6)' }}>LIVE</span>
      </div>

      {/* Lower-third headline */}
      <div style={{
        position: 'absolute', bottom: 60*u, left: 0, right: 0, zIndex: 3,
        padding: `0 ${50*u}px`,
      }}>
        <div style={{ background: 'rgba(10,10,15,0.92)', backdropFilter: 'blur(12px)', borderLeft: `4px solid ${NEON.cyan}`, padding: `${20*u}px ${24*u}px` }}>
          {content.headline && (
            <h1 style={{ fontFamily: FONTS.display, fontSize: 52*u, lineHeight: 0.95, color: TEXT.white, textTransform: 'uppercase', margin: 0, marginBottom: 8*u, wordBreak: 'break-word' }}>
              {content.headline}
            </h1>
          )}
          {content.subheadline && (
            <p style={{ fontFamily: FONTS.body, fontSize: 20*u, fontWeight: 600, color: 'rgba(255,255,255,0.7)', margin: 0 }}>
              {content.subheadline}
            </p>
          )}
        </div>
      </div>

      {/* Ticker bar — bottom */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        background: '#111', borderTop: `2px solid ${NEON.cyan}`,
        padding: `${10*u}px ${50*u}px`, zIndex: 3,
        display: 'flex', alignItems: 'center', gap: 16*u,
      }}>
        <span style={{ fontFamily: FONTS.body, fontSize: 11*u, fontWeight: 900, color: NEON.cyan, letterSpacing: '0.15em', textTransform: 'uppercase', flexShrink: 0 }}>▶ TICKER</span>
        <span style={{ fontFamily: FONTS.body, fontSize: 13*u, fontWeight: 600, color: 'rgba(255,255,255,0.6)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
          {content.body || content.cta || 'Visit peanutgallery.app for more details'}
        </span>
      </div>
    </div>
  );
}

/** Premium Invitation — gold border frame, centered, formal. */
export function PremiumInvitation({ content, u, w, h }) {
  const gold = '#d4af37';
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0a0808', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {/* Gold border frame */}
      <div style={{
        position: 'absolute', inset: 30*u,
        border: `1.5px solid ${gold}`,
        zIndex: 2,
      }} />
      <div style={{
        position: 'absolute', inset: 36*u,
        border: `0.5px solid ${gold}88`,
        zIndex: 2,
      }} />

      {/* Content — centered, formal */}
      <div style={{ position: 'relative', zIndex: 3, textAlign: 'center', maxWidth: '70%', padding: `${40*u}px` }}>
        {content.badge && (
          <p style={{ fontFamily: FONTS.body, fontSize: 12*u, fontWeight: 500, color: gold, letterSpacing: '0.4em', textTransform: 'uppercase', margin: 0, marginBottom: 24*u }}>
            {content.badge}
          </p>
        )}

        {/* Ornamental divider */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12*u, marginBottom: 24*u }}>
          <div style={{ width: 40*u, height: 0.5, background: gold }} />
          <div style={{ width: 6*u, height: 6*u, borderRadius: '50%', background: gold }} />
          <div style={{ width: 40*u, height: 0.5, background: gold }} />
        </div>

        {content.headline && (
          <h1 style={{ fontFamily: FONTS.body, fontSize: 48*u, fontWeight: 300, color: '#f5f0e8', margin: 0, marginBottom: 20*u, lineHeight: 1.2, wordBreak: 'break-word', letterSpacing: '0.02em' }}>
            {content.headline}
          </h1>
        )}

        {content.subheadline && (
          <p style={{ fontFamily: FONTS.body, fontSize: 20*u, fontWeight: 300, color: 'rgba(245,240,232,0.6)', margin: 0, marginBottom: 28*u, lineHeight: 1.5, fontStyle: 'italic' }}>
            {content.subheadline}
          </p>
        )}

        {/* Ornamental divider */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12*u, marginBottom: 24*u }}>
          <div style={{ width: 40*u, height: 0.5, background: gold }} />
          <div style={{ width: 6*u, height: 6*u, borderRadius: '50%', background: gold }} />
          <div style={{ width: 40*u, height: 0.5, background: gold }} />
        </div>

        {content.body && (
          <p style={{ fontFamily: FONTS.body, fontSize: 16*u, fontWeight: 400, color: 'rgba(245,240,232,0.5)', margin: 0, marginBottom: 20*u, lineHeight: 1.6 }}>
            {content.body}
          </p>
        )}

        {content.cta && (
          <p style={{ fontFamily: FONTS.body, fontSize: 14*u, fontWeight: 500, color: gold, letterSpacing: '0.2em', textTransform: 'uppercase', margin: 0 }}>
            {content.cta}
          </p>
        )}

        {/* Monogram */}
        <div style={{ marginTop: 32*u, fontFamily: FONTS.display, fontSize: 24*u, color: `${gold}88`, letterSpacing: '0.1em' }}>PG</div>
      </div>
    </div>
  );
}

/** Handwritten Notes — lined paper, margin, casual type, doodles. */
export function HandwrittenNotes({ content, u, w, h }) {
  // Lined paper background
  const lineHeight = 32 * u;
  const lines = Math.ceil(h / lineHeight);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0d0b0f', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {/* Paper */}
      <div style={{
        width: '88%', height: '84%', background: '#faf8f3', position: 'relative', zIndex: 2,
        boxShadow: `0 ${8*u}px ${32*u}px rgba(0,0,0,0.4)`,
        overflow: 'hidden',
      }}>
        {/* Red margin line */}
        <div style={{ position: 'absolute', left: 60*u, top: 0, bottom: 0, width: 1.5*u, background: '#e8a0a0' }} />

        {/* Blue ruling lines */}
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: i * lineHeight + lineHeight, height: 1, background: '#a0c4e8', opacity: 0.5 }} />
        ))}

        {/* Content — written along the lines */}
        <div style={{ position: 'relative', zIndex: 2, padding: `${20*u}px ${20*u}px ${20*u}px ${80*u}` }}>
          {content.badge && (
            <div style={{ marginBottom: 12*u }}>
              <span style={{ fontFamily: FONTS.body, fontSize: 14*u, fontWeight: 700, color: '#4a6fa5', fontStyle: 'italic' }}>
                {content.badge}
              </span>
              {/* Star doodle */}
              <span style={{ marginLeft: 8*u, fontSize: 16*u, color: NEON.yellow }}>★</span>
            </div>
          )}

          {content.headline && (
            <h1 style={{ fontFamily: FONTS.body, fontSize: 36*u, fontWeight: 800, color: '#1a1612', margin: 0, marginBottom: 16*u, lineHeight: 1.1, fontStyle: 'italic', wordBreak: 'break-word', textDecoration: 'underline', textDecorationColor: NEON.yellow, textDecorationThickness: 2*u }}>
              {content.headline}
            </h1>
          )}

          {content.subheadline && (
            <p style={{ fontFamily: FONTS.body, fontSize: 20*u, fontWeight: 500, color: '#3a2f25', margin: 0, marginBottom: 12*u, lineHeight: 1.4, fontStyle: 'italic' }}>
              {content.subheadline}
            </p>
          )}

          {content.body && (
            <p style={{ fontFamily: FONTS.body, fontSize: 16*u, fontWeight: 400, color: '#3a2f25', margin: 0, lineHeight: 1.5, fontStyle: 'italic' }}>
              {content.body}
            </p>
          )}

          {content.cta && (
            <div style={{ marginTop: 16*u }}>
              <span style={{ fontFamily: FONTS.body, fontSize: 18*u, fontWeight: 700, color: '#4a6fa5', fontStyle: 'italic' }}>
                → {content.cta}
              </span>
            </div>
          )}

          {/* Arrow doodle */}
          <div style={{ position: 'absolute', bottom: 40*u, right: 30*u, fontFamily: FONTS.body, fontSize: 24*u, color: NEON.pink, transform: 'rotate(15deg)' }}>↗</div>
        </div>
      </div>
    </div>
  );
}