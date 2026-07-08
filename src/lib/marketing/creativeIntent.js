/**
 * Creative Intent Model
 * --------------------------------------------------------------------
 * The semantic language the AI Creative Director speaks.
 *
 * Instead of low-level design overrides (typography.scale = 1.25),
 * the AI returns intent: "mood: premium, spacing: airy."
 *
 * The Intent Translator converts these into rendering decisions.
 * The AI never needs to know implementation details.
 *
 * Intent dimensions:
 *   mood             — emotional atmosphere
 *   energy           — visual intensity level
 *   hierarchy        — what leads the composition
 *   spacing          — breathing room between elements
 *   background       — background treatment level
 *   focus            — which element draws the eye
 *   contrast         — light/dark differentiation
 *   accent_treatment — how brand accents are used
 *   decoration       — density of decorative elements
 *   typography_tone  — personality of the type
 *   weight           — overall type weight
 *   cta_prominence   — how prominent the CTA is
 *   logo_treatment   — how the logo is handled
 *
 * Special fields (content-specific, not standard dimensions):
 *   emphasis_word      — a word to visually emphasize
 *   emphasis_treatment — how to emphasize it
 */

// ── Intent dimension definitions ────────────────────────────────────────
export const INTENT_DIMENSIONS = {
  mood: {
    label: 'Mood',
    values: ['premium', 'energetic', 'dark', 'playful', 'editorial', 'cinematic', 'minimal', 'bold', 'luxury', 'documentary', 'atmospheric', 'industrial'],
  },
  energy: {
    label: 'Energy',
    values: ['low', 'medium', 'high', 'extreme'],
  },
  hierarchy: {
    label: 'Hierarchy',
    values: ['headline_first', 'balanced', 'stat_focused', 'quote_centered', 'cta_driven', 'image_first'],
  },
  spacing: {
    label: 'Spacing',
    values: ['tight', 'normal', 'airy', 'expansive'],
  },
  background: {
    label: 'Background',
    values: ['minimal', 'subtle', 'dramatic', 'atmospheric', 'textured'],
  },
  focus: {
    label: 'Focus',
    values: ['headline', 'stat', 'quote', 'image', 'cta', 'badge', 'logo'],
  },
  contrast: {
    label: 'Contrast',
    values: ['low', 'medium', 'high', 'extreme'],
  },
  accent_treatment: {
    label: 'Accent Treatment',
    values: ['restrained', 'balanced', 'vibrant', 'dominant'],
  },
  decoration: {
    label: 'Decoration',
    values: ['minimal', 'subtle', 'moderate', 'heavy', 'maximal'],
  },
  typography_tone: {
    label: 'Typography Tone',
    values: ['refined', 'confident', 'editorial', 'technical', 'expressive'],
  },
  weight: {
    label: 'Weight',
    values: ['light', 'normal', 'bold', 'heavy'],
  },
  cta_prominence: {
    label: 'CTA Prominence',
    values: ['subtle', 'normal', 'prominent', 'dominant'],
  },
  logo_treatment: {
    label: 'Logo Treatment',
    values: ['hidden', 'minimal', 'normal', 'prominent'],
  },
};

// ── Lockable design systems ─────────────────────────────────────────────
export const LOCKABLE_SYSTEMS = {
  layout:      { label: 'Layout',       intentCategories: ['composition'] },
  typography:  { label: 'Typography',   intentCategories: ['typography'] },
  background:  { label: 'Background',   intentCategories: ['background'] },
  colors:      { label: 'Colors',       intentCategories: ['color'] },
  decorative:  { label: 'Decorative',   intentCategories: ['decorative'] },
  imagery:     { label: 'Imagery',      intentCategories: ['imagery'] },
  logo:        { label: 'Logo',         intentCategories: ['logo'] },
  cta:         { label: 'CTA',          intentCategories: ['cta'] },
};

export function defaultLocks() {
  return Object.fromEntries(Object.keys(LOCKABLE_SYSTEMS).map(k => [k, false]));
}

// ── Regeneratable systems ───────────────────────────────────────────────
export const REGENERATABLE_SYSTEMS = {
  background:   { label: 'Background',     intentDims: ['background', 'mood'] },
  typography:   { label: 'Typography',     intentDims: ['typography_tone', 'weight'] },
  decorations:  { label: 'Decorations',    intentDims: ['decoration'] },
  layout:       { label: 'Layout',         intentDims: ['hierarchy', 'spacing'] },
  colors:       { label: 'Color Treatment', intentDims: ['accent_treatment', 'contrast'] },
  hierarchy:    { label: 'Hierarchy',      intentDims: ['hierarchy', 'focus'] },
  cta:          { label: 'CTA',            intentDims: ['cta_prominence'] },
  imagery:      { label: 'Imagery',        intentDims: ['focus'] },
};

// ── Defaults ────────────────────────────────────────────────────────────
export function emptyIntent() {
  return {};
}

export function hasActiveIntent(intent) {
  if (!intent) return false;
  return Object.keys(intent).length > 0;
}

/**
 * Merge intent deltas into an existing intent object.
 * Only overwrites dimensions present in the delta.
 */
export function mergeIntent(existing = {}, delta = {}) {
  return { ...existing, ...delta };
}

/**
 * Diff two intent objects — returns which dimensions changed
 * and their old/new values. Used for before/after comparison.
 */
export function diffIntents(oldIntent = {}, newIntent = {}) {
  const allKeys = [...new Set([...Object.keys(oldIntent), ...Object.keys(newIntent)])];
  const diff = {};
  for (const key of allKeys) {
    const oldVal = oldIntent[key];
    const newVal = newIntent[key];
    if (oldVal !== newVal) {
      diff[key] = { old: oldVal ?? null, new: newVal ?? null };
    }
  }
  return diff;
}