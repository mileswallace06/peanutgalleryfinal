export default function FanZone() {
  return (
    <div className="rave-bg min-h-screen pb-28">
      {/* Hero */}
      <div className="relative h-56 overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=900&q=80"
          alt="Fan Zone"
          className="w-full h-full object-cover object-top"
        />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, rgba(5,3,12,0.45) 0%, rgba(5,3,12,0.2) 40%, rgba(5,3,12,0.92) 100%)' }}
        />

        <div className="absolute top-5 left-4">
          <span className="text-[10px] font-black tracking-[0.2em] px-3 py-1 rounded-full inline-block"
            style={{ background: 'rgba(0,0,0,0.5)', color: '#FFE600', border: '1px solid #FFE60055', backdropFilter: 'blur(12px)' }}>
            🎤 FAN ZONE
          </span>
        </div>

        <div className="absolute bottom-5 left-4 right-4">
          <h1 className="font-display mb-3"
            style={{
              fontSize: 'clamp(3rem, 12vw, 4.5rem)',
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
              background: 'linear-gradient(135deg, #00C8FF 0%, #FF2D78 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              filter: 'drop-shadow(0 0 30px rgba(0,255,135,0.4)), drop-shadow(0 6px 24px rgba(0,0,0,0.6))'
            }}>
            Fan Zone
          </h1>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full"
            style={{ background: 'rgba(255,230,0,0.15)', border: '1px solid rgba(255,230,0,0.35)' }}>
            <span className="text-[11px] font-medium leading-snug" style={{ color: 'rgba(255,250,210,0.9)' }}>
              Share concert moments and connect with fans in your section.
            </span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 pt-8 flex flex-col items-center text-center gap-4">
        <div className="text-5xl">🎤</div>
        <p className="font-bold text-foreground text-lg">No posts yet</p>
        <p className="text-sm text-muted-foreground max-w-[260px] leading-relaxed">
          Be the first to share a concert video or seat flex!
        </p>
        <div className="mt-4 text-xs text-muted-foreground px-4 py-3 rounded-2xl"
          style={{ background: 'rgba(255,230,0,0.05)', border: '1px solid rgba(255,230,0,0.15)' }}>
          🚧 Fan Zone coming soon — community posts, seat flex & more.
        </div>
      </div>
    </div>
  );
}