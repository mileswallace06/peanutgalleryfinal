/**
 * Execution Styles
 * --------------------------------------------------------------------
 * Decision 3 of 3: How should the concept be executed?
 *
 * The execution style MODIFIES the concept's design system — it does
 * not replace it. It changes typography density, spacing, decorative
 * restraint, texture intensity, and contrast while remaining faithful
 * to the selected Creative Concept's visual world.
 *
 * Example: "Movie Poster" concept + "Minimal" execution =
 *   same cinematic darkness, but stripped to one element, maximum space.
 *
 * "Movie Poster" concept + "Bold" execution =
 *   same world, but denser, louder, more decorative elements.
 */
export const EXECUTION_STYLES = [
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Less is more. Maximum whitespace, restrained typography, essential elements only.',
    modifiers: {
      negativeSpaceBoost: 0.15,
      typographyScale: 0.9,
      decorativeMode: 'essential',
      textureIntensityMultiplier: 0.4,
      maxWidthReduction: 0.1,
      weightReduction: true,
    },
  },
  {
    id: 'editorial',
    name: 'Editorial',
    description: 'Magazine-grade refinement. Structured grid, considered hierarchy, tasteful accents.',
    modifiers: {
      negativeSpaceBoost: 0.05,
      typographyScale: 1.0,
      decorativeMode: 'curated',
      textureIntensityMultiplier: 0.7,
      maxWidthReduction: 0.05,
      weightReduction: false,
    },
  },
  {
    id: 'premium',
    name: 'Premium',
    description: 'Luxury restraint. Generous margins, light weights, gold-standard spacing.',
    modifiers: {
      negativeSpaceBoost: 0.12,
      typographyScale: 0.95,
      decorativeMode: 'curated',
      textureIntensityMultiplier: 0.6,
      maxWidthReduction: 0.08,
      weightReduction: true,
    },
  },
  {
    id: 'cinematic',
    name: 'Cinematic',
    description: 'Dramatic, atmospheric. Deep shadows, bold display type, immersive mood.',
    modifiers: {
      negativeSpaceBoost: 0.08,
      typographyScale: 1.1,
      decorativeMode: 'keep',
      textureIntensityMultiplier: 1.2,
      maxWidthReduction: 0.0,
      weightReduction: false,
    },
  },
  {
    id: 'technical',
    name: 'Technical',
    description: 'Precise, diagrammatic. Grid-aligned, monospace accents, annotation feel.',
    modifiers: {
      negativeSpaceBoost: 0.0,
      typographyScale: 0.95,
      decorativeMode: 'keep',
      textureIntensityMultiplier: 0.8,
      maxWidthReduction: 0.05,
      weightReduction: false,
      monoAccents: true,
    },
  },
  {
    id: 'bold',
    name: 'Bold',
    description: 'Maximum impact. Heavy type, dense layout, full decorative treatment.',
    modifiers: {
      negativeSpaceBoost: -0.05,
      typographyScale: 1.15,
      decorativeMode: 'keep',
      textureIntensityMultiplier: 1.0,
      maxWidthReduction: -0.05,
      weightReduction: false,
    },
  },
  {
    id: 'corporate',
    name: 'Corporate',
    description: 'Professional, clean, trustworthy. Structured, moderate density, neutral palette.',
    modifiers: {
      negativeSpaceBoost: 0.05,
      typographyScale: 1.0,
      decorativeMode: 'curated',
      textureIntensityMultiplier: 0.5,
      maxWidthReduction: 0.0,
      weightReduction: false,
    },
  },
  {
    id: 'luxury',
    name: 'Luxury',
    description: 'Aspirational elegance. Ultra-light type, extreme whitespace, minimal accents.',
    modifiers: {
      negativeSpaceBoost: 0.2,
      typographyScale: 0.9,
      decorativeMode: 'essential',
      textureIntensityMultiplier: 0.5,
      maxWidthReduction: 0.12,
      weightReduction: true,
    },
  },
  {
    id: 'documentary',
    name: 'Documentary',
    description: 'Raw, honest, unpolished. High contrast, grain texture, caption-style type.',
    modifiers: {
      negativeSpaceBoost: 0.0,
      typographyScale: 1.0,
      decorativeMode: 'curated',
      textureIntensityMultiplier: 1.3,
      maxWidthReduction: 0.0,
      weightReduction: false,
    },
  },
  {
    id: 'high_energy',
    name: 'High Energy',
    description: 'Electric, vibrant, loud. Tight spacing, bold colors, full decorative.',
    modifiers: {
      negativeSpaceBoost: -0.08,
      typographyScale: 1.2,
      decorativeMode: 'keep',
      textureIntensityMultiplier: 1.1,
      maxWidthReduction: -0.05,
      weightReduction: false,
    },
  },
  {
    id: 'experimental',
    name: 'Experimental',
    description: 'Push boundaries. Asymmetric, unusual spacing, unexpected decorative.',
    modifiers: {
      negativeSpaceBoost: 0.05,
      typographyScale: 1.05,
      decorativeMode: 'keep',
      textureIntensityMultiplier: 1.0,
      maxWidthReduction: 0.0,
      weightReduction: false,
      asymmetric: true,
    },
  },
];

export function getExecutionStyleById(id) {
  return EXECUTION_STYLES.find(s => s.id === id);
}