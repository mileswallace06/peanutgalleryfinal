import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

/**
 * FounderStoryCard — compact card for the Upgrades page.
 * "Built by a fan — meet Miles" with a typography-only lockup (no portrait).
 * Links to /our-story. Works signed in or out.
 */
export default function FounderStoryCard() {
  return (
    <Link
      to="/our-story"
      className="flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all active:scale-[0.98]"
      style={{
        background: 'rgba(var(--neon-purple-rgb), 0.06)',
        border: '1px solid rgba(var(--neon-purple-rgb), 0.2)',
      }}
    >
      <div
        className="flex-shrink-0 text-[10px] uppercase tracking-[0.15em] px-2.5 py-1.5 rounded-md"
        style={{
          background: 'rgba(var(--neon-purple-rgb), 0.1)',
          border: '1px solid rgba(var(--neon-purple-rgb), 0.25)',
          color: 'var(--neon-purple)',
          fontFamily: 'var(--font-mono-label)',
        }}
      >
        MW
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-foreground">Built by a fan</div>
        <div className="text-[10px] text-muted-foreground">Meet Miles</div>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
    </Link>
  );
}