/**
 * EventLookupDebugPanel
 * Shown on every "Event Not Found" screen.
 * Displays the full lookup trace + classified failure category.
 * Always enabled — this is how we capture proof of root cause.
 */
import { classifyFailure } from '@/lib/navLogger';

const CATEGORY_COLORS = {
  A: { bg: 'rgba(191,95,255,0.12)', border: 'rgba(191,95,255,0.35)', color: '#BF5FFF' },
  B: { bg: 'rgba(0,200,255,0.10)', border: 'rgba(0,200,255,0.35)', color: '#00C8FF' },
  C: { bg: 'rgba(255,140,0,0.10)',  border: 'rgba(255,140,0,0.35)',  color: '#FF8C00' },
  D: { bg: 'rgba(255,45,120,0.10)', border: 'rgba(255,45,120,0.35)', color: '#FF2D78' },
  E: { bg: 'rgba(255,230,0,0.10)',  border: 'rgba(255,230,0,0.35)',  color: '#FFE600' },
  F: { bg: 'rgba(255,255,255,0.05)',border: 'rgba(255,255,255,0.15)',color: 'rgba(255,255,255,0.5)' },
};

const CATEGORY_LABELS = {
  A: 'A — Duplicate Event',
  B: 'B — Unsynced TM Event',
  C: 'C — Invalid Route',
  D: 'D — Missing Event (deleted or wrong env)',
  E: 'E — Sync Failure',
  F: 'F — Unknown',
};

export default function EventLookupDebugPanel({ routeId, lookupTrace }) {
  if (!routeId && !lookupTrace) return null;

  const steps = lookupTrace?.steps || [];
  const finalCount = lookupTrace?.finalCount ?? '?';
  const finalId = lookupTrace?.finalId || '—';
  const syncTriggered = lookupTrace?.syncTriggered || false;
  const syncResult = lookupTrace?.syncResult || null;

  const classified = classifyFailure(routeId, lookupTrace);
  const catStyle = CATEGORY_COLORS[classified.category] || CATEGORY_COLORS.F;

  return (
    <div className="mx-4 mt-4 rounded-2xl overflow-hidden text-left"
      style={{ background: 'rgba(255,230,0,0.04)', border: '1px solid rgba(255,230,0,0.2)', fontFamily: 'monospace' }}>

      {/* Header */}
      <div className="px-4 py-2.5 flex items-center gap-2"
        style={{ background: 'rgba(255,230,0,0.08)', borderBottom: '1px solid rgba(255,230,0,0.15)' }}>
        <span className="text-xs font-black" style={{ color: '#FFE600' }}>🔍 EVENT LOOKUP DIAGNOSTIC</span>
        <span className="ml-auto text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>always-on capture mode</span>
      </div>

      <div className="px-4 py-3 space-y-2">

        {/* Failure category — most prominent row */}
        {classified.category && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-xl text-[11px]"
            style={{ background: catStyle.bg, border: `1px solid ${catStyle.border}` }}>
            <span className="font-black flex-shrink-0 mt-px" style={{ color: catStyle.color }}>
              {CATEGORY_LABELS[classified.category] || classified.category}
            </span>
          </div>
        )}

        {/* Detail line */}
        {classified.detail && (
          <p className="text-[10px] leading-relaxed px-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {classified.detail}
          </p>
        )}

        <div className="h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />

        {/* Route param */}
        <div className="grid grid-cols-[120px_1fr] gap-1 text-[11px]">
          <span style={{ color: 'rgba(255,255,255,0.35)' }}>route param:</span>
          <span style={{ color: '#FFE600', wordBreak: 'break-all' }}>{routeId || '—'}</span>
        </div>

        {/* Lookup steps */}
        {steps.map((step, i) => (
          <div key={i} className="grid grid-cols-[120px_1fr] gap-1 text-[11px]">
            <span style={{ color: 'rgba(255,255,255,0.35)' }}>{step.method}:</span>
            <span style={{ color: step.count > 0 ? '#00FF87' : step.count > 1 ? '#BF5FFF' : 'rgba(255,255,255,0.3)' }}>
              {step.count === 0 ? '✗ 0 results' : step.count === 1 ? '✓ found 1' : `⚠ found ${step.count} (DUPLICATE)`}
              {step.error ? ` — ERROR: ${step.error}` : ''}
            </span>
          </div>
        ))}

        {/* Sync fallback */}
        <div className="grid grid-cols-[120px_1fr] gap-1 text-[11px]">
          <span style={{ color: 'rgba(255,255,255,0.35)' }}>sync_fallback:</span>
          <span style={{ color: syncTriggered ? '#00C8FF' : 'rgba(255,255,255,0.25)' }}>
            {syncTriggered ? `triggered → ${syncResult || 'no id returned'}` : 'not triggered'}
          </span>
        </div>

        <div className="h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />

        {/* Final summary */}
        <div className="grid grid-cols-[120px_1fr] gap-1 text-[11px]">
          <span style={{ color: 'rgba(255,255,255,0.35)' }}>events found:</span>
          <span style={{ color: finalCount > 0 ? '#00FF87' : '#FF2D78', fontWeight: 'bold' }}>{finalCount}</span>
        </div>
        <div className="grid grid-cols-[120px_1fr] gap-1 text-[11px]">
          <span style={{ color: 'rgba(255,255,255,0.35)' }}>selected id:</span>
          <span style={{ color: '#BF5FFF', wordBreak: 'break-all' }}>{finalId}</span>
        </div>

      </div>
    </div>
  );
}