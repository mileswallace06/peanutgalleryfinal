/**
 * AI Concept Director
 * --------------------------------------------------------------------
 * The brain that chooses which Creative Concept best serves the user's
 * content. It thinks like a Creative Director:
 *
 *   "What is the story? What emotion should this create?
 *    What visual metaphor communicates that?"
 *
 * NOT: "Which layout fits these text fields?"
 *
 * Flow:
 *   1. Analyze the user's content for intent, tone, and story
 *   2. Ask the LLM to match content → concept by story/emotion/metaphor
 *   3. Return ranked concept recommendations with reasoning
 *
 * Falls back to heuristic matching if LLM is unavailable.
 */
import { base44 } from '@/api/base44Client';
import { CONCEPT_LIBRARY } from './conceptLibrary';

/**
 * Build a compact concept catalog for the LLM prompt.
 * Each entry includes the art direction metadata the AI reasons about.
 */
function buildConceptCatalog() {
  return CONCEPT_LIBRARY.map(c => ({
    id: c.id,
    name: c.name,
    family: c.family,
    inspiration: c.inspiration,
    story: c.story,
    emotion: c.emotion,
    visualMetaphor: c.visualMetaphor,
    focalPoints: c.focalPoints,
    photographyStyle: c.photographyStyle,
  }));
}

/**
 * Summarize the user's content for the LLM.
 */
function summarizeContent(content = {}) {
  const parts = [];
  if (content.badge) parts.push(`Badge/Category: "${content.badge}"`);
  if (content.headline) parts.push(`Headline: "${content.headline}"`);
  if (content.subheadline) parts.push(`Subheadline: "${content.subheadline}"`);
  if (content.body) parts.push(`Body: "${content.body}"`);
  if (content.cta) parts.push(`CTA: "${content.cta}"`);
  if (content.stat_number) parts.push(`Stat: ${content.stat_number} ${content.stat_label || ''}`);
  if (content.quote_text) parts.push(`Quote: "${content.quote_text}" — ${content.author || ''}`);
  if (content.image_url) parts.push(`Has image: yes`);
  return parts.join('\n');
}

/**
 * Ask the AI Concept Director to recommend concepts for this content.
 * Returns: [{ conceptId, reason, fitScore }]
 */
export async function recommendConcepts(content, graphicType, count = 3) {
  const contentSummary = summarizeContent(content);
  const catalog = buildConceptCatalog();

  const prompt = `You are a Creative Director for Peanut Gallery, a ticket marketplace.

A marketer has written content for a social media post. Your job is to choose which CREATIVE CONCEPT best serves this content.

Think like a Creative Director:
1. What is the STORY this content tells?
2. What EMOTION should it create in the viewer?
3. What VISUAL METAPHOR communicates that idea?
4. Which concept's art direction (typography, color, texture, atmosphere) reinforces that?

Do NOT think about layout or text placement. Think about the FEELING and VISUAL WORLD.

Here is the content:
${contentSummary}

Graphic type context: ${graphicType || 'general'}

Here are the available Creative Concepts (each is a complete art direction system):

${JSON.stringify(catalog, null, 2)}

Choose the top ${count} concepts that best match this content's story and emotion. For each, explain WHY this concept's art direction serves the content's message.

Return JSON with this structure:
{
  "recommendations": [
    {
      "conceptId": "the_concept_id",
      "reason": "1-2 sentences explaining why this concept's visual world matches the content's story and emotion",
      "fitScore": 0-100
    }
  ]
}

Rank by fitScore descending. Only choose concepts that genuinely serve the content.`;

  try {
    const response = await base44.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: 'object',
        properties: {
          recommendations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                conceptId: { type: 'string' },
                reason: { type: 'string' },
                fitScore: { type: 'number' },
              },
            },
          },
        },
      },
    });

    const recs = response.recommendations || [];
    // Validate that conceptIds exist
    return recs
      .filter(r => CONCEPT_LIBRARY.find(c => c.id === r.conceptId))
      .slice(0, count);
  } catch (err) {
    // Fallback to heuristic matching
    return heuristicRecommend(content, graphicType, count);
  }
}

/**
 * Heuristic fallback — matches content to concepts using keyword analysis.
 * Not as smart as the LLM, but ensures the system works offline.
 */
function heuristicRecommend(content, graphicType, count = 3) {
  const text = `${content.headline || ''} ${content.subheadline || ''} ${content.body || ''} ${content.badge || ''}`.toLowerCase();
  const scores = {};

  // Keyword → concept mapping
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

  // Score by keyword matches
  for (const [conceptId, keywords] of Object.entries(keywordMap)) {
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) score += 10;
    }
    scores[conceptId] = score;
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
    scores[conceptId] = (scores[conceptId] || 0) + boost;
  }

  // If content has a stat, boost data concepts
  if (content.stat_number) {
    scores.spotify_wrapped = (scores.spotify_wrapped || 0) + 25;
    scores.financial_report = (scores.financial_report || 0) + 20;
    scores.jumbotron = (scores.jumbotron || 0) + 15;
  }

  // If content has a quote, boost quote-friendly concepts
  if (content.quote_text) {
    scores.handwritten_notes = (scores.handwritten_notes || 0) + 20;
    scores.bw_documentary = (scores.bw_documentary || 0) + 15;
  }

  // If content has an image, boost image-forward concepts
  if (content.image_url) {
    scores.luxury_fashion = (scores.luxury_fashion || 0) + 20;
    scores.magazine_cover = (scores.magazine_cover || 0) + 15;
    scores.bw_documentary = (scores.bw_documentary || 0) + 10;
  }

  // Rank and return
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .filter(([, score]) => score > 0)
    .map(([conceptId, score]) => ({
      conceptId,
      reason: 'Matched based on content keywords and graphic type.',
      fitScore: Math.min(100, 40 + score),
    }));
}

/**
 * Quick local concept suggestion (no LLM call) for instant UI feedback.
 * Used as initial state while the AI recommendation loads.
 */
export function quickSuggest(content, graphicType) {
  return heuristicRecommend(content, graphicType, 3);
}