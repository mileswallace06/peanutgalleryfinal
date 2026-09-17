const ACTIONABLE_PURCHASE_STATUSES = new Set(['pending_transfer']);

/**
 * Prefer the newest completed purchase, then the newest still-actionable
 * purchase. Terminal/cancelled records must never be presented as a current
 * ticket.
 */
export function selectCurrentPurchase(purchases = []) {
  const newestFirst = [...purchases].sort(
    (a, b) => new Date(b?.created_date || 0) - new Date(a?.created_date || 0),
  );
  return newestFirst.find(purchase => purchase?.transfer_status === 'completed')
    || newestFirst.find(purchase => ACTIONABLE_PURCHASE_STATUSES.has(purchase?.transfer_status));
}

/**
 * Seat inventory can outlive a cancellation. Use the first usable ownership
 * record, excluding records explicitly cancelled or transfer-expired.
 */
export function selectCurrentSeatInventory(records = []) {
  return records.find(record =>
    record?.section
    && record.inventory_status !== 'cancelled'
    && record.transfer_status !== 'transfer_expired'
  ) || null;
}
