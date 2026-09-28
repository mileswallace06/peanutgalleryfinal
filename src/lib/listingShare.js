/**
 * Public-only share projection. Input must come from getListingParticipantView;
 * these client checks are presentation checks, never authorization or proof review.
 * Do not spread listing/event records into exported artwork or share messages.
 */
export const LISTING_SHARE_ORIGIN = 'https://peanutgallery.store';
const TYPES = new Set(['resale_ticket', 'venue_ticket', 'live_upgrade', 'venue_upgrade']);
const CLOSED = new Set(['closed', 'manually_verified_closed']);
const DURATION = { concert: 4, sports: 4, theater: 3, comedy: 3, other: 4 };
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

export function cleanShareText(value, maxLength = 120) {
  if (typeof value !== 'string') return '';
  const text = value.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  const chars = Array.from(text);
  return chars.length > maxLength ? `${chars.slice(0, maxLength - 1).join('')}…` : text;
}

export function getListingShareUrl(id) {
  if (typeof id !== 'string' || !id || id.length > 200 || id !== id.trim()
    || id === '.' || id === '..' || /[\u0000-\u0020\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(id)) return null;
  try { return `${LISTING_SHARE_ORIGIN}/listings/${encodeURIComponent(id)}`; } catch { return null; }
}

/** Parse only explicit UTC/offset instants. Never let the device infer a zone. */
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateLabel(event, start) {
  const zone = cleanShareText(event.venue_timezone, 100);
  const options = { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
  if (zone) {
    try { return new Intl.DateTimeFormat('en-US', { ...options, timeZone: zone }).format(start); } catch { /* explicit UTC fallback below */ }
  }
  return `${new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(start)} · venue time unconfirmed`;
}

/**
 * Returns { data, reason }. The returned data is the complete export allowlist.
 * No images, email, exact seats, notes, proof, token, or private IDs are included.
 * Fresh public-list membership is additionally checked by the caller before export.
 */
export function getListingShareData(listing, event, now = Date.now()) {
  const fail = (reason) => ({ data: null, reason });
  if (!listing || listing.viewer_is_seller !== true) return fail('Only the seller can create a listing image.');
  const url = getListingShareUrl(listing.id);
  if (!url) return fail('This listing link is unavailable.');
  if (!event || typeof event.id !== 'string' || event.id !== listing.event_id) return fail('The event could not be confirmed.');
  if (listing.is_demo_listing !== false || listing.inventory_source === 'pg_demo' || event.is_beta_live === true || event.is_demo === true) return fail('Demo listings cannot be shared.');
  if (listing.status !== 'active' || listing.hidden_reason) return fail('Only active listings can be shared.');
  if (listing.is_verified !== true && listing.proof_status !== 'approved') return fail('This listing is still awaiting approval.');
  if (listing.reservation_state !== 'available') return fail('This listing is currently reserved or unavailable.');
  if (!TYPES.has(listing.listing_type)) return fail('This listing type cannot be shared.');
  if (typeof listing.asking_price !== 'number' || !Number.isFinite(listing.asking_price) || listing.asking_price <= 0
    || !Number.isSafeInteger(Math.round(listing.asking_price * 100)) || Math.abs(listing.asking_price * 100 - Math.round(listing.asking_price * 100)) > 0.00001) return fail('The ticket price could not be confirmed.');
  if (!Number.isSafeInteger(listing.quantity) || listing.quantity < 1) return fail('The ticket quantity could not be confirmed.');
  const nowMs = now instanceof Date ? now.getTime() : now;
  const start = instant(event.event_start_utc || event.date);
  if (!Number.isFinite(nowMs) || start === null) return fail('The event date could not be confirmed.');
  const hours = typeof event.duration_hours === 'number' && Number.isFinite(event.duration_hours) && event.duration_hours > 0
    ? event.duration_hours : (DURATION[event.category] || 4);
  if (event.status === 'ended' || start + hours * 3600000 <= nowMs) return fail('This event has ended.');
  if (CLOSED.has(event.transfer_window_status)) return fail('Ticket transfers are closed for this event.');
  for (const value of [listing.upgrade_window_closes_at, event.transfer_window_closes_at]) {
    if (value && (instant(value) === null || instant(value) <= nowMs)) return fail('The transfer window has closed or could not be confirmed.');
  }
  if (listing.transfer_status === 'transfer_disabled') return fail('Ticket transfer is disabled for this listing.');
  if (listing.listing_mode === 'instant' && listing.is_instant_ready !== true) return fail('This instant listing is not ready to share.');
  // Stale/unconfirmed transfer warnings remain the live listing's responsibility;
  // sharing does not introduce a new purchase or verification policy.
  const title = cleanShareText(event.title, 150);
  const venue = cleanShareText(event.venue, 90);
  if (!title || !venue) return fail('The event name and venue could not be confirmed.');
  const isUpgrade = listing.listing_type === 'live_upgrade' || listing.listing_type === 'venue_upgrade';
  return {
    data: {
      id: listing.id,
      title,
      venue,
      city: cleanShareText([cleanShareText(event.city, 60), cleanShareText(event.state, 20)].filter(Boolean).join(', '), 82),
      dateLabel: dateLabel(event, start),
      section: cleanShareText(listing.section, 32),
      row: cleanShareText(listing.row, 24),
      quantity: listing.quantity,
      priceLabel: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(listing.asking_price),
      kindLabel: isUpgrade ? 'Seat upgrade' : 'Tickets for sale',
      isUpgrade,
      url,
    },
    reason: null,
  };
}
