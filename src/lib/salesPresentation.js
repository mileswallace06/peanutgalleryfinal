import { getEventDateDisplay } from './eventDateDisplay.js';

// Display-only contract: the participant endpoint returns up to 500 authorized
// records, not a lifetime aggregate. seller_payout is the recorded amount owed,
// and payment_captured is buyer capture, not confirmation of a bank payout.
export const SELLER_HISTORY_SCOPE = 'Available seller history (up to 500 records); demo sales excluded.';
export function summarizeSellerHistory(sales = []) {
  const completed = sales.filter(p => !p.is_demo && p.transfer_status === 'completed');
  const known = completed.filter(p => typeof p.seller_payout === 'number' && Number.isFinite(p.seller_payout));
  return {
    completedCount: completed.length,
    recordedAmount: known.reduce((sum, p) => sum + p.seller_payout, 0),
    missingAmounts: completed.length - known.length,
  };
}
export function formatRecordedAmount(amount) {
  return typeof amount === 'number' && Number.isFinite(amount) ? `$${amount.toFixed(2)}` : 'Amount unavailable';
}
export function salePaymentStatus(sale) {
  if (sale.payment_capture_failed) return { label: 'Payment capture failed', tone: 'warning' };
  if (sale.payment_captured === true) return { label: 'Payment captured', tone: 'active' };
  // The participant serializer coerces absent capture evidence to false.
  // False therefore cannot establish that capture has not happened.
  if (sale.payment_captured === false) return { label: 'Payment capture not confirmed', tone: 'warning' };
  return { label: 'Payment status unavailable', tone: 'warning' };
}
export function saleIdentity(sale, event, listing) {
  // No immutable event/seat snapshot is exposed by the participant serializer.
  // Do not invent one or read privileged records to fill missing metadata.
  const seats = listing ? [listing.section && `Section ${listing.section}`, listing.row && `Row ${listing.row}`, listing.seats && `Seats ${listing.seats}`].filter(Boolean).join(' · ') : '';
  return {
    title: event?.title || 'Event details unavailable',
    reference: sale.id ? `Sale reference: ${sale.id}` : 'Sale reference unavailable',
    eventLabel: getEventDateDisplay(event)?.detailLabel || '',
    venue: event?.venue_name || event?.venue || '',
    seats,
  };
}
export function adminEventIdentity(event, eventId) {
  return event?.title || (eventId ? `Event details unavailable · Event reference: ${eventId}` : 'Event details unavailable · No event reference');
}
