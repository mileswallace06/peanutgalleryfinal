/**
 * Creative Edit — AI-powered conversational design adjustments.
 * --------------------------------------------------------------------
 * REFACTORED: The AI now returns Creative Intent (semantic), NOT
 * low-level design overrides. The Intent Translator converts intent
 * into rendering decisions.
 *
 * Architecture:
 *   User Prompt → AI → Creative Intent → Intent Translator → Renderer
 *
 * The AI thinks like a Creative Director: emotion, story, hierarchy,
 * atmosphere, energy, personality. It never specifies implementation
 * details like pixel sizes or color values.
 *
 * Also provides:
 *   - System regeneration (regenerate just background, typography, etc.)
 *   - Version snapshot management
 */
import { base44 } from '@/api/base44Client';
import { INTENT_DIMENSIONS, REGENERATABLE_SYSTEMS, mergeIntent } from '@/lib/marketing/creativeIntent';

// ── Quick edit presets ──────────────────────────────────────────────────
export const QUICK_EDITS = [
  { label: 'More premium',       instruction: 'Make this feel more premium and luxurious.' },
  { label: 'More energetic',     instruction: 'Make this feel more energetic and electric.' },
  { label: 'More breathing room', instruction: 'Give this more breathing room and negative space.' },
  { label: 'Darker',             instruction: 'Make the overall graphic darker and moodier.' },
  { label: 'More editorial',     instruction: 'Make this feel more editorial and magazine-like.' },
  { label: 'Bold headline',      instruction: 'Make the headline dominate the composition.' },
  { label: 'Minimal background', instruction: 'Make the background more minimal and restrained.' },
  { label: 'More decoration',    instruction: 'Add more decorative energy and visual texture.' },
  { label: 'Less decoration',    instruction: 'Reduce decorative clutter, make it cleaner.' },
  { label: 'Higher contrast',    instruction: 'Increase the visual contrast dramatically.' },
  { label: 'More cinematic',     instruction: 'Give this a more cinematic, film-poster atmosphere.' },
  { label: 'More playful',       instruction: 'Make this feel more playful and fun.' },
];

// ── AI Creative Edit ────────────────────────────────────────────────────
/**
 * Ask the AI to convert a natural-language instruction into Creative Intent.
 *
 * @param {string} instruction — user's natural-language edit request
 * @param {object} context — { concept, executionStyle, currentIntent, lockedSystems }
 * @returns {Promise<{ summary: string, intent: object }>}
 */
export async function applyCreativeEdit(instruction, context = {}) {
  const { concept, executionStyle, currentIntent = {}, lockedSystems = {} } = context;

  const conceptDesc = concept
    ? `Concept: ${concept.name} — mood: ${concept.mood || 'n/a'}`
    : 'Concept: auto-selected';

  const execDesc = executionStyle
    ? `Execution Style: ${executionStyle.name}`
    : 'Execution Style: auto-selected';

  const intentDesc = Object.keys(currentIntent).length > 0
    ? `Current creative intent:\n${JSON.stringify(currentIntent, null, 2)}`
    : 'Current creative intent: none (using concept defaults)';

  const lockedList = Object.entries(lockedSystems).filter(([, v]) => v).map(([k]) => k);
  const lockedDesc = lockedList.length > 0
    ? `LOCKED systems (do NOT modify): ${lockedList.join(', ')}`
    : 'No systems are locked.';

  const dimensionsList = Object.entries(INTENT_DIMENSIONS)
    .map(([key, def]) => `- ${key}: ${def.values.join(' | ')}`)
    .join('\n');

  const prompt = `You are an experienced Creative Director for Peanut Gallery, adjusting an EXISTING marketing graphic.

You think in terms of emotion, story, hierarchy, visual emphasis, atmosphere, pacing, energy, and personality.
You do NOT think in implementation details like pixel sizes, color values, or CSS properties.

The user has a graphic with this art direction:
${conceptDesc}
${execDesc}
${intentDesc}
${lockedDesc}

The user's instruction: "${instruction}"

Convert this instruction into Creative Intent. Creative Intent is a semantic model — you describe the creative direction, not the implementation.

Available intent dimensions and their valid values:
${dimensionsList}

Special fields (optional):
- emphasis_word: a word from the headline to visually emphasize (case-insensitive)
- emphasis_treatment: "fracture" | "gradient" | "highlight" | "underline" | "bold"

RULES:
- Think like a Creative Director, not a graphics engine
- Only return dimensions that the instruction actually affects
- Merge with existing intent — don't lose previous creative directions unless the instruction contradicts them
- Do NOT change the Creative Concept, Creative Strategy, or Execution Style — those are preserved unless the user explicitly requests a different one (note it in summary if they do, but don't change it)
- Do NOT rewrite the user's content
- If the instruction is vague, interpret it as a Creative Director would
- Respect locked systems — do not return dimensions that map to locked categories

After merging your intent changes with the existing intent, write a natural-language description of the OVERALL creative direction as a Creative Director would describe it to a colleague. This is what the user sees — it must feel conversational, not technical. Never mention intent dimension names (mood, energy, hierarchy, etc.). Instead describe the aesthetic, the feel, the focus, the atmosphere.

Example direction_description:
"Premium editorial aesthetic with restrained typography and generous spacing. Primary focus is the headline."

Another example:
"Dark, cinematic atmosphere with dramatic glow and bold, dominant headline. High energy and visual tension."

Return JSON only:
{
  "summary": "One sentence describing the creative change you made",
  "direction_description": "Natural-language description of the overall creative direction after this edit",
  "intent": {
    // only dimensions that changed
  }
}`;

  const response = await base44.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        direction_description: { type: 'string' },
        intent: {
          type: 'object',
          additionalProperties: true,
          description: 'Creative Intent dimensions (mood, energy, hierarchy, spacing, etc.)',
        },
      },
    },
  });

  return {
    summary: response.summary || 'Applied creative edit',
    direction_description: response.direction_description || '',
    intent: response.intent || {},
  };
}

// ── System Regeneration ─────────────────────────────────────────────────
/**
 * Ask the AI to suggest a fresh treatment for a specific design system.
 * Only the intent dimensions for that system are returned — everything
 * else is preserved.
 *
 * @param {string} systemKey — key from REGENERATABLE_SYSTEMS
 * @param {object} context — { content, concept, executionStyle, currentIntent }
 * @returns {Promise<{ summary: string, intent: object }>}
 */
export async function regenerateSystem(systemKey, context = {}) {
  const systemDef = REGENERATABLE_SYSTEMS[systemKey];
  if (!systemDef) throw new Error(`Unknown system: ${systemKey}`);

  const { content = {}, concept, executionStyle, currentIntent = {} } = context;

  const dimsForSystem = systemDef.intentDims
    .map(d => `- ${d}: ${INTENT_DIMENSIONS[d]?.values.join(' | ') || 'string'}`)
    .join('\n');

  const prompt = `You are a Creative Director for Peanut Gallery. Regenerate the ${systemDef.label} for this marketing graphic.

Content:
- Headline: "${content.headline || 'n/a'}"
- Subheadline: "${content.subheadline || 'n/a'}"
- Body: "${content.body || 'n/a'}"
- CTA: "${content.cta || 'n/a'}"

Concept: ${concept?.name || 'auto-selected'}
Execution Style: ${executionStyle?.name || 'auto-selected'}
Current intent: ${JSON.stringify(currentIntent)}

Suggest a fresh ${systemDef.label} treatment that works with the content and concept. Only return the intent dimensions relevant to ${systemDef.label}:

${dimsForSystem}

Also write a natural-language description of the OVERALL creative direction after this regeneration, as a Creative Director would describe it. Never mention intent dimension names.

Return JSON only:
{
  "summary": "One sentence describing the new ${systemDef.label} direction",
  "direction_description": "Natural-language description of the overall creative direction",
  "intent": {
    // only dimensions for this system
  }
}`;

  const response = await base44.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        direction_description: { type: 'string' },
        intent: {
          type: 'object',
          additionalProperties: true,
        },
      },
    },
  });

  return {
    summary: response.summary || `Regenerated ${systemDef.label}`,
    direction_description: response.direction_description || '',
    intent: response.intent || {},
  };
}

// ── Direction Description ───────────────────────────────────────────────
/**
 * Generate a natural-language description of the current creative
 * direction from the intent state, WITHOUT an AI call.
 *
 * Used on initial load or when no AI description is available yet.
 * Falls back to a generic description if intent is empty.
 *
 * This is the ONLY part of the intent model the user ever sees,
 * and it's always in plain English.
 */
export function describeDirection(intent = {}, conceptName = '') {
  const parts = [];

  // Mood
  if (intent.mood) parts.push(intent.mood);

  // Energy → intensity descriptor
  if (intent.energy === 'low') parts.push('restrained');
  if (intent.energy === 'high') parts.push('high-energy');
  if (intent.energy === 'extreme') parts.push('electric');

  // Spacing → atmosphere descriptor
  if (intent.spacing === 'airy') parts.push('with generous breathing room');
  if (intent.spacing === 'expansive') parts.push('with expansive whitespace');
  if (intent.spacing === 'tight') parts.push('dense and compact');

  // Background
  if (intent.background === 'minimal') parts.push('clean background');
  if (intent.background === 'dramatic') parts.push('dramatic background');
  if (intent.background === 'atmospheric') parts.push('atmospheric background');

  // Focus
  if (intent.focus === 'headline') parts.push('headline-led composition');
  if (intent.focus === 'stat') parts.push('statistic-focused');
  if (intent.focus === 'cta') parts.push('CTA-driven');

  // Typography
  if (intent.typography_tone === 'editorial') parts.push('editorial typography');
  if (intent.typography_tone === 'expressive') parts.push('expressive type');

  // CTA
  if (intent.cta_prominence === 'dominant') parts.push('prominent call to action');
  if (intent.cta_prominence === 'subtle') parts.push('subtle CTA');

  if (parts.length === 0) {
    return conceptName
      ? `Using the ${conceptName} concept with default treatment.`
      : 'Default creative direction — describe a change to get started.';
  }

  // Join naturally
  let desc = parts.join(', ');
  // Capitalize first letter
  desc = desc.charAt(0).toUpperCase() + desc.slice(1);
  if (!desc.endsWith('.')) desc += '.';
  return desc;
}

// ── Version Management ──────────────────────────────────────────────────
/**
 * Create a version snapshot of the current creative state.
 */
export function createVersionSnapshot(instruction, summary, state, directionDescription = '', explanation = '') {
  return {
    id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    instruction,
    summary,
    explanation,
    direction_description: directionDescription,
    name: null,
    is_favorite: false,
    snapshot: {
      creative_intent: { ...state.creative_intent },
      creative_locks: { ...state.creative_locks },
      concept_id: state.concept_id,
      execution_style_id: state.execution_style_id,
      strategy_id: state.strategy_id,
    },
  };
}

/**
 * Restore state from a version snapshot.
 */
export function restoreFromSnapshot(version) {
  if (!version?.snapshot) return null;
  const s = version.snapshot;
  return {
    creative_intent: { ...s.creative_intent },
    creative_locks: { ...s.creative_locks },
    concept_id: s.concept_id,
    execution_style_id: s.execution_style_id,
    strategy_id: s.strategy_id,
  };
}