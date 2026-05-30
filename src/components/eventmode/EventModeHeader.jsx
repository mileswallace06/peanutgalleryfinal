/**
 * EventModeHeader — sticky top bar showing event name, live badge,
 * current time, and transfer window status.
 */
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { format } from 'date-fns';

function TransferWindowPill({ event }) {
  if (!event) return null;
  const status = event.transfer_window_status || 'unknown';
  const isOpen = status.includes('open');
  const isClosed = status.includes('closed');
  const closesAt = event.transfer_window_closes_at;

  return (
    <div className="flex items-center gap-1.5 text-[10px] font-bold">
      <div className="w-1.5 h-1.5 rounded-full animate-pulse"
        style={{ background: isOpen ? '#00FF87' : isClosed ? '#FF2D78' : '#FF8C00' }} />
      <span style={{ color: isOpen ? '#00FF87' : isClosed ? '#FF2D78' : '#FF8C00' }}>
        Transfer {isOpen ? 'Open' : isClosed ? 'Closed' : 'Unknown'}
      </span>
      {closesAt && isOpen && (
        <span className="text-muted-foreground font-normal">
          · closes {format(new Date(closesAt), 'h:mm a')}
        </span>
      )}
    </div>
  );
}

export default function EventModeHeader({ event, eventId, loading, onRefresh }) {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="sticky top-0 z-40 border-b border-border"
      style={{ background: 'rgba(0,0,0,0.96)', backdropFilter: 'blur(24px)' }}>
      {/* Top accent line */}
      <div className="h-0.5" style={{ background: 'linear-gradient(90deg, #BF5FFF, #FF2D78, #FFE600, #00FF87)' }} />
      <div className="px-4 py-3">
        <div className="flex items-center gap-3">
          {/* Live badge */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#FF2D78' }} />
            <span className="text-[10px] font-black tracking-[0.15em]" style={{ color: '#FF2D78' }}>LIVE</span>
          </div>

          <div className="flex-1 min-w-0">
            <p className="font-black text-sm text-foreground truncate leading-tight">
              {event?.title || 'Loading…'}
            </p>
            <div className="flex items-center gap-2 flex-wrap mt-0.5">
              <TransferWindowPill event={event} />
              <span className="text-[10px] text-muted-foreground">{format(time, 'h:mm a')}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <Link to={`/events/${eventId}`} className="text-[10px] text-muted-foreground hover:text-foreground hidden sm:block">
              Full Page →
            </Link>
            <button onClick={onRefresh} disabled={loading} className="p-1.5 rounded-lg hover:bg-muted">
              <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}