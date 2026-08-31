import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import FounderFeature from '@/components/founder/FounderFeature';
import { FOUNDER_PHOTOS } from '@/lib/founderAssets';

const MONO = { fontFamily: 'var(--font-mono-label)' };
const EDITORIAL = { fontFamily: 'var(--font-editorial)' };
const SERIF_ITALIC = { fontFamily: 'var(--font-serif-italic)' };
const BODY = { fontSize: '17px', lineHeight: 1.7 };

const PHOTO_STYLE = { borderRadius: '0.25rem', border: '1px solid hsl(var(--border))' };

export default function OurStory() {
  const navigate = useNavigate();

  return (
    <div
      className="dark:rave-bg grain-overlay"
      style={{ height: '100dvh', overflowY: 'auto', overflowX: 'hidden' }}
    >
      {/* ── Sticky header ── */}
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

      {/* ── Content ── */}
      <div
        className="relative max-w-md mx-auto"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 4rem)' }}
      >
        {/* ═══ Hero ═══ */}
        <section className="px-6 pt-12 pb-8">
          <div
            className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-4"
            style={MONO}
          >
            Our Story
          </div>
          <h2
            className="font-bold leading-[0.95] text-foreground"
            style={{ ...EDITORIAL, fontSize: 'clamp(2.5rem, 11vw, 3.5rem)' }}
          >
            Built from<br />the stands.
          </h2>
        </section>

        {/* ═══ Typography lockup (no portrait) ═══ */}
        <section className="px-6 pb-10">
          <div
            className="font-bold text-foreground"
            style={{ ...EDITORIAL, fontSize: 'clamp(1.5rem, 7vw, 2rem)', lineHeight: 1.1 }}
          >
            Miles Wallace
          </div>
          <div
            className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground mt-1.5"
            style={MONO}
          >
            Founder
          </div>
        </section>

        <div className="stub-perf-h mx-6" />

        {/* ═══ Chapter 1: Intro ═══ */}
        <section className="px-6 py-8 space-y-5">
          <p style={BODY} className="text-foreground">Hi, fans.</p>
          <p style={BODY} className="text-foreground">
            My name is Miles Wallace, and Peanut Gallery is the passion project of all passion projects.
          </p>
          <p style={BODY} className="text-foreground">
            Ever since I was a little kid, I needed an event on the calendar—something to count down to and look forward to. As I grew up, I became obsessed with everything live: sports, concerts, festivals, professional wrestling—anything capable of creating a moment you could never experience the same way again.
          </p>
          <p style={BODY} className="text-foreground">
            The more events I attended, the more I realized how much being close to the action changes the memory you take home.
          </p>
        </section>

        {/* ═══ Fan Before Founder — flowing photo essay ═══ */}
        <section className="px-6 pb-10">
          <div
            className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-6"
            style={MONO}
          >
            Fan Before Founder
          </div>

          {/* Photo 1: full-width (childhood) */}
          <figure
            className="relative mb-6"
            style={{ transform: `rotate(${FOUNDER_PHOTOS[0].rotation}deg)` }}
          >
            <img
              src={FOUNDER_PHOTOS[0].url}
              alt={FOUNDER_PHOTOS[0].alt}
              loading="lazy"
              className="w-full h-auto block select-none"
              style={PHOTO_STYLE}
            />
          </figure>

          {/* Photos 2-3: natural-width pair */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <figure style={{ transform: `rotate(${FOUNDER_PHOTOS[1].rotation}deg)` }}>
              <img
                src={FOUNDER_PHOTOS[1].url}
                alt={FOUNDER_PHOTOS[1].alt}
                loading="lazy"
                className="w-full h-auto block select-none"
                style={PHOTO_STYLE}
              />
            </figure>
            <figure style={{ transform: `rotate(${FOUNDER_PHOTOS[2].rotation}deg)` }}>
              <img
                src={FOUNDER_PHOTOS[2].url}
                alt={FOUNDER_PHOTOS[2].alt}
                loading="lazy"
                className="w-full h-auto block select-none"
                style={PHOTO_STYLE}
              />
            </figure>
          </div>

          {/* Photo 4: full-width (wrestling) */}
          <figure
            className="relative mb-6"
            style={{ transform: `rotate(${FOUNDER_PHOTOS[3].rotation}deg)` }}
          >
            <img
              src={FOUNDER_PHOTOS[3].url}
              alt={FOUNDER_PHOTOS[3].alt}
              loading="lazy"
              className="w-full h-auto block select-none"
              style={PHOTO_STYLE}
            />
          </figure>

          {/* Photo 5: full-width (later fandom) */}
          <figure
            className="relative"
            style={{ transform: `rotate(${FOUNDER_PHOTOS[4].rotation}deg)` }}
          >
            <img
              src={FOUNDER_PHOTOS[4].url}
              alt={FOUNDER_PHOTOS[4].alt}
              loading="lazy"
              className="w-full h-auto block select-none"
              style={PHOTO_STYLE}
            />
          </figure>
        </section>

        <div className="stub-perf-h mx-6" />

        {/* ═══ Chapter 2: WrestleMania ═══ */}
        <section className="px-6 py-8 space-y-5">
          <p style={BODY} className="text-foreground">
            That realization came to a head at WrestleMania 42 in Las Vegas. I had paid an absurd amount of money for a seat in the nosebleeds. From up there, I could see entire stretches of incredible seats sitting empty—seats that might as well have cost my life savings.
          </p>
          <p style={BODY} className="text-foreground">
            I remember looking down and thinking:
          </p>
          {/* ── Pull quote 1 ── */}
          <blockquote
            className="italic text-foreground py-2"
            style={{ ...SERIF_ITALIC, fontSize: 'clamp(1.25rem, 5.5vw, 1.75rem)', lineHeight: 1.3 }}
          >
            Why am I paying this much to sit this far away while some of the best views in the building are going to waste?
          </blockquote>
          <p style={BODY} className="text-foreground">
            I couldn&rsquo;t let that question go.
          </p>
          <p style={BODY} className="text-foreground">
            What if fans already inside could move closer in real time? What if an empty premium seat could become someone&rsquo;s favorite memory? What if a better experience didn&rsquo;t require paying a ridiculous price months before the event?
          </p>
          <p style={BODY} className="text-foreground">
            And then came the biggest question: If this idea makes so much sense, why hasn&rsquo;t one of the major ticketing apps already built it?
          </p>
        </section>

        {/* ═══ Chapter 3: The answer ═══ */}
        <section className="px-6 py-8 space-y-5">
          <p style={BODY} className="text-foreground">
            The answer became clear. Major ticketing platforms were built to sell access before an event. Once your ticket scans and you enter the building, their job is effectively over. Meanwhile, fans are still dealing with excessive fees, scalping, unused seats, loyalty programs based on spending, and platforms that treat the transaction as more important than the experience.
          </p>
        </section>

        {/* ═══ Pull quote 2 (oversized) ═══ */}
        <section className="px-6 py-10">
          <blockquote
            className="italic text-foreground"
            style={{ ...SERIF_ITALIC, fontSize: 'clamp(1.75rem, 8vw, 2.5rem)', lineHeight: 1.2 }}
          >
            It could have been done. It just wasn&rsquo;t valuable enough to the companies controlling ticketing.
            <span className="block mt-3" style={{ color: 'var(--neon-cyan)' }}>
              It was valuable to fans.
            </span>
          </blockquote>
        </section>

        {/* ═══ Chapter 4: That is why ═══ */}
        <section className="px-6 py-8 space-y-5">
          <p style={BODY} className="text-foreground">
            That is why I started Peanut Gallery.
          </p>
          <p style={BODY} className="text-foreground">
            Peanut Gallery is not another version of the same ticket marketplace. It is being built to solve the problems those marketplaces created, accepted, or left behind.
          </p>
        </section>

        <div className="stub-perf-h mx-6" />

        {/* ═══ Features ═══ */}
        <section className="px-6 py-10">
          <div
            className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-6"
            style={MONO}
          >
            The Manifesto
          </div>
          <div className="space-y-6">
            <FounderFeature
              label="Live Upgrades"
              body="A real-time marketplace built specifically for fans who are already inside the event. Better seats no longer have to sit empty while other fans watch from farther away."
              accent="cyan"
            />
            <FounderFeature
              label="Venue-Verified Access"
              body="Location safeguards are designed to keep Live Upgrades inside the venue and out of the hands of outside scalpers trying to turn them into inventory."
              accent="magenta"
            />
            <FounderFeature
              label="Protected Payments"
              body="Payment is not treated as complete until the upgrade process is confirmed, giving fans protection that informal seat-swapping could never provide."
              accent="green"
            />
            <FounderFeature
              label="Fan Drops"
              body="Fans can win upgraded experiences for free. The best moment in the building should not always belong to whoever has the most money."
              accent="cyan"
            />
            <FounderFeature
              label="The Fan Zone"
              body="A live, event-specific home for fans to share photos, videos, reactions, and everything happening around the venue—not hours later on an unrelated social platform."
              accent="magenta"
            />
            <FounderFeature
              label="Fan Points"
              body="A rewards system based on being an active, trustworthy fan—not on how much money you can pump into the app."
              accent="green"
            />
            <FounderFeature
              label="The Lowest Fees on the Market"
              body="Peanut Gallery was not built to bury fans beneath the same fees they already hate. Keeping the platform affordable is not a promotion. It is part of its foundation."
              accent="cyan"
            />
          </div>
        </section>

        <div className="stub-perf-h mx-6" />

        {/* ═══ Closing ═══ */}
        <section className="px-6 py-10 space-y-5">
          <p style={BODY} className="text-foreground">
            These are not minor additions to the traditional resale model. Together, they create something the major ticketing apps have never offered: a platform centered on improving the fan&rsquo;s experience after the event has already begun.
          </p>
          <p style={BODY} className="text-foreground">
            Every part of Peanut Gallery is being built around the questions I have asked, the frustrations I have felt, and the features I have always wished existed as a fan. And because this platform will handle people&rsquo;s tickets, payments, and once-in-a-lifetime moments, earning your trust has to be part of the product—not an afterthought.
          </p>
          <p style={BODY} className="text-foreground">
            The future of live events should not be decided only by the biggest ticketing companies or the fans with the biggest wallets.
          </p>
          <p
            className="font-bold text-foreground"
            style={{ ...EDITORIAL, fontSize: 'clamp(1.5rem, 6vw, 2rem)', lineHeight: 1.15 }}
          >
            It should be built around all of us.
          </p>
          <p style={BODY} className="text-foreground">
            From one fan to another, welcome to the Gallery.
          </p>
        </section>

        {/* ═══ Signature ═══ */}
        <section className="px-6 pb-8">
          <div className="text-[13px] text-muted-foreground" style={MONO}>
            — Miles Wallace
          </div>
          <div
            className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mt-1"
            style={MONO}
          >
            Founder, Peanut Gallery
          </div>
        </section>
      </div>
    </div>
  );
}