import { Calendar } from 'lucide-react';

/**
 * Premium event thumbnail with graceful fallback.
 * Never shows a broken/placeholder image — falls back to a branded dark card.
 */
export default function EventThumbnail({ event, className = '', style = {} }) {
  const hasImage = !!event.image_url;

  if (hasImage) {
    return (
      <div className={`relative overflow-hidden ${className}`} style={style}>
        <img
          src={event.image_url}
          alt={event.title}
          className="w-full h-full object-cover absolute inset-0"
          onError={(e) => {
            // Hide broken image, show fallback sibling
            e.currentTarget.style.display = 'none';
            e.currentTarget.nextSibling?.style.setProperty('display', 'flex');
          }}
        />
        {/* Hidden fallback — revealed on image error */}
        <div
          className="w-full h-full absolute inset-0 items-center justify-center flex-col gap-1"
          style={{ display: 'none', background: 'linear-gradient(135deg, hsl(var(--card)) 0%, hsl(var(--muted)) 100%)' }}
        >
          <EventInitials event={event} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden flex items-center justify-center flex-col gap-1 ${className}`}
      style={{ background: 'linear-gradient(135deg, hsl(var(--card)) 0%, hsl(var(--muted)) 100%)', ...style }}
    >
      <EventInitials event={event} />
    </div>
  );
}

function EventInitials({ event }) {
  // Get 1–2 meaningful initials from title
  const words = (event.title || '').split(' ').filter(w => w.length > 2);
  const initials = words.length >= 2
    ? (words[0][0] + words[1][0]).toUpperCase()
    : (event.title || '?').slice(0, 2).toUpperCase();

  return (
    <>
      <span
        className="font-display text-xl leading-none select-none"
        style={{ color: 'hsl(var(--muted-foreground))', opacity: 0.5 }}
      >
        {initials}
      </span>
      <Calendar className="w-3 h-3 opacity-20" style={{ color: 'hsl(var(--muted-foreground))' }} />
    </>
  );
}