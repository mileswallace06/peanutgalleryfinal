/**
 * FlashDropMetricsPanel — Founder dashboard panel for Flash Drop engagement metrics.
 */
import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { RefreshCw } from 'lucide-react';

function Stat({ label, value, color, sub }) {
  return (
    <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="text-2xl font-black" style={{ color: color || 'hsl(var(--foreground))' }}>{value}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
      {sub && <div className="text-[9px] text-muted-foreground opacity-70 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function FlashDropMetricsPanel() {
  const [drops, setDrops] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [d, e] = await Promise.all([
      base44.entities.FlashDrop.list('-created_date', 200),
      base44.entities.FlashDropEntry.list('-created_date', 500),
    ]);
    setDrops(d || []);
    setEntries(e || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const totalDrops = drops.length;
  const activeDrops = drops.filter(d => d.status === 'active').length;
  const completedDrops = drops.filter(d => d.status === 'winner_selected').length;
  const totalEntries = entries.length;
  const winners = entries.filter(e => e.is_winner).length;
  const losers = totalEntries - winners;

  const loserUpgradeClicks = entries.filter(e => e.loser_action === 'clicked_listing' || e.loser_action === 'purchased').length;
  const loserPurchases = entries.filter(e => e.loser_action === 'purchased').length;
  const loserConversionRate = losers > 0 ? Math.round((loserUpgradeClicks / losers) * 100) : 0;
  const loserPurchaseRate = losers > 0 ? Math.round((loserPurchases / losers) * 100) : 0;

  const avgEntriesPerDrop = completedDrops > 0
    ? Math.round(drops.filter(d => d.status === 'winner_selected').reduce((s, d) => s + (d.entry_count || 0), 0) / completedDrops)
    : 0;

  // Event participation
  const uniqueEvents = new Set(drops.map(d => d.event_id)).size;
  const uniqueParticipants = new Set(entries.map(e => e.entrant_email)).size;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-base text-foreground">Flash Drop Metrics</h3>
          <p className="text-xs text-muted-foreground">Engagement, conversion, and marketplace impact</p>
        </div>
        <button onClick={load} disabled={loading} className="p-1.5 rounded-lg hover:bg-muted">
          <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-4 gap-2">{[1,2,3,4].map(i => <div key={i} className="h-16 rounded-xl animate-pulse bg-muted" />)}</div>
      ) : (
        <>
          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-2">Drop Activity</p>
            <div className="grid grid-cols-4 gap-2">
              <Stat label="Total Drops" value={totalDrops} />
              <Stat label="Active Now" value={activeDrops} color={activeDrops > 0 ? '#FFE600' : undefined} />
              <Stat label="Completed" value={completedDrops} color="#00FF87" />
              <Stat label="Events With Drops" value={uniqueEvents} color="#BF5FFF" />
            </div>
          </div>

          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-2">Participation</p>
            <div className="grid grid-cols-4 gap-2">
              <Stat label="Total Entries" value={totalEntries} />
              <Stat label="Unique Fans" value={uniqueParticipants} color="#00C8FF" />
              <Stat label="Avg Entries / Drop" value={avgEntriesPerDrop} color="#BF5FFF" />
              <Stat label="Winners" value={winners} color="#00FF87" />
            </div>
          </div>

          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-2">Loser → Marketplace Conversion</p>
            <div className="grid grid-cols-4 gap-2">
              <Stat label="Losers" value={losers} />
              <Stat label="Upgrade Clicks" value={loserUpgradeClicks} color="#FF8C00" />
              <Stat label="Click Rate" value={`${loserConversionRate}%`} color={loserConversionRate > 20 ? '#00FF87' : '#FF8C00'} sub="losers who clicked" />
              <Stat label="Purchase Rate" value={`${loserPurchaseRate}%`} color={loserPurchaseRate > 5 ? '#00FF87' : '#FF2D78'} sub="losers who bought" />
            </div>
          </div>

          {/* Success metric callout */}
          <div className="rounded-xl px-4 py-3 text-xs"
            style={{ background: 'rgba(255,230,0,0.06)', border: '1px solid rgba(255,230,0,0.2)' }}>
            <p className="font-bold mb-1" style={{ color: '#FFE600' }}>Success Metric</p>
            <p className="text-muted-foreground">
              The key metric is <strong className="text-foreground">loser → marketplace interaction rate</strong>, not free seats given away.
              Flash Drops succeed when losers explore and purchase upgrades.
              Current rate: <strong className="text-foreground">{loserConversionRate}% click · {loserPurchaseRate}% purchase</strong>.
            </p>
          </div>
        </>
      )}
    </div>
  );
}