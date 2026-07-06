/**
 * Compositions C — Data, Dynamic & Quote
 * --------------------------------------------------------------------
 *  9. StatisticHero       — Massive number dominates the canvas
 * 10. DiagonalComposition — Angled elements, movement, energy
 * 11. AsymmetricLayout    — Intentional imbalance, dramatic negative space
 * 12. LargeQuote          — Oversized punctuation, pull-quote aesthetic
 */
import { NEON, NEON_RGB, TEXT, FONTS, GRADIENTS } from '@/lib/marketingTokens';
import { CanvasBadge, CanvasHeadline, CanvasSubheadline, CanvasCTA, CanvasGlow, CanvasFooter } from '../CanvasPrimitives';
import { AccentLine, BackgroundNumeral, CornerGradient, OutlinedText, OversizedPunctuation } from '../DesignElements';
import BodyPresenter from '../BodyPresenter';

/** 9. Statistic Hero — massive number dominates, data-driven aesthetic. */
export function StatisticHero({ content, u, w, h }) {
  const hasStat = !!content.stat_number;
  const bigText = hasStat ? content.stat_number : content.headline;
  const label = hasStat ? content.stat_label : content.subheadline;
  const explanation = hasStat ? content.stat_explanation : content.body;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: 70 * u, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <BackgroundNumeral u={u} size={700} color={NEON.purple} opacity={0.03} style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
      <CornerGradient u={u} corner="top-right" color={NEON.green} size={450} />
      <CornerGradient u={u} corner="bottom-left" color={NEON.cyan} size={400} />
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        {content.badge && <CanvasBadge u={u} color={NEON.cyan} style={{ marginBottom: 24 * u }}>{content.badge}</CanvasBadge>}
        {bigText && (
          <div style={{
            fontFamily: FONTS.display, fontSize: 220 * u, lineHeight: 0.85,
            background: `linear-gradient(135deg, ${NEON.green}, ${NEON.cyan})`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            marginBottom: 16 * u,
          }}>{bigText}</div>
        )}
        {label && <p style={{ fontFamily: FONTS.body, fontSize: 36 * u, fontWeight: 700, color: TEXT.white, margin: `0 0 ${10 * u}px`, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>}
        {explanation && <p style={{ fontFamily: FONTS.body, fontSize: 22 * u, fontWeight: 400, color: TEXT.muted, margin: 0, maxWidth: '65%' }}>{explanation}</p>}
        {content.cta && <div style={{ marginTop: 32 * u }}><CanvasCTA u={u}>{content.cta}</CanvasCTA></div>}
      </div>
      <CanvasFooter u={u} />
    </div>
  );
}

/** 10. Diagonal Composition — angled elements, movement, energy. */
export function DiagonalComposition({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <CanvasGlow u={u} rgb={NEON_RGB.pink} size={450} style={{ top: '30%', left: '30%' }} />
      <CanvasGlow u={u} rgb={NEON_RGB.cyan} size={350} style={{ bottom: '10%', right: '10%' }} />
      {/* Diagonal accent lines */}
      <div style={{ position: 'absolute', top: '20%', left: '-10%', width: '60%', height: 2 * u, background: `linear-gradient(90deg, transparent, ${NEON.pink}, transparent)`, transform: 'rotate(-15deg)' }} />
      <div style={{ position: 'absolute', bottom: '25%', right: '-10%', width: '50%', height: 2 * u, background: `linear-gradient(90deg, transparent, ${NEON.cyan}, transparent)`, transform: 'rotate(-15deg)' }} />
      {/* Rotated content block */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: `translate(-50%, -50%) rotate(-4deg)`,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        textAlign: 'center', maxWidth: '80%', zIndex: 2,
      }}>
        {content.badge && <CanvasBadge u={u} color={NEON.pink} style={{ marginBottom: 24 * u }}>{content.badge}</CanvasBadge>}
        {content.headline && <CanvasHeadline u={u} align="center" size={92} style={{ marginBottom: 20 * u }}>{content.headline}</CanvasHeadline>}
        {content.subheadline && <CanvasSubheadline u={u} align="center" style={{ maxWidth: '70%', marginBottom: content.body ? 16 * u : 0 }}>{content.subheadline}</CanvasSubheadline>}
        {content.body && <BodyPresenter u={u} body={content.body} color={NEON.cyan} maxWidth="65%" align="center" />}
        {content.cta && <div style={{ marginTop: 32 * u }}><CanvasCTA u={u} gradient={GRADIENTS.cta_purple}>{content.cta}</CanvasCTA></div>}
      </div>
      <CanvasFooter u={u} />
    </div>
  );
}

/** 11. Asymmetric Layout — content in bottom-left, dramatic negative space top-right. */
export function AsymmetricLayout({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Huge atmospheric negative space top-right */}
      <CanvasGlow u={u} rgb={NEON_RGB.purple} size={550} style={{ top: '-10%', right: '-10%' }} />
      <CanvasGlow u={u} rgb={NEON_RGB.cyan} size={300} style={{ top: '20%', right: '20%' }} />
      <BackgroundNumeral u={u} size={400} color={NEON.pink} opacity={0.04} style={{ top: '8%', right: '5%' }}>
        {'\u2026'}
      </BackgroundNumeral>
      {/* Content in bottom-left quadrant */}
      <div style={{ position: 'absolute', bottom: 130 * u, left: 70 * u, right: 70 * u, zIndex: 1, maxWidth: '65%' }}>
        {content.badge && <CanvasBadge u={u} color={NEON.green} style={{ marginBottom: 20 * u }}>{content.badge}</CanvasBadge>}
        {content.headline && <CanvasHeadline u={u} size={76} style={{ marginBottom: 18 * u }}>{content.headline}</CanvasHeadline>}
        {content.subheadline && <CanvasSubheadline u={u} size={28} style={{ maxWidth: '85%', marginBottom: content.body ? 14 * u : 0 }}>{content.subheadline}</CanvasSubheadline>}
        {content.body && <BodyPresenter u={u} body={content.body} color={NEON.cyan} maxWidth="85%" />}
        {content.cta && (
          <div style={{ marginTop: 28 * u, display: 'inline-flex', alignItems: 'center', gap: 8 * u, fontFamily: FONTS.body, fontSize: 24 * u, fontWeight: 800, color: NEON.green }}>
            {content.cta} <span>{'\u2192'}</span>
          </div>
        )}
      </div>
      <CanvasFooter u={u} />
    </div>
  );
}

/** 12. Large Quote — oversized punctuation, pull-quote aesthetic. */
export function LargeQuote({ content, u, w, h }) {
  const quoteText = content.quote_text || content.body || content.headline || '';
  const author = content.author || content.signature || '';

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: 70 * u }}>
      <CanvasGlow u={u} rgb={NEON_RGB.purple} size={400} style={{ top: '15%', left: '10%' }} />
      <CanvasGlow u={u} rgb={NEON_RGB.cyan} size={300} style={{ bottom: '20%', right: '10%' }} />
      {/* Oversized opening quotation mark */}
      <OversizedPunctuation u={u} char={'\u201C'} size={260} color={NEON.purple} opacity={0.15} style={{ position: 'absolute', top: 40 * u, left: 50 * u }} />
      <div style={{ position: 'relative', zIndex: 1, maxWidth: '82%', marginTop: 120 * u }}>
        {content.badge && <CanvasBadge u={u} color={NEON.cyan} style={{ marginBottom: 24 * u }}>{content.badge}</CanvasBadge>}
        <p style={{
          fontFamily: FONTS.display, fontSize: 56 * u, lineHeight: 1.15,
          color: TEXT.white, margin: 0, wordBreak: 'break-word',
          textTransform: 'uppercase',
        }}>{quoteText}</p>
        {author && (
          <div style={{ marginTop: 32 * u, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <AccentLine u={u} color={NEON.green} length={80} thickness={2} style={{ marginBottom: 12 * u }} />
            <p style={{ fontFamily: FONTS.body, fontSize: 26 * u, fontWeight: 700, color: TEXT.body, margin: 0 }}>
              {'\u2014 '}{author}
            </p>
          </div>
        )}
        {content.cta && <div style={{ marginTop: 28 * u }}><CanvasCTA u={u} gradient={GRADIENTS.cta_purple}>{content.cta}</CanvasCTA></div>}
      </div>
      <CanvasFooter u={u} />
    </div>
  );
}