/** Accept only an explicit instant; never interpret a naive value in the viewer's zone. */
export function reliableTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const [year, month, day, hour, minute] = value.slice(0, 16).split(/[-T:]/).map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > days || hour > 23 || minute > 59) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
