/**
 * Composition Engine
 * --------------------------------------------------------------------
 * The "creative director" brain. Analyzes content, scores every
 * composition for fit, and selects the strongest visual approach.
 *
 * Core principle: "What is the strongest visual way to communicate
 * this message?" — NOT "Where should I place the headline?"
 */

// ── Composition metadata (no React imports — pure logic) ─────────────────
export const COMPOSITION_META = [
  { id: 'massive_left', name: 'Massive Left', cluster: 'typography', desc: 'Huge left-aligned type, atmospheric negative space' },
  { id: 'centered_hero', name: 'Centered Hero', cluster: 'typography', desc: 'Symmetrical, minimal, Apple keynote energy' },
  { id: 'split_layout', name: 'Split', cluster: 'visual', desc: 'Image panel beside content panel' },
  { id: 'magazine_layout', name: 'Magazine', cluster: 'editorial', desc: 'Drop cap, column body, editorial structure' },
  { id: 'poster_layout', name: 'Poster', cluster: 'dynamic', desc: 'Bold full-bleed, high-contrast, geometric' },
  { id: 'editorial_layout', name: 'Editorial', cluster: 'editorial', desc: 'Asymmetric columns, refined, thin accents' },
  { id: 'minimal_apple', name: 'Minimal', cluster: 'typography', desc: 'Extreme whitespace, single focal point' },
  { id: 'floating_card', name: 'Floating Card', cluster: 'visual', desc: 'Glass card over atmospheric background' },
  { id: 'statistic_hero', name: 'Statistic Hero', cluster: 'data', desc: 'Massive number dominates the canvas' },
  { id: 'diagonal_composition', name: 'Diagonal', cluster: 'dynamic', desc: 'Angled elements, movement, energy' },
  { id: 'asymmetric_layout', name: 'Asymmetric', cluster: 'dynamic', desc: 'Intentional imbalance, dramatic negative space' },
  { id: 'large_quote', name: 'Large Quote', cluster: 'editorial', desc: 'Oversized punctuation, pull-quote aesthetic' },
];

// ── Content analysis ─────────────────────────────────────────────────────
export function analyzeContent(content = {}) {
  const headline = content.headline || '';
  const body = content.body || '';
  return {
    hasHeadline: !!headline.trim(),
    headlineLength: headline.length,
    headlineWords: headline.trim().split(/\s+/).filter(Boolean).length,
    hasSubheadline: !!(content.subheadline || '').trim(),
    hasBody: !!body.trim(),
    bodyLength: body.length,
    hasCTA: !!(content.cta || '').trim(),
    hasBadge: !!(content.badge || '').trim(),
    hasStat: !!(content.stat_number || '').trim(),
    hasStatLabel: !!(content.stat_label || '').trim(),
    hasQuote: !!(content.quote_text || '').trim(),
    hasAuthor: !!(content.author || '').trim(),
    hasImage: !!(content.image_url || '').trim(),
    hasSignature: !!(content.signature || '').trim(),
  };
}

// ── Body format detection ────────────────────────────────────────────────
export function detectBodyFormat(body) {
  if (!body?.trim()) return 'none';
  const trimmed = body.trim();
  const lines = trimmed.split('\n').filter(l => l.trim());

  // List-like content
  if (lines.length >= 2 && lines.every(l => /^[-•*]\s/.test(l.trim()) || /^\d+[.)]\s/.test(l.trim()))) {
    return 'bullets';
  }

  // Timeline (dates, phases, steps)
  if (lines.length >= 2 && lines.some(l =>
    /\b(19|20)\d{2}\b|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|q[1-4]|phase|step|stage|day\s?\d/i.test(l)
  )) {
    return 'timeline';
  }

  // Quoted text
  if (/^["""''].+["""'']$/.test(trimmed) || trimmed.startsWith('"')) {
    return 'pullquote';
  }

  // Statistic-like
  if (/\d+%|\$\d+|\d{2,}/.test(trimmed) && trimmed.length < 120) {
    return 'statistic';
  }

  // Short callout
  if (trimmed.length < 80) {
    return 'callout';
  }

  return 'paragraph';
}

// ── Score a single composition (0–100) ───────────────────────────────────
export function scoreComposition(compId, analysis, graphicType) {
  let score = 50;
  const a = analysis;

  switch (compId) {
    case 'massive_left':
      if (a.hasHeadline && a.headlineWords <= 5) score += 30;
      if (a.hasHeadline && a.headlineWords <= 8) score += 15;
      if (!a.hasBody || a.bodyLength < 100) score += 10;
      if (!a.hasImage) score += 5;
      break;

    case 'centered_hero':
      if (a.hasHeadline && a.headlineWords <= 6) score += 25;
      if (a.hasSubheadline) score += 15;
      if (!a.hasBody || a.bodyLength < 80) score += 10;
      if (a.hasBadge) score += 5;
      break;

    case 'split_layout':
      if (a.hasImage) score += 35;
      if (a.hasHeadline && a.hasBody) score += 15;
      if (!a.hasImage) score -= 25;
      if (a.hasCTA) score += 5;
      break;

    case 'magazine_layout':
      if (a.hasBody && a.bodyLength >= 50) score += 25;
      if (a.hasHeadline) score += 15;
      if (!a.hasImage) score += 10;
      if (a.bodyLength >= 100) score += 10;
      break;

    case 'poster_layout':
      if (a.hasCTA) score += 20;
      if (a.hasHeadline && a.headlineWords <= 5) score += 15;
      if (a.hasBadge) score += 10;
      if (!a.hasBody || a.bodyLength < 80) score += 5;
      break;

    case 'editorial_layout':
      if (a.hasBody) score += 20;
      if (a.hasHeadline) score += 15;
      if (!a.hasStat) score += 10;
      if (a.hasSubheadline) score += 5;
      break;

    case 'minimal_apple':
      if (a.hasHeadline && a.headlineWords <= 4) score += 30;
      if (a.hasSubheadline) score += 15;
      if (!a.hasBody || a.bodyLength < 60) score += 10;
      if (a.hasImage) score -= 10;
      break;

    case 'floating_card':
      if (a.hasImage) score += 20;
      if (a.hasHeadline && a.hasBody) score += 15;
      if (a.hasCTA) score += 10;
      if (!a.hasImage && a.hasHeadline) score += 5;
      break;

    case 'statistic_hero':
      if (a.hasStat) score += 40;
      if (a.hasStatLabel) score += 20;
      if (!a.hasStat && a.hasHeadline && a.headlineWords <= 3) score += 15;
      if (!a.hasStat && !a.hasHeadline) score -= 30;
      break;

    case 'diagonal_composition':
      if (a.hasCTA) score += 15;
      if (a.hasHeadline && a.headlineWords <= 5) score += 15;
      if (a.hasBadge) score += 10;
      if (!a.hasBody || a.bodyLength < 80) score += 5;
      break;

    case 'asymmetric_layout':
      if (a.hasHeadline && a.headlineWords <= 5) score += 20;
      if (a.hasSubheadline) score += 15;
      if (!a.hasBody || a.bodyLength < 80) score += 10;
      if (!a.hasImage) score += 5;
      break;

    case 'large_quote':
      if (a.hasQuote) score += 40;
      if (a.hasAuthor) score += 20;
      if (!a.hasQuote && a.hasBody && a.bodyLength < 150) score += 15;
      if (!a.hasQuote && !a.hasBody) score -= 40;
      break;

    default:
      break;
  }

  // ── Graphic type influence ──────────────────────────────────────────────
  const typeBoost = {
    statistic: { statistic_hero: 25, massive_left: 5 },
    quote: { large_quote: 30, magazine_layout: 10 },
    founder_story: { magazine_layout: 15, editorial_layout: 15, large_quote: 10 },
    announcement: { centered_hero: 10, poster_layout: 15, massive_left: 5 },
    problem: { massive_left: 10, asymmetric_layout: 15, poster_layout: 5 },
    feature_spotlight: { split_layout: 15, floating_card: 15, centered_hero: 5 },
    industry_truth: { massive_left: 10, editorial_layout: 10, centered_hero: 5 },
    launch: { poster_layout: 15, centered_hero: 10, diagonal_composition: 10 },
    milestone: { statistic_hero: 15, poster_layout: 10 },
    partnership: { split_layout: 15, centered_hero: 10 },
    coming_soon: { minimal_apple: 15, centered_hero: 10 },
    fan_story: { large_quote: 15, magazine_layout: 10, editorial_layout: 10 },
    ticket_tip: { minimal_apple: 10, floating_card: 10 },
    update: { editorial_layout: 10, centered_hero: 5 },
    waitlist: { minimal_apple: 10, poster_layout: 5 },
    venue_spotlight: { split_layout: 15, poster_layout: 10 },
    comparison: { split_layout: 10, editorial_layout: 10 },
    question: { centered_hero: 10, minimal_apple: 10 },
  };
  const boosts = typeBoost[graphicType] || {};
  score += boosts[compId] || 0;

  return Math.min(100, Math.max(0, Math.round(score)));
}

// ── Get all compositions ranked by score ─────────────────────────────────
export function getRankedCompositions(content, graphicType) {
  const analysis = analyzeContent(content);
  return COMPOSITION_META
    .map(meta => ({
      ...meta,
      score: scoreComposition(meta.id, analysis, graphicType),
    }))
    .sort((a, b) => b.score - a.score);
}

// ── Auto-select the best composition ─────────────────────────────────────
export function getBestComposition(content, graphicType) {
  const ranked = getRankedCompositions(content, graphicType);
  return ranked[0]?.id || 'massive_left';
}

// ── Get N concepts from different visual clusters ────────────────────────
// Each concept uses fundamentally different visual thinking.
export function getConcepts(content, graphicType, count = 3) {
  const ranked = getRankedCompositions(content, graphicType);
  const concepts = [];
  const usedClusters = new Set();

  for (const comp of ranked) {
    if (concepts.length >= count) break;
    // Allow re-using a cluster only if we can't fill all slots otherwise
    if (usedClusters.has(comp.cluster) && concepts.length < count - (COMPOSITION_META.length - ranked.indexOf(comp) - 1)) {
      continue;
    }
    concepts.push(comp);
    usedClusters.add(comp.cluster);
  }

  // Fallback: fill remaining slots from the top-ranked regardless of cluster
  if (concepts.length < count) {
    for (const comp of ranked) {
      if (concepts.length >= count) break;
      if (!concepts.find(c => c.id === comp.id)) concepts.push(comp);
    }
  }

  return concepts;
}