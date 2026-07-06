/**
 * Creative Strategies
 * --------------------------------------------------------------------
 * Decision 1 of 3: What is this post trying to accomplish?
 *
 * The strategy is the INTENT — not the visual.
 * It answers "why does this post exist?" before "what should it look like?"
 *
 * The AI Creative Director determines this independently from
 * the concept and execution style, then uses all three together.
 */
export const CREATIVE_STRATEGIES = [
  {
    id: 'announcement',
    name: 'Announcement',
    description: 'Declare something new — a feature, event, or change.',
    signals: ['new', 'introducing', 'launching', 'announcing', 'now available', 'here'],
    suitableEmotions: ['excitement', 'anticipation', 'urgency'],
  },
  {
    id: 'education',
    name: 'Education',
    description: 'Teach the audience something they did not know.',
    signals: ['how to', 'guide', 'tip', 'learn', 'understand', 'why', 'what is'],
    suitableEmotions: ['clarity', 'confidence', 'trust'],
  },
  {
    id: 'storytelling',
    name: 'Storytelling',
    description: 'Narrate a journey, a moment, or a transformation.',
    signals: ['story', 'journey', 'when we', 'it started', 'remember', 'back then'],
    suitableEmotions: ['empathy', 'nostalgia', 'inspiration'],
  },
  {
    id: 'community',
    name: 'Community',
    description: 'Build belonging, celebrate fans, amplify voices.',
    signals: ['community', 'together', 'fans', 'family', 'join', 'us', 'our'],
    suitableEmotions: ['belonging', 'pride', 'warmth'],
  },
  {
    id: 'product_launch',
    name: 'Product Launch',
    description: 'Reveal a new product or capability to the world.',
    signals: ['launch', 'shipping', 'release', 'v2', 'new product', 'now live'],
    suitableEmotions: ['excitement', 'anticipation', 'premium'],
  },
  {
    id: 'feature_spotlight',
    name: 'Feature Spotlight',
    description: 'Highlight a specific capability and why it matters.',
    signals: ['feature', 'spotlight', 'did you know', 'you can', 'try this'],
    suitableEmotions: ['discovery', 'clarity', 'confidence'],
  },
  {
    id: 'industry_commentary',
    name: 'Industry Commentary',
    description: 'Take a stand on an industry problem or truth.',
    signals: ['industry', 'broken', 'problem', 'truth', 'enough', 'its time', 'we deserve'],
    suitableEmotions: ['conviction', 'frustration', 'resolve'],
  },
  {
    id: 'founder_update',
    name: 'Founder Update',
    description: 'A personal message from the team — vision, progress, gratitude.',
    signals: ['we built', 'our mission', 'thank you', 'from the founder', 'personal note'],
    suitableEmotions: ['authenticity', 'trust', 'intimacy'],
  },
  {
    id: 'investor_communication',
    name: 'Investor Communication',
    description: 'Data-backed proof of traction, growth, or market position.',
    signals: ['growth', 'traction', 'revenue', 'users', 'market', 'metrics'],
    suitableEmotions: ['confidence', 'authority', 'trust'],
  },
  {
    id: 'hype',
    name: 'Hype',
    description: 'Build raw excitement — something big is coming.',
    signals: ['coming soon', 'get ready', 'big things', 'wait for it', 'tomorrow'],
    suitableEmotions: ['excitement', 'anticipation', 'urgency'],
  },
  {
    id: 'trust_building',
    name: 'Trust Building',
    description: 'Prove reliability, safety, or social proof.',
    signals: ['trusted', 'verified', 'safe', 'secure', 'guaranteed', 'proven'],
    suitableEmotions: ['trust', 'security', 'confidence'],
  },
];

export function getStrategyById(id) {
  return CREATIVE_STRATEGIES.find(s => s.id === id);
}