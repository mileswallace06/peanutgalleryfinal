/**
 * Reservation Mutation Manifest (7C.9C.2E Task 5)
 *
 * Complete list of production entry points that mutate reservation state.
 * Each entry has an `integrated` flag that is false until the entry point
 * is migrated to use the reservation authority.
 *
 * The launch gate reads this manifest to verify production integration.
 * The integration portion of the gate remains RED while any entry point
 * has integrated: false.
 */
export const RESERVATION_MUTATION_ENTRY_POINTS = [
  { name: 'reserveListing', path: 'base44/functions/reserveListing/entry.ts', integrated: false },
  { name: 'releaseReservation', path: 'base44/functions/releaseReservation/entry.ts', integrated: false },
  { name: 'createCheckout', path: 'base44/functions/createCheckout/entry.ts', integrated: false },
  { name: 'abortCheckout', path: 'base44/functions/abortCheckout/entry.ts', integrated: false },
  { name: 'cancelPurchase', path: 'base44/functions/cancelPurchase/entry.ts', integrated: false },
  { name: 'processTransferReminders', path: 'base44/functions/processTransferReminders/entry.ts', integrated: false },
  { name: 'capturePayment', path: 'base44/functions/capturePayment/entry.ts', integrated: false },
  { name: 'cleanupAbandonedCheckouts', path: 'base44/functions/cleanupAbandonedCheckouts/entry.ts', integrated: false },
  { name: 'stripeWebhook', path: 'base44/functions/stripeWebhook/entry.ts', integrated: false },
  { name: 'submitListing/manage_existing', path: 'base44/functions/submitListing/entry.ts', integrated: false },
  { name: 'deleteAccount', path: 'base44/functions/deleteAccount/entry.ts', integrated: false },
];