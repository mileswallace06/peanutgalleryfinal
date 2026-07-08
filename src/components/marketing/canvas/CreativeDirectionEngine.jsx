/**
 * Creative Direction Engine
 * --------------------------------------------------------------------
 * The SINGLE rendering engine that interprets a Creative Concept's
 * structured design system data and constructs the graphic dynamically.
 *
 * There is NO per-concept rendering code. Every concept is data.
 * The engine reads that data and builds the graphic.
 *
 * Pipeline:
 *   1. Resolve: base concept designSystem + execution style modifiers
 *      + Creative Intent (translated by Intent Translator, respecting locks)
 *   2. Render background (flat, gradient, radial-glow, banded, pattern)
 *   3. Render background overlays (darken, lighten from intent)
 *   4. Render texture overlay (grain, vignette, paper)
 *   5. Render background-layer decorative elements
 *   6. Calculate content zone (anchor, negativeSpace, maxWidth, offsets)
 *   7. Render content elements in hierarchy order
 *   8. Render inline decorative elements in hierarchy flow
 *   9. Render logo at specified position
 *
 * Creative Intent does NOT mutate the base concept. The Intent Translator
 * converts semantic intent into rendering modifications at render time.
 * Locked design categories are never modified by intent.
 */
import { NEON, NEON_RGB, FONTS, TEXT, GRADIENTS, THEMES, PG_LOGO_URL } from '@/lib/marketingTokens';
import { getConceptById } from '@/lib/marketing/creativeConcepts';
import { getExecutionStyleById, EXECUTION_STYLES } from '@/lib/marketing/executionStyles';
import { renderDecorative, BACKGROUND_DECORATIVES, INLINE_DECORATIVES } from './decoratives';
import { translateIntent } from '@/lib/marketing/intentTranslator';
import { cloneElement } from 'react';

// ── Edit Mode wrapper ───────────────────────────────────────────────────
function withEditMode(element, elementId, editMode, selectedElement, onSelectElement) {
  if (!element || !editMode) return element;
  const isSelected = selectedElement === elementId;
  return cloneElement(element, {
    'data-pg-element': elementId,
    onClick: (e) => { e.stopPropagation(); onSelectElement?.(elementId); },
    style: {
      ...element.props.style,
      cursor: 'pointer',
      outline: isSelected ? `2px solid ${NEON.pink}` : '1px dashed rgba(255,255,255,0.12)',
      outlineOffset: '2px',
      borderRadius: '4px',
    },
  });
}

// ── Emphasis Style (used by content renderer) ───────────────────────────
function getEmphasisStyle(treatment, accentColor) {
  switch (treatment) {
    case 'fracture':
    case 'crack':
      return {
        background: GRADIENTS.broken,
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
      };
    case 'gradient':
      return {
        background: GRADIENTS.headline,
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
      };
    case 'highlight':
      return {
        background: `${accentColor}30`,
        padding: '0 0.1em',
        borderRadius: '0.05em',
        color: accentColor,
      };
    case 'underline':
      return {
        textDecoration: 'underline',
        textDecorationColor: accentColor,
        textDecorationThickness: '2px',
        textUnderlineOffset: '0.05em',
      };
    case 'bold':
      return { fontWeight: 900, color: accentColor };
    default:
      return { color: accentColor };
  }
}

// ── Typography resolution ───────────────────────────────────────────────
const FONT_MAP = { display: FONTS.display, body: FONTS.body };
const WEIGHT_MAP = { light: 300, normal: 400, bold: 700, heavy: 900 };
const TRACKING_MAP = { normal: '0em', wide: '0.05em', 'extra-wide': '0.15em' };

function resolveTypo(typeDef, baseSize, execModifiers) {
  const weight = typeDef.weight;
  const resolvedWeight = execModifiers.weightReduction && weight === 'heavy' ? 700 : WEIGHT_MAP[weight];
  return {
    fontFamily: FONT_MAP[typeDef.font] || FONTS.body,
    fontWeight: resolvedWeight,
    textTransform: typeDef.transform || 'none',
    letterSpacing: TRACKING_MAP[typeDef.tracking] || '0em',
    fontSize: baseSize * (typeDef.scale || 1) * (execModifiers.typographyScale || 1),
  };
}

// ── Content zone calculation ────────────────────────────────────────────
function getContentZone(composition, w, h, execModifiers) {
  const ns = Math.max(0, Math.min(0.9, composition.negativeSpace + (execModifiers.negativeSpaceBoost || 0)));
  const maxW = Math.max(0.3, Math.min(1.0, composition.maxWidth - (execModifiers.maxWidthReduction || 0)));

  const padX = w * (1 - maxW) / 2;
  const padY = h * ns * 0.5;
  const zoneW = w * maxW;
  const zoneH = h - padY * 2;

  let zoneTop;
  switch (composition.anchor) {
    case 'top':       zoneTop = padY; break;
    case 'bottom':    zoneTop = h - zoneH - padY; break;
    case 'lower-third': zoneTop = h * 0.6; break;
    case 'center':
    default:          zoneTop = (h - zoneH) / 2; break;
  }

  // Apply vertical/horizontal offsets from design overrides
  if (composition.verticalOffset) {
    zoneTop += composition.verticalOffset * h;
  }
  let zoneLeft = padX;
  if (composition.horizontalOffset) {
    zoneLeft += composition.horizontalOffset * w;
  }

  return {
    left: zoneLeft,
    top: zoneTop,
    width: zoneW,
    height: zoneH,
    padding: w * 0.04,
  };
}

// ── Background renderer ─────────────────────────────────────────────────
function renderBackground(bg, w, h) {
  const { type, baseColor, glow, bands, patternColor } = bg;

  switch (type) {
    case 'flat':
      return (
        <>
          <div style={{ position: 'absolute', inset: 0, background: baseColor }} />
          {glow && (
            <div style={{
              position: 'absolute', inset: 0,
              background: `radial-gradient(ellipse 60% 50% at ${glow.x}% ${glow.y}%, ${glow.color}${Math.round(glow.intensity * 255).toString(16).padStart(2, '0')}, transparent 70%)`,
            }} />
          )}
        </>
      );

    case 'radial-glow':
      return (
        <>
          <div style={{ position: 'absolute', inset: 0, background: baseColor }} />
          {glow && (
            <div style={{
              position: 'absolute', inset: 0,
              background: `radial-gradient(ellipse 80% 60% at ${glow.x}% ${glow.y}%, ${glow.color}${Math.round(glow.intensity * 255).toString(16).padStart(2, '0')}, transparent 65%)`,
            }} />
          )}
          {/* Secondary subtle glow for depth */}
          <div style={{
            position: 'absolute', inset: 0,
            background: `radial-gradient(ellipse 50% 40% at 80% 90%, ${NEON.green}06, transparent 60%)`,
          }} />
        </>
      );

    case 'banded':
      return (
        <>
          <div style={{ position: 'absolute', inset: 0, background: baseColor }} />
          {(bands || []).map((band, i) => {
            const heights = { top: '12%', middle: '76%', bottom: '12%' };
            const positions = { top: 0, middle: '12%', bottom: '88%' };
            return (
              <div key={i} style={{
                position: 'absolute', left: 0, right: 0,
                top: positions[band.position] || 0,
                height: heights[band.position] || '12%',
                background: band.color,
              }} />
            );
          })}
        </>
      );

    case 'pattern-grid':
      return (
        <>
          <div style={{ position: 'absolute', inset: 0, background: baseColor }} />
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: `
              linear-gradient(${patternColor || 'rgba(0,200,255,0.06)'} 1px, transparent 1px),
              linear-gradient(90deg, ${patternColor || 'rgba(0,200,255,0.06)'} 1px, transparent 1px)
            `,
            backgroundSize: `${w / 40}px ${w / 40}px`,
          }} />
          {glow && (
            <div style={{
              position: 'absolute', inset: 0,
              background: `radial-gradient(ellipse 70% 50% at ${glow.x}% ${glow.y}%, ${glow.color}${Math.round(glow.intensity * 255).toString(16).padStart(2, '0')}, transparent 70%)`,
            }} />
          )}
        </>
      );

    case 'pattern-dots':
      return (
        <>
          <div style={{ position: 'absolute', inset: 0, background: baseColor }} />
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: `radial-gradient(circle, ${patternColor || 'rgba(0,255,135,0.04)'} 1px, transparent 1px)`,
            backgroundSize: `${w / 50}px ${w / 50}px`,
          }} />
          {glow && (
            <div style={{
              position: 'absolute', inset: 0,
              background: `radial-gradient(ellipse 60% 50% at ${glow.x}% ${glow.y}%, ${glow.color}${Math.round(glow.intensity * 255).toString(16).padStart(2, '0')}, transparent 70%)`,
            }} />
          )}
        </>
      );

    case 'pattern-lines':
      return (
        <>
          <div style={{ position: 'absolute', inset: 0, background: baseColor }} />
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: `repeating-linear-gradient(0deg, ${patternColor || 'rgba(255,140,0,0.04)'} 0, ${patternColor || 'rgba(255,140,0,0.04)'} 2px, transparent 2px, transparent 8px)`,
          }} />
          {glow && (
            <div style={{
              position: 'absolute', inset: 0,
              background: `radial-gradient(ellipse 70% 50% at ${glow.x}% ${glow.y}%, ${glow.color}${Math.round(glow.intensity * 255).toString(16).padStart(2, '0')}, transparent 70%)`,
            }} />
          )}
        </>
      );

    default:
      return <div style={{ position: 'absolute', inset: 0, background: baseColor }} />;
  }
}

// ── Texture overlay renderer ────────────────────────────────────────────
function renderTexture(texture, w, h, execModifiers) {
  const intensity = (texture.intensity || 0) * (execModifiers.textureIntensityMultiplier || 1);
  if (intensity <= 0) return null;

  switch (texture.type) {
    case 'vignette':
      return (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: `radial-gradient(ellipse 80% 80% at 50% 50%, transparent 40%, rgba(0,0,0,${intensity}) 100%)`,
        }} />
      );

    case 'grain':
      return (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          opacity: intensity,
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' /%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`,
          mixBlendMode: 'overlay',
        }} />
      );

    case 'paper':
      return (
        <>
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            opacity: intensity * 0.5,
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='p'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.04' numOctaves='5' /%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23p)' opacity='0.3'/%3E%3C/svg%3E")`,
          }} />
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: `radial-gradient(ellipse 90% 90% at 50% 50%, transparent 60%, rgba(0,0,0,${intensity * 0.3}) 100%)`,
          }} />
        </>
      );

    default:
      return null;
  }
}

// ── Content element renderer ────────────────────────────────────────────
function resolveTextColor(colorScheme) {
  if (colorScheme.text === 'dark') return TEXT.dark;
  if (colorScheme.text === 'accent') return colorScheme.accent;
  return TEXT.white;
}

function renderContentElement(elementId, content, designSystem, zone, u, execModifiers, colorScheme) {
  const { typography, color, composition } = designSystem;
  const textColor = resolveTextColor(colorScheme);
  const align = composition.alignment;
  const baseFontSize = zone.width * 0.07;

  switch (elementId) {
    case 'headline': {
      if (!content.headline) return null;
      const typo = resolveTypo(typography.headline, baseFontSize, execModifiers);
      const emphasis = designSystem._emphasis;

      // If emphasis word is set and exists in headline, split and style
      if (emphasis && emphasis.word && content.headline.toLowerCase().includes(emphasis.word.toLowerCase())) {
        const word = emphasis.word;
        const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escaped})`, 'gi');
        const parts = content.headline.split(regex).filter(p => p.length > 0);
        const emphStyle = getEmphasisStyle(emphasis.treatment, color.accent);

        return (
          <div key={elementId} style={{
            ...typo,
            color: textColor,
            textAlign: align,
            lineHeight: 1.05,
            maxWidth: '100%',
            wordBreak: 'break-word',
          }}>
            {parts.map((part, i) => {
              if (part.toLowerCase() === word.toLowerCase()) {
                return <span key={i} style={emphStyle}>{part}</span>;
              }
              return <span key={i}>{part}</span>;
            })}
          </div>
        );
      }

      // Default rendering (with optional text gradient)
      return (
        <div key={elementId} style={{
          ...typo,
          color: color.textGradient ? undefined : textColor,
          background: color.textGradient || undefined,
          WebkitBackgroundClip: color.textGradient ? 'text' : undefined,
          WebkitTextFillColor: color.textGradient ? 'transparent' : undefined,
          backgroundClip: color.textGradient ? 'text' : undefined,
          textAlign: align,
          lineHeight: 1.05,
          maxWidth: '100%',
          wordBreak: 'break-word',
        }}>
          {content.headline}
        </div>
      );
    }

    case 'subheadline': {
      if (!content.subheadline) return null;
      const typo = resolveTypo(typography.subheadline, baseFontSize * 0.42, execModifiers);
      return (
        <div key={elementId} style={{
          ...typo,
          color: textColor,
          opacity: 0.82,
          textAlign: align,
          lineHeight: 1.4,
          maxWidth: '100%',
        }}>
          {content.subheadline}
        </div>
      );
    }

    case 'body': {
      if (!content.body) return null;
      const typo = resolveTypo(typography.body, baseFontSize * 0.32, execModifiers);
      return (
        <div key={elementId} style={{
          ...typo,
          color: textColor,
          opacity: 0.7,
          textAlign: align,
          lineHeight: 1.5,
          maxWidth: '100%',
        }}>
          {content.body}
        </div>
      );
    }

    case 'cta': {
      if (!content.cta) return null;
      const ctaIntent = designSystem._ctaIntent || {};

      const typo = resolveTypo(typography.cta, baseFontSize * 0.3, execModifiers);
      const prominence = ctaIntent.prominence || 'normal';
      const paddingScale = prominence === 'high' ? 1.3 : prominence === 'low' ? 0.7 : 1.0;
      const opacity = prominence === 'low' ? 0.55 : 1.0;
      const ctaStyle = ctaIntent.style || 'pill';

      let ctaBg = GRADIENTS.cta_primary;
      let ctaBorderRadius = 999;
      let ctaBorder = 'none';
      let ctaColor = TEXT.dark;

      if (ctaStyle === 'flat') {
        ctaBorderRadius = 8 * u;
      } else if (ctaStyle === 'outline') {
        ctaBg = 'transparent';
        ctaBorder = `2px solid ${color.accent}`;
        ctaColor = color.accent;
      }

      return (
        <div key={elementId} style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          padding: `${10 * u * paddingScale}px ${28 * u * paddingScale}px`,
          borderRadius: ctaBorderRadius,
          background: ctaBg,
          border: ctaBorder,
          opacity,
          ...typo,
          color: ctaColor,
          alignSelf: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
        }}>
          {content.cta}
        </div>
      );
    }

    case 'badge': {
      if (!content.badge) return null;
      const typo = resolveTypo(typography.badge, baseFontSize * 0.22, execModifiers);
      return (
        <div key={elementId} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6 * u,
          padding: `${4 * u}px ${12 * u}px`,
          borderRadius: 999,
          background: `${color.accent}18`,
          border: `1px solid ${color.accent}40`,
          ...typo,
          color: color.accent,
          alignSelf: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
        }}>
          {content.badge}
        </div>
      );
    }

    case 'stat': {
      if (!content.stat_number) return null;
      const typo = resolveTypo(typography.stat, baseFontSize * 0.8, execModifiers);
      const labelTypo = resolveTypo(typography.subheadline, baseFontSize * 0.28, execModifiers);
      return (
        <div key={elementId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 * u }}>
          <div style={{
            ...typo,
            background: GRADIENTS.stat,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            lineHeight: 1,
          }}>
            {content.stat_number}
          </div>
          {content.stat_label && (
            <div style={{ ...labelTypo, color: textColor, opacity: 0.7, textAlign: 'center' }}>
              {content.stat_label}
            </div>
          )}
          {content.stat_explanation && (
            <div style={{ ...labelTypo, color: textColor, opacity: 0.4, fontSize: labelTypo.fontSize * 0.8, textAlign: 'center' }}>
              {content.stat_explanation}
            </div>
          )}
        </div>
      );
    }

    case 'quote': {
      if (!content.quote_text) return null;
      const typo = resolveTypo(typography.headline, baseFontSize * 0.45, execModifiers);
      const authorTypo = resolveTypo(typography.subheadline, baseFontSize * 0.25, execModifiers);
      return (
        <div key={elementId} style={{ display: 'flex', flexDirection: 'column', gap: 8 * u, alignItems: 'center' }}>
          <div style={{
            ...typo,
            color: textColor,
            opacity: 0.9,
            textAlign: align,
            lineHeight: 1.3,
            fontStyle: 'italic',
            maxWidth: '90%',
          }}>
            "{content.quote_text}"
          </div>
          {content.author && (
            <div style={{ ...authorTypo, color: color.accent, textAlign: 'center' }}>
              — {content.author}
            </div>
          )}
        </div>
      );
    }

    case 'signature': {
      if (!content.signature) return null;
      const typo = resolveTypo(typography.subheadline, baseFontSize * 0.25, execModifiers);
      return (
        <div key={elementId} style={{
          ...typo, color: textColor, opacity: 0.5, fontStyle: 'italic', textAlign: align,
        }}>
          {content.signature}
        </div>
      );
    }

    default:
      // Inline decorative element
      if (INLINE_DECORATIVES.has(elementId)) {
        const props = { u, w: zone.width + zone.padding * 2, h: zone.height, color: color.accent, content };
        return (
          <div key={elementId} style={{
            display: 'flex', justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
          }}>
            {renderDecorative(elementId, props)}
          </div>
        );
      }
      return null;
  }
}

// ── Logo renderer ───────────────────────────────────────────────────────
function renderLogo(logoConfig, u, w, h, colorScheme) {
  if (logoConfig.position === 'none') return null;

  const sizes = { xs: 16 * u, sm: 20 * u, md: 28 * u };
  const logoSize = sizes[logoConfig.size] || sizes.sm;
  const logoOpacity = logoConfig.opacity !== undefined ? logoConfig.opacity : 0.6;

  const positions = {
    'top-left':     { top: 20 * u, left: 20 * u },
    'top-center':   { top: 20 * u, left: '50%', transform: 'translateX(-50%)' },
    'top-right':    { top: 20 * u, right: 20 * u },
    'bottom-left':  { bottom: 20 * u, left: 20 * u },
    'bottom-center':{ bottom: 20 * u, left: '50%', transform: 'translateX(-50%)' },
    'bottom-right': { bottom: 20 * u, right: 20 * u },
  };

  const pos = positions[logoConfig.position];
  if (!pos) return null;

  return (
    <div style={{
      position: 'absolute',
      ...pos,
      display: 'flex', alignItems: 'center', gap: 6 * u,
      opacity: logoOpacity,
      zIndex: 10,
    }}>
      <img src={PG_LOGO_URL} alt="PG" style={{ width: logoSize, height: logoSize, objectFit: 'contain' }} crossOrigin="anonymous" />
      <span style={{
        fontFamily: FONTS.display,
        fontSize: logoSize * 0.5,
        color: resolveTextColor(colorScheme),
        opacity: 0.5,
        letterSpacing: '0.05em',
      }}>
        PG
      </span>
    </div>
  );
}

// ── Main Engine ─────────────────────────────────────────────────────────
/**
 * CreativeDirectionEngine
 *
 * Props:
 *   conceptId — which Creative Concept to render
 *   executionStyleId — which Execution Style modifies it
 *   content — the user's text content (may include creative_intent)
 *   preset — canvas dimensions { w, h }
 *   theme — color theme override
 *   creativeIntent — semantic creative direction (also read from content.creative_intent)
 *   creativeLocks — locked design categories (also read from content.creative_locks)
 *
 * Render order: base concept + execution style + creative intent (translated)
 */
export default function CreativeDirectionEngine({ conceptId, executionStyleId, content = {}, preset, theme, creativeIntent, creativeLocks, editMode, selectedElement, onSelectElement }) {
  const concept = getConceptById(conceptId);
  if (!concept) return null;

  const execStyle = getExecutionStyleById(executionStyleId) || EXECUTION_STYLES[1];
  const execModifiers = execStyle.modifiers;

  // Resolve creative intent: explicit prop, or from content.creative_intent
  const intent = creativeIntent || content?.creative_intent;
  const locks = creativeLocks || content?.creative_locks;
  const designSystem = intent
    ? translateIntent(concept.designSystem, intent, locks)
    : concept.designSystem;

  const { background, composition, typography, color, texture, decorative, logo, hierarchy } = designSystem;

  const w = preset.w;
  const h = preset.h;
  const u = w / 1080;

  const zone = getContentZone(composition, w, h, execModifiers);

  // Separate decoratives into background-layer and inline
  const bgDecoratives = decorative.filter(d => BACKGROUND_DECORATIVES.has(d));
  const inlineDecoratives = decorative.filter(d => INLINE_DECORATIVES.has(d));

  // Apply rotation if specified
  const contentRotation = composition.rotation || 0;

  return (
    <div style={{
      width: w, height: h, position: 'relative', overflow: 'hidden',
      ...(editMode ? { cursor: 'pointer', onClick: () => onSelectElement?.('background') } : {}),
    }}>
      {/* Layer 1: Background */}
      {renderBackground(background, w, h)}

      {/* Layer 1b: Background overlays (darken/lighten from overrides) */}
      {background.darken > 0 && (
        <div style={{ position: 'absolute', inset: 0, background: `rgba(0,0,0,${background.darken})`, pointerEvents: 'none', zIndex: 2 }} />
      )}
      {background.lighten > 0 && (
        <div style={{ position: 'absolute', inset: 0, background: `rgba(255,255,255,${background.lighten})`, pointerEvents: 'none', zIndex: 2 }} />
      )}

      {/* Layer 2: Texture overlay */}
      {renderTexture(texture, w, h, execModifiers)}

      {/* Layer 3: Background-layer decorative elements */}
      {bgDecoratives.map(decId => {
        const props = { u, w, h, color: color.accent, content };
        return (
          <div key={decId} {...(editMode ? {
            'data-pg-element': 'decorations',
            onClick: (e) => { e.stopPropagation(); onSelectElement?.('decorations'); },
            style: {
              cursor: 'pointer',
              outline: selectedElement === 'decorations' ? `2px solid ${NEON.pink}` : '1px dashed rgba(255,255,255,0.1)',
              outlineOffset: '2px',
            },
          } : {})}>
            {renderDecorative(decId, props)}
          </div>
        );
      })}

      {/* Layer 4: Content zone */}
      <div style={{
        position: 'absolute',
        left: zone.left,
        top: zone.top,
        width: zone.width,
        height: zone.height,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: composition.alignment === 'center' ? 'center' : composition.alignment === 'right' ? 'flex-end' : 'flex-start',
        gap: 16 * u,
        padding: zone.padding,
        transform: contentRotation ? `rotate(${contentRotation}deg)` : undefined,
        zIndex: 5,
      }}>
        {/* Render hierarchy — content elements and inline decoratives in order */}
        {hierarchy.map(elementId => {
          const el = renderContentElement(elementId, content, designSystem, zone, u, execModifiers, color);
          if (!el) return null;
          return editMode ? withEditMode(el, elementId, editMode, selectedElement, onSelectElement) : el;
        })}

        {/* Render any inline decoratives not already in hierarchy */}
        {inlineDecoratives
          .filter(d => !hierarchy.includes(d))
          .map(decId => {
            const props = { u, w: zone.width, h: zone.height, color: color.accent, content };
            return (
              <div key={decId} style={{
                display: 'flex',
                justifyContent: composition.alignment === 'center' ? 'center' : composition.alignment === 'right' ? 'flex-end' : 'flex-start',
              }}>
                {renderDecorative(decId, props)}
              </div>
            );
          })
        }
      </div>

      {/* Layer 5: Logo */}
      {(() => {
        const logoEl = renderLogo(logo, u, w, h, color);
        if (!logoEl) return null;
        return editMode ? withEditMode(logoEl, 'logo', editMode, selectedElement, onSelectElement) : logoEl;
      })()}
    </div>
  );
}