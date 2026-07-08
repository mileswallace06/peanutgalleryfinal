/**
 * Intent Translator
 * --------------------------------------------------------------------
 * Converts Creative Intent (semantic) into rendering modifications
 * on a concept's design system.
 *
 * The AI thinks: "This needs to feel more premium."
 * The translator decides: reduce decoration, increase negative space,
 * darken background, increase typography contrast, restrain accents.
 *
 * The AI never knows these implementation details.
 *
 * Lockable categories: if a system is locked, its modifications are
 * skipped entirely. This lets users freeze parts of the design while
 * AI edits other areas.
 *
 * Pipeline:
 *   base concept designSystem
 *   + execution style modifiers (applied by engine)
 *   + Creative Intent (translated here, respecting locks)
 *   = Final rendered design
 */
import { NEON, TEXT, GRADIENTS, FONTS } from '@/lib/marketingTokens';

const COLOR_NAMES = {
  purple: NEON.purple, pink: NEON.pink, green: NEON.green,
  cyan: NEON.cyan, yellow: NEON.yellow, orange: NEON.orange,
  white: '#ffffff', dark: TEXT.dark,
};

function resolveColorName(color) {
  if (!color) return undefined;
  if (typeof color !== 'string') return color;
  if (color.startsWith('#') || color.startsWith('rgb')) return color;
  return COLOR_NAMES[color.toLowerCase()] || color;
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

const WEIGHT_MAP = { light: 300, normal: 400, bold: 700, heavy: 900 };
const TRACKING_MAP = { normal: '0em', wide: '0.05em', 'extra-wide': '0.15em' };

// ── Background intent ───────────────────────────────────────────────────
function applyBackgroundIntent(ds, intent) {
  const { mood, energy, background, contrast } = intent;
  const bg = ds.background;

  // Mood → background atmosphere
  if (mood === 'premium')   bg.darken = (bg.darken || 0) + 0.12;
  if (mood === 'dark')      bg.darken = (bg.darken || 0) + 0.25;
  if (mood === 'cinematic') bg.darken = (bg.darken || 0) + 0.18;
  if (mood === 'minimal')   bg.darken = Math.max(0, (bg.darken || 0) - 0.1);
  if (mood === 'atmospheric' && bg.glow) bg.glow.intensity = clamp((bg.glow.intensity || 0.1) * 1.5, 0, 0.5);
  if (mood === 'luxury')    bg.darken = (bg.darken || 0) + 0.15;

  // Energy → glow intensity
  if (bg.glow) {
    if (energy === 'low')     bg.glow.intensity = clamp((bg.glow.intensity || 0.1) * 0.6, 0, 0.5);
    if (energy === 'high')    bg.glow.intensity = clamp((bg.glow.intensity || 0.1) * 1.6, 0, 0.5);
    if (energy === 'extreme') bg.glow.intensity = clamp((bg.glow.intensity || 0.1) * 2.2, 0, 0.5);
  }

  // Background dimension → explicit treatment level
  if (background === 'minimal' && bg.glow)    bg.glow.intensity = clamp((bg.glow.intensity || 0.1) * 0.2, 0, 0.5);
  if (background === 'subtle' && bg.glow)     bg.glow.intensity = clamp((bg.glow.intensity || 0.1) * 0.6, 0, 0.5);
  if (background === 'dramatic' && bg.glow)   bg.glow.intensity = clamp((bg.glow.intensity || 0.1) * 1.8, 0, 0.5);
  if (background === 'dramatic')              bg.darken = (bg.darken || 0) + 0.1;
  if (background === 'atmospheric' && bg.glow) bg.glow.intensity = clamp((bg.glow.intensity || 0.1) * 1.4, 0, 0.5);
  if (background === 'textured' && ds.texture) ds.texture.intensity = clamp((ds.texture.intensity || 0) + 0.3, 0, 1);

  // Contrast → darken/lighten
  if (contrast === 'extreme') bg.darken = (bg.darken || 0) + 0.1;
  if (contrast === 'high')    bg.darken = (bg.darken || 0) + 0.05;
  if (contrast === 'low')     bg.lighten = (bg.lighten || 0) + 0.05;
}

// ── Layout / Composition intent ─────────────────────────────────────────
function applyLayoutIntent(ds, intent) {
  const { spacing, hierarchy, focus, mood } = intent;
  const comp = ds.composition;

  // Spacing → negative space + max width
  if (spacing === 'tight')     { comp.negativeSpace = clamp((comp.negativeSpace || 0.2) - 0.15, 0, 0.9); comp.maxWidth = clamp((comp.maxWidth || 0.85) + 0.1, 0.3, 1.0); }
  if (spacing === 'airy')      { comp.negativeSpace = clamp((comp.negativeSpace || 0.2) + 0.2, 0, 0.9);  comp.maxWidth = clamp((comp.maxWidth || 0.85) - 0.15, 0.3, 1.0); }
  if (spacing === 'expansive') { comp.negativeSpace = clamp((comp.negativeSpace || 0.2) + 0.35, 0, 0.9); comp.maxWidth = clamp((comp.maxWidth || 0.85) - 0.25, 0.3, 1.0); }

  // Hierarchy → anchor + element emphasis
  if (hierarchy === 'headline_first' && ds.typography.headline) ds.typography.headline.scale = (ds.typography.headline.scale || 1) * 1.15;
  if (hierarchy === 'balanced' && ds.typography.headline)       ds.typography.headline.scale = (ds.typography.headline.scale || 1) * 0.9;
  if (hierarchy === 'stat_focused' && ds.typography.stat)       ds.typography.stat.scale = (ds.typography.stat.scale || 1) * 1.3;
  if (hierarchy === 'quote_centered')                            comp.anchor = 'center';
  if (hierarchy === 'cta_driven')                                comp.anchor = 'lower-third';
  if (hierarchy === 'image_first')                               comp.anchor = 'top';

  // Focus → boost specific element
  if (focus === 'headline' && ds.typography.headline) ds.typography.headline.scale = (ds.typography.headline.scale || 1) * 1.1;
  if (focus === 'stat' && ds.typography.stat)         ds.typography.stat.scale = (ds.typography.stat.scale || 1) * 1.25;
  if (focus === 'cta' && ds.typography.cta)           ds.typography.cta.scale = (ds.typography.cta.scale || 1) * 1.2;

  // Mood → spacing adjustments
  if (mood === 'premium')   comp.negativeSpace = clamp((comp.negativeSpace || 0.2) + 0.15, 0, 0.9);
  if (mood === 'minimal')   comp.negativeSpace = clamp((comp.negativeSpace || 0.2) + 0.2, 0, 0.9);
  if (mood === 'luxury')    comp.negativeSpace = clamp((comp.negativeSpace || 0.2) + 0.2, 0, 0.9);
  if (mood === 'editorial') comp.maxWidth = clamp((comp.maxWidth || 0.85) - 0.1, 0.3, 1.0);
}

// ── Typography intent ───────────────────────────────────────────────────
function applyTypographyIntent(ds, intent) {
  const { weight, typography_tone, mood, energy } = intent;
  const typo = ds.typography;

  // Weight → adjust all type weights
  if (weight) {
    const targetWeight = WEIGHT_MAP[weight];
    for (const el of Object.values(typo)) {
      if (el && el.weight) el.weight = weight;
    }
  }

  // Typography tone → tracking + scale adjustments
  if (typography_tone === 'refined') {
    for (const el of Object.values(typo)) { if (el) { el.tracking = 'wide'; el.scale = (el.scale || 1) * 0.95; } }
  }
  if (typography_tone === 'confident') {
    if (typo.headline) typo.headline.scale = (typo.headline.scale || 1) * 1.05;
  }
  if (typography_tone === 'editorial') {
    for (const el of Object.values(typo)) { if (el) el.tracking = 'wide'; }
    if (typo.body) typo.body.scale = (typo.body.scale || 1) * 0.9;
  }
  if (typography_tone === 'technical') {
    for (const el of Object.values(typo)) { if (el) el.tracking = 'normal'; }
  }
  if (typography_tone === 'expressive') {
    if (typo.headline) { typo.headline.tracking = 'extra-wide'; typo.headline.scale = (typo.headline.scale || 1) * 1.1; }
  }

  // Mood → typography personality
  if (mood === 'premium' && typo.headline)   typo.headline.scale = (typo.headline.scale || 1) * 0.9;
  if (mood === 'bold' && typo.headline)      typo.headline.scale = (typo.headline.scale || 1) * 1.15;
  if (mood === 'editorial' && typo.headline) typo.headline.tracking = 'wide';

  // Energy → typography impact
  if (energy === 'extreme' && typo.headline) typo.headline.scale = (typo.headline.scale || 1) * 1.1;
  if (energy === 'low' && typo.headline)     typo.headline.scale = (typo.headline.scale || 1) * 0.92;
}

// ── Color intent ────────────────────────────────────────────────────────
function applyColorIntent(ds, intent) {
  const { accent_treatment, contrast, mood } = intent;
  const color = ds.color;

  // Accent treatment → how brand accents are used
  if (accent_treatment === 'restrained') { color.accentOpacity = 0.5; }
  if (accent_treatment === 'vibrant')    { color.accentSaturation = 1.3; }
  if (accent_treatment === 'dominant')   { color.accentDominant = true; }

  // Contrast → text color adjustments
  if (contrast === 'low')     color.textOpacity = 0.7;
  if (contrast === 'extreme') color.textOpacity = 1.0;

  // Mood → color treatment
  if (mood === 'premium')   color.restrained = true;
  if (mood === 'energetic') color.vibrant = true;
  if (mood === 'luxury')    color.restrained = true;
}

// ── Decorative intent ───────────────────────────────────────────────────
function applyDecorativeIntent(ds, intent) {
  const { decoration, mood, energy } = intent;
  let decs = ds.decorative || [];

  // Decoration level → how many decoratives are shown
  if (decoration === 'minimal')   decs = decs.slice(0, 1);
  if (decoration === 'subtle')    decs = decs.slice(0, Math.ceil(decs.length * 0.3));
  if (decoration === 'moderate')  decs = decs.slice(0, Math.ceil(decs.length * 0.6));
  if (decoration === 'heavy')     decs = decs.slice(0, Math.ceil(decs.length * 1.0));
  if (decoration === 'maximal')   decs = decs; // keep all

  // Mood → decoration density
  if (mood === 'premium')  decs = decs.slice(0, Math.ceil(decs.length * 0.5));
  if (mood === 'minimal')  decs = decs.slice(0, 1);
  if (mood === 'luxury')   decs = decs.slice(0, Math.ceil(decs.length * 0.4));
  if (mood === 'documentary') decs = decs.slice(0, Math.ceil(decs.length * 0.5));

  // Energy → decoration density
  if (energy === 'low')     decs = decs.slice(0, Math.ceil(decs.length * 0.3));
  if (energy === 'extreme') decs = decs.slice(0, Math.ceil(decs.length * 1.0));

  ds.decorative = decs;
}

// ── Logo intent ─────────────────────────────────────────────────────────
function applyLogoIntent(ds, intent) {
  const { logo_treatment, mood } = intent;
  const logo = ds.logo;

  if (logo_treatment === 'hidden')    logo.position = 'none';
  if (logo_treatment === 'minimal')   { logo.opacity = 0.35; logo.size = 'xs'; }
  if (logo_treatment === 'prominent') { logo.opacity = 0.8; logo.size = 'md'; }

  if (mood === 'premium')  logo.opacity = clamp((logo.opacity || 0.6) * 0.7, 0, 1);
  if (mood === 'minimal')  logo.opacity = clamp((logo.opacity || 0.6) * 0.5, 0, 1);
  if (mood === 'luxury')   logo.opacity = clamp((logo.opacity || 0.6) * 0.6, 0, 1);
}

// ── CTA intent ──────────────────────────────────────────────────────────
function applyCtaIntent(ds, intent) {
  const { cta_prominence, focus, hierarchy } = intent;

  ds._ctaIntent = {};
  if (cta_prominence === 'subtle')    ds._ctaIntent.prominence = 'low';
  if (cta_prominence === 'prominent') ds._ctaIntent.prominence = 'high';
  if (cta_prominence === 'dominant')  ds._ctaIntent.prominence = 'high';
  if (cta_prominence === 'dominant')  ds._ctaIntent.style = 'pill';
  if (focus === 'cta')                ds._ctaIntent.prominence = 'high';
  if (hierarchy === 'cta_driven')     ds._ctaIntent.prominence = 'high';
}

// ── Emphasis (content-specific) ─────────────────────────────────────────
function applyEmphasisIntent(ds, intent) {
  if (intent.emphasis_word) {
    ds._emphasis = {
      word: intent.emphasis_word,
      treatment: intent.emphasis_treatment || 'bold',
    };
  }
}

// ── Main translator ─────────────────────────────────────────────────────
/**
 * Translate Creative Intent into a modified design system.
 *
 * @param {object} baseDesignSystem — the concept's design system
 * @param {object} intent — creative intent dimensions
 * @param {object} locks — { layout: bool, typography: bool, ... }
 * @returns {object} modified design system (does NOT mutate input)
 */
export function translateIntent(baseDesignSystem, intent, locks = {}) {
  if (!intent || Object.keys(intent).length === 0) return baseDesignSystem;

  const ds = deepClone(baseDesignSystem);

  // Each category handler is gated by its lock
  if (!locks.background)  applyBackgroundIntent(ds, intent);
  if (!locks.layout)      applyLayoutIntent(ds, intent);
  if (!locks.typography)  applyTypographyIntent(ds, intent);
  if (!locks.colors)      applyColorIntent(ds, intent);
  if (!locks.decorative)  applyDecorativeIntent(ds, intent);
  if (!locks.logo)        applyLogoIntent(ds, intent);
  if (!locks.cta)         applyCtaIntent(ds, intent);

  // Emphasis is always allowed (it's content-level, not a design system lock)
  applyEmphasisIntent(ds, intent);

  return ds;
}