import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import FounderPortrait from '@/components/founder/FounderPortrait';
import { FOUNDER_PHOTOS } from '@/lib/founderAssets';

export default function OurStory() {
  const navigate = useNavigate();

  return (
    <div className="dark:rave-bg" style={{ height: '100dvh', overflowY: 'auto' }}>
      {/* Header */}
      <div
        className="sticky top-0 z-20 frosted-bar border-b border-border"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}
      >
        <div className="flex items-center gap-3 px-4 pb-3">
          <button
            onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
            aria-label="Go back"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="font-display text-xl text-foreground">Our Story</h1>
        </div>
      </div>

      {/* Content */}
      <div
        className="px-5 py-8 max-w-2xl mx-auto"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 5rem)' }}
      >
        {/* Portrait */}
        <div className="flex justify-center mb-6">
          <FounderPortrait size={96} />
        </div>

        {/* Tagline */}
        <h2 className="font-display text-2xl text-center mb-8 gradient-text-purple">
          Built from the stands.
        </h2>

        {/* Story body */}
        <div className="space-y-5 text-sm leading-relaxed text-foreground">
          <p>
            I&rsquo;m Miles Wallace, founder of Peanut Gallery. I&rsquo;ve spent my life in the
            crowd&mdash;at baseball and basketball games, wrestling shows, concerts, and anywhere a
            great live moment could happen.
          </p>
          <p>
            Peanut Gallery started with a simple question: if better seats become available after an
            event begins, why should they stay empty while fans already inside would love the chance
            to move closer?
          </p>
          <p>
            I&rsquo;m building a responsible fan-to-fan way to make those moments possible. Peanut
            Gallery is being built by a fan, for fans&mdash;and earning your trust is part of the
            product, not an afterthought.
          </p>
        </div>

        {/* Signature */}
        <p className="text-sm font-bold text-foreground mt-6">&mdash; Miles</p>

        {/* "Fan before founder" section — reserved for original photos.
            We will add original photos later. No empty cards or
            screenshot-quality event images are rendered until
            FOUNDER_PHOTOS is populated. */}
        {FOUNDER_PHOTOS.length > 0 && (
          <section className="mt-10">
            <h3 className="font-display text-lg text-foreground mb-4">Fan before founder</h3>
            <div className="space-y-4">
              {FOUNDER_PHOTOS.map((photo, i) => (
                <figure key={i}>
                  <img src={photo.url} alt={photo.alt} className="rounded-2xl w-full" />
                  {photo.caption && (
                    <figcaption className="text-xs text-muted-foreground mt-2">
                      {photo.caption}
                    </figcaption>
                  )}
                </figure>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}