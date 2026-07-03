import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { formatDistanceToNow } from 'date-fns';
import { RefreshCw, ShieldCheck, XCircle, Eye, TrendingUp, Anchor } from 'lucide-react';

const REC_META = {
  open: { label: 'Open', color: '#00FF87', bg: 'rgba(0,255,135,0.08)', border: 'rgba(0,255,135,0.3)', icon: '✅' },
  likely_open: { label: 'Likely Open', color: '#00C8FF', bg: 'rgba(0,200,255,0.08)', border: 'rgba(0,200,255,0.25)', icon: '🙂' },
  closing_soon: { label: 'Closing Soon', color: '#FF8C00', bg: 'rgba(255,140,0,0.08)', border: 'rgba(255,140,0,0.3)', icon: '⚠️' },
  closed: { label: 'Closed', color: '#FF2D78', bg: 'rgba(255,45,120,0.08)', border: 'rgba(255,45,120,0.3)', icon: '🚫' },
  unknown: { label: 'Unknown', color: '#BF5FFF', bg: 'rgba(191,95,255,0.08)', border: 'rgba(191,95,255,0.25)', icon: '❓' },
  admin_review: { label: 'Admin Review', color: '#FFE600', bg: 'rgba(255,230,0,0.08)', border: 'rgba(255,230,0,0.3)', icon: '🧐' },
  manually_verified_open: { label: 'Admin: Open', color: '#00FF87', bg: 'rgba(0,255,135,0.08)', border: 'rgba(0,255,135,0.3)', icon: '🛡️' },
  manually_verified_closed: { label: 'Admin: Closed', color: '#FF2D78', bg: 'rgba(255,45,120,0.08)', border: 'rgba(255,45,120,0.3)', icon: '🛡️' },
};

const EVIDENCE_LABELS = {
  official_partner: 'Official Partner',
  manual_verification: 'Manual Verification',
  historical_success: 'Historical Venue Success',
  historical_failures: 'Recent Failed Transfers',
  community_reports_positive: 'Community Reports (available)',
  community_reports_negative: 'Community Reports (unavailable)',
  time_inference: 'Time Inference',
  venue_patterns: 'Venue Pattern Learning',
  platform_patterns: 'Platform Patterns',
  seller_history: 'Seller History',
  buyer_history: 'Buyer History',
};

function closedColor(s) {
  if (s == null) return '#71717a';
  if (s >= 90) return '#FF2D78';
  if (s >= 70) return '#FF8C00';
  return '#71717a';
}
function openColor(s) {
  if (s == null) return '#71717a';
  if (s >= 80) return '#00FF87';
  if (s >= 60) return '#00C8FF';
  return '#71717a';
}

function EvidenceBreakdown({ evidence }) {
  if (!evidence) return null;
  const entries = Object.entries(evidence)
    .filter(([, v]) => typeof v === 'number' && Math.abs(v) >= 1)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  if (entries.length === 0) {
    return <p className="text-[10px] text-muted-foreground italic">No directional evidence yet — monitoring.</p>;
  }
  return (
    <div className="space-y-1">
      <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-wide">
        Evidence <span className="font-normal normal-case opacity-70">(positive → supports open)</span>
      </div>
      {entries.map(([key, val]) => {
        const positive = val >= 0;
        return (
          <div key={key} className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground truncate flex-1 min-w-0 pr-2">{EVIDENCE_LABELS[key] || key}</span>
            <span className="font-bold flex-shrink-0" style={{ color: positive ? '#00FF87' : '#FF2D78' }}>
              {positive ? '+' : ''}{Math.round(val)}
            </span>
          </div>
        );
      })}
    </div>
  );
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

  // Most at-risk first (closed-confidence desc)
  const sorted = [...events].sort(
    (a, b) => (b.transfer_closed_confidence_score ?? -1) - (a.transfer_closed_confidence_score ?? -1)
  );

  const counts = { closed: 0, closing_soon: 0, open: 0, likely_open: 0, unknown: 0, admin_review: 0 };
  events.forEach(e => {
    const r = e.transfer_confidence_recommendation;
    if (!r) return;
    counts[r] = (counts[r] || 0) + 1;
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
            <span className="text-base">🧠</span> Transfer Intelligence Engine
          </h3>
          <p className="text-[11px] text-muted-foreground">
            Explainable · momentum-stable · freshness-decayed · continuously learning
          </p>
        </div>
        <button onClick={load} disabled={loading} className="p-1.5 rounded-lg hover:bg-muted flex-shrink-0">
          <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Recommendation summary */}
      <div className="grid grid-cols-6 gap-1">
        {[
          { label: 'Closed', value: counts.closed, color: '#FF2D78' },
          { label: 'Closing', value: counts.closing_soon, color: '#FF8C00' },
          { label: 'Open', value: counts.open, color: '#00FF87' },
          { label: 'Likely', value: counts.likely_open, color: '#00C8FF' },
          { label: 'Unknown', value: counts.unknown, color: '#BF5FFF' },
          { label: 'Review', value: counts.admin_review, color: '#FFE600' },
        ].map(s => (
          <div key={s.label} className="rounded-xl p-2 text-center"
            style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${s.value > 0 ? s.color + '30' : 'rgba(255,255,255,0.06)'}` }}>
            <div className="text-base font-black" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[8px] text-muted-foreground leading-tight">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Venue historical rates */}
      {topVenues.length > 0 && (
        <div className="rounded-xl p-3 space-y-1.5"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" style={{ color: '#00FF87' }} /> Learned Venue Transfer Rates
          </div>
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
        <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-24 rounded-xl bg-white/5 animate-pulse" />)}</div>
      ) : sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">No events loaded.</p>
      ) : (
        <div className="space-y-2 max-h-[520px] overflow-y-auto -mr-1 pr-1">
          {sorted.map(ev => {
            const rec = ev.transfer_confidence_recommendation;
            const meta = REC_META[rec] || REC_META.unknown;
            const isOverride = ev.transfer_window_status === 'manually_verified_open' || ev.transfer_window_status === 'manually_verified_closed';
            const oc = ev.transfer_open_confidence_score;
            const cc = ev.transfer_closed_confidence_score;
            const mom = ev.transfer_confidence_momentum;
            const updated = ev.transfer_confidence_last_updated ? formatDistanceToNow(new Date(ev.transfer_confidence_last_updated), { addSuffix: true }) : null;
            return (
              <div key={ev.id} className="rounded-xl p-3 space-y-2.5"
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

                {/* Directional score bars */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-bold w-12 flex-shrink-0" style={{ color: closedColor(cc) }}>CLOSED</span>
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${cc ?? 0}%`, background: closedColor(cc) }} />
                    </div>
                    <span className="text-[10px] font-black w-6 text-right flex-shrink-0" style={{ color: closedColor(cc) }}>{cc ?? '—'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-bold w-12 flex-shrink-0" style={{ color: openColor(oc) }}>OPEN</span>
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${oc ?? 0}%`, background: openColor(oc) }} />
                    </div>
                    <span className="text-[10px] font-black w-6 text-right flex-shrink-0" style={{ color: openColor(oc) }}>{oc ?? '—'}</span>
                  </div>
                </div>

                {/* Evidence breakdown (Explainable AI) */}
                <EvidenceBreakdown evidence={ev.transfer_confidence_evidence} />

                {/* Momentum indicator */}
                {mom && (
                  <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
                    <Anchor className="w-3 h-3 flex-shrink-0" />
                    {mom.bypassed ? (
                      <span style={{ color: '#BF5FFF' }}>Momentum bypassed (authoritative source)</span>
                    ) : mom.open == null ? (
                      <span>First scan</span>
                    ) : (
                      <span>Momentum: open {mom.open >= 0 ? '+' : ''}{mom.open} · closed {mom.closed >= 0 ? '+' : ''}{mom.closed} (≤15/scan)</span>
                    )}
                  </div>
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