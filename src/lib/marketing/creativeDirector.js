/**
 * AI Creative Director
 * --------------------------------------------------------------------
 * Makes THREE INDEPENDENT decisions about a piece of content:
 *
 *   1. CREATIVE STRATEGY — What is this post trying to accomplish?
 *   2. CREATIVE CONCEPT  — What visual metaphor communicates that?
 *   3. EXECUTION STYLE   — How should the concept be executed?
 *
 * Each decision is made independently. The strategy does not force
 * a specific concept. The concept does not force an execution style.
 * They combine to create a unique art direction.
 *
 * The AI thinks like a Creative Director:
 *   "What story am I telling? What emotion should this create?
 *    What should the viewer notice first? What visual metaphor
 *    communicates that? Which execution style best delivers it?"
 *
 * Placement of text is the final step, not the first.
 *
 * Falls back to heuristic matching if LLM is unavailable.
 */
import { base44 } from '@/api/base44Client';
import { CREATIVE_STRATEGIES } from './creativeStrategies';
import { CREATIVE_CONCEPTS } from './creativeConcepts';
import { EXECUTION_STYLES } from './executionStyles';

// ── Content summarizer ──────────────────────────────────────────────────
function summarizeContent(content = {}) {
  const parts = [];
  if (content.badge) parts.push(`Badge: "${content.badge}"`);
  if (content.headline) parts.push(`Headline: "${content.headline}"`);
  if (content.subheadline) parts.push(`Subheadline: "${content.subheadline}"`);
  if (content.body) parts.push(`Body: "${content.body}"`);
  if (content.cta) parts.push(`CTA: "${content.cta}"`);
  if (content.stat_number) parts.push(`Stat: ${content.stat_number} ${content.stat_label || ''}`);
  if (content.quote_text) parts.push(`Quote: "${content.quote_text}" — ${content.author || ''}`);
  if (content.image_url) parts.push(`Has image: yes`);
  return parts.join('\n');
}

// ── Compact catalogs for the LLM prompt ─────────────────────────────────
function strategyCatalog() {
  return CREATIVE_STRATEGIES.map(s => ({
    id: s.id, name: s.name, description: s.description,
    signals: s.signals, suitableEmotions: s.suitableEmotions,
  }));
}

function conceptCatalog() {
  return CREATIVE_CONCEPTS.map(c => ({
    id: c.id, name: c.name, family: c.family,
    inspiration: c.inspiration, references: c.references,
    mood: c.mood, visualLanguage: c.visualLanguage,
    visualMetaphor: c.visualMetaphor, focalPoints: c.focalPoints,
  }));
}

function executionCatalog() {
  return EXECUTION_STYLES.map(s => ({
    id: s.id, name: s.name, description: s.description,
  }));
}

// ═════════════════════════════════════════════════════════════════════════
// PRIMARY: AI Creative Director (three independent LLM decisions)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Ask the AI Creative Director to make all three decisions.
 * Returns: { strategy, concept, executionStyle, reasoning }
 *
 * The LLM is asked to think like a Creative Director — analyzing
 * the story, emotion, and visual metaphor BEFORE choosing visuals.
 */
export async function directCreative(content, graphicType) {
  const contentSummary = summarizeContent(content);
  if (!contentSummary) {
    return heuristicDirect(content, graphicType);
  }

  const prompt = `You are a Creative Director for Peanut Gallery, a fan-first ticket marketplace.

A marketer has written content for a social media post. You must make THREE INDEPENDENT decisions about how to art-direct it.

Think like a Creative Director:
1. What STORY is this content telling?
2. What EMOTION should it create?
3. What should the viewer NOTICE FIRST?
4. What VISUAL METAPHOR communicates that?
5. Which Creative Concept best tells this story?
6. Which Execution Style best delivers it?

Do NOT think about text placement. Think about the VISUAL WORLD and FEELING.

Here is the content:
${contentSummary}

Graphic type context: ${graphicType || 'general'}

═══ CREATIVE STRATEGIES ═══
What is this post trying to accomplish?
${JSON.stringify(strategyCatalog(), null, 2)}

═══ CREATIVE CONCEPTS ═══
What visual metaphor best communicates the message? Each concept is a complete art direction system — NOT a layout.
${JSON.stringify(conceptCatalog(), null, 2)}

═══ EXECUTION STYLES ═══
How should the concept be executed? This modifies typography density, spacing, and decorative restraint.
${JSON.stringify(executionCatalog(), null, 2)}

═══ YOUR TASK ═══
Make three independent choices. For each, explain your reasoning as a Creative Director.

Return JSON:
{
  "strategy": { "id": "strategy_id", "reason": "why this strategy" },
  "concept": { "id": "concept_id", "reason": "why this concept's visual world matches the story and emotion" },
  "executionStyle": { "id": "style_id", "reason": "why this execution style serves the concept" },
  "creativeBrief": "One sentence summarizing the art direction: '[Strategy] executed as [Concept] in [Execution Style] style — [emotional goal]'"
}

Choose IDs that genuinely serve the content. The three decisions should be independent — don't pick a concept just because it "matches" the strategy. Pick the concept whose visual metaphor best communicates the message.`;

  try {
    const response = await base44.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: 'object',
        properties: {
          strategy: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              reason: { type: 'string' },
            },
          },
          concept: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              reason: { type: 'string' },
            },
          },
          executionStyle: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              reason: { type: 'string' },
            },
          },
          creativeBrief: { type: 'string' },
        },
      },
    });

    // Validate IDs exist
    const strategy = CREATIVE_STRATEGIES.find(s => s.id === response.strategy?.id) ? response.strategy : null;
    const concept = CREATIVE_CONCEPTS.find(c => c.id === response.concept?.id) ? response.concept : null;
    const executionStyle = EXECUTION_STYLES.find(s => s.id === response.executionStyle?.id) ? response.executionStyle : null;

    // Fill any gaps with heuristics
    const fallback = heuristicDirect(content, graphicType);
    return {
      strategy: strategy || fallback.strategy,
      concept: concept || fallback.concept,
      executionStyle: executionStyle || fallback.executionStyle,
      creativeBrief: response.creativeBrief || fallback.creativeBrief,
    };
  } catch (err) {
    return heuristicDirect(content, graphicType);
  }
}

/**
 * Quick synchronous recommendation for instant UI feedback.
 * Uses heuristic matching for all three decisions.
 */
export function quickDirect(content, graphicType) {
  return heuristicDirect(content, graphicType);
}

// ═════════════════════════════════════════════════════════════════════════
// FALLBACK: Heuristic Creative Director (no LLM required)
// ═════════════════════════════════════════════════════════════════════════

function heuristicDirect(content = {}, graphicType) {
  const text = `${content.headline || ''} ${content.subheadline || ''} ${content.body || ''} ${content.badge || ''} ${content.cta || ''}`.toLowerCase();

  // ── Decision 1: Strategy ──
  let strategyId = 'announcement';
  let bestStrategyScore = 0;
  for (const s of CREATIVE_STRATEGIES) {
    let score = 0;
    for (const signal of s.signals) {
      if (text.includes(signal)) score += 10;
    }
    if (score > bestStrategyScore) {
      bestStrategyScore = score;
      strategyId = s.id;
    }
  }

  // ── Decision 2: Concept ──
  const conceptScores = {};
  const keywordMap = {
    broken_glass: ['broken', 'shatter', 'crack', 'fracture', 'disrupt', 'destroy', 'fail'],
    empty_seat: ['empty', 'lonely', 'miss', 'gone', 'absent', 'quiet', 'alone'],
    spotlight: ['spotlight', 'stage', 'perform', 'star', 'shine', 'center'],
    arena_lighting: ['concert', 'live', 'energy', 'electric', 'crowd', 'show'],
    movie_poster: ['cinema', 'film', 'movie', 'drama', 'story', 'epic'],
    concert_flyer: ['tonight', 'show', 'live', 'music', 'band', 'gig'],
    street_poster: ['street', 'urban', 'raw', 'real', 'community'],
    neon_sign: ['neon', 'glow', 'night', 'bright', 'sign'],
    receipt: ['price', 'cost', 'fee', 'transaction', 'buy', 'paid', 'save'],
    parking_ticket: ['permit', 'access', 'official', 'authorized'],
    backstage_pass: ['backstage', 'vip', 'exclusive', 'access', 'all-access'],
    vip_wristband: ['vip', 'festival', 'exclusive', 'member', 'elite'],
    ticket_stub: ['ticket', 'admit', 'memory', 'remember', 'nostalgia'],
    magazine_cover: ['cover', 'issue', 'exclusive', 'feature', 'story'],
    minimal_editorial: ['minimal', 'simple', 'clean', 'quiet', 'pure'],
    newspaper: ['news', 'report', 'headline', 'press', 'media'],
    breaking_news: ['breaking', 'urgent', 'alert', 'just in', 'now'],
    premium_invitation: ['invite', 'gala', 'exclusive', 'formal', 'elegant'],
    handwritten_notes: ['note', 'personal', 'journal', 'diary', 'thought'],
    apple_keynote: ['one word', 'simple', 'pure', 'statement', 'bold'],
    tech_launch: ['launch', 'new', 'product', 'feature', 'introducing'],
    spotify_wrapped: ['wrapped', 'year', 'stats', 'data', 'numbers'],
    blueprint: ['plan', 'blueprint', 'design', 'build', 'architecture'],
    jumbotron: ['arena', 'stadium', 'big', 'massive', 'score'],
    seat_map: ['seat', 'section', 'row', 'venue', 'map'],
    bw_documentary: ['documentary', 'truth', 'real', 'raw', 'honest'],
    luxury_fashion: ['luxury', 'premium', 'elegant', 'fashion', 'designer'],
    sports_broadcast: ['sport', 'game', 'team', 'score', 'win', 'champion'],
    financial_report: ['report', 'data', 'growth', 'revenue', 'metric'],
    formula_one: ['speed', 'fast', 'racing', 'precision', 'performance'],
  };

  for (const [conceptId, keywords] of Object.entries(keywordMap)) {
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) score += 10;
    }
    conceptScores[conceptId] = score;
  }

  // Graphic type influence
  const typeBoost = {
    statistic: { spotify_wrapped: 30, financial_report: 25, jumbotron: 20 },
    quote: { handwritten_notes: 20, bw_documentary: 15, magazine_cover: 10 },
    founder_story: { handwritten_notes: 15, magazine_cover: 15, minimal_editorial: 10 },
    announcement: { breaking_news: 25, concert_flyer: 15, tech_launch: 15 },
    problem: { broken_glass: 25, empty_seat: 15, newspaper: 10 },
    feature_spotlight: { tech_launch: 25, spotlight: 15, magazine_cover: 10 },
    industry_truth: { broken_glass: 15, newspaper: 15, bw_documentary: 15 },
    launch: { tech_launch: 25, movie_poster: 15, concert_flyer: 15 },
    milestone: { spotify_wrapped: 20, financial_report: 15, sports_broadcast: 15 },
    partnership: { magazine_cover: 15, premium_invitation: 15, tech_launch: 10 },
    coming_soon: { movie_poster: 20, neon_sign: 15, concert_flyer: 10 },
    fan_story: { handwritten_notes: 20, bw_documentary: 15, ticket_stub: 15 },
    ticket_tip: { ticket_stub: 25, receipt: 15, seat_map: 10 },
    venue_spotlight: { seat_map: 20, jumbotron: 15, arena_lighting: 15 },
    waitlist: { vip_wristband: 20, backstage_pass: 15, premium_invitation: 10 },
  };
  const boosts = typeBoost[graphicType] || {};
  for (const [conceptId, boost] of Object.entries(boosts)) {
    conceptScores[conceptId] = (conceptScores[conceptId] || 0) + boost;
  }

  // Content-based boosts
  if (content.stat_number) {
    conceptScores.spotify_wrapped = (conceptScores.spotify_wrapped || 0) + 25;
    conceptScores.financial_report = (conceptScores.financial_report || 0) + 20;
  }
  if (content.quote_text) {
    conceptScores.handwritten_notes = (conceptScores.handwritten_notes || 0) + 20;
    conceptScores.bw_documentary = (conceptScores.bw_documentary || 0) + 15;
  }
  if (content.image_url) {
    conceptScores.luxury_fashion = (conceptScores.luxury_fashion || 0) + 20;
    conceptScores.magazine_cover = (conceptScores.magazine_cover || 0) + 15;
  }

  const sortedConcepts = Object.entries(conceptScores).sort((a, b) => b[1] - a[1]);
  const conceptId = sortedConcepts[0]?.[0] || 'tech_launch';

  // ── Decision 3: Execution Style ──
  // Choose execution style based on the concept's mood and content density
  let executionStyleId = 'editorial';
  const conceptObj = CREATIVE_CONCEPTS.find(c => c.id === conceptId);
  if (conceptObj) {
    const mood = (conceptObj.mood || '').toLowerCase();
    if (mood.includes('minimal') || mood.includes('calm') || mood.includes('quiet') || mood.includes('contemplative')) {
      executionStyleId = 'minimal';
    } else if (mood.includes('luxury') || mood.includes('aspiration') || mood.includes('refined') || mood.includes('elegant')) {
      executionStyleId = 'luxury';
    } else if (mood.includes('electric') || mood.includes('urgent') || mood.includes('energy') || mood.includes('excitement')) {
      executionStyleId = 'high_energy';
    } else if (mood.includes('cinematic') || mood.includes('dramatic') || mood.includes('awe')) {
      executionStyleId = 'cinematic';
    } else if (mood.includes('precise') || mood.includes('technical') || mood.includes('authoritative')) {
      executionStyleId = 'technical';
    } else if (mood.includes('raw') || mood.includes('honest') || mood.includes('unvarnished')) {
      executionStyleId = 'documentary';
    } else if (mood.includes('professional') || mood.includes('trustworthy')) {
      executionStyleId = 'corporate';
    } else if (mood.includes('bold') || mood.includes('spectacle')) {
      executionStyleId = 'bold';
    } else if (mood.includes('premium') || mood.includes('sophisticated') || mood.includes('modern')) {
      executionStyleId = 'premium';
    }
  }

  return {
    strategy: {
      id: strategyId,
      reason: `Detected ${strategyId} intent from content signals.`,
    },
    concept: {
      id: conceptId,
      reason: `Content keywords and graphic type match this concept's visual world.`,
    },
    executionStyle: {
      id: executionStyleId,
      reason: `Execution style chosen to match the concept's mood and emotional tone.`,
    },
    creativeBrief: `${strategyId} executed as ${conceptId} in ${executionStyleId} style.`,
  };
}