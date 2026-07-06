/**
 * Visual Asset Library
 * --------------------------------------------------------------------
 * Curated stock photography URLs + treatment utilities for compositions.
 * Photography is an ENHANCEMENT layer — every composition looks premium
 * with gradient/glow fallbacks alone. Images are optional.
 *
 * URLs use Unsplash's CDN (CORS-enabled for html2canvas).
 * If any fail to load, the gradient background behind them still renders.
 */

// ── Curated photography by mood/category ────────────────────────────────
export const STOCK_PHOTOS = {
  concert: [
    'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=1080&q=80&fm=jpg&fit=crop',
    'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=1080&q=80&fm=jpg&fit=crop',
    'https://images.unsplash.com/photo-1517457373958-b7bdd4587205?w=1080&q=80&fm=jpg&fit=crop',
  ],
  crowd: [
    'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=1080&q=80&fm=jpg&fit=crop',
    'https://images.unsplash.com/photo-1429962714451-bb934bdc3793?w=1080&q=80&fm=jpg&fit=crop',
  ],
  stadium: [
    'https://images.unsplash.com/photo-1571266028243-d220c6a7f1ef?w=1080&q=80&fm=jpg&fit=crop',
  ],
  abstract: [
    'https://images.unsplash.com/photo-1557682250-33bd709cbe85?w=1080&q=80&fm=jpg&fit=crop',
    'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1080&q=80&fm=jpg&fit=crop',
  ],
};

// ── Get a stock photo by keyword ─────────────────────────────────────────
export function getStockPhoto(category = 'concert', index = 0) {
  const photos = STOCK_PHOTOS[category] || STOCK_PHOTOS.concert;
  return photos[index % photos.length];
}

// ── Pick a relevant photo based on content/graphic type ──────────────────
export function getRelevantStockPhoto(graphicType, content) {
  const categoryMap = {
    venue_spotlight: 'stadium',
    fan_story: 'crowd',
    concert: 'concert',
    industry_truth: 'abstract',
    problem: 'abstract',
    launch: 'concert',
    milestone: 'crowd',
    partnership: 'abstract',
    founder_story: 'abstract',
    feature_spotlight: 'abstract',
    announcement: 'abstract',
    coming_soon: 'abstract',
    statistic: 'abstract',
    quote: 'abstract',
    update: 'abstract',
    waitlist: 'abstract',
    ticket_tip: 'stadium',
    comparison: 'abstract',
    question: 'abstract',
  };
  const category = categoryMap[graphicType] || 'concert';
  const seed = (content?.headline || '').length + (content?.body || '').length;
  return getStockPhoto(category, seed);
}

// ── Image treatment presets (applied via CSS filter) ─────────────────────
export const TREATMENTS = {
  blur: 'blur(14px) saturate(1.2) brightness(0.5)',
  darken: 'brightness(0.35) saturate(1.1) contrast(1.05)',
  saturate: 'saturate(1.5) contrast(1.15) brightness(0.55)',
  duotone: 'grayscale(0.3) sepia(0.2) brightness(0.5) saturate(1.3)',
  normal: 'brightness(0.6) saturate(1.1)',
};