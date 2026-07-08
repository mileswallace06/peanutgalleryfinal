/**
 * Element Brain — Living Element Intelligence
 * --------------------------------------------------------------------
 * Every visible object on the canvas is alive. It understands:
 *
 *   WHAT it is          — semantic identity, not just a label
 *   WHY it exists       — its purpose in the composition
 *   HOW important it is — critical / high / medium / low / ambient
 *   WHAT role it plays  — primary, secondary, supporting, ambient
 *   WHAT controls it    — which visual systems can change it
 *   WHAT it CAN change   — permissions: allowed modifications
 *   WHAT it CANNOT change— permissions: protected aspects
 *   ITS CURRENT STATE   — dynamic assessment of emphasis, readability,
 *                          relationships — computed from live intent
 *
 * When the user selects an element, the AI doesn't receive:
 *   "User clicked headline."
 *
 * It receives:
 *   "The user selected the primary communication object.
 *    Current role: Largest hierarchy element.
 *    Responsible for attention.
 *    Current emphasis: Moderate.
 *    Current readability: Excellent.
 *    Current relationship with CTA: Competing slightly."
 *
 * This is the difference between a tool and a collaborator.
 */

export const ELEMENT_BRAIN = {
  // ═══════════════════════════════════════════════════════════════════════
  headline: {
    identity: {
      label: 'Headline',
      semanticName: 'Primary Communication Object',
      whatItIs: 'The main text element that leads the composition',
      whyItExists: 'Delivers the core message and creates the first impression. Everything else in the composition exists to support it.',
    },
    role: {
      type: 'primary',
      rank: 1,
      responsibilities: ['attention', 'message delivery', 'emotional hook', 'first impression'],
    },
    importance: 'critical',
    controllingSystems: ['typography', 'layout', 'color'],
    permissions: {
      canChange: ['scale', 'weight', 'emphasis treatment', 'spacing', 'gradient treatment'],
      cannotChange: ['content text — use Copy Assistant for that'],
      reasoning: 'The headline is the composition anchor. Scale and weight changes ripple through the entire visual hierarchy.',
    },
    quickActions: [
      { label: 'Make Bigger', instruction: 'Make the headline larger and more dominant', icon: 'Maximize2' },
      { label: 'Bolder', instruction: 'Make the headline weight heavier and more commanding', icon: 'Bold' },
      { label: 'Restyle', instruction: 'Give the headline a fresh visual treatment', icon: 'Sparkles' },
      { label: 'More Room', instruction: 'Give the headline more breathing room around it', icon: 'Move' },
    ],
    assessState(intent = {}, content = {}) {
      const hierarchy = intent.hierarchy || 'headline_first';
      const weight = intent.weight || 'heavy';
      const spacing = intent.spacing || 'normal';
      const ctaProminence = intent.cta_prominence || 'normal';

      let emphasis = 'moderate';
      if (hierarchy === 'headline_first' && (weight === 'heavy' || weight === 'bold')) emphasis = 'dominant';
      else if (hierarchy === 'balanced') emphasis = 'balanced';
      else if (['stat_focused', 'quote_centered', 'cta_driven', 'image_first'].includes(hierarchy)) emphasis = 'reduced';

      let readability = 'good';
      if (spacing === 'airy' || spacing === 'expansive') readability = 'excellent';
      else if (spacing === 'tight') readability = 'fair';

      let relationshipWithCTA = 'harmonious';
      if (!content.cta) relationshipWithCTA = 'no CTA present';
      else if (emphasis === 'dominant' && ctaProminence === 'dominant') relationshipWithCTA = 'competing';
      else if (emphasis === 'dominant' && ctaProminence === 'prominent') relationshipWithCTA = 'competing slightly';
      else if (emphasis === 'dominant' && ['subtle', 'normal'].includes(ctaProminence)) relationshipWithCTA = 'headline dominating';
      else if (emphasis === 'reduced' && ctaProminence === 'dominant') relationshipWithCTA = 'CTA dominating';

      let relationshipWithStat = 'no statistic present';
      if (content.stat_number) {
        if (hierarchy === 'stat_focused') relationshipWithStat = 'stat leading, headline supporting';
        else if (hierarchy === 'headline_first') relationshipWithStat = 'headline leading, stat supporting';
        else if (emphasis === 'dominant') relationshipWithStat = 'potentially competing with statistic';
        else relationshipWithStat = 'balanced with statistic';
      }

      return { emphasis, readability, relationshipWithCTA, relationshipWithStat };
    },
    buildAIContext(state) {
      return `The user selected the primary communication object.

Current role: Largest hierarchy element.
Responsible for: attention, message delivery, and first impression.
Current emphasis: ${state.emphasis}.
Current readability: ${state.readability}.
Current relationship with CTA: ${state.relationshipWithCTA}.${state.relationshipWithStat !== 'no statistic present' ? `\nCurrent relationship with statistic: ${state.relationshipWithStat}.` : ''}`;
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  subheadline: {
    identity: {
      label: 'Subheadline',
      semanticName: 'Supporting Communication Object',
      whatItIs: 'Secondary text directly below the headline',
      whyItExists: 'Expands on the headline, provides context, and bridges the viewer from the headline to the rest of the composition.',
    },
    role: {
      type: 'secondary',
      rank: 2,
      responsibilities: ['context', 'elaboration', 'transition'],
    },
    importance: 'high',
    controllingSystems: ['typography', 'layout'],
    permissions: {
      canChange: ['scale', 'weight', 'opacity', 'spacing'],
      cannotChange: ['content text — use Copy Assistant'],
      reasoning: 'The subheadline must maintain visual hierarchy with the headline. If it gets too prominent, it competes with the primary message.',
    },
    quickActions: [
      { label: 'More Prominent', instruction: 'Make the subheadline more prominent and readable', icon: 'Maximize2' },
      { label: 'Subtler', instruction: 'Make the subheadline more subtle and recessed', icon: 'Minimize2' },
      { label: 'Restyle', instruction: 'Give the subheadline a different visual treatment', icon: 'Sparkles' },
    ],
    assessState(intent = {}, content = {}) {
      const weight = intent.weight || 'heavy';
      const spacing = intent.spacing || 'normal';

      let prominence = 'balanced';
      if (weight === 'heavy' || weight === 'bold') prominence = 'strong';
      else if (weight === 'light') prominence = 'subtle';

      let readability = 'good';
      if (spacing === 'airy' || spacing === 'expansive') readability = 'excellent';
      else if (spacing === 'tight') readability = 'fair';

      let relationshipWithHeadline = 'supporting';
      if (prominence === 'strong') relationshipWithHeadline = 'potentially competing';

      return { prominence, readability, relationshipWithHeadline };
    },
    buildAIContext(state) {
      return `The user selected the supporting communication object.

Current role: Secondary text element.
Responsible for: providing context and bridging the headline to the rest of the composition.
Current prominence: ${state.prominence}.
Current readability: ${state.readability}.
Current relationship with headline: ${state.relationshipWithHeadline}.`;
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  body: {
    identity: {
      label: 'Body Text',
      semanticName: 'Contextual Narrative Object',
      whatItIs: 'Paragraph text providing detailed context',
      whyItExists: 'Gives the viewer enough information to understand the message fully. Should never compete with the headline.',
    },
    role: {
      type: 'supporting',
      rank: 3,
      responsibilities: ['detail', 'context', 'depth'],
    },
    importance: 'medium',
    controllingSystems: ['typography', 'layout'],
    permissions: {
      canChange: ['scale', 'opacity', 'line height', 'spacing'],
      cannotChange: ['content text — use Copy Assistant'],
      reasoning: 'Body text should remain recessive. If it becomes too prominent, the composition loses its hierarchy.',
    },
    quickActions: [
      { label: 'More Readable', instruction: 'Make the body text more readable and prominent', icon: 'Maximize2' },
      { label: 'Subtler', instruction: 'Make the body text more subtle and recessed', icon: 'Minimize2' },
    ],
    assessState(intent = {}, content = {}) {
      const spacing = intent.spacing || 'normal';
      let readability = 'good';
      if (spacing === 'airy' || spacing === 'expansive') readability = 'excellent';
      else if (spacing === 'tight') readability = 'fair';
      return { readability, role: 'recessive narrative' };
    },
    buildAIContext(state) {
      return `The user selected the contextual narrative object.

Current role: Supporting paragraph text.
Responsible for: providing detail and depth without competing with the headline.
Current readability: ${state.readability}.`;
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  cta: {
    identity: {
      label: 'Call to Action',
      semanticName: 'Conversion Object',
      whatItIs: 'The button or action prompt',
      whyItExists: 'Drives the viewer to act. This is where attention converts to action. Its prominence directly affects conversion.',
    },
    role: {
      type: 'conversion',
      rank: 2,
      responsibilities: ['action', 'conversion', 'direction'],
    },
    importance: 'critical',
    controllingSystems: ['cta', 'layout', 'color'],
    permissions: {
      canChange: ['prominence', 'style', 'scale', 'color treatment'],
      cannotChange: ['content text — use Copy Assistant'],
      reasoning: 'The CTA must balance visibility with hierarchy. Too prominent and it feels aggressive; too subtle and conversions drop.',
    },
    quickActions: [
      { label: 'More Prominent', instruction: 'Make the CTA more prominent and attention-grabbing', icon: 'Maximize2' },
      { label: 'Subtler', instruction: 'Make the CTA more subtle and restrained', icon: 'Minimize2' },
      { label: 'Bolder', instruction: 'Make the CTA feel bolder and more urgent', icon: 'Bold' },
      { label: 'Restyle', instruction: 'Give the CTA a different visual style', icon: 'Sparkles' },
    ],
    assessState(intent = {}, content = {}) {
      const ctaProminence = intent.cta_prominence || 'normal';
      const hierarchy = intent.hierarchy || 'headline_first';
      const decoration = intent.decoration || 'moderate';

      let visibility = 'balanced';
      if (ctaProminence === 'dominant') visibility = 'dominant';
      else if (ctaProminence === 'prominent') visibility = 'prominent';
      else if (ctaProminence === 'subtle') visibility = 'subtle';

      let relationshipWithHeadline = 'harmonious';
      if (hierarchy === 'cta_driven') relationshipWithHeadline = 'CTA leading';
      else if (hierarchy === 'headline_first' && ctaProminence === 'dominant') relationshipWithHeadline = 'competing with headline';
      else if (hierarchy === 'headline_first' && ctaProminence === 'subtle') relationshipWithHeadline = 'headline overshadowing CTA';

      let backgroundNoise = 'clean';
      if (decoration === 'heavy' || decoration === 'maximal') backgroundNoise = 'potentially lost in decoration';

      return { visibility, relationshipWithHeadline, backgroundNoise };
    },
    buildAIContext(state) {
      return `The user selected the conversion object.

Current role: Action driver.
Responsible for: converting attention to action.
Current visibility: ${state.visibility}.
Current relationship with headline: ${state.relationshipWithHeadline}.
Background noise level: ${state.backgroundNoise}.`;
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  badge: {
    identity: {
      label: 'Badge',
      semanticName: 'Categorical Signal Object',
      whatItIs: 'Small label tag above the headline',
      whyItExists: 'Provides instant categorization or context before the viewer reads the headline. Sets expectations.',
    },
    role: {
      type: 'supporting',
      rank: 4,
      responsibilities: ['categorization', 'context setting', 'visual anchor'],
    },
    importance: 'medium',
    controllingSystems: ['decorative', 'layout'],
    permissions: {
      canChange: ['prominence', 'color treatment', 'scale'],
      cannotChange: ['content text — use Copy Assistant'],
      reasoning: 'The badge should be noticed but not dominate. It frames the headline, not replaces it.',
    },
    quickActions: [
      { label: 'More Prominent', instruction: 'Make the badge more prominent and visible', icon: 'Maximize2' },
      { label: 'Subtler', instruction: 'Make the badge more subtle and restrained', icon: 'Minimize2' },
    ],
    assessState(intent = {}, content = {}) {
      const decoration = intent.decoration || 'moderate';
      let visibility = 'balanced';
      if (decoration === 'maximal' || decoration === 'heavy') visibility = 'potentially lost';
      return { visibility, role: 'categorical signal' };
    },
    buildAIContext(state) {
      return `The user selected the categorical signal object.

Current role: Pre-headline label.
Responsible for: setting context before the viewer reads the headline.
Current visibility: ${state.visibility}.`;
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  stat: {
    identity: {
      label: 'Statistic',
      semanticName: 'Evidence Object',
      whatItIs: 'Large number with label and explanation',
      whyItExists: 'Provides quantitative proof. Numbers create instant credibility and can override emotional resistance.',
    },
    role: {
      type: 'evidence',
      rank: 2,
      responsibilities: ['credibility', 'proof', 'visual anchor'],
    },
    importance: 'high',
    controllingSystems: ['layout', 'typography'],
    permissions: {
      canChange: ['dominance', 'scale', 'position in hierarchy'],
      cannotChange: ['content — use content fields'],
      reasoning: 'The statistic can either lead or support. Its relationship with the headline defines the composition\'s persuasion strategy.',
    },
    quickActions: [
      { label: 'More Prominent', instruction: 'Make the statistic more prominent in the composition', icon: 'Maximize2' },
      { label: 'Less Dominant', instruction: 'Make the statistic less dominant, supporting the headline', icon: 'Minimize2' },
      { label: 'Lead with It', instruction: 'Make the statistic the primary focus of the composition', icon: 'ArrowUp' },
    ],
    assessState(intent = {}, content = {}) {
      const hierarchy = intent.hierarchy || 'headline_first';
      let dominance = 'supporting';
      if (hierarchy === 'stat_focused') dominance = 'leading';
      else if (hierarchy === 'headline_first') dominance = 'supporting';
      else dominance = 'balanced';

      let relationshipWithHeadline = 'harmonious';
      if (dominance === 'leading') relationshipWithHeadline = 'stat leading, headline supporting';
      else if (dominance === 'supporting') relationshipWithHeadline = 'headline leading, stat supporting';

      return { dominance, relationshipWithHeadline };
    },
    buildAIContext(state) {
      return `The user selected the evidence object.

Current role: Quantitative proof element.
Responsible for: providing credibility and visual anchor.
Current dominance: ${state.dominance}.
Current relationship with headline: ${state.relationshipWithHeadline}.`;
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  quote: {
    identity: {
      label: 'Quote',
      semanticName: 'Voice Object',
      whatItIs: 'Quotation text with author attribution',
      whyItExists: 'Brings a human voice into the composition. Quotes create emotional connection and lend authority through association.',
    },
    role: {
      type: 'voice',
      rank: 2,
      responsibilities: ['emotional connection', 'authority', 'humanization'],
    },
    importance: 'high',
    controllingSystems: ['layout', 'typography'],
    permissions: {
      canChange: ['prominence', 'treatment', 'editorial style'],
      cannotChange: ['content — use content fields'],
      reasoning: 'The quote can lead or support. Its treatment defines whether the composition feels editorial or promotional.',
    },
    quickActions: [
      { label: 'More Prominent', instruction: 'Make the quote the center of attention', icon: 'Maximize2' },
      { label: 'More Editorial', instruction: 'Give the quote a more editorial, magazine-like treatment', icon: 'Sparkles' },
      { label: 'Subtler', instruction: 'Make the quote more subtle and recessed', icon: 'Minimize2' },
    ],
    assessState(intent = {}, content = {}) {
      const hierarchy = intent.hierarchy || 'headline_first';
      let dominance = 'supporting';
      if (hierarchy === 'quote_centered') dominance = 'leading';
      return { dominance, role: 'human voice' };
    },
    buildAIContext(state) {
      return `The user selected the voice object.

Current role: Quotation with attribution.
Responsible for: emotional connection and authority.
Current dominance: ${state.dominance}.`;
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  signature: {
    identity: {
      label: 'Signature',
      semanticName: 'Personal Mark Object',
      whatItIs: 'Founder signature text',
      whyItExists: 'Adds a personal, human touch. Signals that a real person stands behind the message.',
    },
    role: {
      type: 'ambient',
      rank: 5,
      responsibilities: ['personalization', 'authenticity'],
    },
    importance: 'low',
    controllingSystems: ['typography'],
    permissions: {
      canChange: ['visibility', 'style'],
      cannotChange: ['content text — use Copy Assistant'],
      reasoning: 'The signature should feel like a quiet personal note, not a design element competing for attention.',
    },
    quickActions: [
      { label: 'More Visible', instruction: 'Make the signature more visible', icon: 'Maximize2' },
      { label: 'Subtler', instruction: 'Make the signature more subtle and recessed', icon: 'Minimize2' },
    ],
    assessState() {
      return { role: 'personal mark', visibility: 'ambient' };
    },
    buildAIContext(state) {
      return `The user selected the personal mark object.

Current role: Founder signature.
Responsible for: adding a personal, human touch.
Current visibility: ${state.visibility}.`;
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  logo: {
    identity: {
      label: 'Logo',
      semanticName: 'Brand Identity Object',
      whatItIs: 'The Peanut Gallery brand mark and wordmark',
      whyItExists: 'Anchors the graphic to the brand. Ensures the viewer knows who created this content.',
    },
    role: {
      type: 'brand',
      rank: 4,
      responsibilities: ['brand recognition', 'attribution'],
    },
    importance: 'medium',
    controllingSystems: ['logo'],
    permissions: {
      canChange: ['size', 'position', 'opacity', 'visibility'],
      cannotChange: ['brand identity — the logo itself is fixed'],
      reasoning: 'The logo should be present but never compete with the message. Its job is attribution, not attention.',
    },
    quickActions: [
      { label: 'Smaller', instruction: 'Make the logo smaller and more subtle', icon: 'Minimize2' },
      { label: 'Hidden', instruction: 'Hide the logo entirely', icon: 'Eye' },
      { label: 'Tuck in Corner', instruction: 'Tuck the logo into the corner more discreetly', icon: 'Move' },
      { label: 'More Prominent', instruction: 'Make the logo more prominent and visible', icon: 'Maximize2' },
    ],
    assessState(intent = {}) {
      const logoTreatment = intent.logo_treatment || 'normal';
      let visibility = 'normal';
      if (logoTreatment === 'hidden') visibility = 'hidden';
      else if (logoTreatment === 'minimal') visibility = 'subtle';
      else if (logoTreatment === 'prominent') visibility = 'prominent';
      return { visibility, role: 'brand attribution' };
    },
    buildAIContext(state) {
      return `The user selected the brand identity object.

Current role: Brand mark and wordmark.
Responsible for: brand recognition and attribution.
Current visibility: ${state.visibility}.`;
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  background: {
    identity: {
      label: 'Background',
      semanticName: 'Atmospheric Foundation Object',
      whatItIs: 'The backdrop — color, glow, pattern, atmosphere',
      whyItExists: 'Sets the entire emotional tone before the viewer processes a single word. The background is the stage; everything else is the performance.',
    },
    role: {
      type: 'foundation',
      rank: 0,
      responsibilities: ['mood', 'atmosphere', 'contrast foundation', 'emotional setup'],
    },
    importance: 'high',
    controllingSystems: ['background', 'color'],
    permissions: {
      canChange: ['mood', 'energy', 'darkness', 'atmosphere', 'pattern', 'glow'],
      cannotChange: ['content elements on top'],
      reasoning: 'The background controls the emotional context. Every content element reads differently depending on what sits behind it.',
    },
    quickActions: [
      { label: 'Darker', instruction: 'Make the background darker and moodier', icon: 'Moon' },
      { label: 'More Premium', instruction: 'Make the background feel more premium and restrained', icon: 'Crown' },
      { label: 'More Atmospheric', instruction: 'Make the background more atmospheric with deeper glow', icon: 'Cloud' },
      { label: 'Minimal', instruction: 'Make the background more minimal and clean', icon: 'Square' },
    ],
    assessState(intent = {}) {
      const mood = intent.mood || 'default';
      const energy = intent.energy || 'medium';
      const background = intent.background || 'default';
      const contrast = intent.contrast || 'medium';

      let atmosphere = 'balanced';
      if (background === 'atmospheric' || background === 'dramatic') atmosphere = 'rich';
      else if (background === 'minimal') atmosphere = 'clean';

      let contentSupport = 'good';
      if (contrast === 'low') contentSupport = 'poor — low contrast may hurt readability';
      else if (contrast === 'extreme') contentSupport = 'excellent';

      return { mood, energy, atmosphere, contentSupport };
    },
    buildAIContext(state) {
      return `The user selected the atmospheric foundation object.

Current role: The entire backdrop of the composition.
Responsible for: setting the emotional tone and contrast foundation.
Current mood: ${state.mood}.
Current energy: ${state.energy}.
Current atmosphere: ${state.atmosphere}.
Content support: ${state.contentSupport}.`;
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  decorations: {
    identity: {
      label: 'Decorations',
      semanticName: 'Visual Texture Objects',
      whatItIs: 'Decorative visual elements — lines, shapes, glows, particles',
      whyItExists: 'Adds visual rhythm, energy, and personality. Decorations create the difference between a template and a designed graphic.',
    },
    role: {
      type: 'ambient',
      rank: 5,
      responsibilities: ['visual rhythm', 'energy', 'personality', 'texture'],
    },
    importance: 'medium',
    controllingSystems: ['decorative'],
    permissions: {
      canChange: ['density', 'style', 'energy', 'color'],
      cannotChange: ['content elements'],
      reasoning: 'Decorations should support the composition, not compete with it. Too much decoration kills hierarchy; too little feels sterile.',
    },
    quickActions: [
      { label: 'Less', instruction: 'Reduce the decorative clutter, make it cleaner', icon: 'Minimize2' },
      { label: 'More', instruction: 'Add more decorative energy and visual texture', icon: 'Maximize2' },
      { label: 'More Subtle', instruction: 'Make the decorations more subtle and understated', icon: 'Eye' },
      { label: 'Restyle', instruction: 'Give the decorations a different visual character', icon: 'Sparkles' },
    ],
    assessState(intent = {}) {
      const decoration = intent.decoration || 'moderate';
      const energy = intent.energy || 'medium';

      let density = 'balanced';
      if (decoration === 'minimal') density = 'minimal';
      else if (decoration === 'subtle') density = 'subtle';
      else if (decoration === 'heavy') density = 'heavy';
      else if (decoration === 'maximal') density = 'maximal';

      let relationshipWithContent = 'supporting';
      if (density === 'heavy' || density === 'maximal') relationshipWithContent = 'potentially competing with content';
      else if (density === 'minimal') relationshipWithContent = 'clean, content-forward';

      return { density, energy, relationshipWithContent };
    },
    buildAIContext(state) {
      return `The user selected the visual texture objects.

Current role: Decorative elements throughout the composition.
Responsible for: visual rhythm, energy, and personality.
Current density: ${state.density}.
Current energy: ${state.energy}.
Current relationship with content: ${state.relationshipWithContent}.`;
    },
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────

export function getElementBrain(elementId) {
  return ELEMENT_BRAIN[elementId] || null;
}

export function assessElementState(elementId, intent = {}, content = {}) {
  const brain = ELEMENT_BRAIN[elementId];
  if (!brain) return {};
  return brain.assessState(intent, content);
}

export function buildElementAIContext(elementId, intent = {}, content = {}) {
  const brain = ELEMENT_BRAIN[elementId];
  if (!brain) return `The user selected: ${elementId}`;
  const state = brain.assessState(intent, content);
  return brain.buildAIContext(state);
}

export function getElementQuickActions(elementId) {
  return ELEMENT_BRAIN[elementId]?.quickActions || [];
}

const IMPORTANCE_STYLES = {
  critical: { color: '#FF2D78', label: 'Critical', glow: 'rgba(255,45,120,0.15)' },
  high: { color: '#BF5FFF', label: 'High', glow: 'rgba(191,95,255,0.12)' },
  medium: { color: '#00C8FF', label: 'Medium', glow: 'rgba(0,200,255,0.10)' },
  low: { color: '#00FF87', label: 'Low', glow: 'rgba(0,255,135,0.08)' },
  ambient: { color: '#888888', label: 'Ambient', glow: 'rgba(136,136,136,0.08)' },
};

export function getImportanceStyle(importance) {
  return IMPORTANCE_STYLES[importance] || IMPORTANCE_STYLES.medium;
}

export function getImportanceForElement(elementId) {
  return ELEMENT_BRAIN[elementId]?.importance || 'medium';
}