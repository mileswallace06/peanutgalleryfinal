/**
 * Marketing Design Tokens
 * --------------------------------------------------------------------
 * These are NOT new design decisions. They are the EXACT values
 * already used throughout Peanut Gallery, extracted into constants
 * so the canvas renderer (html2canvas) can use them with inline styles.
 *
 * Sources:
 *   - src/index.css (CSS custom properties, .rave-bg, neon vars)
 *   - src/components/Onboarding.jsx (pill, headline, button patterns)
 *   - src/pages/Landing.jsx (gradients, glows, typography)
 *   - src/pages/WhyPeanutGallery.jsx (section labels, cards, CTAs)
 *   - src/components/events/ValuePropCard.jsx (card + CTA patterns)
 *
 * The app UI pages use Tailwind classes + these same values via CSS vars.
 * The canvas renderer uses these constants directly (inline styles).
 */

// ── Neon palette (from index.css :root .dark) ──────────────────────────
export const NEON = {
  green:  '#00FF87',
  cyan:   '#00C8FF',
  purple: '#BF5FFF',
  pink:   '#FF2D78',
  yellow: '#FFE600',
  orange: '#FF8C00',
};

// RGB strings for rgba() usage
export const NEON_RGB = {
  green:  '0,255,135',
  cyan:   '0,200,255',
  purple: '191,95,255',
  pink:   '255,45,120',
  yellow: '255,230,0',
  orange: '255,140,0',
};

// ── Text colors (from Onboarding.jsx / Landing.jsx) ─────────────────────
export const TEXT = {
  white:  '#ffffff',
  body:   'rgba(255,255,255,0.82)',   // onboarding body copy
  muted:  'rgba(255,255,255,0.55)',   // muted labels
  faint:  'rgba(255,255,255,0.35)',   // tertiary
  ultra:  'rgba(255,255,255,0.28)',   // legal/footer
  dark:   '#0D0B14',                  // text on green/cyan CTAs
};

// ── Backgrounds (from index.css .rave-bg) ───────────────────────────────
export const BG = {
  black:   '#000000',
  base:    '#050308',          // from .rave-bg final layer
  surface: 'hsl(0 0% 8%)',     // from --card in .dark
};

// Exact .rave-bg gradient from index.css (dark mode)
export const RAVE_BG = `
  radial-gradient(ellipse 80% 60% at 15% -5%, rgba(191,95,255,0.10), transparent 55%),
  radial-gradient(ellipse 70% 50% at 85% 5%, rgba(255,45,120,0.10), transparent 50%),
  radial-gradient(ellipse 60% 70% at 50% 110%, rgba(0,255,135,0.06), transparent 55%),
  radial-gradient(ellipse 40% 30% at 50% 50%, rgba(0,200,255,0.04), transparent 50%),
  #050308
`;

// Theme variations — same gradient structure, different accent weights
export const THEMES = {
  dark: RAVE_BG,
  dark_purple: `
    radial-gradient(ellipse 80% 60% at 20% 0%, rgba(191,95,255,0.20), transparent 60%),
    radial-gradient(ellipse 60% 50% at 80% 20%, rgba(132,43,212,0.10), transparent 55%),
    radial-gradient(ellipse 50% 50% at 50% 100%, rgba(191,95,255,0.06), transparent 55%),
    #06030f
  `,
  dark_green: `
    radial-gradient(ellipse 75% 55% at 15% 5%, rgba(0,255,135,0.16), transparent 60%),
    radial-gradient(ellipse 55% 45% at 85% 15%, rgba(0,200,255,0.10), transparent 55%),
    radial-gradient(ellipse 50% 50% at 50% 100%, rgba(0,255,135,0.06), transparent 55%),
    #030806
  `,
  dark_cyan: `
    radial-gradient(ellipse 75% 55% at 15% 5%, rgba(0,200,255,0.16), transparent 60%),
    radial-gradient(ellipse 60% 50% at 85% 20%, rgba(0,255,135,0.08), transparent 55%),
    radial-gradient(ellipse 50% 50% at 50% 100%, rgba(0,200,255,0.06), transparent 55%),
    #030608
  `,
  dark_pink: `
    radial-gradient(ellipse 75% 55% at 20% 0%, rgba(255,45,120,0.18), transparent 60%),
    radial-gradient(ellipse 60% 50% at 80% 15%, rgba(191,95,255,0.12), transparent 55%),
    radial-gradient(ellipse 50% 50% at 50% 100%, rgba(255,45,120,0.06), transparent 55%),
    #0a0306
  `,
};

// ── Gradients (exact patterns from Landing.jsx / Onboarding.jsx) ────────
export const GRADIENTS = {
  // Primary CTA — from Landing.jsx "Create Account" button
  cta_primary: 'linear-gradient(135deg, #00FF87, #00C8FF)',
  // Purple-pink — from WhyPeanutGallery "Browse Events" button
  cta_purple:  'linear-gradient(135deg, #BF5FFF, #FF2D78)',
  // Brand — from Onboarding logo text
  brand:       'linear-gradient(90deg, #00FF87, #BF5FFF, #FFE600)',
  // Hero accent — from Onboarding slide 1 button
  hero:        'linear-gradient(135deg, #00FF87, #BF5FFF, #FFE600)',
  // Yellow-orange — from Onboarding slide 4 button
  warm:        'linear-gradient(135deg, #FF8C00, #FFE600)',
  // Stat number — green to cyan
  stat:        'linear-gradient(135deg, #00FF87, #00C8FF)',
  // Milestone — yellow to orange
  milestone:   'linear-gradient(135deg, #FFE600, #FF8C00)',
  // Headline default — purple to pink to yellow
  headline:    'linear-gradient(135deg, #BF5FFF 0%, #FF2D78 50%, #FFE600 100%)',
  // Broken text — purple to pink only (more intense)
  broken:      'linear-gradient(135deg, #BF5FFF 0%, #FF2D78 100%)',
};

// ── Typography (from index.css @import + tailwind.config.js) ────────────
export const FONTS = {
  display: "'Black Han Sans', Impact, sans-serif",
  body:    "'DM Sans', system-ui, sans-serif",
};

// ── Logo (from RouteFallback.jsx + Landing.jsx) ─────────────────────────
export const PG_LOGO_URL = 'https://media.base44.com/images/public/69ef9900cf3862dc0ea39734/9022a5431_ChatGPTImageMay1202601_29_27PM.png';

// ── Shadows (from Onboarding.jsx / ValuePropCard.jsx) ───────────────────
export const SHADOWS = {
  cta_glow:  (color = NEON.green) => `0 0 24px ${color}66`,
  card:      '0 4px 24px rgba(0,0,0,0.4)',
  card_neon: (rgb = NEON_RGB.purple) => `0 0 30px rgba(${rgb},0.06)`,
  screenshot:'0 8px 40px rgba(0,0,0,0.5), 0 0 24px rgba(191,95,255,0.12)',
};

// ── Canvas presets ──────────────────────────────────────────────────────
export const CANVAS_PRESETS = {
  '1080x1350': { w: 1080, h: 1350, label: 'Portrait 4:5',  platform: 'Instagram' },
  '1080x1080': { w: 1080, h: 1080, label: 'Square 1:1',    platform: 'Instagram' },
  '1920x1080': { w: 1920, h: 1080, label: 'Landscape 16:9', platform: 'Web' },
  'story':     { w: 1080, h: 1920, label: 'Story 9:16',    platform: 'Instagram' },
  'linkedin':  { w: 1200, h: 1200, label: 'LinkedIn',      platform: 'LinkedIn' },
  'x':         { w: 1600, h: 900,  label: 'X / Twitter',   platform: 'X' },
  'facebook':  { w: 1200, h: 630,  label: 'Facebook',      platform: 'Facebook' },
};

// ── Graphic types (full list from spec) ─────────────────────────────────
export const GRAPHIC_TYPES = [
  { id: 'industry_truth',    label: 'Industry Truth',     icon: '🎯', color: NEON.cyan },
  { id: 'feature_spotlight', label: 'Feature Spotlight',  icon: '✨', color: NEON.purple },
  { id: 'founder_story',     label: 'Founder Story',      icon: '👤', color: NEON.pink },
  { id: 'announcement',      label: 'Announcement',       icon: '📢', color: NEON.pink },
  { id: 'statistic',         label: 'Statistic',          icon: '📊', color: NEON.green },
  { id: 'quote',             label: 'Quote',              icon: '💬', color: NEON.cyan },
  { id: 'problem',           label: 'Problem',            icon: '⚠️', color: NEON.pink },
  { id: 'coming_soon',       label: 'Coming Soon',        icon: '🔮', color: NEON.cyan },
  { id: 'launch',            label: 'Launch',             icon: '🚀', color: NEON.green },
  { id: 'milestone',         label: 'Milestone',          icon: '🏆', color: NEON.yellow },
  { id: 'partnership',       label: 'Partnership',        icon: '🤝', color: NEON.cyan },
  { id: 'waitlist',          label: 'Waitlist',           icon: '📋', color: NEON.purple },
  { id: 'update',            label: 'Update',             icon: '🔄', color: NEON.cyan },
  { id: 'venue_spotlight',   label: 'Venue Spotlight',    icon: '🏟️', color: NEON.green },
  { id: 'ticket_tip',        label: 'Ticket Tip',         icon: '🎫', color: NEON.yellow },
  { id: 'fan_story',         label: 'Fan Story',          icon: '❤️', color: NEON.pink },
  { id: 'comparison',        label: 'Comparison',         icon: '⚖️', color: NEON.cyan },
  { id: 'question',          label: 'Question',           icon: '❓', color: NEON.purple },
];

// ── Broken text detection ───────────────────────────────────────────────
export const BROKEN_WORDS = [
  'BROKEN', 'SHATTERED', 'FAILED', 'EMPTY', 'DEAD', 'CRACK',
  'FRACTURE', 'DESTROY', 'RUIN', 'WRECK', 'COLLAPSE', 'FALLEN',
];

export function detectBrokenText(text) {
  if (!text) return false;
  const upper = text.toUpperCase();
  return BROKEN_WORDS.some(w => upper.includes(w));
}

// ── Helper: neon color to RGB string ────────────────────────────────────
export function neonToRgb(hex) {
  const entry = Object.entries(NEON).find(([_, v]) => v === hex);
  return entry ? NEON_RGB[entry[0]] : NEON_RGB.cyan;
}