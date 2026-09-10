// Only pathname is recorded by FeedbackWidget. Never reconstruct query strings,
// hash state, or accept a URL supplied by a feedback record.
const PAGES = new Map(Object.entries({
  '/': 'Events',
  '/events': 'Events',
  '/upgrades': 'Upgrades',
  '/sell': 'Sell',
  '/fan-zone': 'Fan Zone',
  '/me': 'Me',
  '/create-listing': 'Create Listing',
  '/my-sales': 'My Sales',
  '/my-tickets': 'My Tickets',
  '/account-settings': 'Account Settings',
  '/edit-persona': 'Edit Persona',
  '/notifications': 'Notifications',
  '/leaderboard': 'Leaderboard',
  '/terms': 'Terms of Service',
  '/privacy': 'Privacy Policy',
  '/cookies': 'Cookie Policy',
  '/our-story': 'Our Story',
  '/instant-listings': 'Instant Listings Guide',
  '/seller-payout-guide': 'Seller Payout Guide',
  '/why-peanut-gallery': 'Why Peanut Gallery',
  '/admin': 'Admin Panel',
  '/admin-legacy': 'Legacy Admin Panel',
  '/founder': 'Founder Dashboard',
  '/beta-qa': 'Beta QA',
  '/beta-checklist': 'Beta Checklist',
  '/beta-testers': 'Beta Testers',
  '/beta-dashboard': 'Beta Dashboard',
}));
const DETAIL_PAGES = [
  [/^\/events\/tm\/[A-Za-z0-9_-]{1,128}$/, 'Ticketmaster Event'],
  [/^\/events\/[A-Za-z0-9_-]{1,128}$/, 'Event Details'],
  [/^\/upgrades\/[A-Za-z0-9_-]{1,128}$/, 'Upgrade Details'],
  [/^\/purchase\/[A-Za-z0-9_-]{1,128}$/, 'Purchase Details'],
  [/^\/event-mode\/[A-Za-z0-9_-]{1,128}$/, 'Event Mode'],
];

export function identifyFeedbackPage(value) {
  if (value == null || (typeof value === 'string' && !value.trim())) {
    return { status: 'missing', name: 'Page not recorded', path: null, href: null };
  }
  const unavailable = { status: 'invalid', name: 'Page unavailable', path: null, href: null };
  // Reject schemes, protocol-relative paths, escapes, controls, query strings,
  // hashes and dot segments before matching the app's known routes.
  if (typeof value !== 'string' || value.length > 500 || !/^\/(?:[A-Za-z0-9_-]+\/?)*$/.test(value)) return unavailable;
  const path = value.length > 1 ? value.replace(/\/$/, '') : value;
  const name = PAGES.get(path) || DETAIL_PAGES.find(([pattern]) => pattern.test(path))?.[1];
  return name ? { status: 'valid', name, path: value, href: value } : unavailable;
}
