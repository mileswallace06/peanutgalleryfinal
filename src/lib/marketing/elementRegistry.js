/**
 * Element Registry
 * --------------------------------------------------------------------
 * Maps every clickable element on the canvas to its semantic meaning,
 * the intent dimensions it controls, and its lock category.
 *
 * This is how the AI knows what you clicked and what it can change.
 */
export const ELEMENTS = {
  background: {
    label: 'Background',
    description: 'The backdrop — color, glow, pattern, atmosphere, overall mood of the canvas',
    intentDims: ['background', 'mood', 'contrast', 'energy'],
    lockCategory: 'background',
  },
  headline: {
    label: 'Headline',
    description: 'The primary text — the main message that leads the composition',
    intentDims: ['typography_tone', 'weight', 'hierarchy', 'focus', 'spacing'],
    lockCategory: 'typography',
  },
  subheadline: {
    label: 'Subheadline',
    description: 'Supporting text below the headline',
    intentDims: ['typography_tone', 'spacing'],
    lockCategory: 'typography',
  },
  body: {
    label: 'Body Text',
    description: 'Paragraph text providing context',
    intentDims: ['typography_tone', 'spacing'],
    lockCategory: 'typography',
  },
  cta: {
    label: 'Call to Action',
    description: 'The button or action prompt that drives the viewer to act',
    intentDims: ['cta_prominence', 'focus'],
    lockCategory: 'cta',
  },
  badge: {
    label: 'Badge',
    description: 'Small label tag above the headline',
    intentDims: ['focus', 'accent_treatment'],
    lockCategory: 'decorative',
  },
  stat: {
    label: 'Statistic',
    description: 'The large number with its label and explanation',
    intentDims: ['hierarchy', 'focus'],
    lockCategory: 'layout',
  },
  quote: {
    label: 'Quote',
    description: 'The quotation text and its author attribution',
    intentDims: ['hierarchy', 'focus'],
    lockCategory: 'layout',
  },
  signature: {
    label: 'Signature',
    description: 'Founder signature text',
    intentDims: ['typography_tone'],
    lockCategory: 'typography',
  },
  logo: {
    label: 'Logo',
    description: 'The Peanut Gallery brand mark and wordmark',
    intentDims: ['logo_treatment'],
    lockCategory: 'logo',
  },
  decorations: {
    label: 'Decorations',
    description: 'Decorative visual elements — lines, shapes, glows, particles',
    intentDims: ['decoration', 'energy', 'accent_treatment'],
    lockCategory: 'decorative',
  },
};

export function getElementLabel(id) {
  return ELEMENTS[id]?.label || id;
}

export function getElementDescription(id) {
  return ELEMENTS[id]?.description || '';
}