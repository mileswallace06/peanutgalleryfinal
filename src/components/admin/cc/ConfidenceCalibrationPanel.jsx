import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { formatDistanceToNow } from 'date-fns';
import { RefreshCw, Gauge, TrendingUp, TrendingDown, Brain, Sparkles } from 'lucide-react';

function accColor(pct) {
  if (pct == null) return '#71717a';
  if (pct >= 80) return '#00FF87';
  if (pct >= 60) return '#00C8FF';
  if (pct >= 40) return '#FF8C00';
  return '#FF2D78';
}
function biasColor(bias) {
  if (bias == null || bias === 0) return '#71717a';
  return bias > 0 ? '#FF8C00' : '#00C8FF'; // over-optimistic = orange, over-pessimistic = cyan
}

function AccuracyTable({ title, map, limit }) {
  const entries = Object.entries(map || {})
    .sort((a, b) => b[1].samples - a[1].samples)
    .slice(0, limit || 20);
  if (entries.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-wide">{title}</div>
      <div className="space-y-0.5">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between text-[10px] gap-2">
            <span className="text-muted-foreground truncate flex-1 min-w-0">{k}</span>
            <span className="text-muted-foreground flex-shrink-0">{v.correct}/{v.samples}</span>
            <span className="font-bold w-8 text-right flex-shrink-0" style={{ color: accColor(v.accuracy) }}>{v.accuracy}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SourceWeightRow({ name, data }) {
  if (!data) return null;
  const { baseWeight, multiplier, samples, hits, misses, accuracy, bias } = data;
  const effective = (baseWeight * multiplier).toFixed(2);
  const tuned = Math.abs(multiplier - 1) > 0.01;
  return (
    <div className="rounded-lg p-2.5 space-y-1.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-foreground flex items-center gap-1">
          {name}
          {tuned && <Sparkles className="w-3 h-3" style={{ color: '#BF5FFF' }} />}
        </span>
        <span className="text-[10px] font-bold" style={{ color: '#BF5FFF' }}>×{multiplier}</span>
      </div>
      <div className="flex items-center justify-between text-[9px] text-muted-foreground">
        <span>base {baseWeight} → eff <span className="font-bold" style={{ color: accColor(accuracy == null ? null : 70) }}>{effective}</span></span>
        <span>{samples} samples</span>
      </div>
      {samples > 0 ? (
        <>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">source accuracy</span>
            <span className="font-bold" style={{ color: accColor(accuracy) }}>{accuracy == null ? '—' : `${accuracy}%`}</span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground flex items-center gap-1">
              bias {bias > 0 ? <TrendingUp className="w-3 h-3" /> : bias < 0 ? <TrendingDown className="w-3 h-3" /> : null}
            </span>
            <span className="font-bold" style={{ color: biasColor(bias) }}>
              {bias > 0 ? 'over-optimistic' : bias < 0 ? 'over-pessimistic' : 'neutral'} ({bias > 0 ? '+' : ''}{bias})
            </span>
          </div>
        </>
      ) : (
        <p className="text-[9px] text-muted-foreground italic">No directional verdicts yet.</p>
      )}
    </div>
  );
}

const SOURCE_LABELS = {
  historical: 'Historical Venue Success',
  venue_patterns: 'Venue Patterns',
  platform_patterns: 'Platform Patterns',
  community: 'Community Reports',
  time: 'Time Inference',
};

export default function ConfidenceCalibrationPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const list = await base44.entities.ConfidenceCalibration.list('-last_calibrated_at', 1).catch(() => []);
      setData(list[0] || null);
    } catch (_) {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const run = async () => {
    setRunning(true);
    try {
      await base44.functions.invoke('calibrateConfidenceWeights', {});
      await load();
    } catch (_) {}
    setRunning(false);
  };

  const overall = data?.overall_accuracy;
  const verdicts = data?.total_with_verdict || 0;
  const lastCal = data?.last_calibrated_at ? formatDistanceToNow(new Date(data.last_calibrated_at), { addSuffix: true }) : null;

  return (
    <div className="rounded-2xl p-4 space-y-4"
      style={{ background: 'rgba(0,200,255,0.04)', border: '1px solid rgba(0,200,255,0.18)' }}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-sm text-foreground flex items-center gap-1.5">
            <Gauge className="w-4 h-4" style={{ color: '#00C8FF' }} /> Confidence Calibration
          </h3>
          <p className="text-[11px] text-muted-foreground">Self-evaluating prediction accuracy · auto-tuning evidence weights</p>
        </div>
        <button onClick={run} disabled={running}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold disabled:opacity-50"
          style={{ background: 'rgba(0,200,255,0.1)', color: '#00C8FF', border: '1px solid rgba(0,200,255,0.3)' }}>
          <RefreshCw className={`w-3 h-3 ${running ? 'animate-spin' : ''}`} /> {running ? 'Calibrating…' : 'Run Calibration'}
        </button>
      </div>

      {/* Overall */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${accColor(overall)}30` }}>
          <div className="text-2xl font-black" style={{ color: accColor(overall) }}>{overall == null ? '—' : `${overall}%`}</div>
          <div className="text-[9px] text-muted-foreground leading-tight">Overall Accuracy</div>
        </div>
        <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="text-2xl font-black text-foreground">{verdicts}</div>
          <div className="text-[9px] text-muted-foreground leading-tight">Verdict Predictions</div>
        </div>
        <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="text-2xl font-black text-foreground">{data?.total_resolved || 0}</div>
          <div className="text-[9px] text-muted-foreground leading-tight">Resolved Total</div>
        </div>
      </div>

      {loading ? (
        <div className="h-40 rounded-xl bg-white/5 animate-pulse" />
      ) : !data ? (
        <div className="text-center py-6 space-y-2">
          <Brain className="w-8 h-8 mx-auto text-muted-foreground opacity-50" />
          <p className="text-xs text-muted-foreground">No calibration data yet. Run calibration to begin self-tuning.</p>
        </div>
      ) : (
        <>
          {/* Self-tuned evidence weights */}
          <div className="space-y-2">
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Sparkles className="w-3 h-3" style={{ color: '#BF5FFF' }} /> Self-Tuned Evidence Weights
            </div>
            {Object.entries(data.source_weights || {}).map(([k, v]) => (
              <SourceWeightRow key={k} name={SOURCE_LABELS[k] || k} data={v} />
            ))}
          </div>

          {/* Accuracy by recommendation tier */}
          <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <AccuracyTable title="Accuracy by Recommendation Tier" map={data.accuracy_by_recommendation} limit={10} />
          </div>

          {/* Accuracy by dimensions */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <AccuracyTable title="By Event Type" map={data.accuracy_by_category} limit={6} />
            </div>
            <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <AccuracyTable title="By Platform" map={data.accuracy_by_platform} limit={6} />
            </div>
            <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <AccuracyTable title="By Venue (top)" map={data.accuracy_by_venue} limit={6} />
            </div>
            <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <AccuracyTable title="By Artist (top)" map={data.accuracy_by_artist} limit={6} />
            </div>
          </div>
        </>
      )}

      {lastCal && <p className="text-[9px] text-muted-foreground opacity-60">Last calibrated {lastCal}</p>}
    </div>
  );
}