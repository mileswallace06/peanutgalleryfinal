/**
 * Decorative Element Library
 * --------------------------------------------------------------------
 * Reusable visual elements referenced by ID in a concept's
 * designSystem.decorative array. The Creative Direction Engine
 * looks up each ID and renders it at the correct position.
 *
 * Every element is parameterized by `u` (unit scale = canvasWidth/1080)
 * and receives the full design context for adaptive styling.
 *
 * This is NOT per-concept code. These are shared primitives that
 * ANY concept can compose. New concepts simply reference different
 * combinations of these elements.
 */
import { NEON, NEON_RGB, FONTS, TEXT, GRADIENTS } from '@/lib/marketingTokens';

// ── Borders & Frames ────────────────────────────────────────────────────
function ThinBorder({ u, color }) {
  return <div style={{ position: 'absolute', inset: 8 * u, border: `${1 * u}px solid`, borderColor: `rgba(255,255,255,0.15)`, pointerEvents: 'none', borderRadius: 4 * u }} />;
}
function GoldBorder({ u }) {
  return <div style={{ position: 'absolute', inset: 12 * u, border: `${1.5 * u}px solid ${NEON.yellow}`, pointerEvents: 'none' }} />;
}
function BorderFrame({ u, color }) {
  return <div style={{ position: 'absolute', inset: 4 * u, border: `${2 * u}px solid`, borderColor: color || `rgba(255,255,255,0.2)`, pointerEvents: 'none' }} />;
}
function CardFrame({ u, color }) {
  return <div style={{ position: 'absolute', inset: 20 * u, border: `${1 * u}px solid`, borderColor: `rgba(255,255,255,0.12)`, borderRadius: 16 * u, pointerEvents: 'none' }} />;
}
function ScoreboardFrame({ u, color }) {
  return <div style={{ position: 'absolute', inset: 6 * u, border: `${3 * u}px solid`, borderColor: color || NEON.green, borderRadius: 8 * u, pointerEvents: 'none' }} />;
}

// ── Dividers & Lines ────────────────────────────────────────────────────
function DottedDividers({ u, contentZone }) {
  // Rendered inline by content renderer between elements; this is a marker
  return null;
}
function ColumnRules({ u, w, h }) {
  const cols = [0.33, 0.66];
  return (
    <>
      {cols.map((c, i) => (
        <div key={i} style={{ position: 'absolute', left: c * w, top: 200 * u, bottom: 80 * u, width: 1, background: 'rgba(255,255,255,0.08)' }} />
      ))}
    </>
  );
}
function GradientAccentLine({ u, color, w }) {
  return <div style={{ width: 60 * u, height: 3 * u, background: GRADIENTS.cta_primary, borderRadius: 2 * u }} />;
}
function HairlineAccent({ u, color, w }) {
  return <div style={{ width: 40 * u, height: 1 * u, background: 'rgba(255,255,255,0.2)' }} />;
}
function OrnamentalDivider({ u, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 * u, justifyContent: 'center' }}>
      <div style={{ width: 30 * u, height: 1 * u, background: color || NEON.yellow, opacity: 0.6 }} />
      <span style={{ color: color || NEON.yellow, fontSize: 10 * u, fontFamily: FONTS.display }}>✦</span>
      <div style={{ width: 30 * u, height: 1 * u, background: color || NEON.yellow, opacity: 0.6 }} />
    </div>
  );
}
function MeasurementMarks({ u, w, h }) {
  const marks = [];
  for (let i = 0; i < 10; i++) {
    const x = (i / 10) * w;
    marks.push(<div key={`t${i}`} style={{ position: 'absolute', left: x, top: 0, width: 1, height: 10 * u, background: 'rgba(0,200,255,0.2)' }} />);
    marks.push(<div key={`b${i}`} style={{ position: 'absolute', left: x, bottom: 0, width: 1, height: 10 * u, background: 'rgba(0,200,255,0.2)' }} />);
  }
  return <>{marks}</>;
}
function DimensionLines({ u, w, h }) {
  return (
    <>
      <div style={{ position: 'absolute', left: 20 * u, top: 100 * u, bottom: 100 * u, width: 1, background: 'rgba(0,200,255,0.15)' }} />
      <div style={{ position: 'absolute', left: 16 * u, top: 100 * u, width: 8 * u, height: 1, background: 'rgba(0,200,255,0.3)' }} />
      <div style={{ position: 'absolute', left: 16 * u, bottom: 100 * u, width: 8 * u, height: 1, background: 'rgba(0,200,255,0.3)' }} />
    </>
  );
}
function GridLines({ u, w, h }) {
  const lines = [];
  for (let i = 1; i < 4; i++) {
    lines.push(<div key={`h${i}`} style={{ position: 'absolute', left: 0, right: 0, top: (i / 4) * h, height: 1, background: 'rgba(255,255,255,0.04)' }} />);
  }
  return <>{lines}</>;
}

// ── Stamps & Seals ──────────────────────────────────────────────────────
function OfficialStamp({ u, color }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      padding: `${4 * u}px ${12 * u}px`,
      border: `${2 * u}px solid ${color || NEON.cyan}`,
      borderRadius: 4 * u,
      transform: `rotate(-8deg)`,
      opacity: 0.7,
    }}>
      <span style={{ fontFamily: FONTS.body, fontSize: 10 * u, fontWeight: 900, color: color || NEON.cyan, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
        VERIFIED
      </span>
    </div>
  );
}
function Monogram({ u, color }) {
  return <span style={{ fontFamily: FONTS.display, fontSize: 16 * u, color: color || NEON.yellow, opacity: 0.5 }}>PG</span>;
}
function DateStamp({ u }) {
  const now = new Date();
  return <span style={{ fontFamily: FONTS.body, fontSize: 8 * u, color: TEXT.muted, letterSpacing: '0.1em' }}>{now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).toUpperCase()}</span>;
}
function PhotoCredit({ u }) {
  return <span style={{ fontFamily: FONTS.body, fontSize: 7 * u, color: TEXT.faint, fontStyle: 'italic' }}>PHOTO: PEANUT GALLERY</span>;
}
function SourceCitation({ u }) {
  return <span style={{ fontFamily: FONTS.body, fontSize: 7 * u, color: TEXT.faint }}>SOURCE: PG INTERNAL DATA</span>;
}

// ── Data Elements ───────────────────────────────────────────────────────
function Barcode({ u, color }) {
  const bars = Array.from({ length: 24 }, (_, i) => ({
    width: (i % 3 === 0 ? 3 : 1) * u,
    gap: 2 * u,
  }));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 1 * u, height: 30 * u }}>
      {bars.map((b, i) => (
        <div key={i} style={{ width: b.width, height: '100%', background: color || 'rgba(255,255,255,0.7)' }} />
      ))}
    </div>
  );
}
function SerialNumber({ u, color }) {
  const serial = 'PG-' + Math.random().toString(36).substring(2, 8).toUpperCase();
  return <span style={{ fontFamily: FONTS.body, fontSize: 8 * u, color: color || TEXT.muted, letterSpacing: '0.15em', fontWeight: 700 }}>{serial}</span>;
}
function TransactionId({ u }) {
  const txn = '#TXN' + Math.floor(100000 + Math.random() * 900000);
  return <span style={{ fontFamily: FONTS.body, fontSize: 7 * u, color: TEXT.faint, letterSpacing: '0.1em' }}>{txn}</span>;
}
function Timestamp({ u }) {
  const now = new Date();
  return <span style={{ fontFamily: FONTS.body, fontSize: 7 * u, color: TEXT.faint, letterSpacing: '0.05em' }}>{now.toISOString().substring(0, 19).replace('T', ' ')}</span>;
}
function Folio({ u }) {
  return <span style={{ fontFamily: FONTS.body, fontSize: 8 * u, color: TEXT.faint }}>PAGE 01 · SECTION A</span>;
}
function Dateline({ u }) {
  const now = new Date();
  const city = 'PHOENIX';
  return <span style={{ fontFamily: FONTS.body, fontSize: 8 * u, color: TEXT.muted, fontWeight: 700 }}>{city} — {now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase()}</span>;
}
function RacingNumber({ u, color }) {
  return <span style={{ fontFamily: FONTS.display, fontSize: 24 * u, color: color || NEON.orange, opacity: 0.4 }}>07</span>;
}
function VersionBadge({ u, color }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 4 * u,
      padding: `${3 * u}px ${10 * u}px`,
      borderRadius: 999,
      background: `rgba(${NEON_RGB.cyan}, 0.12)`,
      border: `1px solid rgba(${NEON_RGB.cyan}, 0.3)`,
    }}>
      <span style={{ fontFamily: FONTS.body, fontSize: 9 * u, fontWeight: 900, color: NEON.cyan, letterSpacing: '0.1em', textTransform: 'uppercase' }}>v2.0</span>
    </div>
  );
}

// ── Text Blocks ─────────────────────────────────────────────────────────
function CreditsBlock({ u, color }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 * u, alignItems: 'center' }}>
      <span style={{ fontFamily: FONTS.body, fontSize: 7 * u, color: TEXT.faint, letterSpacing: '0.15em', textTransform: 'uppercase' }}>PEANUT GALLERY PRESENTS</span>
      <span style={{ fontFamily: FONTS.body, fontSize: 6 * u, color: TEXT.ultra, letterSpacing: '0.1em' }}>A FAN-FIRST TICKET MARKETPLACE</span>
    </div>
  );
}
function InfoPile({ u }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 * u, alignItems: 'center' }}>
      <span style={{ fontFamily: FONTS.body, fontSize: 8 * u, color: TEXT.muted, fontWeight: 900, textTransform: 'uppercase' }}>DOORS 7PM · SHOW 8PM</span>
      <span style={{ fontFamily: FONTS.body, fontSize: 7 * u, color: TEXT.faint, fontWeight: 700, textTransform: 'uppercase' }}>ALL AGES · NO REFUNDS</span>
    </div>
  );
}
function Masthead({ u, color, content }) {
  const title = content?.badge || 'PEANUT GALLERY';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 * u }}>
      <span style={{ fontFamily: FONTS.display, fontSize: 14 * u, color: 'rgba(255,255,255,0.9)', letterSpacing: '0.05em' }}>{title.toUpperCase()}</span>
      <div style={{ width: '100%', height: 1, background: 'rgba(255,255,255,0.15)' }} />
    </div>
  );
}
function CoverLines({ u, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 * u }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 * u }}>
        <span style={{ fontFamily: FONTS.body, fontSize: 8 * u, color: color || NEON.purple, fontWeight: 900 }}>FEATURE STORY</span>
        <span style={{ fontFamily: FONTS.body, fontSize: 7 * u, color: TEXT.muted }}>THE FAN ECONOMY</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 * u, alignItems: 'flex-end' }}>
        <span style={{ fontFamily: FONTS.body, fontSize: 8 * u, color: color || NEON.purple, fontWeight: 900 }}>EXCLUSIVE</span>
        <span style={{ fontFamily: FONTS.body, fontSize: 7 * u, color: TEXT.muted }}>INSIDE PG</span>
      </div>
    </div>
  );
}
function TickerBar({ u, color }) {
  return (
    <div style={{
      width: '100%', padding: `${4 * u}px 0`,
      background: 'rgba(0,0,0,0.6)',
      borderTop: `${1 * u}px solid rgba(255,255,255,0.1)`,
      overflow: 'hidden', whiteSpace: 'nowrap',
    }}>
      <span style={{ fontFamily: FONTS.body, fontSize: 8 * u, color: TEXT.muted, letterSpacing: '0.1em' }}>
        BREAKING · PG MARKETPLACE LIVE · TRANSFER WINDOW OPEN · NEW LISTINGS DAILY · BREAKING ·
      </span>
    </div>
  );
}
function BreakingBanner({ u, color }) {
  return (
    <div style={{
      width: '100%', padding: `${6 * u}px 0`,
      background: color || NEON.pink,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 * u,
    }}>
      <span style={{ width: 6 * u, height: 6 * u, borderRadius: '50%', background: '#ffffff', animation: 'pulse 1s infinite' }} />
      <span style={{ fontFamily: FONTS.display, fontSize: 12 * u, color: '#ffffff', letterSpacing: '0.15em' }}>BREAKING</span>
    </div>
  );
}
function LiveIndicator({ u, color }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 * u }}>
      <span style={{ width: 5 * u, height: 5 * u, borderRadius: '50%', background: color || NEON.pink }} />
      <span style={{ fontFamily: FONTS.body, fontSize: 8 * u, color: TEXT.muted, fontWeight: 900, letterSpacing: '0.15em' }}>LIVE</span>
    </div>
  );
}
function CaptionBar({ u }) {
  return <div style={{ width: '100%', height: 1, background: 'rgba(255,255,255,0.1)', marginTop: 4 * u }} />;
}

// ── Structural Elements ─────────────────────────────────────────────────
function PaperCard({ u, w, h, children, color }) {
  return (
    <div style={{
      position: 'absolute', inset: 40 * u,
      background: 'rgba(245, 240, 230, 0.95)',
      borderRadius: 4 * u,
      padding: 32 * u,
      display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    }}>
      {children}
    </div>
  );
}
function NewsprintCard({ u, w, h, children }) {
  return (
    <div style={{
      position: 'absolute', inset: 30 * u,
      background: 'rgba(240, 235, 220, 0.92)',
      borderRadius: 2 * u,
      padding: 28 * u,
      display: 'flex', flexDirection: 'column',
      boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
    }}>
      {children}
    </div>
  );
}
function TicketCard({ u, w, h, children, color }) {
  return (
    <div style={{
      position: 'absolute', inset: 30 * u,
      background: 'rgba(230, 220, 200, 0.9)',
      borderRadius: 8 * u,
      padding: 32 * u,
      display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    }}>
      {children}
    </div>
  );
}
function Perforation({ u, w, h, orientation = 'vertical' }) {
  if (orientation === 'vertical') {
    const dots = Math.floor(h / (12 * u));
    return (
      <div style={{ position: 'absolute', left: '28%', top: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-around', alignItems: 'center' }}>
        {Array.from({ length: dots }).map((_, i) => (
          <div key={i} style={{ width: 4 * u, height: 4 * u, borderRadius: '50%', background: 'rgba(0,0,0,0.4)' }} />
        ))}
      </div>
    );
  }
  return null;
}
function FieldGrid({ u }) {
  const fields = [
    { label: 'SECTION', value: '118' },
    { label: 'ROW', value: 'G' },
    { label: 'SEAT', value: '7-8' },
  ];
  return (
    <div style={{ display: 'flex', gap: 16 * u, justifyContent: 'center' }}>
      {fields.map(f => (
        <div key={f.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 * u }}>
          <span style={{ fontFamily: FONTS.body, fontSize: 7 * u, color: TEXT.faint, letterSpacing: '0.1em', fontWeight: 700 }}>{f.label}</span>
          <span style={{ fontFamily: FONTS.display, fontSize: 16 * u, color: TEXT.white }}>{f.value}</span>
        </div>
      ))}
    </div>
  );
}
function LanyardStrip({ u, w, color }) {
  return (
    <div style={{
      position: 'absolute', top: 0, left: '25%', right: '25%', height: 40 * u,
      background: `repeating-linear-gradient(45deg, ${color || NEON.green}22, ${color || NEON.green}22 ${4 * u}px, ${color || NEON.green}11 ${4 * u}px, ${color || NEON.green}11 ${8 * u}px)`,
      borderBottom: `${2 * u}px solid rgba(255,255,255,0.1)`,
    }} />
  );
}
function HolographicStrip({ u, w, color }) {
  return (
    <div style={{
      position: 'absolute', top: 40 * u, left: 30 * u, right: 30 * u, height: 8 * u,
      background: `linear-gradient(90deg, ${NEON.cyan}, ${NEON.purple}, ${NEON.pink}, ${NEON.green})`,
      opacity: 0.6,
    }} />
  );
}
function WristbandBand({ u, w, color }) {
  return (
    <div style={{
      position: 'absolute', top: '35%', left: '5%', right: '5%', height: 80 * u,
      background: color || NEON.pink,
      borderRadius: 8 * u,
      boxShadow: `0 4px 16px rgba(0,0,0,0.3)`,
    }} />
  );
}
function RepeatingPattern({ u, w, color }) {
  return (
    <div style={{
      position: 'absolute', top: '35%', left: '5%', right: '5%', height: 80 * u,
      background: `repeating-linear-gradient(90deg, transparent, transparent ${20 * u}px, rgba(255,255,255,0.1) ${20 * u}px, rgba(255,255,255,0.1) ${24 * u}px)`,
      borderRadius: 8 * u,
    }} />
  );
}
function StatBoxes({ u, color }) {
  return (
    <div style={{ display: 'flex', gap: 8 * u, justifyContent: 'center' }}>
      {['HOME', 'AWAY'].map((label, i) => (
        <div key={label} style={{ padding: `${6 * u}px ${12 * u}px`, border: `${1 * u}px solid rgba(255,255,255,0.15)`, borderRadius: 4 * u, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 * u }}>
          <span style={{ fontFamily: FONTS.body, fontSize: 7 * u, color: TEXT.faint, letterSpacing: '0.1em' }}>{label}</span>
          <span style={{ fontFamily: FONTS.display, fontSize: 14 * u, color: color || NEON.orange }}>{i === 0 ? '3' : '2'}</span>
        </div>
      ))}
    </div>
  );
}
function ClockDisplay({ u, color }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 * u }}>
      <span style={{ fontFamily: FONTS.display, fontSize: 12 * u, color: color || NEON.green }}>12:34</span>
      <span style={{ fontFamily: FONTS.body, fontSize: 7 * u, color: TEXT.faint }}>Q4</span>
    </div>
  );
}
function DataCards({ u, color }) {
  const cards = [
    { label: 'GROWTH', value: '+47%', trend: 'up' },
    { label: 'VOLUME', value: '2.3K', trend: 'up' },
    { label: 'TRUST', value: '98%', trend: 'up' },
  ];
  return (
    <div style={{ display: 'flex', gap: 8 * u, justifyContent: 'center' }}>
      {cards.map(c => (
        <div key={c.label} style={{ padding: `${8 * u}px ${12 * u}px`, background: 'rgba(255,255,255,0.04)', borderRadius: 8 * u, border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 * u }}>
          <span style={{ fontFamily: FONTS.body, fontSize: 7 * u, color: TEXT.faint, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{c.label}</span>
          <span style={{ fontFamily: FONTS.display, fontSize: 14 * u, color: c.trend === 'up' ? NEON.green : NEON.pink }}>{c.value}</span>
        </div>
      ))}
    </div>
  );
}
function TrendIndicators({ u, color }) {
  return (
    <div style={{ display: 'flex', gap: 4 * u, alignItems: 'center' }}>
      <span style={{ color: NEON.green, fontSize: 10 * u }}>▲</span>
      <span style={{ fontFamily: FONTS.body, fontSize: 8 * u, color: NEON.green, fontWeight: 700 }}>+12.4%</span>
    </div>
  );
}
function CornerAnnotations({ u, w, h }) {
  return (
    <>
      <span style={{ position: 'absolute', top: 20 * u, left: 20 * u, fontFamily: FONTS.body, fontSize: 7 * u, color: 'rgba(0,200,255,0.4)', letterSpacing: '0.1em' }}>DWG-001</span>
      <span style={{ position: 'absolute', top: 20 * u, right: 20 * u, fontFamily: FONTS.body, fontSize: 7 * u, color: 'rgba(0,200,255,0.4)', letterSpacing: '0.1em' }}>REV A</span>
      <span style={{ position: 'absolute', bottom: 20 * u, left: 20 * u, fontFamily: FONTS.body, fontSize: 7 * u, color: 'rgba(0,200,255,0.4)', letterSpacing: '0.1em' }}>SCALE 1:1</span>
    </>
  );
}
function TitleBlock({ u, w, h }) {
  return (
    <div style={{ position: 'absolute', bottom: 20 * u, right: 20 * u, padding: `${6 * u}px ${10 * u}px`, border: `${1 * u}px solid rgba(0,200,255,0.2)`, display: 'flex', flexDirection: 'column', gap: 2 * u }}>
      <span style={{ fontFamily: FONTS.body, fontSize: 7 * u, color: 'rgba(0,200,255,0.5)', letterSpacing: '0.1em' }}>PROJECT</span>
      <span style={{ fontFamily: FONTS.body, fontSize: 8 * u, color: 'rgba(0,200,255,0.7)', fontWeight: 700 }}>PEANUT GALLERY</span>
    </div>
  );
}

// ── Atmospheric Effects ─────────────────────────────────────────────────
function SingleLightGlow({ u, w, h, color }) {
  return (
    <div style={{
      position: 'absolute', left: '50%', top: '55%',
      transform: 'translate(-50%, -50%)',
      width: 120 * u, height: 120 * u, borderRadius: '50%',
      background: `radial-gradient(circle, ${color || 'rgba(80,50,30,0.3)'} 0%, transparent 70%)`,
      pointerEvents: 'none',
    }} />
  );
}
function SpotlightCone({ u, w, h, color }) {
  return (
    <div style={{
      position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
      width: 0, height: 0,
      borderLeft: `${w * 0.4}px solid transparent`,
      borderRight: `${w * 0.4}px solid transparent`,
      borderTop: `${h * 0.7}px solid`,
      borderTopColor: `${color || NEON.yellow}15`,
      pointerEvents: 'none',
    }} />
  );
}
function HazeParticles({ u, w, h, color }) {
  const particles = Array.from({ length: 12 }, (_, i) => ({
    left: Math.random() * 100,
    top: Math.random() * 100,
    size: (2 + Math.random() * 3) * u,
    opacity: 0.1 + Math.random() * 0.15,
  }));
  return (
    <>
      {particles.map((p, i) => (
        <div key={i} style={{ position: 'absolute', left: `${p.left}%`, top: `${p.top}%`, width: p.size, height: p.size, borderRadius: '50%', background: color || 'rgba(255,255,255,0.3)', opacity: p.opacity }} />
      ))}
    </>
  );
}
function StageFloor({ u, w, h }) {
  return <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 60 * u, background: 'linear-gradient(to top, rgba(0,0,0,0.5), transparent)' }} />;
}
function LightBeams({ u, w, h, color }) {
  const beams = [
    { left: 20, rotate: -15, color: NEON.purple },
    { left: 50, rotate: 0, color: NEON.pink },
    { left: 80, rotate: 15, color: NEON.green },
  ];
  return (
    <>
      {beams.map((b, i) => (
        <div key={i} style={{
          position: 'absolute', top: 0, left: `${b.left}%`,
          width: 4 * u, height: h * 0.8,
          background: `linear-gradient(to bottom, ${b.color}20, transparent)`,
          transform: `rotate(${b.rotate}deg)`,
          transformOrigin: 'top center',
          pointerEvents: 'none',
        }} />
      ))}
    </>
  );
}
function ColorWashes({ u, w, h }) {
  return (
    <>
      <div style={{ position: 'absolute', bottom: 0, left: 0, width: '50%', height: '40%', background: `radial-gradient(ellipse at bottom left, ${NEON.purple}15, transparent 70%)` }} />
      <div style={{ position: 'absolute', bottom: 0, right: 0, width: '50%', height: '40%', background: `radial-gradient(ellipse at bottom right, ${NEON.green}15, transparent 70%)` }} />
    </>
  );
}
function DustParticles({ u, w, h }) {
  const particles = Array.from({ length: 8 }, () => ({
    left: Math.random() * 100,
    top: Math.random() * 100,
    size: (1 + Math.random() * 2) * u,
  }));
  return (
    <>
      {particles.map((p, i) => (
        <div key={i} style={{ position: 'absolute', left: `${p.left}%`, top: `${p.top}%`, width: p.size, height: p.size, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
      ))}
    </>
  );
}

// ── Patterns ────────────────────────────────────────────────────────────
function SeatDotGrid({ u, w, h, color }) {
  const cols = 12, rows = 10;
  const dotSize = 4 * u;
  const gapX = (w * 0.7) / cols;
  const gapY = (h * 0.4) / rows;
  const startX = w * 0.15;
  const startY = h * 0.35;
  const dots = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const isHighlighted = r === 4 && c >= 4 && c <= 7;
      dots.push(
        <div key={`${r}-${c}`} style={{
          position: 'absolute',
          left: startX + c * gapX, top: startY + r * gapY,
          width: dotSize, height: dotSize, borderRadius: '50%',
          background: isHighlighted ? (color || NEON.cyan) : 'rgba(255,255,255,0.15)',
          boxShadow: isHighlighted ? `0 0 8px ${color || NEON.cyan}` : 'none',
        }} />
      );
    }
  }
  return <>{dots}</>;
}
function StageShape({ u, w, color }) {
  return (
    <div style={{
      position: 'absolute', top: 60 * u, left: '25%', right: '25%', height: 16 * u,
      background: color || 'rgba(255,255,255,0.08)',
      borderRadius: `${4 * u}px ${4 * u}px 0 0`,
    }} >
      <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontFamily: FONTS.body, fontSize: 7 * u, color: TEXT.faint, letterSpacing: '0.15em' }}>STAGE</span>
    </div>
  );
}
function HighlightedZone({ u, w, h, color }) {
  return <div style={{ position: 'absolute', left: '40%', top: '55%', width: '20%', height: '8%', border: `${2 * u}px solid ${color || NEON.cyan}`, borderRadius: 4 * u, background: `${color || NEON.cyan}11` }} />;
}
function Compass({ u, color }) {
  return (
    <div style={{ position: 'absolute', top: 20 * u, right: 20 * u, width: 24 * u, height: 24 * u, borderRadius: '50%', border: `${1 * u}px solid rgba(255,255,255,0.15)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontFamily: FONTS.body, fontSize: 7 * u, color: TEXT.faint, fontWeight: 700 }}>N</span>
    </div>
  );
}
function SpeedLines({ u, w, h, color }) {
  const lines = Array.from({ length: 8 }, (_, i) => ({
    top: 15 + i * 10,
    width: 30 + Math.random() * 40,
    opacity: 0.05 + Math.random() * 0.1,
  }));
  return (
    <>
      {lines.map((l, i) => (
        <div key={i} style={{ position: 'absolute', left: 0, top: `${l.top}%`, width: `${l.width}%`, height: 1 * u, background: color || NEON.orange, opacity: l.opacity }} />
      ))}
    </>
  );
}
function CarbonFiber({ u, w, h }) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      backgroundImage: `
        repeating-linear-gradient(0deg, rgba(255,255,255,0.02) 0, rgba(255,255,255,0.02) ${2 * u}px, transparent ${2 * u}px, transparent ${4 * u}px),
        repeating-linear-gradient(90deg, rgba(255,255,255,0.02) 0, rgba(255,255,255,0.02) ${2 * u}px, transparent ${2 * u}px, transparent ${4 * u}px)
      `,
      pointerEvents: 'none',
    }} />
  );
}
function CrackLines({ u, w, h, color }) {
  const cracks = [
    { x1: '10%', y1: '20%', x2: '40%', y2: '50%' },
    { x1: '40%', y1: '50%', x2: '70%', y2: '30%' },
    { x1: '40%', y1: '50%', x2: '35%', y2: '85%' },
    { x1: '40%', y1: '50%', x2: '85%', y2: '60%' },
    { x1: '70%', y1: '30%', x2: '90%', y2: '50%' },
  ];
  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      {cracks.map((c, i) => (
        <line key={i} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} stroke={color || 'rgba(255,255,255,0.15)'} strokeWidth={1} />
      ))}
    </svg>
  );
}
function ShardFragments({ u, w, h }) {
  const shards = [
    { top: '15%', left: '5%', size: 20, rotate: 15 },
    { top: '70%', left: '8%', size: 16, rotate: -25 },
    { top: '20%', right: '5%', size: 24, rotate: -10 },
    { top: '75%', right: '8%', size: 18, rotate: 30 },
  ];
  return (
    <>
      {shards.map((s, i) => (
        <div key={i} style={{
          position: 'absolute',
          top: s.top, left: s.left, right: s.right,
          width: s.size * u, height: s.size * u,
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          transform: `rotate(${s.rotate}deg)`,
          clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
        }} />
      ))}
    </>
  );
}

// ── Accents ─────────────────────────────────────────────────────────────
function Starburst({ u, color }) {
  return (
    <svg width={40 * u} height={40 * u} viewBox="0 0 100 100" style={{ opacity: 0.15 }}>
      <polygon points="50,0 58,35 100,50 58,65 50,100 42,65 0,50 42,35" fill={color || NEON.green} />
    </svg>
  );
}
function Arrows({ u, color }) {
  return (
    <div style={{ display: 'flex', gap: 4 * u, justifyContent: 'center' }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{ fontSize: 12 * u, color: color || NEON.green, opacity: 0.4 }}>→</span>
      ))}
    </div>
  );
}
function TapeStrip({ u, w }) {
  return (
    <div style={{
      position: 'absolute', top: 20 * u, left: '20%',
      width: 80 * u, height: 20 * u,
      background: 'rgba(255,255,255,0.08)',
      transform: 'rotate(-3deg)',
      border: '1px solid rgba(255,255,255,0.05)',
    }} />
  );
}
function SprayAccent({ u, w, h, color }) {
  return (
    <div style={{
      position: 'absolute', bottom: 40 * u, right: 40 * u,
      width: 60 * u, height: 60 * u, borderRadius: '50%',
      background: `radial-gradient(circle, ${color || NEON.pink}15, transparent 70%)`,
      filter: 'blur(8px)',
    }} />
  );
}
function RouteBullet({ u, color }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 24 * u, height: 24 * u, borderRadius: '50%',
      background: color || NEON.cyan,
    }}>
      <span style={{ fontFamily: FONTS.display, fontSize: 12 * u, color: '#000000' }}>PG</span>
    </div>
  );
}
function GlowAccents({ u, w, h, color }) {
  return (
    <>
      <div style={{ position: 'absolute', top: '20%', left: '15%', width: 40 * u, height: 40 * u, borderRadius: '50%', background: `${color || NEON.pink}10`, filter: 'blur(16px)' }} />
      <div style={{ position: 'absolute', bottom: '25%', right: '15%', width: 50 * u, height: 50 * u, borderRadius: '50%', background: `${NEON.cyan}08`, filter: 'blur(20px)' }} />
    </>
  );
}
function SignFrame({ u, w, h, color }) {
  return (
    <>
      <div style={{ position: 'absolute', inset: 20 * u, border: `${3 * u}px solid rgba(255,255,255,0.08)`, borderRadius: 12 * u }} />
      {/* Mounting bolts */}
      <div style={{ position: 'absolute', top: 28 * u, left: 28 * u, width: 6 * u, height: 6 * u, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
      <div style={{ position: 'absolute', top: 28 * u, right: 28 * u, width: 6 * u, height: 6 * u, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
      <div style={{ position: 'absolute', bottom: 28 * u, left: 28 * u, width: 6 * u, height: 6 * u, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
      <div style={{ position: 'absolute', bottom: 28 * u, right: 28 * u, width: 6 * u, height: 6 * u, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
    </>
  );
}
function Doodles({ u, color }) {
  return (
    <div style={{ display: 'flex', gap: 8 * u, alignItems: 'center' }}>
      <span style={{ fontSize: 10 * u, opacity: 0.4 }}>★</span>
      <span style={{ fontSize: 8 * u, opacity: 0.3, color: color || NEON.green }}>~</span>
      <span style={{ fontSize: 10 * u, opacity: 0.4 }}>→</span>
    </div>
  );
}
function StatBars({ u, color }) {
  return (
    <div style={{ display: 'flex', gap: 4 * u, alignItems: 'flex-end', height: 30 * u }}>
      {[40, 70, 55, 90, 65].map((h, i) => (
        <div key={i} style={{ width: 8 * u, height: `${h}%`, background: color || NEON.purple, borderRadius: `${2 * u}px ${2 * u}px 0 0`, opacity: 0.6 + i * 0.08 }} />
      ))}
    </div>
  );
}
function ColorBlocks({ u }) {
  return (
    <div style={{ display: 'flex', gap: 2 * u }}>
      {[NEON.green, NEON.pink, NEON.cyan, NEON.yellow].map(c => (
        <div key={c} style={{ width: 16 * u, height: 16 * u, background: c, borderRadius: 2 * u }} />
      ))}
    </div>
  );
}
function ChevronAccents({ u, color }) {
  return (
    <div style={{ display: 'flex', gap: 2 * u }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 0, height: 0,
          borderLeft: `${6 * u}px solid transparent`,
          borderRight: `${6 * u}px solid transparent`,
          borderBottom: `${8 * u}px solid ${color || NEON.orange}`,
          opacity: 0.3 + i * 0.2,
        }} />
      ))}
    </div>
  );
}
function BrandWordmark({ u, color }) {
  return <span style={{ fontFamily: FONTS.body, fontSize: 10 * u, fontWeight: 300, color: color || '#cccccc', letterSpacing: '0.3em', textTransform: 'uppercase' }}>PEANUT GALLERY</span>;
}
function FeatureBullets({ u, color }) {
  const features = ['Verified transfers', 'Fan-first pricing', 'Instant delivery'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 * u }}>
      {features.map(f => (
        <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 6 * u }}>
          <span style={{ width: 4 * u, height: 4 * u, borderRadius: '50%', background: color || NEON.green }} />
          <span style={{ fontFamily: FONTS.body, fontSize: 9 * u, color: TEXT.body }}>{f}</span>
        </div>
      ))}
    </div>
  );
}
function TeamStripes({ u, color }) {
  return (
    <div style={{ display: 'flex', height: 4 * u }}>
      <div style={{ flex: 1, background: color || NEON.orange }} />
      <div style={{ flex: 1, background: '#ffffff22' }} />
    </div>
  );
}
function BroadcastFrame({ u, color }) {
  return <div style={{ position: 'absolute', inset: 4 * u, border: `${2 * u}px solid`, borderColor: `${color || NEON.orange}33`, borderRadius: 4 * u }} />;
}
function RuledLines({ u, w, h }) {
  const lines = [];
  const count = 18;
  for (let i = 1; i <= count; i++) {
    lines.push(
      <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: `${(i / (count + 1)) * 100}%`, height: 1, background: 'rgba(100,130,200,0.15)' }} />
    );
  }
  return <>{lines}</>;
}
function RedMargin({ u, h }) {
  return <div style={{ position: 'absolute', left: '8%', top: 0, bottom: 0, width: 1, background: 'rgba(200,80,80,0.25)' }} />;
}
function IssueDate({ u }) {
  const now = new Date();
  return <span style={{ fontFamily: FONTS.body, fontSize: 7 * u, color: TEXT.faint }}>ISSUE {now.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }).toUpperCase()}</span>;
}

// ── Registry ────────────────────────────────────────────────────────────
export const DECORATIVE_REGISTRY = {
  // Borders & Frames
  thin_border: ThinBorder,
  gold_border: GoldBorder,
  border_frame: BorderFrame,
  card_frame: CardFrame,
  scoreboard_frame: ScoreboardFrame,
  sign_frame: SignFrame,
  broadcast_frame: BroadcastFrame,

  // Dividers & Lines
  dotted_dividers: DottedDividers,
  column_rules: ColumnRules,
  gradient_accent_line: GradientAccentLine,
  hairline_accent: HairlineAccent,
  ornamental_divider: OrnamentalDivider,
  measurement_marks: MeasurementMarks,
  dimension_lines: DimensionLines,
  grid_lines: GridLines,
  ruled_lines: RuledLines,
  red_margin: RedMargin,

  // Stamps & Seals
  official_stamp: OfficialStamp,
  monogram: Monogram,
  date_stamp: DateStamp,
  photo_credit: PhotoCredit,
  source_citation: SourceCitation,

  // Data Elements
  barcode: Barcode,
  serial_number: SerialNumber,
  transaction_id: TransactionId,
  timestamp: Timestamp,
  folio: Folio,
  dateline: Dateline,
  racing_number: RacingNumber,
  version_badge: VersionBadge,
  issue_date: IssueDate,

  // Text Blocks
  credits_block: CreditsBlock,
  info_pile: InfoPile,
  masthead: Masthead,
  cover_lines: CoverLines,
  ticker_bar: TickerBar,
  breaking_banner: BreakingBanner,
  live_indicator: LiveIndicator,
  caption_bar: CaptionBar,

  // Structural
  paper_card: PaperCard,
  newsprint_card: NewsprintCard,
  ticket_card: TicketCard,
  perforation: Perforation,
  field_grid: FieldGrid,
  lanyard_strip: LanyardStrip,
  holographic_strip: HolographicStrip,
  wristband_band: WristbandBand,
  repeating_pattern: RepeatingPattern,
  stat_boxes: StatBoxes,
  clock_display: ClockDisplay,
  data_cards: DataCards,
  trend_indicators: TrendIndicators,
  corner_annotations: CornerAnnotations,
  title_block: TitleBlock,

  // Atmospheric
  single_light_glow: SingleLightGlow,
  spotlight_cone: SpotlightCone,
  haze_particles: HazeParticles,
  stage_floor: StageFloor,
  light_beams: LightBeams,
  color_washes: ColorWashes,
  dust_particles: DustParticles,

  // Patterns
  seat_dot_grid: SeatDotGrid,
  stage_shape: StageShape,
  highlighted_zone: HighlightedZone,
  compass: Compass,
  speed_lines: SpeedLines,
  carbon_fiber: CarbonFiber,
  crack_lines: CrackLines,
  shard_fragments: ShardFragments,

  // Accents
  starburst: Starburst,
  arrows: Arrows,
  tape_strip: TapeStrip,
  spray_accent: SprayAccent,
  route_bullet: RouteBullet,
  glow_accents: GlowAccents,
  doodles: Doodles,
  stat_bars: StatBars,
  color_blocks: ColorBlocks,
  chevron_accents: ChevronAccents,
  brand_wordmark: BrandWordmark,
  feature_bullets: FeatureBullets,
  team_stripes: TeamStripes,
};

// Elements that should be rendered as background layer (behind content)
export const BACKGROUND_DECORATIVES = new Set([
  'ruled_lines', 'red_margin', 'carbon_fiber', 'crack_lines', 'speed_lines',
  'seat_dot_grid', 'stage_shape', 'highlighted_zone', 'light_beams',
  'color_washes', 'single_light_glow', 'spotlight_cone', 'haze_particles',
  'stage_floor', 'dust_particles', 'shard_fragments', 'glow_accents',
  'sign_frame', 'broadcast_frame', 'scoreboard_frame', 'thin_border',
  'gold_border', 'border_frame', 'card_frame', 'perforation',
  'lanyard_strip', 'holographic_strip', 'wristband_band', 'repeating_pattern',
  'paper_card', 'newsprint_card', 'ticket_card', 'tape_strip', 'spray_accent',
  'column_rules', 'grid_lines', 'measurement_marks', 'dimension_lines',
  'corner_annotations', 'title_block', 'compass',
]);

// Elements that should be rendered inline with content (in hierarchy flow)
export const INLINE_DECORATIVES = new Set([
  'credits_block', 'info_pile', 'masthead', 'cover_lines', 'ticker_bar',
  'breaking_banner', 'live_indicator', 'caption_bar', 'official_stamp',
  'monogram', 'date_stamp', 'photo_credit', 'source_citation', 'barcode',
  'serial_number', 'transaction_id', 'timestamp', 'folio', 'dateline',
  'racing_number', 'version_badge', 'issue_date', 'starburst', 'arrows',
  'doodles', 'stat_bars', 'color_blocks', 'chevron_accents', 'brand_wordmark',
  'feature_bullets', 'team_stripes', 'stat_boxes', 'clock_display',
  'data_cards', 'trend_indicators', 'gradient_accent_line', 'hairline_accent',
  'ornamental_divider', 'field_grid', 'route_bullet',
]);

export function renderDecorative(id, props) {
  const Comp = DECORATIVE_REGISTRY[id];
  if (!Comp) return null;
  return <Comp {...props} />;
}