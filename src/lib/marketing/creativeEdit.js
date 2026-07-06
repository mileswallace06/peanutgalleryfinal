/**
 * Creative Edit — AI-powered conversational design adjustments.
 * --------------------------------------------------------------------
 * Converts a natural-language design instruction into structured
 * designOverrides that the Creative Direction Engine merges into
 * the base concept before rendering.
 *
 * Does NOT regenerate the concept, strategy, or execution style.
 * Does NOT rewrite user content.
 * Only returns override fields the instruction actually affects.
 */
import { base44 } from '@/api/base44Client';

// ── Override factory ────────────────────────────────────────────────────
export function emptyOverrides() {
  return {
    typography: {},
    composition: {},
    color: {},
    background: {},
    decorative: {},
    logo: {},
    emphasis: {},
    cta: {},
    custom_notes: [],
  };
}

// ── Deep merge utilities ────────────────────────────────────────────────
function mergeDeep(target, source) {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = mergeDeep(result[key] || {}, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function mergeDecorative(existing, updates) {
  let add = [...(existing.add || [])];
  let remove = [...(existing.remove || [])];

  if (updates.add) add = [...new Set([...add, ...updates.add])];
  if (updates.remove) remove = [...new Set([...remove, ...updates.remove])];

  // Anything in `remove` is pulled from `add`
  add = add.filter(id => !remove.includes(id));

  return {
    ...existing,
    ...updates,
    add,
    remove,
  };
}

/**
 * Merge a new set of overrides into an existing overrides object.
 * Returns a new object — does not mutate either input.
 */
export function mergeOverrides(existing = {}, newOverrides = {}) {
  const e = { ...emptyOverrides(), ...existing };
  const n = { ...emptyOverrides(), ...newOverrides };

  return {
    typography:  mergeDeep(e.typography, n.typography),
    composition: { ...e.composition, ...n.composition },
    color:       { ...e.color, ...n.color },
    background:  mergeDeep(e.background, n.background),
    decorative:  mergeDecorative(e.decorative, n.decorative),
    logo:        { ...e.logo, ...n.logo },
    emphasis:    { ...e.emphasis, ...n.emphasis },
    cta:         { ...e.cta, ...n.cta },
    custom_notes: [...e.custom_notes, ...n.custom_notes],
  };
}

/**
 * Check if an overrides object has any active (non-empty) values.
 */
export function hasActiveOverrides(overrides) {
  if (!overrides) return false;
  return Object.entries(overrides).some(([key, value]) => {
    if (key === 'custom_notes') return value && value.length > 0;
    return value && typeof value === 'object' && Object.keys(value).length > 0;
  });
}

// ── Quick edit presets ──────────────────────────────────────────────────
export const QUICK_EDITS = [
  { label: 'Bigger headline',     instruction: 'Make the headline significantly bigger.' },
  { label: 'More negative space', instruction: 'Increase the negative space around the content.' },
  { label: 'Darker',              instruction: 'Make the overall graphic darker and moodier.' },
  { label: 'More premium',        instruction: 'Make this feel more premium and luxurious with lighter type and more whitespace.' },
  { label: 'More rave',           instruction: 'Make this feel more rave, electric, and energetic with stronger glow and bolder colors.' },
  { label: 'More editorial',      instruction: 'Make this feel more editorial and magazine-like with a structured, refined layout.' },
  { label: 'Smaller logo',        instruction: 'Make the logo smaller and less prominent.' },
  { label: 'Stronger background', instruction: 'Make the background glow stronger and more dramatic.' },
  { label: 'Softer background',   instruction: 'Soften the background, reduce glow intensity.' },
  { label: 'More depth',          instruction: 'Add more visual depth with stronger vignette and shadows.' },
  { label: 'Less text-heavy',     instruction: 'Reduce text density, make it feel less text-heavy and more spacious.' },
  { label: 'Move text lower',     instruction: 'Move the content lower on the canvas.' },
];

// ── Available decorative IDs (for AI reference) ─────────────────────────
const DECORATIVE_IDS = [
  'crack_lines', 'shard_fragments', 'dust_particles',
  'seat_dot_grid', 'stage_shape', 'highlighted_zone', 'compass',
  'grid_lines', 'column_rules', 'measurement_marks', 'dimension_lines',
  'thin_border', 'gold_border', 'border_frame', 'card_frame', 'scoreboard_frame',
  'perforation', 'lanyard_strip', 'holographic_strip', 'wristband_band', 'repeating_pattern',
  'spotlight_cone', 'light_beams', 'color_washes', 'haze_particles', 'stage_floor',
  'speed_lines', 'carbon_fiber', 'single_light_glow',
  'starburst', 'arrows', 'glow_accents', 'sign_frame', 'spray_accent', 'tape_strip',
  'barcode', 'serial_number', 'timestamp', 'official_stamp',
  'credits_block', 'info_pile', 'masthead', 'cover_lines', 'ticker_bar', 'breaking_banner',
  'stat_bars', 'color_blocks', 'chevron_accents', 'brand_wordmark', 'feature_bullets',
];

// ── AI Creative Edit ────────────────────────────────────────────────────
/**
 * Ask the AI to convert a natural-language instruction into structured
 * design overrides.
 *
 * @param {string} instruction — user's natural-language edit request
 * @param {object} currentDesignState — { concept, executionStyle, currentOverrides }
 * @returns {Promise<{ summary: string, overrides: object }>}
 */
export async function applyCreativeEdit(instruction, currentDesignState = {}) {
  const { concept, executionStyle, currentOverrides } = currentDesignState;

  const conceptDesc = concept
    ? `Concept: ${concept.name} — mood: ${concept.mood || 'n/a'}, visual language: ${concept.visualLanguage || 'n/a'}`
    : 'Concept: auto-selected';

  const execDesc = executionStyle
    ? `Execution Style: ${executionStyle.name}`
    : 'Execution Style: auto-selected';

  const overridesDesc = currentOverrides && Object.keys(currentOverrides).length > 0
    ? `Current overrides already applied:\n${JSON.stringify(currentOverrides, null, 2)}`
    : 'Current overrides: none';

  const prompt = `You are a Creative Director for Peanut Gallery, adjusting an EXISTING marketing graphic design.

The user has a graphic with this art direction:
${conceptDesc}
${execDesc}
${overridesDesc}

The user's instruction: "${instruction}"

Convert this instruction into structured design overrides. Only change what the user asked for — do NOT rewrite the entire design.

Available override categories and their valid values:

═══ TYPOGRAPHY ═══
Keys are element names: "headline", "subheadline", "body", "cta", "badge", "stat"
Each can have: scale (number, e.g. 1.25 = 25% bigger), weight ("light"|"normal"|"bold"|"heavy"), tracking ("normal"|"wide"|"extra-wide"), transform ("none"|"uppercase")

═══ COMPOSITION ═══
anchor ("top"|"center"|"bottom"|"lower-third"), alignment ("left"|"center"|"right"), negativeSpace (0.0-0.9, higher=more empty space), maxWidth (0.3-1.0), verticalOffset (-0.3 to 0.3, positive=lower), rotation (degrees)

═══ COLOR ═══
accent (color name: "purple"|"pink"|"green"|"cyan"|"yellow"|"orange" or hex), text ("white"|"dark"|"accent")

═══ BACKGROUND ═══
glow: { color (name or hex), intensity (0.0-0.5), x (0-100), y (0-100) }, darken (0.0-0.8, adds black overlay), lighten (0.0-0.5)

═══ DECORATIVE ═══
add (array of IDs from: ${DECORATIVE_IDS.join(', ')}), remove (array of IDs), intensity (0.0-1.0)

═══ LOGO ═══
size ("xs"|"sm"|"md"), position ("top-left"|"top-center"|"top-right"|"bottom-left"|"bottom-center"|"bottom-right"|"none"), opacity (0.0-1.0)

═══ EMPHASIS ═══
word (the word to emphasize, case-insensitive match), treatment ("fracture"|"gradient"|"highlight"|"underline"|"bold")

═══ CTA ═══
prominence ("high"|"normal"|"low"), visibility ("visible"|"hidden"), style ("pill"|"flat"|"outline")

SAFETY RULES:
- Do NOT change the concept, strategy, or execution style
- Do NOT rewrite the user's content
- Brand colors: purple #BF5FFF, pink #FF2D78, green #00FF87, cyan #00C8FF, yellow #FFE600, orange #FF8C00
- Only return override fields that the user's instruction actually affects
- If the instruction is vague, interpret it as a Creative Director would
- Merge with existing overrides — don't lose previous edits

Return JSON only:
{
  "summary": "One sentence describing what you changed",
  "overrides": {
    // only include categories that changed
  }
}`;

  const response = await base44.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        overrides: {
          type: 'object',
          properties: {
            typography:  { type: 'object', additionalProperties: true },
            composition: { type: 'object', additionalProperties: true },
            color:       { type: 'object', additionalProperties: true },
            background:  { type: 'object', additionalProperties: true },
            decorative:  { type: 'object', additionalProperties: true },
            logo:        { type: 'object', additionalProperties: true },
            emphasis:    { type: 'object', additionalProperties: true },
            cta:         { type: 'object', additionalProperties: true },
            custom_notes: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  });

  return {
    summary: response.summary || 'Applied edit',
    overrides: response.overrides || {},
  };
}