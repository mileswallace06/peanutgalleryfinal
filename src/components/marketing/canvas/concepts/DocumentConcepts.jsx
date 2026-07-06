/**
 * Document Concepts
 * --------------------------------------------------------------------
 * Receipt, Parking Ticket, Backstage Pass, VIP Wristband, Ticket Stub
 * Physical artifacts rendered as graphics — each fundamentally different.
 */
import { NEON, NEON_RGB, TEXT, FONTS, GRADIENTS } from '@/lib/marketingTokens';
import { CanvasLogo } from '../CanvasPrimitives';

const MONO = "'DM Sans', 'Courier New', monospace";

/** Receipt — thermal paper, monospace, itemized. */
export function Receipt({ content, u, w, h }) {
  const dot = (label, value) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 16*u, color: '#1a1612', marginBottom: 6*u }}>
      <span>{label}</span>
      <span style={{ fontWeight: 700 }}>{value}</span>
    </div>
  );

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0d0b0f', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        width: '52%', background: '#faf6ee', padding: `${40*u}px ${36*u}px`,
        position: 'relative', zIndex: 2,
        boxShadow: `0 ${8*u}px ${32*u}px rgba(0,0,0,0.4)`,
        clipPath: 'polygon(0% 0%, 100% 0%, 100% 97%, 96% 100%, 92% 97%, 88% 100%, 84% 97%, 80% 100%, 76% 97%, 72% 100%, 68% 97%, 64% 100%, 60% 97%, 56% 100%, 52% 97%, 48% 100%, 44% 97%, 40% 100%, 36% 97%, 32% 100%, 28% 97%, 24% 100%, 20% 97%, 16% 100%, 12% 97%, 8% 100%, 4% 97%, 0% 100%)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 20*u }}>
          <CanvasLogo u={u} size={32} showWordmark={false} style={{ justifyContent: 'center', marginBottom: 8*u }} />
          <div style={{ fontFamily: FONTS.display, fontSize: 22*u, color: '#1a1612', textTransform: 'uppercase' }}>Peanut Gallery</div>
          <div style={{ fontFamily: MONO, fontSize: 11*u, color: '#6a5f55' }}>peanutgallery.app</div>
        </div>

        <div style={{ borderTop: `2px dashed #1a1612`, margin: `${16*u}px 0`, opacity: 0.4 }} />

        {content.badge && <div style={{ fontFamily: MONO, fontSize: 12*u, color: '#6a5f55', textAlign: 'center', marginBottom: 12*u, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{content.badge}</div>}

        {content.headline && dot('ITEM', content.headline)}
        {content.subheadline && dot('DESC', content.subheadline)}

        <div style={{ borderTop: `2px dashed #1a1612`, margin: `${16*u}px 0`, opacity: 0.4 }} />

        {content.body && (
          <div style={{ fontFamily: MONO, fontSize: 14*u, color: '#4a3f35', lineHeight: 1.5, marginBottom: 16*u }}>
            {content.body}
          </div>
        )}

        <div style={{ borderTop: `2px dashed #1a1612`, margin: `${8*u}px 0`, opacity: 0.4 }} />

        {content.cta && dot('TOTAL', content.cta)}

        <div style={{ textAlign: 'center', marginTop: 20*u, fontFamily: MONO, fontSize: 10*u, color: '#8a7f75' }}>
          <div>THANK YOU</div>
          <div style={{ marginTop: 4*u }}>**** TRANSACTION COMPLETE ****</div>
          <div style={{ marginTop: 8*u }}>{new Date().toISOString().slice(0,10)}</div>
        </div>
      </div>
    </div>
  );
}

/** Parking Ticket — bordered permit card, form fields, official stamp. */
export function ParkingTicket({ content, u, w, h }) {
  const field = (label, value) => (
    <div style={{ flex: 1 }}>
      <div style={{ fontFamily: FONTS.body, fontSize: 10*u, fontWeight: 700, color: '#8a7f75', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 4*u }}>{label}</div>
      <div style={{ fontFamily: FONTS.body, fontSize: 18*u, fontWeight: 800, color: '#1a1612', borderBottom: `1.5px solid #d0c8be`, paddingBottom: 4*u }}>{value || '—'}</div>
    </div>
  );

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0d0b0f', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        width: '76%', background: '#faf6ee', borderRadius: 8*u,
        border: `3px solid ${NEON.cyan}`,
        padding: `${40*u}px ${36*u}px`,
        position: 'relative', zIndex: 2,
        boxShadow: `0 ${8*u}px ${32*u}px rgba(0,0,0,0.4)`,
      }}>
        <div style={{ position: 'absolute', top: 12*u, left: 0, right: 0, borderTop: `2px dashed #d0c8be` }} />

        <div style={{ textAlign: 'center', marginBottom: 24*u, marginTop: 8*u }}>
          <div style={{ fontFamily: FONTS.display, fontSize: 28*u, color: NEON.cyan, textTransform: 'uppercase' }}>{content.badge || 'PERMIT'}</div>
          <div style={{ fontFamily: FONTS.body, fontSize: 12*u, fontWeight: 700, color: '#6a5f55', letterSpacing: '0.2em', textTransform: 'uppercase', marginTop: 4*u }}>PEANUT GALLERY</div>
        </div>

        {content.headline && (
          <div style={{ fontFamily: FONTS.display, fontSize: 36*u, color: '#1a1612', textTransform: 'uppercase', textAlign: 'center', marginBottom: 24*u, lineHeight: 1 }}>
            {content.headline}
          </div>
        )}

        <div style={{ display: 'flex', gap: 20*u, marginBottom: 16*u }}>
          {field('SECTION', content.subheadline)}
          {field('STATUS', content.cta)}
        </div>

        {content.body && (
          <div style={{ fontFamily: FONTS.body, fontSize: 14*u, color: '#4a3f35', lineHeight: 1.5, marginTop: 16*u, borderTop: `1px solid #d0c8be`, paddingTop: 12*u }}>
            {content.body}
          </div>
        )}

        <div style={{ position: 'absolute', bottom: 20*u, right: 20*u, transform: 'rotate(-12deg)' }}>
          <div style={{
            border: `2.5px solid ${NEON.pink}`, borderRadius: 6*u,
            padding: `${6*u}px ${14*u}px`,
            fontFamily: FONTS.body, fontSize: 11*u, fontWeight: 900,
            color: NEON.pink, textTransform: 'uppercase', letterSpacing: '0.15em',
            opacity: 0.8,
          }}>Verified</div>
        </div>

        <div style={{ display: 'flex', gap: 1.5*u, marginTop: 20*u, height: 30*u, alignItems: 'flex-end' }}>
          {Array.from({ length: 40 }).map((_, i) => (
            <div key={i} style={{ width: 2*u, height: `${50 + (i % 4) * 15}%`, background: '#1a1612' }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Backstage Pass — lanyard credential, ALL ACCESS, holographic accent. */
export function BackstagePass({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#050308', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        width: 80*u, height: 60*u,
        background: `repeating-linear-gradient(45deg, ${NEON.purple}, ${NEON.purple} 8px, ${NEON.pink} 8px, ${NEON.pink} 16px)`,
        position: 'relative', zIndex: 2,
      }}>
        <div style={{ position: 'absolute', bottom: -8*u, left: '50%', transform: 'translateX(-50%)', width: 16*u, height: 16*u, borderRadius: '50%', background: '#333', border: `2px solid #555` }} />
      </div>

      <div style={{
        width: '68%', background: '#0a0a0f', borderRadius: 12*u,
        border: `1px solid rgba(255,255,255,0.15)`,
        padding: 0, overflow: 'hidden', zIndex: 2,
        boxShadow: `0 ${8*u}px ${32*u}px rgba(0,0,0,0.5)`,
      }}>
        <div style={{ height: 8*u, background: `linear-gradient(90deg, ${NEON.green}, ${NEON.cyan}, ${NEON.purple}, ${NEON.pink}, ${NEON.yellow})` }} />

        <div style={{ padding: `${32*u}px ${28*u}px` }}>
          <div style={{
            width: 80*u, height: 80*u, borderRadius: 8*u,
            background: 'rgba(255,255,255,0.05)', border: `1px solid rgba(255,255,255,0.1)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 16*u,
          }}>
            <CanvasLogo u={u} size={40} showWordmark={false} />
          </div>

          {content.headline && (
            <h1 style={{ fontFamily: FONTS.display, fontSize: 48*u, lineHeight: 0.9, color: NEON.green, textTransform: 'uppercase', margin: 0, marginBottom: 8*u, wordBreak: 'break-word' }}>
              {content.headline}
            </h1>
          )}
          {content.subheadline && (
            <p style={{ fontFamily: FONTS.body, fontSize: 16*u, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.2em', textTransform: 'uppercase', margin: 0 }}>
              {content.subheadline}
            </p>
          )}

          {content.badge && (
            <div style={{ marginTop: 16*u, display: 'inline-block', padding: `${4*u}px ${12*u}px`, background: `rgba(0,255,135,0.1)`, border: `1px solid ${NEON.green}55`, borderRadius: 4*u }}>
              <span style={{ fontFamily: FONTS.body, fontSize: 12*u, fontWeight: 900, color: NEON.green, letterSpacing: '0.15em', textTransform: 'uppercase' }}>{content.badge}</span>
            </div>
          )}

          {content.body && (
            <p style={{ fontFamily: FONTS.body, fontSize: 14*u, color: 'rgba(255,255,255,0.4)', margin: 0, marginTop: 16*u, lineHeight: 1.4 }}>
              {content.body}
            </p>
          )}

          <div style={{ marginTop: 20*u, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: FONTS.body, fontSize: 10*u, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.2em' }}>NO. PG-{Math.floor(Math.random() * 90000 + 10000)}</span>
            {content.cta && <span style={{ fontFamily: FONTS.body, fontSize: 12*u, fontWeight: 900, color: NEON.cyan, textTransform: 'uppercase' }}>{content.cta}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** VIP Wristband — horizontal band, repeated pattern, fabric feel. */
export function VIPWristband({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#050308', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        width: '92%', height: 180*u, borderRadius: 12*u,
        background: NEON.pink,
        position: 'relative', zIndex: 2,
        overflow: 'hidden',
        boxShadow: `0 ${8*u}px ${32*u}px rgba(255,45,120,0.2)`,
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: `repeating-linear-gradient(90deg, transparent, transparent 60px, rgba(0,0,0,0.1) 60px, rgba(0,0,0,0.1) 62px)`,
        }} />

        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.15) 1px, transparent 1px)`,
          backgroundSize: `${20*u}px ${20*u}px`,
        }} />

        <div style={{ position: 'relative', zIndex: 2, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8*u }}>
          {content.badge && (
            <span style={{ fontFamily: FONTS.body, fontSize: 12*u, fontWeight: 900, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.4em', textTransform: 'uppercase' }}>
              {content.badge}
            </span>
          )}
          {content.headline && (
            <h1 style={{ fontFamily: FONTS.display, fontSize: 72*u, lineHeight: 0.9, color: '#ffffff', textTransform: 'uppercase', margin: 0, wordBreak: 'break-word' }}>
              {content.headline}
            </h1>
          )}
          {content.subheadline && (
            <span style={{ fontFamily: FONTS.body, fontSize: 18*u, fontWeight: 700, color: 'rgba(255,255,255,0.8)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
              {content.subheadline}
            </span>
          )}
        </div>

        <div style={{ position: 'absolute', right: -4*u, top: '50%', transform: 'translateY(-50%)', width: 24*u, height: 60*u, background: '#333', borderRadius: 4*u, border: `1px solid #555` }} />

        <div style={{ position: 'absolute', left: 20*u, top: '50%', transform: 'translateY(-50%) rotate(-90deg)', transformOrigin: 'center', fontFamily: FONTS.body, fontSize: 9*u, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.2em', whiteSpace: 'nowrap' }}>
          PG-VIP-{new Date().getFullYear()}
        </div>
      </div>

      {(content.body || content.cta) && (
        <div style={{ position: 'absolute', bottom: 60*u, left: 0, right: 0, textAlign: 'center', zIndex: 2 }}>
          {content.body && <p style={{ fontFamily: FONTS.body, fontSize: 18*u, color: 'rgba(255,255,255,0.5)', margin: 0, marginBottom: 8*u }}>{content.body}</p>}
          {content.cta && <span style={{ fontFamily: FONTS.body, fontSize: 18*u, fontWeight: 800, color: NEON.pink, textTransform: 'uppercase' }}>{content.cta}</span>}
        </div>
      )}
    </div>
  );
}

/** Ticket Stub — vintage Admit One, perforated split. */
export function TicketStub({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0d0b0f', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        width: '88%', height: '60%', background: '#faf6ee', borderRadius: 6*u,
        display: 'flex', position: 'relative', zIndex: 2,
        boxShadow: `0 ${8*u}px ${32*u}px rgba(0,0,0,0.4)`,
        overflow: 'hidden',
      }}>
        <div style={{
          width: '25%', padding: `${24*u}px ${16*u}px`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
          borderRight: `2px dashed #d0c8be`,
          background: 'rgba(0,0,0,0.02)',
        }}>
          <div style={{ transform: 'rotate(-90deg)', whiteSpace: 'nowrap' }}>
            <span style={{ fontFamily: FONTS.display, fontSize: 20*u, color: '#1a1612', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Admit One</span>
          </div>
          <CanvasLogo u={u} size={20} showWordmark={false} />
          <span style={{ fontFamily: FONTS.body, fontSize: 9*u, fontWeight: 700, color: '#8a7f75', letterSpacing: '0.15em' }}>NO. {Math.floor(Math.random() * 9000 + 1000)}</span>
        </div>

        <div style={{ flex: 1, padding: `${28*u}px ${32*u}px`, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          {content.badge && (
            <span style={{ fontFamily: FONTS.body, fontSize: 11*u, fontWeight: 900, color: NEON.pink, letterSpacing: '0.25em', textTransform: 'uppercase', marginBottom: 8*u }}>
              {content.badge}
            </span>
          )}
          {content.headline && (
            <h1 style={{ fontFamily: FONTS.display, fontSize: 56*u, lineHeight: 0.9, color: '#1a1612', textTransform: 'uppercase', margin: 0, marginBottom: 16*u, wordBreak: 'break-word' }}>
              {content.headline}
            </h1>
          )}
          {content.subheadline && (
            <p style={{ fontFamily: FONTS.body, fontSize: 20*u, fontWeight: 600, color: '#4a3f35', margin: 0, marginBottom: 12*u }}>
              {content.subheadline}
            </p>
          )}

          <div style={{ display: 'flex', gap: 20*u, marginTop: 8*u }}>
            {['SEC', 'ROW', 'SEAT'].map((label, i) => (
              <div key={label}>
                <div style={{ fontFamily: FONTS.body, fontSize: 9*u, fontWeight: 700, color: '#8a7f75', letterSpacing: '0.15em' }}>{label}</div>
                <div style={{ fontFamily: FONTS.display, fontSize: 22*u, color: '#1a1612' }}>
                  {i === 0 ? (content.cta || '—') : i === 1 ? 'G' : String(i + 1)}
                </div>
              </div>
            ))}
          </div>

          {content.body && (
            <p style={{ fontFamily: FONTS.body, fontSize: 13*u, color: '#6a5f55', margin: 0, marginTop: 12*u, lineHeight: 1.4 }}>
              {content.body}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}