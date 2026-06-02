/**
 * EventLookupDebugPanel
 * Shown on "Event Not Found" screens.
 * Displays full diagnostic info to identify why the lookup failed.
 * Stays enabled until root cause is permanently resolved.
 */
export default function EventLookupDebugPanel({ routeId, lookupTrace }) {
  if (!routeId && !lookupTrace) return null;

  const steps = lookupTrace?.steps || [];
  const finalCount = lookupTrace?.finalCount ?? '?';
  const finalId = lookupTrace?.finalId || '—';
  const syncTriggered = lookupTrace?.syncTriggered || false;
  const syncResult = lookupTrace?.syncResult || null;

  return (
    <div className="mx-4 mt-4 rounded-2xl overflow-hidden text-left"
      style={{ background: 'rgba(255,230,0,0.05)', border: '1px solid rgba(255,230,0,0.25)', fontFamily: 'monospace' }}>
      <div className="px-4 py-2.5 flex items-center gap-2"
        style={{ background: 'rgba(255,230,0,0.1)', borderBottom: '1px solid rgba(255,230,0,0.2)' }}>
        <span className="text-xs font-black" style={{ color: '#FFE600' }}>🔍 EVENT LOOKUP DIAGNOSTIC</span>
        <span className="ml-auto text-[10px] text-yellow-400/60">debug panel — enabled until root cause resolved</span>
      </div>

      <div className="px-4 py-3 space-y-2.5">
        {/* Route param */}
        <div className="grid grid-cols-[120px_1fr] gap-1 text-[11px]">
          <span style={{ color: 'rgba(255,255,255,0.4)' }}>Route param:</span>
          <span style={{ color: '#FFE600', wordBreak: 'break-all' }}>{routeId || '—'}</span>
        </div>

        {/* Lookup steps */}
        {steps.map((step, i) => (
          <div key={i} className="grid grid-cols-[120px_1fr] gap-1 text-[11px]">
            <span style={{ color: 'rgba(255,255,255,0.4)' }}>{step.method}:</span>
            <span style={{
              color: step.count > 0 ? '#00FF87' : 'rgba(255,255,255,0.35)',
            }}>
              {step.count > 0 ? `✓ found ${step.count}` : '✗ 0 results'}
              {step.error ? ` — ERROR: ${step.error}` : ''}
            </span>
          </div>
        ))}

        {/* Sync fallback */}
        <div className="grid grid-cols-[120px_1fr] gap-1 text-[11px]">
          <span style={{ color: 'rgba(255,255,255,0.4)' }}>sync_fallback:</span>
          <span style={{ color: syncTriggered ? '#00C8FF' : 'rgba(255,255,255,0.3)' }}>
            {syncTriggered ? `triggered → ${syncResult || 'pending'}` : 'not triggered'}
          </span>
        </div>

        {/* Final result */}
        <div className="mt-1 pt-2.5" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="grid grid-cols-[120px_1fr] gap-1 text-[11px]">
            <span style={{ color: 'rgba(255,255,255,0.4)' }}>events found:</span>
            <span style={{ color: finalCount > 0 ? '#00FF87' : '#FF2D78', fontWeight: 'bold' }}>{finalCount}</span>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-1 text-[11px] mt-1">
            <span style={{ color: 'rgba(255,255,255,0.4)' }}>selected id:</span>
            <span style={{ color: '#BF5FFF', wordBreak: 'break-all' }}>{finalId}</span>
          </div>
        </div>

        {/* Root cause hint */}
        {finalCount === 0 && (
          <div className="mt-2 px-3 py-2 rounded-xl text-[10px] leading-relaxed"
            style={{ background: 'rgba(255,45,120,0.1)', border: '1px solid rgba(255,45,120,0.25)', color: '#FF2D78' }}>
            <strong>Likely cause:</strong> TM event synced with a race-condition ID mismatch.
            The route param is an internal DB id, but the TM sync may have created a duplicate
            with a different internal id. Check for duplicate tm_ids in the Event table.
          </div>
        )}
      </div>
    </div>
  );
}