/** A bounded read never turns an absent/malformed response into an empty queue. */
export async function readOperationalRows(read, timeoutMs = 15000) {
  let timer;
  try {
    const rows = await Promise.race([
      Promise.resolve().then(read),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Read timed out')), timeoutMs); }),
    ]);
    return Array.isArray(rows)
      ? { status: 'ready', rows, updatedAt: Date.now() }
      : { status: 'unavailable', rows: [] };
  } catch {
    return { status: 'error', rows: [] };
  } finally {
    clearTimeout(timer);
  }
}

export function operationalValue(source, value) {
  return source.status === 'ready' ? value : source.status === 'loading' ? 'Loading…' : 'Unavailable';
}
