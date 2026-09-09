// Synthetic browser fixtures. No real SDK, credentials, or network transport.
const role = new URLSearchParams(location.search).get('role') || 'admin';
const banner = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500"><defs><linearGradient id="b"><stop stop-color="#281344"/><stop offset="1" stop-color="#135e68"/></linearGradient></defs><path fill="url(#b)" d="M0 0h900v500H0z"/></svg>');
export const user = role === 'anonymous' ? null : { id: 'fixture-user', role, email: 'fixture@example.invalid', full_name: 'Fixture Fan', banner_url: banner,
  has_seen_onboarding: true, has_seen_upgrades_onboarding: true };
export function useAuth() { return { user, authChecked: true, isAuthenticated: Boolean(user), isLoadingAuth: false }; }
const realNow = Date.now;
Date.now = () => window.fixtureNow ?? realNow();
const start = Date.now() - 3600000;
window.fixtureStart = start;
window.feedbackReads = 0;
window.providerReads = 0;
window.feedbackFailure = false;
window.feedbackEmpty = false;
window.providerFailure = false;
window.feedbackDelay = 0;
const events = [{ id: 'pg-local', title: 'Local ongoing show', city: 'Phoenix', state: 'AZ', venue: 'Fixture Hall',
  venue_lat: 33.45, venue_lng: -112.07, date: new Date(start).toISOString(), duration_hours: 4 }];
const feedback = Array.from({ length: 52 }, (_, i) => ({ id: String(i), feedback_type: ['bug', 'confused', 'idea', 'love'][i % 4],
  page: '/upgrades', created_date: new Date(start - i * 60000).toISOString(), message: `Complete feedback message ${i}\nSecond line is readable.` }));
export const base44 = {
  auth: { me: async () => user },
  entities: new Proxy({}, { get: (_, entity) => ({
    subscribe: () => () => {},
    list: async () => entity === 'Event' ? events : [],
    filter: async (query, _sort, limit, offset = 0) => {
      if (entity !== 'BetaFeedbackEvent') return [];
      window.feedbackReads++;
      if (user?.role !== 'admin') throw new Error('admin_only');
      if (window.feedbackDelay) await new Promise(resolve => setTimeout(resolve, window.feedbackDelay));
      if (window.feedbackFailure) throw new Error('synthetic_read_failure');
      return window.feedbackEmpty ? [] : feedback.filter(row => !query.feedback_type || row.feedback_type === query.feedback_type).slice(offset, offset + limit);
    },
  }) }),
  functions: { invoke: async name => {
    if (name !== 'getTicketmasterEvents') return { data: {} };
    window.providerReads++;
    if (window.providerFailure) throw new Error('synthetic_provider_failure');
    return { data: { events: [{ ...events[0], id: undefined, tm_id: 'tm-only', title: 'Provider ongoing show' }] } };
  } },
};
