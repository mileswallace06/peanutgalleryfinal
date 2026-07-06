/**
 * Graphic Type Layouts
 * --------------------------------------------------------------------
 * Each layout is a function ({ content, u, w, h }) => JSX.
 * The system chooses the layout based on graphic_type — the user
 * never positions elements. Every layout uses PG brand components
 * to guarantee visual consistency with the onboarding design.
 *
 * `u` = canvasWidth / 1080 — all sizes scale proportionally.
 */
import {
  PGLogo, PGHeadline, PGSubheadline, PGBody, PGCTA, PGBadge,
  PGGlassCard, PGScreenshotFrame, PGDivider, PGGlow, PGStatBlock,
  PG_COLORS,
} from './PGBrand';

const PAD = 70; // base padding at u=1

function Footer({ u, h }) {
  return (
    <div style={{
      position: 'absolute', bottom: 50 * u, left: PAD * u, right: PAD * u,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }}>
      <PGLogo u={u} size="sm" />
      <span style={{
        fontFamily: "'DM Sans', sans-serif", fontSize: 18 * u, fontWeight: 500,
        color: PG_COLORS.faint, letterSpacing: '0.05em',
      }}>@peanutgallery</span>
    </div>
  );
}

/** Industry Truth — badge + huge headline + supporting copy, minimal. */
function IndustryTruth({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: PAD * u, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <PGGlow u={u} color="191,95,255" size={400} style={{ top: '10%', left: '60%' }} />
      <PGGlow u={u} color="0,200,255" size={350} style={{ bottom: '15%', left: '5%' }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        {content.badge && <PGBadge u={u} color={PG_COLORS.cyan} style={{ marginBottom: 30 * u }}>{content.badge}</PGBadge>}
        <PGHeadline u={u} broken style={{ marginBottom: 24 * u }}>{content.headline}</PGHeadline>
        {content.subheadline && <PGSubheadline u={u} color={PG_COLORS.muted} style={{ maxWidth: '85%' }}>{content.subheadline}</PGSubheadline>}
      </div>
      <Footer u={u} h={h} />
    </div>
  );
}

/** Feature Spotlight — badge, headline, paragraph, screenshot, accents. */
function FeatureSpotlight({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: PAD * u, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <PGGlow u={u} color="0,200,255" size={400} style={{ top: '5%', right: '10%' }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        {content.badge && <PGBadge u={u} color={PG_COLORS.purple} style={{ marginBottom: 24 * u }}>{content.badge}</PGBadge>}
        <PGHeadline u={u} style={{ marginBottom: 18 * u, fontSize: '60px' }}>{content.headline}</PGHeadline>
        {content.body && <PGBody u={u} style={{ maxWidth: '85%', marginBottom: 24 * u }}>{content.body}</PGBody>}
      </div>
      {content.image_url && (
        <div style={{ position: 'relative', zIndex: 1, marginBottom: 20 * u }}>
          <PGScreenshotFrame u={u} src={content.image_url} />
        </div>
      )}
      {content.cta && (
        <div style={{ position: 'relative', zIndex: 1, marginBottom: 30 * u }}>
          <PGCTA u={u}>{content.cta}</PGCTA>
        </div>
      )}
      <Footer u={u} h={h} />
    </div>
  );
}

/** Statistic — huge number, supporting sentence, tiny explanation. */
function Statistic({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: PAD * u, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <PGGlow u={u} color="0,255,135" size={450} style={{ top: '20%', left: '50%', transform: 'translateX(-50%)' }} />
      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
        {content.badge && <PGBadge u={u} color={PG_COLORS.green} style={{ marginBottom: 36 * u }}>{content.badge}</PGBadge>}
        <PGStatBlock
          u={u}
          number={content.stat_number || '0'}
          label={content.stat_label}
          explanation={content.stat_explanation}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
        />
      </div>
      <Footer u={u} h={h} />
    </div>
  );
}

/** Quote — huge quote text, author, lots of whitespace. */
function Quote({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: PAD * u, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <PGGlow u={u} color="191,95,255" size={400} style={{ top: '10%', left: '10%' }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <span style={{
          fontFamily: "'Black Han Sans', Impact, sans-serif",
          fontSize: 160 * u, lineHeight: 0.7,
          color: 'rgba(191,95,255,0.25)', display: 'block', marginBottom: 10 * u,
        }}>“</span>
        <p style={{
          fontFamily: "'DM Sans', sans-serif", fontSize: 42 * u, fontWeight: 600,
          lineHeight: 1.35, color: '#ffffff', margin: 0, marginBottom: 30 * u,
        }}>{content.quote_text || content.headline}</p>
        {content.author && (
          <p style={{
            fontFamily: "'DM Sans', sans-serif", fontSize: 26 * u, fontWeight: 500,
            color: PG_COLORS.cyan, margin: 0,
          }}>— {content.author}</p>
        )}
      </div>
      <Footer u={u} h={h} />
    </div>
  );
}

/** Announcement — badge, headline, subheadline, CTA. */
function Announcement({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: PAD * u, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <PGGlow u={u} color="255,45,120" size={400} style={{ top: '15%', right: '15%' }} />
      <PGGlow u={u} color="0,200,255" size={300} style={{ bottom: '20%', left: '10%' }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        {content.badge && <PGBadge u={u} color={PG_COLORS.pink} style={{ marginBottom: 28 * u }}>{content.badge}</PGBadge>}
        <PGHeadline u={u} style={{ marginBottom: 20 * u }}>{content.headline}</PGHeadline>
        {content.subheadline && <PGSubheadline u={u} color={PG_COLORS.muted} style={{ maxWidth: '85%', marginBottom: 36 * u }}>{content.subheadline}</PGSubheadline>}
        {content.cta && <PGCTA u={u}>{content.cta}</PGCTA>}
      </div>
      <Footer u={u} h={h} />
    </div>
  );
}

/** Founder Story — photo, headline, body, signature. */
function FounderStory({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: PAD * u, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <PGGlow u={u} color="191,95,255" size={400} style={{ top: '10%', left: '5%' }} />
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 28 * u }}>
        {content.image_url && (
          <div style={{
            width: 120 * u, height: 120 * u, borderRadius: '50%',
            overflow: 'hidden', border: `3px solid rgba(191,95,255,0.4)`,
            boxShadow: `0 0 ${32*u}px rgba(191,95,255,0.3)`,
            flexShrink: 0,
          }}>
            <img src={content.image_url} alt="" crossOrigin="anonymous" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        )}
        {content.badge && <PGBadge u={u} color={PG_COLORS.purple}>{content.badge}</PGBadge>}
        <PGHeadline u={u} style={{ fontSize: '56px' }}>{content.headline}</PGHeadline>
        {content.body && <PGBody u={u} style={{ maxWidth: '85%' }}>{content.body}</PGBody>}
        {content.signature && (
          <p style={{
            fontFamily: "'DM Sans', sans-serif", fontSize: 30 * u, fontWeight: 600,
            fontStyle: 'italic', color: PG_COLORS.cyan, margin: 0,
          }}>{content.signature}</p>
        )}
      </div>
      <Footer u={u} h={h} />
    </div>
  );
}

/** Coming Soon — badge, headline, subheadline, minimal. */
function ComingSoon({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: PAD * u, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
      <PGGlow u={u} color="0,200,255" size={500} style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <PGBadge u={u} color={PG_COLORS.cyan} style={{ marginBottom: 32 * u }}>{content.badge || 'Coming Soon'}</PGBadge>
        <PGHeadline u={u} align="center" style={{ marginBottom: 20 * u }}>{content.headline}</PGHeadline>
        {content.subheadline && <PGSubheadline u={u} align="center" color={PG_COLORS.muted} style={{ maxWidth: '75%' }}>{content.subheadline}</PGSubheadline>}
      </div>
      <Footer u={u} h={h} />
    </div>
  );
}

/** Launch — badge, headline, subheadline, CTA. */
function Launch({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: PAD * u, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
      <PGGlow u={u} color="0,255,135" size={500} style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
      <PGGlow u={u} color="191,95,255" size={350} style={{ top: '15%', right: '15%' }} />
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <PGBadge u={u} color={PG_COLORS.green} style={{ marginBottom: 32 * u }}>{content.badge || 'Now Live'}</PGBadge>
        <PGHeadline u={u} align="center" style={{ marginBottom: 20 * u }}>{content.headline}</PGHeadline>
        {content.subheadline && <PGSubheadline u={u} align="center" color={PG_COLORS.muted} style={{ maxWidth: '80%', marginBottom: 36 * u }}>{content.subheadline}</PGSubheadline>}
        {content.cta && <PGCTA u={u}>{content.cta}</PGCTA>}
      </div>
      <Footer u={u} h={h} />
    </div>
  );
}

/** Problem — badge, headline, body, stark and minimal. */
function Problem({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: PAD * u, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <PGGlow u={u} color="255,45,120" size={400} style={{ top: '20%', left: '60%' }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        {content.badge && <PGBadge u={u} color={PG_COLORS.pink} style={{ marginBottom: 28 * u }}>{content.badge || 'The Problem'}</PGBadge>}
        <PGHeadline u={u} broken style={{ marginBottom: 24 * u }}>{content.headline}</PGHeadline>
        {content.body && <PGBody u={u} style={{ maxWidth: '85%' }}>{content.body}</PGBody>}
      </div>
      <Footer u={u} h={h} />
    </div>
  );
}

/** Milestone — badge, headline, statistic, celebratory. */
function Milestone({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: PAD * u, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
      <PGGlow u={u} color="255,230,0" size={450} style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <PGBadge u={u} color={PG_COLORS.yellow} style={{ marginBottom: 32 * u }}>{content.badge || 'Milestone'}</PGBadge>
        {content.stat_number && (
          <div style={{
            fontFamily: "'Black Han Sans', Impact, sans-serif",
            fontSize: 120 * u, lineHeight: 0.9,
            background: 'linear-gradient(135deg, #FFE600, #FF8C00)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            marginBottom: 20 * u,
          }}>{content.stat_number}</div>
        )}
        <PGHeadline u={u} align="center" style={{ fontSize: '52px' }}>{content.headline}</PGHeadline>
        {content.subheadline && <PGSubheadline u={u} align="center" color={PG_COLORS.muted} style={{ maxWidth: '80%', marginTop: 16 * u }}>{content.subheadline}</PGSubheadline>}
      </div>
      <Footer u={u} h={h} />
    </div>
  );
}

/** Generic fallback layout for types without a bespoke layout yet. */
function GenericLayout({ content, u, w, h }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: PAD * u, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <PGGlow u={u} color="191,95,255" size={400} style={{ top: '15%', right: '15%' }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        {content.badge && <PGBadge u={u} style={{ marginBottom: 28 * u }}>{content.badge}</PGBadge>}
        <PGHeadline u={u} style={{ marginBottom: 20 * u }}>{content.headline}</PGHeadline>
        {content.subheadline && <PGSubheadline u={u} color={PG_COLORS.muted} style={{ maxWidth: '85%', marginBottom: 20 * u }}>{content.subheadline}</PGSubheadline>}
        {content.body && <PGBody u={u} style={{ maxWidth: '85%', marginBottom: 28 * u }}>{content.body}</PGBody>}
        {content.cta && <PGCTA u={u}>{content.cta}</PGCTA>}
      </div>
      <Footer u={u} h={h} />
    </div>
  );
}

export const LAYOUTS = {
  industry_truth: IndustryTruth,
  feature_spotlight: FeatureSpotlight,
  statistic: Statistic,
  quote: Quote,
  announcement: Announcement,
  founder_story: FounderStory,
  coming_soon: ComingSoon,
  launch: Launch,
  problem: Problem,
  milestone: Milestone,
  // Types using the generic fallback (bespoke layouts can be added later):
  partnership: GenericLayout,
  waitlist: GenericLayout,
  update: GenericLayout,
  venue_spotlight: GenericLayout,
  ticket_tip: GenericLayout,
  fan_story: GenericLayout,
  comparison: GenericLayout,
  question: GenericLayout,
};

export function renderLayout(graphicType, props) {
  const Layout = LAYOUTS[graphicType] || GenericLayout;
  return <Layout {...props} />;
}