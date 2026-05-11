import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { getEventLiveStatus, resolveTimezone, formatInVenueTimezone } from '@/lib/eventTiming';
import { Clock, AlertTriangle, RefreshCw } from 'lucide-react';

const STATUS_STYLE = {
  upcoming: { color: '#BF5FFF', bg: 'rgba(191,95,255,0.12)', border: 'rgba(191,95,255,0.3)', label: 'Upcoming' },
  soon:     { color: '#FFE600', bg: 'rgba(255,230,0,0.12)',  border: 'rgba(255,230,0,0.3)',  label: 'Starting Soon' },
  live:     { color: '#00FF87', bg: 'rgba(0,255,135,0.12)',  border: 'rgba(0,255,135,0.3)',  label: 'LIVE' },
  ended:    { color: '#888',    bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.1)', label: 'Ended' },
};

export default function EventTimingDebug() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  const load = async () => {
    setLoading(true);
    const data = await base44.entities.Event.list('date', 50);
    setEvents(data.filter(e => e.status !== 'ended' || e.is_beta_live));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Refresh "now" every 30s so status stays current without a full reload
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const currentUtc = new Date(nowMs).toISOString();

  return (
    <div className="bg-card border border-border rounded-2xl p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-primary" />
          <h2 className="font-bold text-lg">Event Timing Debug</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground font-mono">UTC now: {currentUtc}</span>
          <button onClick={() => { setNowMs(Date.now()); load(); }} disabled={loading}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loading && events.length === 0 ? (
        <div className="text-sm text-muted-foreground">Loading events…</div>
      ) : events.length === 0 ? (
        <div className="text-sm text-muted-foreground">No active events.</div>
      ) : (
        <div className="space-y-3">
          {events.map(event => {
            const timing = getEventLiveStatus(event, nowMs);
            const { timezone, warning } = resolveTimezone(event);
            const st = STATUS_STYLE[timing.status] || STATUS_STYLE.upcoming;
            const startUtcMs = timing.start_utc_ms;
            const endUtcMs = timing.end_utc_ms;

            return (
              <div key={event.id}
                className="rounded-xl p-4 text-xs space-y-2"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>

                {/* Header row */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="font-semibold text-sm text-foreground">{event.title}</div>
                  <span className="text-[10px] font-black px-2.5 py-1 rounded-full"
                    style={{ background: st.bg, color: st.color, border: `1px solid ${st.border}` }}>
                    {timing.is_beta_live ? '⚡ BETA LIVE' : st.label}
                  </span>
                </div>

                {/* Timezone warning */}
                {warning && (
                  <div className="flex items-start gap-1.5 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0 mt-0.5" />
                    <span className="text-amber-400">{warning}</span>
                  </div>
                )}

                {/* Timing grid */}
                <div className="grid grid-cols-2 gap-2">
                  <DebugRow label="Venue Timezone" value={timezone} mono />
                  <DebugRow label="Duration" value={`${timing.duration_hours}h`} />

                  {event.event_start_local && (
                    <DebugRow label="Local Start (entered)" value={event.event_start_local} mono />
                  )}
                  {startUtcMs ? (
                    <>
                      <DebugRow label="UTC Start" value={new Date(startUtcMs).toISOString()} mono />
                      <DebugRow label="Local at Venue"
                        value={formatInVenueTimezone(startUtcMs, timezone)} mono />
                      <DebugRow label="Live Window End"
                        value={endUtcMs ? new Date(endUtcMs).toISOString() : '—'} mono />
                    </>
                  ) : (
                    <DebugRow label="UTC Start" value="⚠️ No start time" warn />
                  )}

                  <DebugRow label="Current UTC" value={currentUtc} mono />

                  {timing.minutes_until_start !== null && timing.minutes_until_start > 0 && (
                    <DebugRow label="Starts In" value={`${Math.round(timing.minutes_until_start)} min`} />
                  )}
                  {timing.minutes_since_start !== null && timing.minutes_since_start > 0 && (
                    <DebugRow label="Started" value={`${Math.round(timing.minutes_since_start)} min ago`} />
                  )}
                  {timing.minutes_until_end !== null && timing.minutes_until_end > 0 && (
                    <DebugRow label="Ends In" value={`${Math.round(timing.minutes_until_end)} min`} />
                  )}
                </div>

                {/* Field presence check */}
                <div className="flex gap-2 flex-wrap pt-1">
                  <FieldBadge label="event_start_utc" present={!!event.event_start_utc} />
                  <FieldBadge label="venue_timezone" present={!!event.venue_timezone} />
                  <FieldBadge label="event_start_local" present={!!event.event_start_local} />
                  <FieldBadge label="duration_hours" present={!!event.duration_hours} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DebugRow({ label, value, mono, warn }) {
  return (
    <div className="bg-secondary rounded-lg px-2.5 py-2 border border-border">
      <div className="text-muted-foreground font-medium uppercase tracking-wide text-[9px] mb-0.5">{label}</div>
      <div className={`text-[11px] ${mono ? 'font-mono' : 'font-semibold'} ${warn ? 'text-amber-400' : 'text-foreground'} break-all`}>
        {value}
      </div>
    </div>
  );
}

function FieldBadge({ label, present }) {
  return (
    <span className="text-[9px] font-mono px-2 py-0.5 rounded-full"
      style={{
        background: present ? 'rgba(0,255,135,0.1)' : 'rgba(255,45,120,0.1)',
        color: present ? '#00FF87' : '#FF2D78',
        border: `1px solid ${present ? 'rgba(0,255,135,0.25)' : 'rgba(255,45,120,0.25)'}`,
      }}>
      {present ? '✓' : '✗'} {label}
    </span>
  );
}