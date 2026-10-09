import { useState, useEffect } from 'react';
import { adminEventIdentity } from '@/lib/salesPresentation';
import { base44 } from '@/api/base44Client';
import { RefreshCw, ShieldCheck, XCircle, AlertTriangle, ExternalLink } from 'lucide-react';
import { getTransferStatusBadge, formatVerificationAge, isVerificationExpired } from '@/lib/transferConfidence';
import EventConfidenceOverview from '@/components/admin/cc/EventConfidenceOverview';

function ListingRow({ listing, event, onAdminVerify, onDisable, onOverride, onRestore }) {
  const badge = getTransferStatusBadge(listing);
  const score = listing.transfer_confidence_score ?? '?';
  const age = formatVerificationAge(listing.last_transfer_verification);
  const expired = isVerificationExpired(listing);
  const [overrideScore, setOverrideScore] = useState('');
  const [showOverride, setShowOverride] = useState(false);

  return (
    <div className="pg-operations-card rounded-xl p-3 text-xs space-y-2"
      style={{ background: 'var(--pg-surface)', border: '1px solid var(--pg-line)' }}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-foreground break-words">
            {adminEventIdentity(event, listing.event_id)} · Sec {listing.section} Row {listing.row}
          </div>
          <div className="text-muted-foreground">{listing.seller_email}</div>
        </div>
        <span className="pg-operations-status text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
          style={{ background: badge.bg, '--pg-status-ink': badge.color, border: `1px solid ${badge.border}` }}>
          {badge.icon} {badge.label}
        </span>
      </div>

      <div className="flex items-center gap-3 flex-wrap text-muted-foreground">
        <span>Confidence: <strong className="text-foreground">{score}</strong>/100</span>
        <span>Method: <strong className="text-foreground">{listing.transfer_verification_method || 'none'}</strong></span>
        {age && <span>{expired ? '⏱ ' : ''}{age}</span>}
      </div>

      {listing.transfer_verification_proof_url && (
        <a href={listing.transfer_verification_proof_url} target="_blank" rel="noopener noreferrer"
          className="pg-operations-status inline-flex items-center gap-1 text-[10px] font-medium hover:underline"
          style={{ '--pg-status-ink': '#BF5FFF' }}>
          <ExternalLink className="w-3 h-3" /> View proof
        </a>
      )}

      <div className="flex flex-wrap gap-2 pt-1 border-t" style={{ borderColor: 'var(--pg-line)' }}>
        {listing.status === 'hidden' ? (
          <button onClick={() => onRestore(listing)}
            className="pg-operations-status flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold"
            style={{ background: 'color-mix(in srgb, rgb(0 200 255) 8%, var(--pg-surface))', '--pg-status-ink': '#00C8FF', border: '1px solid rgba(0,200,255,0.25)' }}>
            <RefreshCw className="w-3 h-3" /> Restore Listing
          </button>
        ) : (
          <button onClick={() => onAdminVerify(listing)}
            className="pg-operations-status flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold"
            style={{ background: 'color-mix(in srgb, rgb(0 255 135) 8%, var(--pg-surface))', '--pg-status-ink': '#00FF87', border: '1px solid rgba(0,255,135,0.25)' }}>
            <ShieldCheck className="w-3 h-3" /> Admin Verify
          </button>
        )}
        <button onClick={() => onDisable(listing)}
          disabled={listing.status === 'hidden'}
          className="pg-operations-status flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold disabled:opacity-40"
          style={{ background: 'color-mix(in srgb, rgb(255 45 120) 8%, var(--pg-surface))', '--pg-status-ink': '#FF2D78', border: '1px solid rgba(255,45,120,0.25)' }}>
          <XCircle className="w-3 h-3" /> Disable Transfer
        </button>
        <button onClick={() => setShowOverride(v => !v)}
          className="pg-operations-status flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold"
          style={{ background: 'color-mix(in srgb, rgb(255 230 0) 8%, var(--pg-surface))', '--pg-status-ink': '#FFE600', border: '1px solid rgba(255,230,0,0.25)' }}>
          <AlertTriangle className="w-3 h-3" /> Override Score
        </button>
      </div>

      {showOverride && (
        <div className="flex items-center gap-2 pt-1">
          <input type="number" min="0" max="100" value={overrideScore}
            onChange={e => setOverrideScore(e.target.value)}
            placeholder="0–100"
            className="w-20 px-2 py-1 rounded text-xs text-foreground focus:outline-none"
            style={{ background: 'var(--pg-surface-raised)', border: '1px solid var(--pg-line)' }} />
          <button onClick={() => { onOverride(listing, parseInt(overrideScore)); setShowOverride(false); setOverrideScore(''); }}
            disabled={!overrideScore}
            className="pg-operations-status px-3 py-1 rounded-lg text-xs font-semibold disabled:opacity-40"
            style={{ background: 'color-mix(in srgb, rgb(255 230 0) 12%, var(--pg-surface))', '--pg-status-ink': '#FFE600', border: '1px solid rgba(255,230,0,0.3)' }}>
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

export default function TransferIntelligencePanel({ events: eventsMap, onRefresh }) {
  const [listings, setListings] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [localEvents, setLocalEvents] = useState({});
  const resolvedEvents = { ...eventsMap, ...localEvents };
  const [filter, setFilter] = useState('needs_attention');
  const [actionLoading, setActionLoading] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError(false);
    try {
      const [allListings, allReports] = await Promise.all([
        base44.entities.Listing.list('-updated_date', 200),
        base44.entities.TransferReport.list('-created_date', 500),
      ]);
      if (!Array.isArray(allListings) || !Array.isArray(allReports)) throw new Error('Transfer intelligence unavailable');
      const eligible = allListings.filter(l => ['active', 'pending_transfer', 'hidden'].includes(l.status));
      setListings(eligible);
      setReports(allReports);
      const missing = [...new Set([...eligible, ...allReports].map(row => row.event_id).filter(id => id && !eventsMap?.[id]))];
      const eventMap = {};
      await Promise.all(missing.map(async id => {
        const rows = await base44.entities.Event.filter({ id }).catch(() => []);
        if (rows[0]) eventMap[id] = rows[0];
      }));
      setLocalEvents(eventMap);
    } catch { setError(true); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, []);

  const handleAdminVerify = async (listing) => {
    setActionLoading(listing.id);
    const now = new Date().toISOString();
    await base44.entities.Listing.update(listing.id, {
      transfer_status: 'transfer_confirmed',
      transfer_verification_method: 'admin_verified',
      transfer_confidence_score: 92,
      last_transfer_verification: now,
      transfer_verified_by: 'admin',
      // Reset warning/expiry flags so the full lifecycle restarts
      verification_warning_sent_at: null,
      verification_expired_sent_at: null,
    });
    await loadData();
    onRefresh?.();
    setActionLoading('');
  };

  const handleDisable = async (listing) => {
    setActionLoading(listing.id + 'dis');
    await base44.entities.Listing.update(listing.id, {
      transfer_status: 'transfer_disabled',
      transfer_confidence_score: 0,
      transfer_verified_by: 'admin',
      transfer_verified_notes: 'Admin marked transfer disabled',
    });
    await loadData();
    onRefresh?.();
    setActionLoading('');
  };

  const handleOverride = async (listing, score) => {
    await base44.entities.Listing.update(listing.id, { transfer_confidence_score: Math.max(0, Math.min(100, score)) });
    await loadData();
  };

  const handleRestore = async (listing) => {
    setActionLoading(listing.id + 'restore');
    await base44.entities.Listing.update(listing.id, {
      status: 'active',
      hidden_reason: null,
      transfer_status: 'transfer_unconfirmed',
      // Reset both flags so the full 45-min → 60-min cycle runs again
      verification_warning_sent_at: null,
      verification_expired_sent_at: null,
    });
    // Beta log
    base44.entities.BetaTransferLog.create({
      log_type: 'listing_restored',
      actor_role: 'admin',
      listing_id: listing.id,
      event_id: listing.event_id,
      before_state: { status: listing.status, hidden_reason: listing.hidden_reason },
      after_state: { status: 'active' },
    }).catch(() => {});
    await loadData();
    onRefresh?.();
    setActionLoading('');
  };

  // Event-level aggregations
  const now = Date.now();
  const twoHoursAgo = now - 2 * 60 * 60 * 1000;
  const eventReportMap = {};
  reports.forEach(r => {
    if (!eventReportMap[r.event_id]) eventReportMap[r.event_id] = { open: 0, closed: 0, latest: null };
    if (new Date(r.created_date).getTime() < twoHoursAgo) return; // only last 2h for conflict detection
    if (r.report_type === 'transfer_available') eventReportMap[r.event_id].open++;
    else eventReportMap[r.event_id].closed++;
    const ts = r.created_date;
    if (!eventReportMap[r.event_id].latest || ts > eventReportMap[r.event_id].latest) {
      eventReportMap[r.event_id].latest = ts;
    }
  });

  // Conflict detection: events where open AND closed each >= 3
  const conflictingEvents = Object.entries(eventReportMap)
    .filter(([, d]) => d.open >= 3 && d.closed >= 3)
    .map(([eid, d]) => ({ eid, ...d }));

  // Stats
  const expired = listings.filter(l => isVerificationExpired(l));
  const hidden = listings.filter(l => l.status === 'hidden');
  const disabled = listings.filter(l => l.transfer_status === 'transfer_disabled');
  const lowConf = listings.filter(l => (l.transfer_confidence_score ?? 100) < 50 && l.transfer_status !== 'transfer_disabled');
  const needsReverify = listings.filter(l => isVerificationExpired(l) || !l.last_transfer_verification);

  const filteredListings = filter === 'all' ? listings
    : filter === 'needs_attention' ? needsReverify
    : filter === 'hidden' ? hidden
    : filter === 'disabled' ? disabled
    : filter === 'low_confidence' ? lowConf
    : listings;

  const visibleCount = value => loading ? '…' : error ? '?' : value;

  const topEventsByOpen = Object.entries(eventReportMap)
    .sort((a, b) => b[1].open - a[1].open)
    .slice(0, 3);
  const topEventsByClosed = Object.entries(eventReportMap)
    .sort((a, b) => b[1].closed - a[1].closed)
    .slice(0, 3);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg text-foreground">Transfer Intelligence</h2>
          <p className="text-xs text-muted-foreground">Loaded window: newest 200 updated listings and 500 reports. Eligibility filters apply after loading; counts are not global totals.</p>
        </div>
        <button aria-label="Refresh transfer intelligence" onClick={loadData} disabled={loading} className="p-1.5 rounded-lg hover:bg-muted">
          <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <EventConfidenceOverview />

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Needs Reverify', value: needsReverify.length, color: '#FF8C00' },
          { label: 'Hidden', value: hidden.length, color: '#FFE600' },
          { label: 'Disabled', value: disabled.length, color: '#FF2D78' },
          { label: 'Low Confidence', value: lowConf.length, color: '#FF8C00' },
        ].map(s => (
          <div key={s.label} className="pg-operations-card rounded-xl p-3 text-center"
            style={{ background: 'var(--pg-surface)', border: `1px solid ${s.value > 0 ? s.color + '30' : 'var(--pg-line)'}` }}>
            <div className="pg-operations-status text-xl font-black" style={{ '--pg-status-ink': s.color }}>{loading ? '…' : error ? '?' : s.value}</div>
            <div className="text-[10px] text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      {/* ⚡ Conflict detection banner */}
      {!loading && !error && conflictingEvents.length > 0 && (
        <div className="pg-operations-card rounded-xl p-3 space-y-2"
          style={{ background: 'color-mix(in srgb, rgb(255 230 0) 8%, var(--pg-surface))', border: '1px solid rgba(255,230,0,0.35)' }}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="pg-operations-status w-4 h-4 flex-shrink-0" style={{ '--pg-status-ink': '#FFE600' }} />
            <span className="pg-operations-status text-xs font-bold" style={{ '--pg-status-ink': '#FFE600' }}>
              {conflictingEvents.length} event{conflictingEvents.length !== 1 ? 's' : ''} with conflicting community reports
            </span>
          </div>
          {conflictingEvents.map(({ eid, open, closed }) => (
            <div key={eid} className="text-xs text-foreground flex justify-between pl-6">
              <span className="text-muted-foreground truncate">{adminEventIdentity(resolvedEvents[eid], eid)}</span>
              <span><span className="pg-operations-status" style={{ '--pg-status-ink': '#00FF87' }}>{open} open</span> vs <span className="pg-operations-status" style={{ '--pg-status-ink': '#FF2D78' }}>{closed} closed</span></span>
            </div>
          ))}
        </div>
      )}

      {/* Community report summaries */}
      {!loading && !error && (topEventsByOpen.length > 0 || topEventsByClosed.length > 0) && (
        <div className="grid grid-cols-2 gap-3">
          <div className="pg-operations-card rounded-xl p-3 space-y-2"
            style={{ background: 'color-mix(in srgb, rgb(0 255 135) 4%, var(--pg-surface))', border: '1px solid rgba(0,255,135,0.15)' }}>
            <div className="pg-operations-status text-xs font-bold" style={{ '--pg-status-ink': '#00FF87' }}>Most Open Reports</div>
            {topEventsByOpen.map(([eid, data]) => (
              <div key={eid} className="text-xs text-foreground flex justify-between">
                <span className="truncate text-muted-foreground">{adminEventIdentity(resolvedEvents[eid], eid)}</span>
                <span className="pg-operations-status" style={{ '--pg-status-ink': '#00FF87' }}>+{data.open}</span>
              </div>
            ))}
          </div>
          <div className="pg-operations-card rounded-xl p-3 space-y-2"
            style={{ background: 'color-mix(in srgb, rgb(255 45 120) 4%, var(--pg-surface))', border: '1px solid rgba(255,45,120,0.15)' }}>
            <div className="pg-operations-status text-xs font-bold" style={{ '--pg-status-ink': '#FF2D78' }}>Most Closed Reports</div>
            {topEventsByClosed.map(([eid, data]) => (
              <div key={eid} className="text-xs text-foreground flex justify-between">
                <span className="truncate text-muted-foreground">{adminEventIdentity(resolvedEvents[eid], eid)}</span>
                <span className="pg-operations-status" style={{ '--pg-status-ink': '#FF2D78' }}>+{data.closed}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: 'needs_attention', label: `Needs Attention (${visibleCount(needsReverify.length)} loaded)` },
          { key: 'hidden', label: `Hidden (${visibleCount(hidden.length)} loaded)` },
          { key: 'low_confidence', label: `Low Confidence (${visibleCount(lowConf.length)} loaded)` },
          { key: 'disabled', label: `Disabled (${visibleCount(disabled.length)} loaded)` },
          { key: 'all', label: `All (${visibleCount(listings.length)} loaded)` },
        ].map(tab => (
          <button key={tab.key} onClick={() => setFilter(tab.key)}
            className="pg-operations-status text-xs px-2.5 py-1 rounded-lg transition-all"
            style={filter === tab.key
              ? { background: 'color-mix(in srgb, rgb(191 95 255) 12%, var(--pg-surface))', '--pg-status-ink': '#BF5FFF', border: '1px solid rgba(191,95,255,0.3)' }
              : { background: 'var(--pg-surface)', '--pg-status-ink': 'var(--pg-muted)', border: '1px solid var(--pg-line)' }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Listing rows */}
      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="pg-operations-card h-20 rounded-xl pg-operations-skeleton animate-pulse" />)}</div>
      ) : error ? <p role="alert">Transfer intelligence could not be loaded. <button type="button" className="underline" onClick={loadData}>Retry transfer intelligence</button></p> : filteredListings.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No matching listings in the loaded window. Older listings may exist.</p>
      ) : (
        <div className="space-y-2">
          {filteredListings.map(listing => (
            <ListingRow
              key={listing.id}
              listing={listing}
              event={resolvedEvents[listing.event_id]}
              onAdminVerify={handleAdminVerify}
              onDisable={handleDisable}
              onOverride={handleOverride}
              onRestore={handleRestore}
            />
          ))}
        </div>
      )}
    </div>
  );
}