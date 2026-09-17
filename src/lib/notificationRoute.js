const EXACT_NOTIFICATION_ROUTES = new Set([
  '/events',
  '/my-sales',
  '/my-tickets',
  '/create-listing',
  '/fan-zone',
  '/me',
  '/upgrades',
  '/sell',
  '/account-settings',
  '/edit-persona',
  '/instant-listings',
  '/seller-payout-guide',
  '/why-peanut-gallery',
  '/leaderboard',
  '/notifications',
  '/our-story',
  '/terms',
  '/privacy',
  '/cookies',
]);

const DYNAMIC_NOTIFICATION_ROUTES = [
  /^\/events\/[A-Za-z0-9_-]{1,200}$/,
  /^\/events\/tm\/[A-Za-z0-9_-]{1,200}$/,
  /^\/purchase\/[A-Za-z0-9_-]{1,200}$/,
  /^\/upgrades\/[A-Za-z0-9_-]{1,200}$/,
  /^\/event-mode\/[A-Za-z0-9_-]{1,200}$/,
];

/**
 * Return a route only when it resolves to a known, user-facing application
 * screen. Notification records are persisted data, so their destination is
 * treated as untrusted even though the backend normally creates it.
 */
export function getSafeNotificationRoute(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return null;
  if (value !== value.trim() || /[\\\u0000-\u001F\u007F]/.test(value)) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;

  // Notification links do not need query strings or fragments. Rejecting both
  // also prevents an otherwise-valid screen from receiving injected state.
  if (value.includes('?') || value.includes('#') || value.includes('%')) return null;

  if (EXACT_NOTIFICATION_ROUTES.has(value)) return value;
  return DYNAMIC_NOTIFICATION_ROUTES.some((pattern) => pattern.test(value)) ? value : null;
}
