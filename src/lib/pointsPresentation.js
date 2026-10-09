// Text inks are separate from the bright decorative rank/bar palette.
// Keep these scoped to the points card so dark artwork elsewhere is unchanged.
const TONES = {
  '#8A8A8A': 'neutral', '#00C8FF': 'cyan', '#00FF87': 'green',
  '#BF5FFF': 'purple', '#FF8C00': 'orange', '#FF2D78': 'pink', '#FFE600': 'yellow',
};

export function pointTextColor(accent) {
  return `var(--pg-points-${TONES[String(accent).toUpperCase()] || 'neutral'})`;
}
