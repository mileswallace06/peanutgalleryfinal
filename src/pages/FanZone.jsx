export default function FanZone() {
  return (
    <div className="rave-bg min-h-screen pb-28">
      {/* Hero */}
      <div className="relative h-52 overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=800&q=80"
          alt="Fan Zone"
          className="w-full h-full object-cover"
          style={{ filter: 'brightness(0.45) saturate(1.4)' }}
        />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, transparent 20%, rgba(13,11,20,0.95) 100%)' }} />
        <div className="absolute bottom-0 left-0 px-5 pb-5">
          <div className="text-[10px] font-bold tracking-[0.25em] uppercase mb-2" style={{ color: '#FFE600' }}>
            🥜 PEANUT GALLERY
          </div>
          <h1 className="font-display text-foreground leading-tight" style={{ fontSize: 'clamp(2.2rem, 10vw, 3rem)' }}>
            Fan Zone
          </h1>
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