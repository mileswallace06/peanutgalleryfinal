import { getEventLiveStatus } from './eventTiming.js';
import { TICKET_LISTING_TYPES, UPGRADE_LISTING_TYPES } from './listingTypes.js';
import { getListingShareUrl, parseShareInstant } from './listingShare.js';

const LISTING_FIELDS = [
  'id', 'event_id', 'section', 'row', 'quantity', 'tier', 'asking_price',
  'listing_type', 'status', 'is_verified', 'is_demo_listing', 'reservation_state',
  'listing_mode', 'is_instant_ready', 'upgrade_window_closes_at',
  'transfer_status', 'requires_location', 'location_requirement', 'requires_existing_ticket',
  // Internal ownership checks may use this boolean; it is never exported in artwork.
  'viewer_is_seller',
];
const EVENT_FIELDS = [
  'id', 'title', 'venue', 'city', 'state', 'image_url', 'event_start_utc',
  'date', 'venue_timezone', 'duration_hours', 'category', 'status', 'is_demo', 'is_beta_live',
  'transfer_window_status', 'transfer_window_closes_at',
];
const allowed = (record, keys) => Object.fromEntries(keys
  .filter(key => record[key] !== undefined).map(key => [key, record[key]]));

function validId(value) {
  return !!getListingShareUrl(value);
}

function shareableListing(listing) {
  return listing && validId(listing.id) && validId(listing.event_id)
    && listing.status === 'active' && listing.is_verified === true && listing.is_demo_listing === false
    && listing.reservation_state === 'available'
    && listing.transfer_status !== 'transfer_disabled'
    && (listing.listing_mode !== 'instant' || listing.is_instant_ready === true)
    && [...TICKET_LISTING_TYPES, ...UPGRADE_LISTING_TYPES].includes(listing.listing_type)
    && typeof listing.asking_price === 'number' && Number.isFinite(listing.asking_price) && listing.asking_price > 0
    && Number.isInteger(listing.quantity) && listing.quantity > 0;
}

export function isSharedEventOpen(event, nowMs = Date.now()) {
  if (!event || !Number.isFinite(nowMs) || event.is_demo || event.is_beta_live || event.status === 'ended'
    || parseShareInstant(event.event_start_utc || event.date) === null
    || ['closed', 'manually_verified_closed'].includes(event.transfer_window_status)) return false;
  if (!windowStillOpen(event.transfer_window_closes_at, nowMs)) return false;
  const duration = event.duration_hours;
  const timing = getEventLiveStatus({ ...event, duration_hours: typeof duration === 'number'
    && Number.isFinite(duration) && duration > 0 ? duration : undefined }, nowMs);
  return timing.end_utc_ms > nowMs;
}

function windowStillOpen(value, nowMs) {
  if (!value) return true;
  const closes = parseShareInstant(value);
  return closes !== null && closes > nowMs;
}

function unavailableError(error) {
  const status = Number(error?.response?.status ?? error?.status);
  return [400, 404].includes(status);
}

/**
 * Read the existing safe views only. The single-record API also serves owners,
 * so membership in list_active_by_event independently enforces its PUBLIC proof
 * and fail-closed gates. Its 200-record cap deliberately fails closed for a
 * listing outside that result; it must not fall back to a different listing.
 * Only public display fields survive, even when called by a seller/admin.
 */
export async function loadSharedListing({ invoke, filterEvents }, listingId, nowMs = Date.now()) {
  if (!validId(listingId)) return { status: 'unavailable' };
  try {
    const single = await invoke('getListingParticipantView', { listing_id: listingId });
    const initial = single?.data?.listing;
    if (initial?.id !== listingId || !shareableListing(initial)) return { status: 'unavailable' };

    const publicView = await invoke('getListingParticipantView', {
      action: 'list_active_by_event', event_id: initial.event_id,
    });
    if (!Array.isArray(publicView?.data?.listings)) return { status: 'error' };
    const listing = publicView.data.listings.find(item => item.id === listingId && item.event_id === initial.event_id);
    if (!shareableListing(listing)) return { status: 'unavailable' };

    const events = await filterEvents({ id: listing.event_id });
    if (!Array.isArray(events)) return { status: 'error' };
    const event = events.find(item => item.id === listing.event_id);
    if (!isSharedEventOpen(event, nowMs) || !windowStillOpen(listing.upgrade_window_closes_at, nowMs)) return { status: 'unavailable' };

    return { status: 'available', listing: allowed(listing, LISTING_FIELDS), event: allowed(event, EVENT_FIELDS) };
  } catch (error) {
    // Never surface provider responses: they can include request details.
    if ([401, 403].includes(Number(error?.response?.status ?? error?.status))) return { status: 'authentication-required' };
    return { status: unavailableError(error) ? 'unavailable' : 'error' };
  }
}

export function listingHandoffHref(listing) {
  if (!validId(listing?.id) || !validId(listing?.event_id)) return null;
  const page = UPGRADE_LISTING_TYPES.includes(listing.listing_type) ? 'upgrades'
    : TICKET_LISTING_TYPES.includes(listing.listing_type) ? 'events' : null;
  return page ? `/${page}/${encodeURIComponent(listing.event_id)}?${new URLSearchParams({ listing: listing.id })}` : null;
}

/** A shared link may narrow a feed, but never auto-select a purchase or another listing. */
export function sharedListingSelection(listings, event, search, types, nowMs = Date.now()) {
  const params = new URLSearchParams(search);
  if (!params.has('listing')) return { requested: false, listings };
  const ids = params.getAll('listing');
  if (ids.length !== 1 || !validId(ids[0]) || !isSharedEventOpen(event, nowMs)) {
    return { requested: true, listings: [] };
  }
  const selected = listings.find(listing => listing.id === ids[0]
    && listing.event_id === event.id && types.includes(listing.listing_type)
    && shareableListing(listing) && windowStillOpen(listing.upgrade_window_closes_at, nowMs));
  return { requested: true, listings: selected ? [selected] : [] };
}
