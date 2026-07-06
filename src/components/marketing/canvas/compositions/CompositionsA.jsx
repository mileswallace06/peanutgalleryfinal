/**
 * Compositions A — Typography & Editorial
 * --------------------------------------------------------------------
 * 1. MassiveLeft     — Huge left-aligned type, atmospheric negative space
 * 2. CenteredHero    — Symmetrical, minimal, Apple keynote energy
 * 3. SplitLayout     — Image/gradient panel beside content panel
 * 4. MagazineLayout  — Drop cap, column body, editorial structure
 */
import { NEON, NEON_RGB, TEXT, FONTS, GRADIENTS } from '@/lib/marketingTokens';
import { CanvasBadge, CanvasHeadline, CanvasSubheadline, CanvasCTA, CanvasGlow, CanvasFooter } from '../CanvasPrimitives';
import { AccentLine, BackgroundNumeral, CornerGradient, ImageLayer, NumberBlock, DropCapText, VerticalText } from '../DesignElements';
import BodyPresenter from '../BodyPresenter';

/** 1. Massive Left — huge type dominates left, atmospheric right side. */
export function MassiveLeft({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: 70 * u, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <BackgroundNumeral u={u} size={520} color={NEON.purple} opacity={0.04} style={{ right: '-8%', top: '10%' }} />
      <CanvasGlow u={u} rgb={NEON_RGB.purple} size={420} style={{ bottom: '10%', right: '-5%' }} />
      <CanvasGlow u={u} rgb={NEON_RGB.cyan} size={280} style={{ top: '5%', right: '15%' }} />
      <div style={{ position: 'relative', zIndex: 1, maxWidth: '78%' }}>
        {content.badge && <CanvasBadge u={u} color={NEON.cyan} style={{ marginBottom: 28 * u }}>{content.badge}</CanvasBadge>}
        {content.headline && <CanvasHeadline u={u} broken size={110} style={{ marginBottom: 24 * u }}>{content.headline}</CanvasHeadline>}
        {content.subheadline && <CanvasSubheadline u={u} style={{ maxWidth: '55%', marginBottom: content.body ? 24 * u : 0 }}>{content.subheadline}</CanvasSubheadline>}
        {content.body && <BodyPresenter u={u} body={content.body} color={NEON.purple} maxWidth="55%" />}
        {content.cta && <div style={{ marginTop: 32 * u }}><CanvasCTA u={u}>{content.cta}</CanvasCTA></div>}
      </div>
      <CanvasFooter u={u} />
    </div>
  );
}

/** 2. Centered Hero — symmetrical, minimal, Apple keynote. */
export function CenteredHero({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 70 * u }}>
      <CornerGradient u={u} corner="top-left" color={NEON.purple} size={500} />
      <CornerGradient u={u} corner="bottom-right" color={NEON.cyan} size={450} />
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', maxWidth: '85%' }}>
        {content.badge && <CanvasBadge u={u} color={NEON.purple} style={{ marginBottom: 32 * u }}>{content.badge}</CanvasBadge>}
        {content.headline && <CanvasHeadline u={u} align="center" size={88} style={{ marginBottom: 28 * u }}>{content.headline}</CanvasHeadline>}
        <AccentLine u={u} color={NEON.green} length={140} thickness={2} style={{ marginBottom: 28 * u }} />
        {content.subheadline && <CanvasSubheadline u={u} align="center" style={{ maxWidth: '70%', marginBottom: content.body ? 20 * u : 0 }}>{content.subheadline}</CanvasSubheadline>}
        {content.body && <BodyPresenter u={u} body={content.body} color={NEON.cyan} maxWidth="65%" align="center" />}
        {content.cta && <div style={{ marginTop: 36 * u }}><CanvasCTA u={u}>{content.cta}</CanvasCTA></div>}
      </div>
      <CanvasFooter u={u} />
    </div>
  );
}

/** 3. Split Layout — image/gradient panel beside content panel. */
export function SplitLayout({ content, u, w, h }) {
  const isPortrait = h > w;
  const leftWidth = isPortrait ? '100%' : '52%';
  const rightWidth = isPortrait ? '100%' : '48%';
  const flexDirection = isPortrait ? 'column' : 'row';

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection }}>
      {/* Left panel — image or gradient */}
      <div style={{ width: leftWidth, height: isPortrait ? '42%' : '100%', position: 'relative', overflow: 'hidden' }}>
        {content.image_url ? (
          <ImageLayer u={u} src={content.image_url} treatment="darken" overlayOpacity={0.55} />
        ) : (
          <>
            <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg, rgba(191,95,255,0.15), rgba(0,200,255,0.08))` }} />
            <CanvasGlow u={u} rgb={NEON_RGB.purple} size={400} style={{ top: '20%', left: '20%' }} />
            <CanvasGlow u={u} rgb={NEON_RGB.pink} size={300} style={{ bottom: '10%', right: '10%' }} />
          </>
        )}
        <div style={{ position: 'absolute', bottom: 30 * u, left: 30 * u, zIndex: 2 }}>
          <CanvasBadge u={u} color={NEON.green}>{content.badge || 'PEANUT GALLERY'}</CanvasBadge>
        </div>
      </div>
      {/* Right panel — content */}
      <div style={{ width: rightWidth, height: isPortrait ? '58%' : '100%', padding: 60 * u, display: 'flex', flexDirection: 'column', justifyContent: 'center', position: 'relative' }}>
        {content.headline && <CanvasHeadline u={u} size={72} style={{ marginBottom: 20 * u }}>{content.headline}</CanvasHeadline>}
        {content.subheadline && <CanvasSubheadline u={u} style={{ marginBottom: content.body ? 16 * u : 0, maxWidth: '90%' }}>{content.subheadline}</CanvasSubheadline>}
        {content.body && <BodyPresenter u={u} body={content.body} color={NEON.cyan} maxWidth="90%" />}
        {content.cta && <div style={{ marginTop: 28 * u }}><CanvasCTA u={u}>{content.cta}</CanvasCTA></div>}
      </div>
      <CanvasFooter u={u} />
    </div>
  );
}

/** 4. Magazine Layout — drop cap, column body, editorial structure. */
export function MagazineLayout({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: 70 * u }}>
      <CanvasGlow u={u} rgb={NEON_RGB.purple} size={350} style={{ top: '-5%', right: '10%' }} />
      {/* Page-style number in top-right corner */}
      <div style={{ position: 'absolute', top: 50 * u, right: 60 * u }}>
        <NumberBlock u={u} color={NEON.cyan} style={{ width: 44 * u, height: 44 * u, minWidth: 44 * u, fontSize: 20 * u }}>01</NumberBlock>
      </div>
      {/* Vertical text on right edge */}
      <div style={{ position: 'absolute', right: 22 * u, top: '50%', width: 20 * u, height: 220 * u, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ transform: 'rotate(-90deg)', whiteSpace: 'nowrap', fontFamily: FONTS.body, fontSize: 13 * u, fontWeight: 900, letterSpacing: '0.35em', textTransform: 'uppercase', color: NEON.cyan }}>
          PEANUT GALLERY
        </div>
      </div>
      <div style={{ position: 'relative', zIndex: 1, maxWidth: '68%', marginTop: 20 * u }}>
        {content.badge && <CanvasBadge u={u} color={NEON.pink} style={{ marginBottom: 24 * u }}>{content.badge}</CanvasBadge>}
        {content.headline && <CanvasHeadline u={u} size={74} style={{ marginBottom: 20 * u }}>{content.headline}</CanvasHeadline>}
        <AccentLine u={u} color={NEON.purple} length={160} style={{ marginBottom: 28 * u }} />
        {content.body && <DropCapText u={u} color={NEON.purple} size={24} capSize={82} style={{ maxWidth: '95%' }}>{content.body}</DropCapText>}
        {!content.body && content.subheadline && <CanvasSubheadline u={u} style={{ maxWidth: '90%' }}>{content.subheadline}</CanvasSubheadline>}
        {content.cta && <div style={{ marginTop: 28 * u }}><CanvasCTA u={u} gradient={GRADIENTS.cta_purple}>{content.cta}</CanvasCTA></div>}
      </div>
      <CanvasFooter u={u} />
    </div>
  );
}