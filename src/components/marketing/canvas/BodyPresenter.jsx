/**
 * Body Presenter
 * --------------------------------------------------------------------
 * Automatically determines the best visual presentation for body text.
 * Instead of always rendering a paragraph, it can render:
 *   - paragraph (default)
 *   - bullets (list-like content)
 *   - timeline (date/step-structured content)
 *   - pullquote (quoted text)
 *   - callout (short text in a glass box)
 *   - statistic (number-heavy text)
 *   - none (no body)
 */
import { NEON, NEON_RGB, TEXT, FONTS, GRADIENTS, neonToRgb } from '@/lib/marketingTokens';
import { detectBodyFormat } from '@/lib/marketing/compositionEngine';
import { AccentLine, NumberBlock } from './DesignElements';
import { CanvasBody } from './CanvasPrimitives';

/** Parse body text into list items. */
function parseListItems(body) {
  return body.split('\n')
    .filter(l => l.trim())
    .map(l => l.replace(/^[-•*]\s*/, '').replace(/^\d+[.)]\s*/, '').trim());
}

/** Parse body text into timeline entries. */
function parseTimelineItems(body) {
  return body.split('\n')
    .filter(l => l.trim())
    .map(l => l.replace(/^[-•*]\s*/, '').replace(/^\d+[.)]\s*/, '').trim());
}

/** Extract a statistic from body text. */
function extractStat(body) {
  const match = body.match(/(\d+%|\$\d+[\d,]*|\d{2,})/);
  if (!match) return null;
  const stat = match[1];
  const rest = body.replace(stat, '').trim().replace(/^[-:–]\s*/, '');
  return { number: stat, label: rest };
}

export default function BodyPresenter({ u = 1, body, color = NEON.purple, maxWidth = '85%', align = 'left', style }) {
  if (!body?.trim()) return null;
  const format = detectBodyFormat(body);

  switch (format) {
    case 'none':
      return null;

    case 'bullets': {
      const items = parseListItems(body);
      const rgb = neonToRgb(color);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 * u, maxWidth, ...style }}>
          {items.map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 14 * u }}>
              <div style={{
                width: 8 * u, height: 8 * u, borderRadius: '50%',
                background: color, marginTop: 10 * u, flexShrink: 0,
                boxShadow: `0 0 ${8 * u}px rgba(${rgb}, 0.5)`,
              }} />
              <span style={{
                fontFamily: FONTS.body, fontSize: 24 * u, fontWeight: 500,
                lineHeight: 1.4, color: TEXT.body,
              }}>{item}</span>
            </div>
          ))}
        </div>
      );
    }

    case 'timeline': {
      const items = parseTimelineItems(body);
      const rgb = neonToRgb(color);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 * u, maxWidth, ...style }}>
          {items.map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 16 * u, position: 'relative' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                <NumberBlock u={u} color={color} style={{ width: 36 * u, height: 36 * u, minWidth: 36 * u, fontSize: 18 * u }}>
                  {i + 1}
                </NumberBlock>
                {i < items.length - 1 && (
                  <div style={{
                    width: 2 * u, height: 28 * u,
                    background: `linear-gradient(180deg, rgba(${rgb}, 0.4), transparent)`,
                    marginTop: 4 * u,
                  }} />
                )}
              </div>
              <span style={{
                fontFamily: FONTS.body, fontSize: 22 * u, fontWeight: 500,
                lineHeight: 1.4, color: TEXT.body, paddingTop: 4 * u,
              }}>{item}</span>
            </div>
          ))}
        </div>
      );
    }

    case 'pullquote': {
      const text = body.replace(/^["""'']+|["""'']+$/g, '').trim();
      const rgb = neonToRgb(color);
      return (
        <div style={{
          maxWidth, padding: `${20 * u}px ${28 * u}px`,
          borderLeft: `${3 * u}px solid ${color}`,
          background: `rgba(${rgb}, 0.04)`,
          ...style,
        }}>
          <p style={{
            fontFamily: FONTS.body, fontSize: 28 * u, fontWeight: 600,
            lineHeight: 1.35, color: TEXT.white, margin: 0,
            fontStyle: 'italic',
          }}>{text}</p>
        </div>
      );
    }

    case 'statistic': {
      const stat = extractStat(body);
      if (!stat) return <CanvasBody u={u} align={align} color={TEXT.muted} style={{ maxWidth, ...style }}>{body}</CanvasBody>;
      return (
        <div style={{ maxWidth, ...style }}>
          <div style={{
            fontFamily: FONTS.display, fontSize: 100 * u, lineHeight: 0.9,
            background: `linear-gradient(135deg, ${color}, ${NEON.cyan})`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>{stat.number}</div>
          {stat.label && (
            <p style={{
              fontFamily: FONTS.body, fontSize: 26 * u, fontWeight: 600,
              color: TEXT.white, margin: `${8 * u}px 0 0`,
            }}>{stat.label}</p>
          )}
        </div>
      );
    }

    case 'callout': {
      const rgb = neonToRgb(color);
      return (
        <div style={{
          maxWidth,
          padding: `${18 * u}px ${24 * u}px`,
          borderRadius: 16 * u,
          background: 'rgba(255,255,255,0.06)',
          backdropFilter: 'blur(12px)',
          border: `1px solid rgba(${rgb}, 0.2)`,
          ...style,
        }}>
          <p style={{
            fontFamily: FONTS.body, fontSize: 24 * u, fontWeight: 600,
            lineHeight: 1.4, color: TEXT.white, margin: 0,
          }}>{body.trim()}</p>
        </div>
      );
    }

    default:
      return <CanvasBody u={u} align={align} color={TEXT.muted} style={{ maxWidth, ...style }}>{body}</CanvasBody>;
  }
}