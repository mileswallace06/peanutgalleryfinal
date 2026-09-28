import { SOON_WINDOW_MINUTES } from './eventTiming.js';
import { sellingEventTiming } from './sellingEventTiming.js';

// Discovery must agree with Sell about actual ends, estimated windows and TBA
// times. Keep the Upgrades-only "Soon" label without changing those rules.
export function getUpgradeEventTiming(event, nowMs = Date.now()) {
  const timing = sellingEventTiming(event, nowMs);
  return timing.status === 'upcoming' && timing.start - nowMs <= SOON_WINDOW_MINUTES * 60000
    ? { ...timing, status: 'soon' } : timing;
}

const eventStart = event => {
  const value = Date.parse(event.event_start_utc || event.date || '');
  return Number.isFinite(value) ? value : Infinity;
};

// Discovery labels describe event timing, not available upgrade inventory.
export function groupUpgradeEvents(events, nowMs = Date.now()) {
  const live = [];
  const upcoming = [];
  for (const event of events) {
    const status = getUpgradeEventTiming(event, nowMs).status;
    if (status === 'live' || status === 'estimated_live') live.push(event);
    else if (status === 'soon' || status === 'upcoming' || status === 'unknown') upcoming.push(event);
  }
  live.sort((a, b) => eventStart(a) - eventStart(b));
  upcoming.sort((a, b) => eventStart(a) - eventStart(b));
  return { live, upcoming };
}

// Reuse the wallet's authenticated buyer view. Never enumerate Purchase directly.
// These events are shortcuts into the existing hub, not purchase authorization.
export async function loadOwnedUpgradeEvents(client) {
  const response = await client.functions.invoke('getPurchaseParticipantView', {
    action: 'list_mine', perspective: 'buyer',
  });
  const purchases = response?.data?.purchases;
  if (!Array.isArray(purchases)) throw new Error('Ticket list unavailable');
  const eventIds = [...new Set(purchases
    .filter(p => p.transfer_status === 'completed' && typeof p.event_id === 'string' && p.event_id)
    .map(p => p.event_id))];
  const results = await Promise.allSettled(eventIds.map(id => client.entities.Event.filter({ id })));
  const events = [];
  let unavailableCount = 0;
  results.forEach((result, index) => {
    const event = result.status === 'fulfilled' && Array.isArray(result.value)
      ? result.value.find(value => value.id === eventIds[index]) : null;
    if (event) events.push(event);
    else unavailableCount += 1;
  });
  return { events, unavailableCount };
}
