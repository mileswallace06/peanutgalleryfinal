/**
 * Creative Conversation — The AI Creative Director
 * --------------------------------------------------------------------
 * The AI that acts as an elite Creative Director sitting beside you.
 *
 * Capabilities:
 *   1. Element-aware editing — knows which element you clicked,
 *      edits only that element's dimensions
 *   2. Global direction — understands aesthetic references (Apple
 *      keynote, A24 poster, Vogue editorial, etc.) and translates
 *      them into creative intent
 *   3. Proactive observations — reviews the composition like a senior
 *      designer and shares genuinely valuable insights
 *   4. Change explanations — explains what it changed and why, in
 *      natural conversational language
 *
 * The AI never exposes intent dimension names, pixel values, or
 * implementation details. It thinks in aesthetics, emotion, and
 * visual communication.
 */
import { base44 } from '@/api/base44Client';
import { INTENT_DIMENSIONS } from '@/lib/marketing/creativeIntent';
import { ELEMENTS, getElementDescription } from '@/lib/marketing/elementRegistry';
import { buildElementAIContext } from '@/lib/marketing/elementBrain';

// ── Shared reference vocabulary ─────────────────────────────────────────
const REFERENCE_CONTEXT = `
You understand aesthetic references and cultural design vocabulary. When a user mentions a reference, you understand its visual language and translate it into creative intent — you never copy literally.

Reference vocabulary you know:
- "Apple keynote" → minimalist, premium, generous whitespace, restrained typography, high contrast, confident
- "Nike campaign" → bold, energetic, high-contrast, heroic, confident typography, visceral
- "A24 poster" → atmospheric, cinematic, muted tones, editorial composition, film-poster mood
- "Spotify Wrapped" → vibrant, maximal, playful, gradient-heavy, data-forward, energetic
- "Supreme drop" → bold, raw, stark, high-contrast, utilitarian, unapologetic
- "Interstellar" → cinematic, atmospheric, vast, scientific, awe-inspiring, deep space
- "Cyberpunk" → neon, gritty, high-energy, futuristic, maximal decoration, saturated
- "Boiler Room" → dark, underground, raw, energetic, immersive, understated
- "Rave flyer" → maximal, psychedelic, vibrant, high-energy, decorative, irreverent
- "Vogue editorial" → refined, elegant, editorial typography, restrained, luxurious, sophisticated
- "Swiss design" → grid-based, precise, minimal, objective, clean, mathematical
- "Memphis design" → playful, maximal, geometric, bold colors, irreverent, pattern-heavy

If the user mentions any other cultural or design reference, apply the same principle: understand the aesthetic vocabulary and translate it into creative intent dimensions.`;

// ── Element-aware editing ───────────────────────────────────────────────
/**
 * Edit a specific element. The AI knows which element was clicked
 * and only modifies that element's dimensions.
 */
export async function editElement(elementId, instruction, context = {}) {
  const element = ELEMENTS[elementId];
  if (!element) throw new Error(`Unknown element: ${elementId}`);

  const {
    concept, executionStyle, currentIntent = {},
    lockedSystems = {}, content = {}, directionDescription = '',
    elementBrainContext,
  } = context;

  const isLocked = lockedSystems[element.lockCategory];
  if (isLocked) {
    return {
      summary: `${element.label} is locked — unlock it to edit`,
      explanation: `The ${element.label.toLowerCase()} is currently protected from changes. Unlock it in the advanced settings to edit it.`,
      direction_description: directionDescription,
      intent: {},
      agrees: false,
      confidence: 'low',
      critique: { reason: `${element.label} is locked`, suggestion: null },
    };
  }

  const brainContext = elementBrainContext || buildElementAIContext(elementId, currentIntent, content);

  const dimsList = element.intentDims
    .map(d => `- ${d}: ${INTENT_DIMENSIONS[d]?.values.join(' | ') || 'string'}`)
    .join('\n');

  const contentSummary = buildContentSummary(content);
  const conceptDesc = concept ? `${concept.name} — mood: ${concept.mood || 'n/a'}` : 'auto-selected';
  const execDesc = executionStyle ? executionStyle.name : 'auto-selected';

  const prompt = `You are an elite Creative Director working in Peanut Gallery's Marketing Studio. You are sitting beside the user, looking at their marketing graphic together.

The user has selected an element on the canvas. Here is what they selected:

${brainContext}

Element identity: ${element.description}

Current creative context:
- Concept: ${conceptDesc}
- Execution Style: ${execDesc}
- Overall direction: ${directionDescription || 'default treatment'}
- Content: ${contentSummary}
- Current creative intent: ${JSON.stringify(currentIntent)}

${REFERENCE_CONTEXT}

The user's instruction about the ${element.label}: "${instruction}"

IMPORTANT: Only modify the ${element.label}. Do not change other elements. The ${element.label} is controlled by these creative dimensions:
${dimsList}

Return ONLY the dimensions that should change based on the instruction. Merge with existing intent for this element — don't lose previous directions unless the instruction contradicts them.

CRITICAL — Evaluate this change like a senior Creative Director:
- Will this actually improve the design?
- Could it create unintended problems (hierarchy competition, readability loss, overwhelming the composition)?
- Is there a better alternative that would achieve the user's goal more effectively?

If you disagree with the change (it won't improve the design or could cause problems):
- Set "agrees" to false
- Provide "critique" with your reasoning and a better suggestion
- Still provide the intent changes (the user asked for it), but flag your concern

If you agree:
- Set "agrees" to true
- Set "critique" to null

Always communicate your confidence level:
- "high": Very confident this will noticeably improve the design
- "medium": Think it will help, but some uncertainty
- "low": There are trade-offs and you are not sure

After determining your changes, write:
1. "agrees" — true or false
2. "confidence" — "high", "medium", or "low"
3. "summary" — one short sentence describing the change
4. "explanation" — 1-2 sentences explaining what you changed and WHY, as if talking to a colleague. Be specific and conversational. Never mention intent dimension names.
5. "critique" — null if you agree, or { "reason": "why you disagree", "suggestion": "what you'd recommend instead" }
6. "direction_description" — a natural-language description of the OVERALL creative direction after this change
7. "intent" — only the dimensions that changed

Return JSON only:
{
  "agrees": true,
  "confidence": "high",
  "summary": "One sentence",
  "explanation": "1-2 sentences explaining what and why, conversational",
  "critique": null,
  "direction_description": "Overall direction after this change",
  "intent": {}
}`;

  const response = await base44.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        agrees: { type: 'boolean' },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        summary: { type: 'string' },
        explanation: { type: 'string' },
        critique: {
          type: ['object', 'null'],
          properties: {
            reason: { type: 'string' },
            suggestion: { type: 'string' },
          },
        },
        direction_description: { type: 'string' },
        intent: { type: 'object', additionalProperties: true },
      },
    },
  });

  return {
    type: 'edit',
    agrees: response.agrees !== false,
    confidence: response.confidence || 'medium',
    summary: response.summary || `Adjusted the ${element.label}`,
    explanation: response.explanation || response.summary || '',
    critique: response.critique || null,
    direction_description: response.direction_description || '',
    intent: response.intent || {},
  };
}

// ── Explain element — the element explains itself ──────────────────────
/**
 * The user clicked "Explain" on an element. The AI gives a concise,
 * insightful read on the element's role, current state, and recommendations.
 * This is what makes every object "alive" — it can explain itself.
 */
export async function explainElement(elementId, context = {}) {
  const {
    concept, executionStyle, currentIntent = {},
    content = {}, elementBrainContext,
  } = context;

  const brainContext = elementBrainContext || buildElementAIContext(elementId, currentIntent, content);
  const contentSummary = buildContentSummary(content);
  const conceptDesc = concept ? `${concept.name} — mood: ${concept.mood || 'n/a'}` : 'auto-selected';

  const prompt = `You are an elite Creative Director. The user clicked "Explain" on an element in their marketing graphic. Give them a concise, insightful read on what this element is doing in the composition right now.

${brainContext}

Current creative context:
- Concept: ${conceptDesc}
- Content: ${contentSummary}
- Current creative intent: ${JSON.stringify(currentIntent)}

Give a concise, insightful read on:
1. What this element is doing right now in the composition
2. How well it's performing its role
3. One specific, actionable recommendation (if any) — or confirm it's working well

Be conversational, like a senior designer giving a quick read. Never mention intent dimension names or technical terms. Be honest — if something isn't working, say so.

Return JSON:
{
  "explanation": "2-3 sentences, conversational and insightful",
  "confidence": "high" | "medium" | "low"
}`;

  const response = await base44.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        explanation: { type: 'string' },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      },
    },
  });

  return {
    type: 'explain',
    explanation: response.explanation || '',
    confidence: response.confidence || 'medium',
  };
}

// ── Global creative direction ───────────────────────────────────────────
/**
 * Apply a global creative direction. Understands references.
 * Replaces applyCreativeEdit with richer context and explanations.
 */
export async function globalDirect(instruction, context = {}) {
  const {
    concept, executionStyle, currentIntent = {},
    lockedSystems = {}, content = {}, directionDescription = '',
  } = context;

  const contentSummary = buildContentSummary(content);
  const conceptDesc = concept ? `${concept.name} — mood: ${concept.mood || 'n/a'}` : 'auto-selected';
  const execDesc = executionStyle ? executionStyle.name : 'auto-selected';

  const lockedList = Object.entries(lockedSystems).filter(([, v]) => v).map(([k]) => k);
  const lockedDesc = lockedList.length > 0
    ? `LOCKED (do NOT modify): ${lockedList.join(', ')}`
    : 'No systems are locked.';

  const dimensionsList = Object.entries(INTENT_DIMENSIONS)
    .map(([key, def]) => `- ${key}: ${def.values.join(' | ')}`)
    .join('\n');

  const prompt = `You are an elite Creative Director working in Peanut Gallery's Marketing Studio. You are sitting beside the user, looking at their marketing graphic together.

Current creative context:
- Concept: ${conceptDesc}
- Execution Style: ${execDesc}
- Overall direction: ${directionDescription || 'default treatment'}
- Content: ${contentSummary}
- Current creative intent: ${JSON.stringify(currentIntent)}
- ${lockedDesc}

${REFERENCE_CONTEXT}

The user's instruction: "${instruction}"

Convert this instruction into creative intent. Think like a Creative Director — emotion, story, hierarchy, atmosphere, energy, personality. Never think in implementation details.

Only return dimensions that the instruction actually affects. Merge with existing intent — don't lose previous directions unless contradicted.

CRITICAL — Evaluate this change like a senior Creative Director:
- Will this actually improve the design?
- Could it create unintended problems?
- Is there a better alternative?

If you disagree, set "agrees" to false and provide "critique" with reasoning and a better suggestion.
If you agree, set "agrees" to true and "critique" to null.

Communicate your confidence:
- "high": Very confident this will noticeably improve the design
- "medium": Think it will help, but some uncertainty
- "low": There are trade-offs and you are not sure

After determining your changes, write:
1. "agrees" — true or false
2. "confidence" — "high", "medium", or "low"
3. "summary" — one short sentence
4. "explanation" — 1-2 sentences explaining what you changed and WHY, as if talking to a colleague. Be specific and conversational. Never mention intent dimension names.
5. "critique" — null or { "reason": "...", "suggestion": "..." }
6. "direction_description" — overall creative direction after this change
7. "intent" — only changed dimensions

Return JSON only:
{
  "agrees": true,
  "confidence": "high",
  "summary": "One sentence",
  "explanation": "1-2 sentences explaining what and why, conversational",
  "critique": null,
  "direction_description": "Overall direction after this change",
  "intent": {}
}`;

  const response = await base44.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        agrees: { type: 'boolean' },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        summary: { type: 'string' },
        explanation: { type: 'string' },
        critique: {
          type: ['object', 'null'],
          properties: {
            reason: { type: 'string' },
            suggestion: { type: 'string' },
          },
        },
        direction_description: { type: 'string' },
        intent: { type: 'object', additionalProperties: true },
      },
    },
  });

  return {
    type: 'edit',
    agrees: response.agrees !== false,
    confidence: response.confidence || 'medium',
    summary: response.summary || 'Applied creative direction',
    explanation: response.explanation || response.summary || '',
    critique: response.critique || null,
    direction_description: response.direction_description || '',
    intent: response.intent || {},
  };
}

// ── Proactive observations ──────────────────────────────────────────────
/**
 * The AI reviews the composition like a senior designer and shares
 * 0-2 genuinely valuable observations. Not constantly — only when
 * there's something worth saying.
 */
export async function observeComposition(context = {}) {
  const {
    concept, executionStyle, currentIntent = {},
    content = {}, directionDescription = '',
  } = context;

  const contentSummary = buildContentSummary(content);
  const conceptDesc = concept ? `${concept.name} — mood: ${concept.mood || 'n/a'}` : 'auto-selected';
  const execDesc = executionStyle ? executionStyle.name : 'auto-selected';

  const prompt = `You are an elite Creative Director reviewing a marketing graphic for Peanut Gallery.

Current creative context:
- Concept: ${conceptDesc}
- Execution Style: ${execDesc}
- Overall direction: ${directionDescription || 'default treatment'}
- Content: ${contentSummary}
- Current creative intent: ${JSON.stringify(currentIntent)}

Review this composition as a senior designer would. Look for:
- Hierarchy issues (elements competing for attention)
- The CTA getting lost or feeling disconnected
- Tone mismatches (e.g. "feels more like a landing page than an Instagram post")
- Missing visual tension or drama
- The headline and statistic competing
- Too much or too little decoration
- Opportunities to strengthen the communication

Share 0-2 observations. Only share something if it's genuinely valuable — don't invent problems. If the composition is working well, you can say so briefly.

Each observation must be:
- Conversational, as if talking to a colleague
- Specific to what's in the graphic
- Actionable (the user knows what to do)
- Never mention intent dimension names or technical terms

Return JSON:
{
  "observations": [
    { "text": "The observation in conversational language", "severity": "suggestion" | "insight" | "praise" }
  ]
}

If there's nothing worth saying, return an empty observations array.`;

  const response = await base44.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        observations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              severity: { type: 'string', enum: ['suggestion', 'insight', 'praise'] },
            },
          },
        },
      },
    },
  });

  return (response.observations || []).map((obs, i) => ({
    id: `obs_${Date.now()}_${i}`,
    text: obs.text,
    severity: obs.severity || 'suggestion',
    timestamp: new Date().toISOString(),
  }));
}

// ── Helpers ─────────────────────────────────────────────────────────────
function buildContentSummary(content = {}) {
  const parts = [];
  if (content.badge) parts.push(`Badge: "${content.badge}"`);
  if (content.headline) parts.push(`Headline: "${content.headline}"`);
  if (content.subheadline) parts.push(`Subheadline: "${content.subheadline}"`);
  if (content.body) parts.push(`Body: "${content.body}"`);
  if (content.cta) parts.push(`CTA: "${content.cta}"`);
  if (content.stat_number) parts.push(`Stat: ${content.stat_number} — ${content.stat_label || ''}`);
  if (content.quote_text) parts.push(`Quote: "${content.quote_text}" — ${content.author || ''}`);
  if (content.signature) parts.push(`Signature: ${content.signature}`);
  return parts.length > 0 ? parts.join('\n') : 'No content set yet.';
}

// ── Quick suggestions ───────────────────────────────────────────────────
export const GLOBAL_SUGGESTIONS = [
  { label: '🍎 Apple keynote', instruction: 'Make this feel like an Apple keynote — minimal, premium, generous whitespace, restrained typography.' },
  { label: '🎬 A24 poster', instruction: 'Give this an A24 film poster atmosphere — cinematic, muted, editorial, atmospheric.' },
  { label: '📰 Vogue editorial', instruction: 'Make this feel like a Vogue editorial — refined, elegant, editorial typography, restrained.' },
  { label: '⚡ More energetic', instruction: 'Make this feel more energetic and electric.' },
  { label: '💎 More premium', instruction: 'Make this feel more premium and luxurious.' },
  { label: '🌙 Darker', instruction: 'Make the overall graphic darker and moodier.' },
  { label: '🌬️ More breathing room', instruction: 'Give this more breathing room and negative space.' },
  { label: '🎬 More cinematic', instruction: 'Give this a more cinematic, film-poster atmosphere.' },
];

export const ELEMENT_SUGGESTIONS = {
  headline: [
    { label: 'Bigger', instruction: 'Make the headline larger and more dominant.' },
    { label: 'Smaller', instruction: 'Shrink the headline to give it less dominance.' },
    { label: 'More breathing room', instruction: 'Give the headline more breathing room around it.' },
    { label: 'Bolder', instruction: 'Make the headline weight heavier and bolder.' },
  ],
  subheadline: [
    { label: 'More prominent', instruction: 'Make the subheadline more prominent and readable.' },
    { label: 'Subtler', instruction: 'Make the subheadline more subtle and restrained.' },
  ],
  body: [
    { label: 'More readable', instruction: 'Make the body text more readable and prominent.' },
    { label: 'Subtler', instruction: 'Make the body text more subtle and recessed.' },
  ],
  background: [
    { label: 'Darker', instruction: 'Make the background darker and moodier.' },
    { label: 'More premium', instruction: 'Make the background feel more premium and restrained.' },
    { label: 'More atmospheric', instruction: 'Make the background more atmospheric with deeper glow.' },
    { label: 'Minimal', instruction: 'Make the background more minimal and clean.' },
  ],
  logo: [
    { label: 'Smaller', instruction: 'Make the logo smaller and more subtle.' },
    { label: 'Hidden', instruction: 'Hide the logo entirely.' },
    { label: 'Tuck in corner', instruction: 'Tuck the logo into the corner more discreetly.' },
    { label: 'More prominent', instruction: 'Make the logo more prominent and visible.' },
  ],
  cta: [
    { label: 'More prominent', instruction: 'Make the CTA more prominent and attention-grabbing.' },
    { label: 'Subtler', instruction: 'Make the CTA more subtle and restrained.' },
    { label: 'Bolder', instruction: 'Make the CTA feel bolder and more urgent.' },
  ],
  badge: [
    { label: 'More prominent', instruction: 'Make the badge more prominent and visible.' },
    { label: 'Subtler', instruction: 'Make the badge more subtle and restrained.' },
  ],
  stat: [
    { label: 'More prominent', instruction: 'Make the statistic more prominent in the composition.' },
    { label: 'Less dominant', instruction: 'Make the statistic less dominant, supporting the headline.' },
  ],
  quote: [
    { label: 'More prominent', instruction: 'Make the quote the center of attention.' },
    { label: 'More editorial', instruction: 'Give the quote a more editorial, magazine-like treatment.' },
  ],
  signature: [
    { label: 'More prominent', instruction: 'Make the signature more visible.' },
    { label: 'Subtler', instruction: 'Make the signature more subtle and recessed.' },
  ],
  decorations: [
    { label: 'Less', instruction: 'Reduce the decorative clutter, make it cleaner.' },
    { label: 'More', instruction: 'Add more decorative energy and visual texture.' },
    { label: 'Use circles', instruction: 'Use circles instead of lines for the decorations.' },
    { label: 'More subtle', instruction: 'Make the decorations more subtle and understated.' },
  ],
};