/**
 * FounderFeature — ticket-stub style feature manifesto card.
 *
 * Each feature gets a distinct accent color (cyan, magenta, or acid-green)
 * and a monospace label. The accent bar on the left reinforces the
 * ticket-stub aesthetic.
 */

const ACCENTS = {
  cyan: 'var(--neon-cyan)',
  magenta: 'var(--neon-pink)',
  green: 'var(--neon-green)',
};

export default function FounderFeature({ label, body, accent = 'cyan' }) {
  const color = ACCENTS[accent] || ACCENTS.cyan;

  return (
    <div className="relative pl-4 py-1">
      <div
        className="absolute left-0 top-0 bottom-0 w-1 rounded-full"
        style={{ background: color }}
      />
      <div
        className="text-[10px] uppercase tracking-[0.2em] mb-1.5"
        style={{ fontFamily: 'var(--font-mono-label)', color }}
      >
        {label}
      </div>
      <p className="text-[13px] leading-relaxed text-foreground">{body}</p>
    </div>
  );
}