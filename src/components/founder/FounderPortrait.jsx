import { FOUNDER_PORTRAIT_URL, FOUNDER_PORTRAIT_OBJECT_POSITION, FOUNDER_PORTRAIT_ALT } from '@/lib/founderAssets';

/**
 * FounderPortrait — small circular portrait of the founder.
 *
 * Displays the founder image with object-position to tightly crop around
 * the face. Falls back to a gradient circle with initials when no image URL
 * is configured. Eager-loaded (never lazy).
 *
 * @param {number} size - diameter in pixels (default 72)
 */
export default function FounderPortrait({ size = 72 }) {
  const hasImage = Boolean(FOUNDER_PORTRAIT_URL);

  return (
    <div
      className="rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center"
      style={{
        width: size,
        height: size,
        background: hasImage ? 'hsl(var(--muted))' : 'linear-gradient(135deg, #BF5FFF, #FF2D78)',
        border: '2px solid hsl(var(--background))',
        boxShadow: '0 0 20px rgba(191,95,255,0.3)',
      }}
    >
      {hasImage ? (
        <img
          src={FOUNDER_PORTRAIT_URL}
          alt={FOUNDER_PORTRAIT_ALT}
          className="w-full h-full object-cover"
          style={{ objectPosition: FOUNDER_PORTRAIT_OBJECT_POSITION }}
        />
      ) : (
        <span
          role="img"
          aria-label={FOUNDER_PORTRAIT_ALT}
          className="font-display text-white"
          style={{ fontSize: size * 0.35 }}
        >
          MW
        </span>
      )}
    </div>
  );
}