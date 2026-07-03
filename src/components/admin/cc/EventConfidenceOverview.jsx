import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { formatDistanceToNow } from 'date-fns';
import { RefreshCw, ShieldCheck, XCircle, Eye } from 'lucide-react';

const STATUS_META = {
  closed: { label: 'Closed', color: '#FF2D78', bg: 'rgba(255,45,120,0.08)', border: 'rgba(255,45,120,0.3)', icon: '🚫' },
  closing_soon: { label: 'Closing Soon', color: '#FF8C00', bg: 'rgba(255,140,0,0.08)', border: 'rgba(255,140,0,0.3)', icon: '⚠️' },
  open: { label: 'Open', color: '#00C8FF', bg: 'rgba(0,200,255,0.08)', border: 'rgba(0,200,255,0.25)', icon: '✅' },
  unknown: { label: 'Unknown', color: '#BF5FFF', bg: 'rgba(191,95,255,0.08)', border: 'rgba(191,95,255,0.25)', icon: '❓' },
  manually_verified_open: { label: 'Admin: Open', color: '#00FF87', bg: 'rgba(0,255,135,0.08)', border: 'rgba(0,255,135,0.3)', icon: '🛡️' },
  manually_verified_closed: { label: 'Admin: Closed', color: '#FF2D78', bg: 'rgba(255,45,120,0.08)', border: 'rgba(255,45,120,0.3)', icon: '🛡️' },
};

function scoreColor(s) {
  if (s == null) return '#71717a';
  if (s >= 90) return '#FF2D78';
  if (s >= 70) return '#FF8C00';
  if (s >= 40) return '#00C8FF';
  return '#BF5FFF';
}

export default function EventConfidenceOverview() {
  const [events, setEvents] = useState([]);
  const [intel, setIntel] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [upcoming, live, ti] = await Promise.all([
        base44.entities.Event.filter({ status: 'upcoming' }, 'event_start_utc', 80).catch(() => []),
        base44.entities.Event.filter({ status: 'live' }, 'event_start_utc', 40).catch(() => []),
        base44.entities.TransferIntelligence.list('-created_date', 200).catch(() => []),
      ]);
      setEvents([...upcoming, ...live]);
      setIntel(ti);
    } catch (_) {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Venue historical success rates
  const venueStats = {};
  intel.forEach(i => {
    if (!i.venue) return;
    const v = venueStats[i.venue] ||= { success: 0, fail: 0, total: 0 };
    v.total++;
    if (i.transfer_successful) v.success++; else v.fail++;
  });
  const topVenues = Object.entries(venueStats)
    .filter(([, v]) => v.total >= 2)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 5);

  const sorted = [...events].sort(
    (a, b) => (b.transfer_confidence_score ?? -1) - (a.transfer_confidence_score ?? -1)
  );

  const counts = { closed: 0, closing_soon: 0, open: 0, unknown: 0, scored: 0 };
  events.forEach(e => {
    const s = e.transfer_confidence_score;
    if (s == null) return;
    counts.scored++;
    if (s >= 90) counts.closed++;
    else if (s >= 70) counts.closing_soon++;
    else if (s >= 40) counts.open++;
    else counts.unknown++;
  });

  const override = async (ev, status) => {
    setBusy(ev.id + status);
    try {
      await base44.entities.Event.update(ev.id, {
        transfer_window_status: status,
        transfer_window_source: 'manual_admin',
        transfer_confidence_last_updated: new Date().toISOString(),
      });
      await load();
    } catch (_) {}
    setBusy('');
  };

  const clearOverride = async (ev) => {
    setBusy(ev.id + 'clear');
    try {
      await base44.entities.Event.update(ev.id, {
        transfer_window_status: 'unknown',
        transfer_window_source: 'inferred',
        transfer_confidence_last_updated: new Date().toISOString(),
      });
      await load();
    } catch (_) {}
    setBusy('');
  };

  return (
    <div className="rounded-2xl p-4 space-y-4"
      style={{ background: 'rgba(191,95,255,0.04)', border: '1px solid rgba(191,95,255,0.18)' }}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-sm text-foreground flex items-center gap-1.5">
            <span className="text-base">🧠</span> Transfer Confidence Engine
          </h3>
          <p className="text-[11px] text-muted-foreground">
            Event-level confidence that transfers are closed · single source of truth for badges, visibility & upgrades
          </p>
        </div>
        <button onClick={load} disabled={loading} className="p-1.5 rounded-lg hover:bg-muted flex-shrink-0">
          <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Tier summary */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Closed 90+', value: counts.closed, color: '#FF2D78' },
          { label: 'Closing 70-89', value: counts.closing_soon, color: '#FF8C00' },
          { label: 'Open 40-69', value: counts.open, color: '#00C8FF' },
          { label: 'Unknown 0-39', value: counts.unknown, color: '#BF5FFF' },
        ].map(s => (
          <div key={s.label} className="rounded-xl p-2.5 text-center"
            style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${s.value > 0 ? s.color + '30' : 'rgba(255,255,255,0.06)'}` }}>
            <div className="text-lg font-black" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[9px] text-muted-foreground leading-tight">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Venue historical rates */}
      {topVenues.length > 0 && (
        <div className="rounded-xl p-3 space-y-1.5"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="text-[11px] font-bold text-foreground">📈 Learned Venue Transfer Rates</div>
          {topVenues.map(([venue, v]) => {
            const pct = Math.round((v.success / v.total) * 100);
            return (
              <div key={venue} className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground truncate flex-1 min-w-0 pr-2">{venue}</span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  <span style={{ color: pct >= 70 ? '#00FF87' : pct >= 40 ? '#FF8C00' : '#FF2D78' }}>{pct}% success</span>
                  <span className="text-muted-foreground">({v.total})</span>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Event list */}
      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-white/5 animate-pulse" />)}</div>
      ) : sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">No events loaded.</p>
      ) : (
        <div className="space-y-2 max-h-[420px] overflow-y-auto -mr-1 pr-1">
          {sorted.map(ev => {
            const s = ev.transfer_confidence_score;
            const meta = STATUS_META[ev.transfer_window_status] || STATUS_META.unknown;
            const isOverride = ev.transfer_window_status === 'manually_verified_open' || ev.transfer_window_status === 'manually_verified_closed';
            const updated = ev.transfer_confidence_last_updated ? formatDistanceToNow(new Date(ev.transfer_confidence_last_updated), { addSuffix: true }) : null;
            return (
              <div key={ev.id} className="rounded-xl p-3 space-y-2"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-xs text-foreground truncate">{ev.title || ev.id}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{ev.venue}{ev.city ? ` · ${ev.city}` : ''}</div>
                  </div>
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.border}` }}>
                    {meta.icon} {meta.label}
                  </span>
                </div>

                {/* Score bar */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${s ?? 0}%`, background: scoreColor(s) }} />
                  </div>
                  <span className="text-xs font-black flex-shrink-0" style={{ color: scoreColor(s) }}>{s ?? '—'}</span>
                </div>

                {/* Reason */}
                {ev.transfer_confidence_reason && (
                  <p className="text-[10px] text-muted-foreground leading-snug">{ev.transfer_confidence_reason}</p>
                )}
                {updated && <p className="text-[9px] text-muted-foreground opacity-60">Updated {updated}</p>}

                {/* Override controls */}
                <div className="flex flex-wrap gap-1.5 pt-1 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                  <button onClick={() => override(ev, 'manually_verified_open')} disabled={!!busy}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold disabled:opacity-40"
                    style={{ background: 'rgba(0,255,135,0.08)', color: '#00FF87', border: '1px solid rgba(0,255,135,0.25)' }}>
                    <ShieldCheck className="w-3 h-3" /> Mark Open
                  </button>
                  <button onClick={() => override(ev, 'manually_verified_closed')} disabled={!!busy}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold disabled:opacity-40"
                    style={{ background: 'rgba(255,45,120,0.08)', color: '#FF2D78', border: '1px solid rgba(255,45,120,0.25)' }}>
                    <XCircle className="w-3 h-3" /> Mark Closed
                  </button>
                  {isOverride && (
                    <button onClick={() => clearOverride(ev)} disabled={!!busy}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold disabled:opacity-40"
                      style={{ background: 'rgba(255,230,0,0.08)', color: '#FFE600', border: '1px solid rgba(255,230,0,0.25)' }}>
                      <Eye className="w-3 h-3" /> Clear Override
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}