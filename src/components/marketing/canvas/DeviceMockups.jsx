/**
 * Device Mockups — frames for placing screenshots inside devices.
 * Each mockup is an inline-style component (for html2canvas).
 * All use the same PG design language: dark, glass, neon accents.
 *
 * Mockups: iPhone, Laptop, Billboard, Jumbotron, FloatingCard,
 *          WebsiteHero, InstagramPost, PresentationSlide
 */
import { FONTS, NEON, NEON_RGB, TEXT, SHADOWS } from '@/lib/marketingTokens';

/** iPhone mockup — screenshot inside a phone frame. */
export function IPhoneMockup({ u = 1, src, style }) {
  if (!src) return null;
  const phoneW = 600 * u;
  const phoneH = 1200 * u;
  return (
    <div style={{
      width: phoneW, height: phoneH,
      borderRadius: 50 * u,
      background: '#0a0a0a',
      border: `${4 * u}px solid rgba(255,255,255,0.15)`,
      padding: 12 * u,
      boxShadow: SHADOWS.screenshot,
      position: 'relative',
      ...style,
    }}>
      {/* Notch */}
      <div style={{
        position: 'absolute', top: 12 * u, left: '50%', transform: 'translateX(-50%)',
        width: 180 * u, height: 28 * u, borderRadius: 14 * u,
        background: '#000', zIndex: 2,
      }} />
      <img src={src} alt="" crossOrigin="anonymous" style={{
        width: '100%', height: '100%', borderRadius: 40 * u,
        objectFit: 'cover', display: 'block',
      }} />
    </div>
  );
}

/** Laptop mockup — screenshot inside a laptop screen. */
export function LaptopMockup({ u = 1, src, style }) {
  if (!src) return null;
  const screenW = 800 * u;
  const screenH = 500 * u;
  return (
    <div style={{ ...style }}>
      {/* Screen */}
      <div style={{
        width: screenW, height: screenH,
        borderRadius: 16 * u,
        background: '#0a0a0a',
        border: `${4 * u}px solid rgba(255,255,255,0.12)`,
        padding: 8 * u,
        boxShadow: SHADOWS.screenshot,
        overflow: 'hidden',
      }}>
        <img src={src} alt="" crossOrigin="anonymous" style={{
          width: '100%', height: '100%', borderRadius: 8 * u,
          objectFit: 'cover', display: 'block',
        }} />
      </div>
      {/* Base */}
      <div style={{
        width: screenW * 1.1, height: 20 * u, margin: '0 auto',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))',
        borderRadius: `0 0 ${12 * u}px ${12 * u}px`,
        border: `${2 * u}px solid rgba(255,255,255,0.08)`,
        borderTop: 'none',
      }} />
    </div>
  );
}

/** Billboard mockup — large outdoor display. */
export function BillboardMockup({ u = 1, src, style }) {
  if (!src) return null;
  return (
    <div style={{ ...style }}>
      {/* Frame */}
      <div style={{
        padding: 16 * u,
        background: 'rgba(0,0,0,0.6)',
        border: `${6 * u}px solid rgba(255,255,255,0.1)`,
        borderRadius: 8 * u,
        boxShadow: SHADOWS.screenshot,
      }}>
        <img src={src} alt="" crossOrigin="anonymous" style={{
          width: 900 * u, height: 500 * u,
          objectFit: 'cover', display: 'block', borderRadius: 4 * u,
        }} />
      </div>
      {/* Support legs */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 200 * u, marginTop: -2 * u }}>
        <div style={{ width: 12 * u, height: 150 * u, background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ width: 12 * u, height: 150 * u, background: 'rgba(255,255,255,0.08)' }} />
      </div>
    </div>
  );
}

/** Jumbotron mockup — stadium screen with glow. */
export function JumbotronMockup({ u = 1, src, style }) {
  if (!src) return null;
  return (
    <div style={{ ...style }}>
      <div style={{
        padding: 20 * u,
        background: 'rgba(0,0,0,0.7)',
        border: `${8 * u}px solid rgba(191,95,255,0.2)`,
        borderRadius: 12 * u,
        boxShadow: `0 0 ${60 * u}px rgba(191,95,255,0.15), ${SHADOWS.screenshot}`,
      }}>
        <img src={src} alt="" crossOrigin="anonymous" style={{
          width: 800 * u, height: 450 * u,
          objectFit: 'cover', display: 'block',
        }} />
      </div>
    </div>
  );
}

/** Dark floating card — screenshot in a glass card. */
export function FloatingCardMockup({ u = 1, src, style }) {
  if (!src) return null;
  return (
    <div style={{
      padding: 24 * u,
      borderRadius: 24 * u,
      background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%)',
      border: `1px solid rgba(255,255,255,0.12)`,
      boxShadow: SHADOWS.screenshot,
      ...style,
    }}>
      <img src={src} alt="" crossOrigin="anonymous" style={{
        width: '100%', maxWidth: 700 * u,
        borderRadius: 12 * u, objectFit: 'cover', display: 'block',
      }} />
    </div>
  );
}

/** Website hero — browser chrome frame. */
export function WebsiteHeroMockup({ u = 1, src, style }) {
  if (!src) return null;
  return (
    <div style={{
      borderRadius: 16 * u, overflow: 'hidden',
      border: `1px solid rgba(255,255,255,0.12)`,
      boxShadow: SHADOWS.screenshot,
      ...style,
    }}>
      {/* Browser bar */}
      <div style={{
        height: 40 * u, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', gap: 8 * u, padding: `0 ${16 * u}px`,
      }}>
        <div style={{ width: 12 * u, height: 12 * u, borderRadius: '50%', background: 'rgba(255,45,120,0.4)' }} />
        <div style={{ width: 12 * u, height: 12 * u, borderRadius: '50%', background: 'rgba(255,230,0,0.4)' }} />
        <div style={{ width: 12 * u, height: 12 * u, borderRadius: '50%', background: 'rgba(0,255,135,0.4)' }} />
        <div style={{
          flex: 1, marginLeft: 16 * u, height: 20 * u, borderRadius: 4 * u,
          background: 'rgba(255,255,255,0.05)',
        }} />
      </div>
      <img src={src} alt="" crossOrigin="anonymous" style={{
        width: 900 * u, height: 500 * u,
        objectFit: 'cover', display: 'block',
      }} />
    </div>
  );
}

/** Instagram post mockup — phone with IG UI. */
export function InstagramPostMockup({ u = 1, src, style }) {
  if (!src) return null;
  return (
    <div style={{
      width: 500 * u, borderRadius: 24 * u, overflow: 'hidden',
      background: '#0a0a0a', border: `${3 * u}px solid rgba(255,255,255,0.1)`,
      boxShadow: SHADOWS.screenshot, ...style,
    }}>
      {/* IG header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10 * u, padding: 16 * u,
      }}>
        <div style={{ width: 36 * u, height: 36 * u, borderRadius: '50%', background: `linear-gradient(135deg, ${NEON.purple}, ${NEON.pink})` }} />
        <div>
          <p style={{ fontFamily: FONTS.body, fontSize: 14 * u, fontWeight: 700, color: TEXT.white, margin: 0 }}>peanutgallery</p>
        </div>
      </div>
      <img src={src} alt="" crossOrigin="anonymous" style={{
        width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block',
      }} />
      {/* IG actions */}
      <div style={{ display: 'flex', gap: 16 * u, padding: 16 * u }}>
        <span style={{ fontSize: 24 * u }}>❤️</span>
        <span style={{ fontSize: 24 * u }}>💬</span>
        <span style={{ fontSize: 24 * u }}>📤</span>
      </div>
    </div>
  );
}

/** Presentation slide — 16:9 with slide chrome. */
export function PresentationSlideMockup({ u = 1, src, style }) {
  if (!src) return null;
  return (
    <div style={{
      padding: 20 * u,
      background: 'rgba(0,0,0,0.5)',
      borderRadius: 12 * u,
      border: `1px solid rgba(255,255,255,0.08)`,
      boxShadow: SHADOWS.screenshot,
      ...style,
    }}>
      <img src={src} alt="" crossOrigin="anonymous" style={{
        width: 960 * u, height: 540 * u,
        objectFit: 'cover', display: 'block', borderRadius: 4 * u,
      }} />
    </div>
  );
}

export const MOCKUP_TYPES = {
  iphone: { label: 'iPhone', Component: IPhoneMockup },
  laptop: { label: 'Laptop', Component: LaptopMockup },
  billboard: { label: 'Billboard', Component: BillboardMockup },
  jumbotron: { label: 'Jumbotron', Component: JumbotronMockup },
  floating_card: { label: 'Floating Card', Component: FloatingCardMockup },
  website_hero: { label: 'Website Hero', Component: WebsiteHeroMockup },
  instagram_post: { label: 'Instagram Post', Component: InstagramPostMockup },
  presentation: { label: 'Presentation', Component: PresentationSlideMockup },
};