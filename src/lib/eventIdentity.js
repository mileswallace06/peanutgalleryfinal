import { normalizeSearch } from './searchNormalize.js';
import { reliableTime } from './sellingEventTiming.js';

// Presentation identity only. Never use these groups to combine listings,
// ownership, transactions or backend records. All original routes stay valid.
const localId = event => event?.id && !String(event.id).startsWith('tm_') ? String(event.id) : null;
const variantFields = ['product_type', 'product_label', 'ticket_type', 'session_name', 'session_id', 'performance_id', 'inventory_group_id', 'ticket_product_id'];
export function eventVariantLabel(event) {
  const labels = [event?.product_label, event?.session_name, event?.ticket_type, event?.product_type].filter(Boolean);
  const reference = value => String(value);
  if (!event?.session_name && event?.session_id) labels.push(`Session ${reference(event.session_id)}`);
  if (event?.performance_id) labels.push(`Performance ${reference(event.performance_id)}`);
  if (!event?.product_label && event?.ticket_product_id) labels.push(`Ticket option ${reference(event.ticket_product_id)}`);
  if (event?.inventory_group_id) labels.push(`Inventory group ${reference(event.inventory_group_id)}`);
  if (Number(event?.listing_count) > 0) labels.push(`${event.listing_count} listing${event.listing_count === 1 ? '' : 's'} · Event ${reference(event.id || event.tm_id)}`);
  return labels.join(' · ');
}
const hasInventory = event => Number(event?.listing_count) > 0 || Number(event?.available_count) > 0 || !!event?.inventory_id;
const inventoryReference = event => hasInventory(event) && (event.inventory_id || localId(event));
// Opaque identifiers are exact; case/punctuation can distinguish sessions.
const variants = event => JSON.stringify(variantFields.map(key => [key, key.endsWith('_id') ? String(event?.[key] || '') : normalizeSearch(String(event?.[key] || ''))]));
export function eventIdentityKeys(event) {
  if (!event) return [];
  const keys = [];
  if (event.id) keys.push(`id:${event.id}`);
  if (event.tm_id) keys.push(`tm:${event.tm_id}|${variants(event)}`);
  // Alias IDs are accepted only from the normalized, explicitly trusted field.
  if (event.provider_aliases_verified === true && Array.isArray(event.provider_aliases)) {
    for (const alias of event.provider_aliases) if (typeof alias === 'string' && alias) keys.push(`tm:${alias}|${variants(event)}`);
  }
  // Matching names, venues and times are not proof that two provider records
  // are aliases. Only exact provider identity or explicitly verified aliases
  // can collapse; similarity is used below solely to disclose ambiguity.
  return keys;
}
const confirmedStart = event => event.time_tba || event.date_tba || event.no_specific_time ? null : reliableTime(event.event_start_utc || event.date);
const compatibleOccurrences = (left, right) => {
  if (left.id && left.id === right.id) return true;
  const a = confirmedStart(left), b = confirmedStart(right);
  if (a !== null && b !== null && a !== b) return false;
  if (left.tm_venue_id && right.tm_venue_id && left.tm_venue_id !== right.tm_venue_id) return false;
  return variants(left) === variants(right);
};

/** Annotate visible context collisions without treating them as identity proof. */
export function markEventIdentityAmbiguity(rows = []) {
  const counts = new Map();
  const key = event => JSON.stringify([
    ...['title', 'venue', 'city', 'state'].map(field => normalizeSearch(String(event[field] || ''))),
    confirmedStart(event), variants(event),
  ]);
  for (const event of rows) counts.set(key(event), (counts.get(key(event)) || 0) + 1);
  return rows.map(event => {
    const result = { ...event };
    if (counts.get(key(event)) > 1) result._identityAmbiguous = true;
    else delete result._identityAmbiguous;
    return result;
  });
}

function eventProviderLabel(event) {
  try {
    const host = new URL(event.tm_url).hostname.toLowerCase();
    if (host === 'axs.com' || host.endsWith('.axs.com')) return 'AXS event page';
    if (host === 'ticketmaster.com' || host.endsWith('.ticketmaster.com')) return 'Ticketmaster event page';
  } catch { /* No trusted provider page context available. */ }
  return '';
}

/** A record reference identifies a route, never an invented session/occurrence. */
export function eventIdentityLabel(event, { alwaysReference = false } = {}) {
  if (!event) return '';
  const ambiguous = event._identityAmbiguous === true;
  const sparse = confirmedStart(event) === null;
  const reference = event.id || (event.tm_id ? `tm_${event.tm_id}` : null);
  const labels = [eventVariantLabel(event), eventProviderLabel(event)];
  if (ambiguous) labels.push('Identity unconfirmed — separate records share this context');
  else if (sparse) labels.push('Occurrence unconfirmed');
  else if (alwaysReference && !event.tm_id) labels.push('Provider identity unconfirmed');
  if (alwaysReference || ambiguous || sparse) labels.push(reference ? `Event reference ${reference}` : 'Event reference unavailable');
  return labels.filter(Boolean).join(' · ');
}
export function dedupeEventIdentities(rows = []) {
  const groups = [], byKey = new Map();
  const compatible = (group, event) => {
    const refs = new Set([...group.events, event].map(inventoryReference).filter(Boolean));
    return refs.size <= 1 && group.events.every(row => compatibleOccurrences(row, event));
  };
  for (const event of rows) {
    if (!event || typeof event !== 'object') continue;
    const keys = eventIdentityKeys(event);
    const matches = [...new Set(keys.map(key => byKey.get(key)).filter(group => group && compatible(group, event)))];
    const group = matches[0] || { events: [], keys: new Set() };
    if (!matches.length) groups.push(group);
    for (const other of matches.slice(1)) {
      if (new Set([...group.events, ...other.events, event].map(inventoryReference).filter(Boolean)).size > 1 || !other.events.every(row => compatible(group, row))) continue;
      group.events.push(...other.events);
      for (const key of other.keys) { group.keys.add(key); byKey.set(key, group); }
      other.events = [];
    }
    group.events.push(event);
    for (const key of keys) { group.keys.add(key); byKey.set(key, group); }
  }
  return markEventIdentityAmbiguity(groups.filter(group => group.events.length).map(group => {
    // A sparse synced copy must not replace a row whose inventory reference
    // made the group safe to retain. Prefer that row before local-route ties.
    const sorted = [...group.events].sort((a, b) => Number(hasInventory(b)) - Number(hasInventory(a)) || Number(!!localId(b)) - Number(!!localId(a)) || String(a.id || a.tm_id || '').localeCompare(String(b.id || b.tm_id || '')));
    const canonical = sorted[0];
    const aliases = [...new Set(sorted.flatMap(event => [event.id, event.tm_id && `tm_${event.tm_id}`, ...(event.provider_aliases_verified === true && Array.isArray(event.provider_aliases) ? event.provider_aliases.filter(alias => typeof alias === 'string' && alias).map(alias => `tm_${alias}`) : []), ...(event._eventAliases || [])]).filter(Boolean))];
    return { ...canonical, _eventAliases: aliases };
  }));
}
export function resolveEventAlias(events, id) {
  const exact = events.find(event => event.id === id);
  if (exact) return exact;
  const matches = events.filter(event => event._eventAliases?.includes(id));
  // A provider ID can cover multiple retained inventory records. Never choose
  // one operational target merely because it happened to be listed first.
  return matches.length === 1 ? matches[0] : null;
}
export function compareDiscoveryEvents(a, b, sort = 'soonest') {
  const ta = reliableTime(a.event_start_utc || a.date), tb = reliableTime(b.event_start_utc || b.date);
  if (ta === null && tb !== null) return 1;
  if (tb === null && ta !== null) return -1;
  return (ta === null ? 0 : (sort === 'latest' ? tb - ta : ta - tb))
    || String(a.id || a.tm_id || '').localeCompare(String(b.id || b.tm_id || ''));
}
