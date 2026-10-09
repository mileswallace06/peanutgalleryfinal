// Static route names avoid leaking account, purchase or password-reset data in titles.
const names = {
  '/': 'Seat Upgrades', '/login': 'Sign In', '/register': 'Create Account',
  '/forgot-password': 'Reset Password', '/reset-password': 'Reset Password',
  '/terms': 'Terms of Service', '/privacy': 'Privacy Policy', '/cookies': 'Cookie Policy',
  '/our-story': 'Our Story', '/help': 'Help', '/events': 'Tickets', '/upgrades': 'Upgrades',
  '/sell': 'Sell Seats', '/create-listing': 'Create Listing', '/fan-zone': 'Fan Zone',
  '/me': 'Your Profile', '/my-sales': 'My Sales', '/my-tickets': 'My Tickets',
  '/account-settings': 'Account Settings', '/edit-persona': 'Edit Persona',
  '/admin': 'Admin Command Center', '/admin-legacy': 'Admin', '/beta-qa': 'Beta Feedback',
  '/instant-listings': 'Instant Listings Guide', '/seller-payout-guide': 'Seller Payout Guide',
  '/why-peanut-gallery': 'Why Peanut Gallery', '/leaderboard': 'Leaderboard',
  '/founder': 'Founder Dashboard', '/beta-checklist': 'Beta Checklist',
  '/beta-testers': 'Beta Testers', '/beta-dashboard': 'Beta Dashboard', '/notifications': 'Notifications',
};
export function titleForRoute(pathname) {
  const path = pathname.replace(/\/$/, '') || '/';
  const name = names[path] || (/^\/events\//.test(path) ? 'Event Details'
    : /^\/upgrades\//.test(path) ? 'Event Upgrades'
    : /^\/listings\//.test(path) ? 'Shared Listing'
    : /^\/purchase\//.test(path) ? 'Purchase Details'
    : /^\/event-mode\//.test(path) ? 'Event Mode' : 'Page Not Found');
  return `${name} | Peanut Gallery`;
}
