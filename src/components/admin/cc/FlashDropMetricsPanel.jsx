/**
 * FlashDropMetricsPanel — Full founder metrics + per-event health dashboard.
 */
import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';

function Stat({ label, value, color, sub }) {
  return (
    <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="text-2xl font-black" style={{ color: color || 'hsl(var(--foreground))' }}>{value}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
      {sub && <div className="text-[9px] text-muted-foreground opacity-70 mt-0.5">{sub}</div>}
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-2">{children}</p>
  );
}

function pct(num, den) {
  if (!den || den === 0) return '0%';
  return `${Math.round((num / den) * 100)}%`;
}

function colorForRate(rate) {
  if (rate >= 25) return '#00FF87';
  if (rate >= 10) return '#FF8C00';
  return '#FF2D78';
}

export default function FlashDropMetricsPanel() {
  const [drops, setDrops] = useState([]);
  const [entries, setEntries] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview'); // overview | funnel | per_event | anti_abuse
  const [expandedEvent, setExpandedEvent] = useState(null);

  const load = async () => {
    setLoading(true);
    const [d, e, ev] = await Promise.all([
      base44.entities.FlashDrop.list('-created_date', 500),
      base44.entities.FlashDropEntry.list('-created_date', 1000),
      base44.entities.Event.list('-date', 100),
    ]);
    setDrops(d || []);
    setEntries(e || []);
    setEvents(ev || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // ── Core aggregations ──────────────────────────────────────────────────────
  const totalDrops = drops.length;
  const activeDrops = drops.filter(d => d.status === 'active').length;
  const completedDrops = drops.filter(d => d.status === 'winner_selected').length;
  const expiredNoEntry = drops.filter(d => d.status === 'expired').length;
  const pendingDrops = drops.filter(d => d.status === 'pending').length;

  const totalEntries = entries.length;
  const winners = entries.filter(e => e.is_winner).length;
  const losers = totalEntries - winners;

  const loserViewedUpgrades = entries.filter(e => e.loser_action === 'viewed_upgrades').length;
  const loserClicked = entries.filter(e => e.loser_action === 'clicked_listing' || e.loser_action === 'purchased').length;
  const loserPurchased = entries.filter(e => e.loser_action === 'purchased').length;

  const loserClickRate = losers > 0 ? Math.round((loserClicked / losers) * 100) : 0;
  const loserPurchaseRate = losers > 0 ? Math.round((loserPurchased / losers) * 100) : 0;

  const avgEntriesPerDrop = completedDrops > 0
    ? Math.round(drops.filter(d => d.status === 'winner_selected').reduce((s, d) => s + (d.entry_count || 0), 0) / completedDrops)
    : 0;

  const uniqueEvents = new Set(drops.map(d => d.event_id)).size;
  const uniqueParticipants = new Set(entries.map(e => e.entrant_email)).size;
  const uniqueDonors = new Set(drops.map(d => d.donor_email)).size;

  // Ownership & trust
  const verifiedDrops = drops.filter(d => d.ownership_verified).length;
  const highTrustDrops = drops.filter(d => (d.trust_score || 0) >= 80).length;
  const unverifiedDrops = drops.filter(d => !d.ownership_verified).length;
  const avgTrustScore = drops.length > 0
    ? Math.round(drops.reduce((s, d) => s + (d.trust_score || 0), 0) / drops.length)
    : 0;

  // Anti-abuse flags
  const flaggedDrops = drops.filter(d => d.abuse_flags && d.abuse_flags.length > 0);
  const flagCounts = {};
  flaggedDrops.forEach(d => (d.abuse_flags || []).forEach(f => { flagCounts[f] = (flagCounts[f] || 0) + 1; }));

  // Repeat engagement
  const donorCounts = {};
  drops.forEach(d => { donorCounts[d.donor_email] = (donorCounts[d.donor_email] || 0) + 1; });
  const repeatDonors = Object.values(donorCounts).filter(c => c > 1).length;
  const repeatDonorRate = uniqueDonors > 0 ? Math.round((repeatDonors / uniqueDonors) * 100) : 0;

  const participantCounts = {};
  entries.forEach(e => { participantCounts[e.entrant_email] = (participantCounts[e.entrant_email] || 0) + 1; });
  const repeatParticipants = Object.values(participantCounts).filter(c => c > 1).length;
  const repeatParticipantRate = uniqueParticipants > 0 ? Math.round((repeatParticipants / uniqueParticipants) * 100) : 0;

  // ── Per-event breakdown ──────────────────────────────────────────────────
  const eventsMap = Object.fromEntries(events.map(e => [e.id, e]));

  const perEvent = Object.values(
    drops.reduce((acc, d) => {
      const eid = d.event_id;
      if (!acc[eid]) acc[eid] = { event_id: eid, drops: 0, entries: 0, completed: 0, losers_clicked: 0, losers_purchased: 0 };
      acc[eid].drops++;
      acc[eid].entries += d.entry_count || 0;
      if (d.status === 'winner_selected') acc[eid].completed++;
      return acc;
    }, {})
  ).map(ev => {
    const evEntries = entries.filter(e => e.event_id === ev.event_id);
    const evLosers = evEntries.filter(e => !e.is_winner);
    ev.losers_clicked = evLosers.filter(e => e.loser_action === 'clicked_listing' || e.loser_action === 'purchased').length;
    ev.losers_purchased = evLosers.filter(e => e.loser_action === 'purchased').length;
    ev.loser_click_rate = evLosers.length > 0 ? Math.round((ev.losers_clicked / evLosers.length) * 100) : 0;
    ev.loser_purchase_rate = evLosers.length > 0 ? Math.round((ev.losers_purchased / evLosers.length) * 100) : 0;
    ev.participation_rate = ev.drops > 0 ? Math.round((ev.entries / ev.drops)) : 0; // avg entries per drop
    return ev;
  }).sort((a, b) => b.drops - a.drops);

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'funnel', label: 'Funnel' },
    { id: 'per_event', label: 'Per Event' },
    { id: 'anti_abuse', label: 'Anti-Abuse' },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-base text-foreground">Flash Drop Metrics</h3>
          <p className="text-xs text-muted-foreground">Engagement, conversion, marketplace impact</p>
        </div>
        <button onClick={load} disabled={loading} className="p-1.5 rounded-lg hover:bg-muted">
          <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className="text-xs px-3 py-1.5 rounded-lg transition-all"
            style={activeTab === t.id
              ? { background: 'rgba(191,95,255,0.12)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.3)' }
              : { background: 'rgba(255,255,255,0.04)', color: 'hsl(var(--muted-foreground))', border: '1px solid rgba(255,255,255,0.08)' }}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-4 gap-2">{[1,2,3,4].map(i => <div key={i} className="h-16 rounded-xl animate-pulse bg-muted" />)}</div>
      ) : (
        <>
          {/* ── OVERVIEW ── */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <div>
                <SectionLabel>Drop Activity</SectionLabel>
                <div className="grid grid-cols-4 gap-2">
                  <Stat label="Total Drops" value={totalDrops} />
                  <Stat label="Active Now" value={activeDrops} color={activeDrops > 0 ? '#FFE600' : undefined} />
                  <Stat label="Completed" value={completedDrops} color="#00FF87" />
                  <Stat label="Events" value={uniqueEvents} color="#BF5FFF" />
                </div>
              </div>
              <div>
                <SectionLabel>Participation</SectionLabel>
                <div className="grid grid-cols-4 gap-2">
                  <Stat label="Total Entries" value={totalEntries} />
                  <Stat label="Unique Fans" value={uniqueParticipants} color="#00C8FF" />
                  <Stat label="Avg / Drop" value={avgEntriesPerDrop} color="#BF5FFF" />
                  <Stat label="Repeat Fans" value={`${repeatParticipantRate}%`} color={colorForRate(repeatParticipantRate)} sub="entered 2+ drops" />
                </div>
              </div>
              <div>
                <SectionLabel>Trust & Ownership</SectionLabel>
                <div className="grid grid-cols-4 gap-2">
                  <Stat label="Verified" value={verifiedDrops} color="#00FF87" sub={`${pct(verifiedDrops, totalDrops)} of drops`} />
                  <Stat label="High Trust (≥80)" value={highTrustDrops} color="#00FF87" />
                  <Stat label="Avg Trust Score" value={avgTrustScore} color={avgTrustScore >= 60 ? '#00FF87' : '#FF8C00'} />
                  <Stat label="Unverified" value={unverifiedDrops} color={unverifiedDrops > 0 ? '#FF8C00' : undefined} />
                </div>
              </div>
            </div>
          )}

          {/* ── FUNNEL ── */}
          {activeTab === 'funnel' && (
            <div className="space-y-4">
              <div>
                <SectionLabel>Drop → Entry Funnel</SectionLabel>
                <div className="space-y-2">
                  {[
                    { label: 'Drops Created', value: totalDrops, color: '#BF5FFF' },
                    { label: 'Total Entries', value: totalEntries, color: '#00C8FF' },
                    { label: 'Entry Rate', value: pct(totalEntries, totalDrops * Math.max(avgEntriesPerDrop, 1)), color: '#FFE600', sub: 'entries vs capacity' },
                    { label: 'Winners Selected', value: winners, color: '#00FF87' },
                  ].map(row => (
                    <div key={row.label} className="flex items-center justify-between px-4 py-2.5 rounded-xl"
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <span className="text-xs text-muted-foreground">{row.label}</span>
                      <div className="text-right">
                        <span className="font-black text-sm" style={{ color: row.color }}>{row.value}</span>
                        {row.sub && <p className="text-[9px] text-muted-foreground">{row.sub}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <SectionLabel>Loser → Marketplace Conversion (Primary KPI)</SectionLabel>
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="Total Losers" value={losers} />
                  <Stat label="Viewed Upgrades" value={loserViewedUpgrades} color="#FF8C00" sub={pct(loserViewedUpgrades, losers)} />
                  <Stat label="Clicked Listing" value={loserClicked} color="#FF8C00" sub={pct(loserClicked, losers)} />
                  <Stat label="Purchased" value={loserPurchased} color={loserPurchased > 0 ? '#00FF87' : '#FF2D78'} sub={pct(loserPurchased, losers)} />
                </div>
                <div className="mt-3 rounded-xl px-4 py-3 text-xs"
                  style={{ background: 'rgba(255,230,0,0.06)', border: '1px solid rgba(255,230,0,0.2)' }}>
                  <p className="font-bold mb-1" style={{ color: '#FFE600' }}>Primary KPI</p>
                  <p className="text-muted-foreground">
                    Loser click rate: <strong className="text-foreground" style={{ color: colorForRate(loserClickRate) }}>{loserClickRate}%</strong> ·
                    Purchase rate: <strong className="text-foreground" style={{ color: colorForRate(loserPurchaseRate) }}>{loserPurchaseRate}%</strong> ·
                    Repeat participants: <strong className="text-foreground">{repeatParticipantRate}%</strong>
                  </p>
                </div>
              </div>

              <div>
                <SectionLabel>Repeat Engagement</SectionLabel>
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="Repeat Donors" value={`${repeatDonorRate}%`} color={colorForRate(repeatDonorRate)} sub={`${repeatDonors} of ${uniqueDonors} donors`} />
                  <Stat label="Repeat Participants" value={`${repeatParticipantRate}%`} color={colorForRate(repeatParticipantRate)} sub={`${repeatParticipants} of ${uniqueParticipants} fans`} />
                </div>
              </div>
            </div>
          )}

          {/* ── PER EVENT ── */}
          {activeTab === 'per_event' && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Sorted by drops created. Expand for detailed breakdown.</p>
              {perEvent.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">No drops yet.</p>}
              {perEvent.map(ev => {
                const eventObj = eventsMap[ev.event_id];
                const isExpanded = expandedEvent === ev.event_id;
                return (
                  <div key={ev.event_id} className="rounded-xl overflow-hidden"
                    style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                    <button className="w-full px-4 py-3 flex items-center gap-3 text-left"
                      style={{ background: 'rgba(255,255,255,0.04)' }}
                      onClick={() => setExpandedEvent(isExpanded ? null : ev.event_id)}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-foreground truncate">{eventObj?.title || ev.event_id.slice(0, 12)}</p>
                        <p className="text-xs text-muted-foreground">{eventObj?.venue} · {eventObj?.city}</p>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0 text-xs">
                        <span className="text-muted-foreground">{ev.drops} drops</span>
                        <span style={{ color: '#00C8FF' }}>{ev.entries} entries</span>
                        <span style={{ color: colorForRate(ev.loser_click_rate) }}>{ev.loser_click_rate}% click</span>
                        {isExpanded ? <ChevronUp className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="px-4 pb-3 pt-2 grid grid-cols-3 gap-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
                        <Stat label="Drops" value={ev.drops} />
                        <Stat label="Total Entries" value={ev.entries} color="#00C8FF" />
                        <Stat label="Completed" value={ev.completed} color="#00FF87" />
                        <Stat label="Avg Entries/Drop" value={ev.drops > 0 ? Math.round(ev.entries / ev.drops) : 0} color="#BF5FFF" />
                        <Stat label="Loser Click Rate" value={`${ev.loser_click_rate}%`} color={colorForRate(ev.loser_click_rate)} />
                        <Stat label="Loser Purchase Rate" value={`${ev.loser_purchase_rate}%`} color={colorForRate(ev.loser_purchase_rate)} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── ANTI-ABUSE ── */}
          {activeTab === 'anti_abuse' && (
            <div className="space-y-4">
              <div>
                <SectionLabel>Abuse Flag Summary</SectionLabel>
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Flagged Drops" value={flaggedDrops.length} color={flaggedDrops.length > 0 ? '#FF8C00' : undefined} />
                  <Stat label="Unverified Ownership" value={unverifiedDrops} color={unverifiedDrops > 5 ? '#FF2D78' : '#FF8C00'} />
                  <Stat label="Flag Rate" value={pct(flaggedDrops.length, totalDrops)} color={flaggedDrops.length > 0 ? '#FF8C00' : '#00FF87'} />
                </div>
              </div>
              {Object.keys(flagCounts).length > 0 && (
                <div>
                  <SectionLabel>Flag Types</SectionLabel>
                  <div className="space-y-1.5">
                    {Object.entries(flagCounts).sort((a, b) => b[1] - a[1]).map(([flag, count]) => (
                      <div key={flag} className="flex items-center justify-between px-3 py-2 rounded-lg"
                        style={{ background: 'rgba(255,140,0,0.06)', border: '1px solid rgba(255,140,0,0.2)' }}>
                        <span className="text-xs text-muted-foreground capitalize">{flag.replace(/_/g, ' ')}</span>
                        <span className="text-xs font-black" style={{ color: '#FF8C00' }}>{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {flaggedDrops.length > 0 && (
                <div>
                  <SectionLabel>Recent Flagged Drops</SectionLabel>
                  <div className="space-y-2">
                    {flaggedDrops.slice(0, 5).map(d => (
                      <div key={d.id} className="rounded-xl px-3 py-2.5 text-xs"
                        style={{ background: 'rgba(255,45,120,0.05)', border: '1px solid rgba(255,45,120,0.2)' }}>
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-foreground">{d.event_title || d.event_id?.slice(0, 8)} · Sec {d.section}</span>
                          <span className="text-muted-foreground">{d.donor_email?.split('@')[0]}</span>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(d.abuse_flags || []).map(f => (
                            <span key={f} className="text-[9px] px-1.5 py-0.5 rounded-full font-bold"
                              style={{ background: 'rgba(255,45,120,0.15)', color: '#FF2D78' }}>
                              {f.replace(/_/g, ' ')}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="rounded-xl px-4 py-3 text-xs"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <p className="font-bold text-foreground mb-1">Anti-Abuse Rules Active</p>
                <ul className="space-y-1 text-muted-foreground">
                  <li>• Max 2 drops per user per event</li>
                  <li>• Min 5 minutes between any two drops</li>
                  <li>• Duplicate section/row detection</li>
                  <li>• Ownership verification required for high-trust badge</li>
                  <li>• Donor cannot enter own drop</li>
                  <li>• Server-side idempotent winner selection</li>
                </ul>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}