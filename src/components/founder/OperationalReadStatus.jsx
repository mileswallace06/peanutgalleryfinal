export default function OperationalReadStatus({ sources, labels, reload }) {
  return <section aria-label="Data availability" className="pg-operations-card rounded-xl p-3 space-y-2" style={{ background: 'var(--pg-surface)', border: '1px solid var(--pg-line)' }}>
    <h2 className="text-sm font-bold text-foreground">Data availability</h2>
    <ul className="space-y-1">
      {Object.entries(sources).map(([key, source]) => <li key={key} className="flex items-center justify-between gap-3 text-xs" data-source={key}>
        <span className="text-muted-foreground">{labels[key]}: <span role="status">{source.status === 'ready' ? 'Loaded' : source.status === 'loading' ? 'Loading…' : source.status === 'error' ? 'Read failed' : 'Unavailable'}</span></span>
        {['error', 'unavailable'].includes(source.status) && <button type="button" onClick={() => reload(key)} className="underline text-foreground" aria-label={`Retry ${labels[key].toLowerCase()}`}>Retry</button>}
      </li>)}
    </ul>
    <p className="text-xs text-muted-foreground">Metrics reflect available record windows, not lifetime totals. Missing sources are unavailable, not zero.</p>
  </section>;
}
