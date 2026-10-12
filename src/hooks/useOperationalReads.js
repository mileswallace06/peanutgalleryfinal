import { useCallback, useEffect, useRef, useState } from 'react';
import { readOperationalRows } from '@/lib/operationalReads';

/** Stable read definitions only. Each source settles independently; late/unmounted reads cannot replace newer results. */
export function useOperationalReads(definitions, enabled = true) {
  const [sources, setSources] = useState(() => Object.fromEntries(Object.keys(definitions).map(key => [key, { status: 'loading', rows: [] }])));
  const active = useRef(false);
  const versions = useRef({});
  const reload = useCallback(async (requested) => {
    if (!active.current || !enabled) return;
    const keys = typeof requested === 'string' && definitions[requested] ? [requested] : Object.keys(definitions);
    await Promise.all(keys.map(async key => {
      const version = (versions.current[key] || 0) + 1;
      versions.current[key] = version;
      setSources(previous => ({ ...previous, [key]: { status: 'loading', rows: [] } }));
      const source = await readOperationalRows(definitions[key]);
      if (active.current && versions.current[key] === version) setSources(previous => ({ ...previous, [key]: source }));
    }));
  }, [definitions, enabled]);
  useEffect(() => {
    active.current = true;
    if (enabled) void reload();
    return () => {
      active.current = false;
      for (const key of Object.keys(definitions)) versions.current[key] = (versions.current[key] || 0) + 1;
    };
  }, [definitions, enabled, reload]);
  return { sources, reload, loading: Object.values(sources).some(source => source.status === 'loading') };
}
