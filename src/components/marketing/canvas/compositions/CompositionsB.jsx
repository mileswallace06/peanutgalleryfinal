/**
 * Compositions B — Dynamic & Visual
 * --------------------------------------------------------------------
 * 5. PosterLayout     — Bold full-bleed gradient, high-contrast, geometric
 * 6. EditorialLayout  — Asymmetric columns, refined, thin accents
 * 7. MinimalApple     — Extreme whitespace, single focal point
 * 8. FloatingCard     — Glass card over atmospheric background
 */
import { NEON, NEON_RGB, TEXT, FONTS, GRADIENTS } from '@/lib/marketingTokens';
import { CanvasBadge, CanvasHeadline, CanvasSubheadline, CanvasCTA, CanvasGlow, CanvasFooter, CanvasLogo } from '../CanvasPrimitives';
import { AccentLine, GlassPanel, CornerGradient, ImageLayer, NumberBlock, Spotlight } from '../DesignElements';
import BodyPresenter from '../BodyPresenter';

/** 5. Poster Layout — bold full-bleed gradient, geometric accent, high energy. */
export function PosterLayout({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Full-bleed vibrant gradient */}
      <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg, ${NEON.purple} 0%, ${NEON.pink} 55%, ${NEON.orange} 100%)` }} />
      {/* Large circle outline — geometric accent */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 500 * u, height: 500 * u, borderRadius: '50%',
        border: `${2 * u}px solid rgba(255,255,255,0.15)`,
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 380 * u, height: 380 * u, borderRadius: '50%',
        border: `${1 * u}px solid rgba(255,255,255,0.08)`,
        pointerEvents: 'none',
      }} />
      {/* Dark vignette at bottom for footer legibility */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 200 * u, background: 'linear-gradient(180deg, transparent, rgba(0,0,0,0.5))', pointerEvents: 'none' }} />
      {/* Content */}
      <div style={{ position: 'relative', zIndex: 2, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 70 * u }}>
        {content.badge && (
          <span style={{
            display: 'inline-flex', padding: `${8 * u}px ${20 * u}px`, borderRadius: 999,
            background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.3)',
            fontFamily: FONTS.body, fontSize: 16 * u, fontWeight: 900,
            letterSpacing: '0.2em', textTransform: 'uppercase', color: '#fff',
            marginBottom: 28 * u,
          }}>{content.badge}</span>
        )}
        {content.headline && (
          <h1 style={{
            fontFamily: FONTS.display, fontSize: 100 * u, lineHeight: 1.0,
            color: '#fff', textTransform: 'uppercase', textAlign: 'center',
            margin: 0, maxWidth: '85%', wordBreak: 'break-word',
            textShadow: `0 ${4 * u}px ${24 * u}px rgba(0,0,0,0.3)`,
          }}>{content.headline}</h1>
        )}
        {content.subheadline && (
          <p style={{ fontFamily: FONTS.body, fontSize: 30 * u, fontWeight: 500, color: 'rgba(255,255,255,0.85)', textAlign: 'center', margin: `${20 * u}px 0 0`, maxWidth: '70%' }}>{content.subheadline}</p>
        )}
        {content.cta && (
          <div style={{ marginTop: 36 * u, padding: `${18 * u}px ${44 * u}px`, borderRadius: 999, background: '#fff', color: NEON.purple, fontFamily: FONTS.body, fontSize: 26 * u, fontWeight: 900, boxShadow: `0 ${6 * u}px ${24 * u}px rgba(0,0,0,0.25)` }}>
            {content.cta}
          </div>
        )}
      </div>
      {/* Footer with dark text for light background */}
      <div style={{ position: 'absolute', bottom: 40 * u, left: 60 * u, right: 60 * u, display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 3 }}>
        <CanvasLogo u={u} size={34} />
        <span style={{ fontFamily: FONTS.body, fontSize: 16 * u, fontWeight: 600, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.05em' }}>@peanutgallery</span>
      </div>
    </div>
  );
}

/** 6. Editorial Layout — asymmetric columns, refined, thin vertical accent. */
export function EditorialLayout({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: 70 * u }}>
      <CanvasGlow u={u} rgb={NEON_RGB.cyan} size={380} style={{ top: '10%', left: '-5%' }} />
      {/* Thin vertical accent line on left edge */}
      <div style={{ position: 'absolute', left: 30 * u, top: 80 * u, bottom: 100 * u, width: 2 * u, background: `linear-gradient(180deg, ${NEON.cyan}, rgba(0,200,255,0.2), transparent)` }} />
      {/* Page reference number top-left */}
      <div style={{ position: 'absolute', top: 50 * u, left: 60 * u }}>
        <NumberBlock u={u} color={NEON.cyan} style={{ width: 40 * u, height: 40 * u, minWidth: 40 * u, fontSize: 18 * u }}>02</NumberBlock>
      </div>
      {/* Headline — right-aligned, right side */}
      <div style={{ position: 'relative', zIndex: 1, marginLeft: '30%', marginTop: 60 * u }}>
        {content.badge && <CanvasBadge u={u} color={NEON.pink} style={{ marginBottom: 20 * u }}>{content.badge}</CanvasBadge>}
        {content.headline && <CanvasHeadline u={u} align="right" size={76} style={{ marginBottom: 24 * u }}>{content.headline}</CanvasHeadline>}
        <AccentLine u={u} orientation="horizontal" color={NEON.purple} length={120} thickness={2} style={{ marginLeft: 'auto', marginBottom: 24 * u }} />
      </div>
      {/* Body — left-aligned, narrow column, left side */}
      <div style={{ position: 'relative', zIndex: 1, maxWidth: '45%', marginTop: 20 * u, marginLeft: '5%' }}>
        {content.body && <BodyPresenter u={u} body={content.body} color={NEON.cyan} maxWidth="100%" />}
        {!content.body && content.subheadline && <CanvasSubheadline u={u}>{content.subheadline}</CanvasSubheadline>}
        {content.cta && <div style={{ marginTop: 24 * u }}><CanvasCTA u={u} gradient={GRADIENTS.cta_purple}>{content.cta}</CanvasCTA></div>}
      </div>
      <CanvasFooter u={u} />
    </div>
  );
}

/** 7. Minimal Apple — extreme whitespace, content in lower third only. */
export function MinimalApple({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <CanvasGlow u={u} rgb={NEON_RGB.purple} size={350} style={{ top: '15%', left: '50%', transform: 'translateX(-50%)' }} />
      {/* Content in lower third */}
      <div style={{ position: 'absolute', bottom: 130 * u, left: 70 * u, right: 70 * u, zIndex: 1 }}>
        {/* Single dot accent */}
        <div style={{ width: 10 * u, height: 10 * u, borderRadius: '50%', background: NEON.green, marginBottom: 24 * u, boxShadow: `0 0 ${16 * u}px ${NEON.green}` }} />
        {content.badge && <p style={{ fontFamily: FONTS.body, fontSize: 14 * u, fontWeight: 900, letterSpacing: '0.3em', textTransform: 'uppercase', color: TEXT.muted, margin: `0 0 ${16 * u}px` }}>{content.badge}</p>}
        {content.headline && <CanvasHeadline u={u} size={56} style={{ marginBottom: 16 * u }}>{content.headline}</CanvasHeadline>}
        {content.subheadline && <CanvasSubheadline u={u} size={26} color={TEXT.muted} style={{ maxWidth: '70%' }}>{content.subheadline}</CanvasSubheadline>}
        {content.cta && <div style={{ marginTop: 28 * u, display: 'inline-flex', alignItems: 'center', gap: 8 * u, fontFamily: FONTS.body, fontSize: 22 * u, fontWeight: 700, color: NEON.cyan }}>
          {content.cta} <span style={{ fontSize: 22 * u }}>{'\u2192'}</span>
        </div>}
      </div>
      <CanvasFooter u={u} />
    </div>
  );
}

/** 8. Floating Card — glass card over atmospheric background. */
export function FloatingCard({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Atmospheric background */}
      {content.image_url && <ImageLayer u={u} src={content.image_url} treatment="blur" overlayOpacity={0.6} />}
      <CanvasGlow u={u} rgb={NEON_RGB.purple} size={500} style={{ top: '20%', left: '50%', transform: 'translateX(-50%)' }} />
      <CanvasGlow u={u} rgb={NEON_RGB.cyan} size={350} style={{ bottom: '10%', right: '5%' }} />
      {/* Glass card */}
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '76%', zIndex: 2 }}>
        <GlassPanel u={u} style={{ padding: 48 * u }}>
          {content.badge && <CanvasBadge u={u} color={NEON.green} style={{ marginBottom: 24 * u }}>{content.badge}</CanvasBadge>}
          {content.headline && <CanvasHeadline u={u} size={64} style={{ marginBottom: 18 * u }}>{content.headline}</CanvasHeadline>}
          {content.subheadline && <CanvasSubheadline u={u} size={28} style={{ marginBottom: content.body ? 16 * u : 0 }}>{content.subheadline}</CanvasSubheadline>}
          {content.body && <BodyPresenter u={u} body={content.body} color={NEON.cyan} maxWidth="100%" />}
          {content.cta && <div style={{ marginTop: 28 * u }}><CanvasCTA u={u}>{content.cta}</CanvasCTA></div>}
        </GlassPanel>
      </div>
      <CanvasFooter u={u} />
    </div>
  );
}