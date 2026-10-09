// Browser-side SDK shape guard; all unknown accesses become persistent evidence
// even if application error handling catches the exception.
export function guardFixtureSdk(sdk, onUnexpected) {
  const proxies = new WeakMap();
  const wrap = (value, path) => {
    if (!value || typeof value !== 'object') return value;
    if (proxies.has(value)) return proxies.get(value);
    const proxy = new Proxy(value, { get(target, key) {
      if (typeof key === 'symbol' || key === 'then') return Reflect.get(target, key);
      const child = Reflect.get(target, key);
      if (child === undefined) {
        const name = `${path}.${key}`;
        window.__PG_RECORD_FIXTURE_BLOCK__?.({ kind: 'sdk', name });
        onUnexpected(name);
        throw new Error(`Unmocked isolated fixture SDK access: ${name}`);
      }
      return wrap(child, `${path}.${key}`);
    } });
    proxies.set(value, proxy);
    return proxy;
  };
  return wrap(sdk, 'base44');
}
