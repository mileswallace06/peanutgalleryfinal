# Workflow and semantics checks — 2026-10-03

These checks cover local source changes and isolated fixtures. They do not establish live deployment, browser rendering, screen-reader behavior, geofence eligibility, or payment readiness. No browser, remote user records, notification writes, real listing creation, or transactions were used.

## Findings

- **F4 fixed in local code:** Sell now uses the existing read-only `useSellingDiscovery` market selection instead of prompting for GPS on mount. The city picker, location-denied/unavailable recovery, no-results guidance, and incomplete-results retry work independently of venue eligibility. A shared market subscription updates retained Events/Upgrades/Sell/Create Listing consumers after a city changes; the validated saved market survives navigation/reload. Existing location TTL/validation and purchase geofencing remain separate.
- **F7 fixed in local code:** Landing and Onboarding render a real main landmark and h1. Onboarding exposes one current slide with its position; outgoing content is immediately removed while current-slide entrance and background animation remain. Next, Back, progress, Skip, and login/register destinations are preserved in fixtures.
- **F8 fixed in local code:** The shared FAQ accordion uses native `hidden` for closed regions, unique control/panel IDs, and focus return when closing a panel that contains focus. Removing the fixed 600px cap also avoids clipping long answers. Native buttons retain keyboard activation; the chevron animation remains. Actual keyboard/screen-reader inspection is outstanding.
- **Find fans addressed with truthful recovery:** No existing people search or public profile destination was found. Following now links to the real Trending feed; Friends has an Explore Trending action that clears date filtering. Copy explains current community browsing and existing Followers/Follow back behavior without promising unavailable people search. No new lookup backend or follow mutation path was introduced.
- **F2 supporting Sell fix:** Nearby event and listing date labels use the shared venue-local display formatter, including explicit timezone, UTC/venue-unconfirmed fallback, and TBA copy.
- FAQ/Terms refund promises were not changed; F13 remains an owner decision.

## Files changed by this work

- `src/pages/Sell.jsx`
- `src/lib/eventLocation.js`
- `src/hooks/useSellingDiscovery.js`
- `src/pages/Events.jsx` — only market-subscription import/effect; timing changes are separately owned
- `src/pages/Landing.jsx`
- `src/components/Onboarding.jsx`
- `src/components/education/FaqAccordion.jsx` — consumed by Why Peanut Gallery; Why/FAQ copy unchanged
- `src/pages/FanZone.jsx`
- `src/pages/Me.jsx`
- `tests/audit-workflow-semantics.test.mjs`
- `tests/public-access-render.test.mjs` — CSS-empty loader for server-render route fixture

## Commands and results

`node --test tests/audit-workflow-semantics.test.mjs tests/public-access-render.test.mjs`

**13/13 passed:** 9 new workflow/semantics cases plus 4 public-route cases. The new cases execute compiled components and hook fixtures for market persistence and retained tabs; denied/unavailable/stale GPS; landing destinations; current onboarding slides; FAQ open/closed/focus; and Sell missing-location, denied, no-results, failed/partial, populated, timezone-fallback, and TBA states. Find-fans destination checks are source-level contracts. Public-route checks use React server rendering with styles excluded; they verify public privacy access and member Layout gating. An existing StaticRouter Navigate warning means this is not browser redirect evidence.

`node --test tests/audit-workflow-semantics.test.mjs tests/event-search-request.test.mjs tests/selling-event-picker.test.mjs tests/public-access-render.test.mjs tests/bucket-list-feed.test.mjs`

**43/43 passed.** Expected mocked Ticketmaster 429 logs exercise error recovery; no provider requests were made. The public-access fixture initially failed because esbuild lacked a CSS loader, then passed after the narrow test-only loader fix.

`npx eslint src/pages/Sell.jsx src/pages/Events.jsx src/pages/Landing.jsx src/components/Onboarding.jsx src/components/education/FaqAccordion.jsx src/pages/Me.jsx src/pages/FanZone.jsx --quiet`

**Passed.** Only npm's existing unknown `http-proxy` configuration warning was printed.

`git diff --check`

`node --check src/lib/eventLocation.js`

`node --check src/hooks/useSellingDiscovery.js`

**All passed.** Root owns the combined build and release status. No commits or deployment were performed by this work.

## Remaining evidence limits

Light/dark visual rendering, desktop/mobile layout, zoom, browser Back, actual native keyboard events, screen-reader accessibility-tree checks, and real-device behavior remain unverified in this pass. Fixture semantics and source checks must not be presented as rendered or production verification. Existing Follow back operation was preserved, not executed against a real account.
