/**
 * FounderPhotoCard — editorial photo card for the "Fan Before Founder" sequence.
 *
 * Displays a tightly cropped photo with a monospace label and a subtle
 * 1-2° rotation for an intentionally irregular, scrapbook feel.
 * Images are lazy-loaded.
 */
export default function FounderPhotoCard({ photo }) {
  return (
    <figure className="relative" style={{ transform: `rotate(${photo.rotation}deg)` }}>
      <div
        className="overflow-hidden"
        style={{
          aspectRatio: '4 / 5',
          borderRadius: '0.5rem',
          border: '1px solid hsl(var(--border))',
          background: 'hsl(var(--muted))',
        }}
      >
        <img
          src={photo.url}
          alt={photo.alt}
          loading="lazy"
          className="w-full h-full object-cover"
          style={{ objectPosition: photo.objectPosition }}
        />
      </div>
      <figcaption
        className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mt-2 px-1"
        style={{ fontFamily: 'var(--font-mono-label)' }}
      >
        {photo.label}
      </figcaption>
    </figure>
  );
}