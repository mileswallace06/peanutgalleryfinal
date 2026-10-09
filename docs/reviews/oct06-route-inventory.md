# October 6 audit: route and listing browser inventory

This is isolated browser evidence from the repair working tree based on `852dc94cd7edea7d18cf75c72ffd6c2ff9ca9bc3`, recorded October 9, 2026 UTC (October 8 in Phoenix). It is not a production deployment check. The parent audit report records the finalized commit and aggregate run separately.

## Results

The production route map contains 38 explicit patterns and one wildcard. All 39 were mounted with guest, member, and admin fixtures in light and dark themes at 390 × 844: 234 initial route observations. Another 20 observations cover `/login` as guest and `/events` as member in both themes at 320 × 844, 375 × 844, 430 × 844, 1280 × 900, and landscape 844 × 390.

Of 254 observations, **252 rendered as expected and two were fixture-blocked**. There were zero assertion/render failures, document-title mismatches, page-wide overflow observations, uncaught browser errors, unexpected fixture reads, or intercepted external requests. All 36 SPA title/history transitions passed, across six role/theme combinations. They cover Terms/Cookies, Back/Forward, protected Events, and the legacy Event Mode redirect. This is route rendering and title coverage; it does not establish full workflow correctness.

Both blocked cases are `/founder` as admin, one per theme. Initial rendering attempts `entities.AdminAlert.create`; the fixture denied this privileged mutation. The screen and title rendered, but the route is intentionally not counted as a clean pass. No alert was created in a service. This exact route/role/API combination is the only allowed fixture blocker; any new unexpected read, write, outbound request, runtime/render/title error, or overflow fails the runner. `unexpectedFixtureBlockers` reports unapproved gaps separately. `EventNavigationLog.create` is simulated only in fixture memory. The report's `localFixtureMutations` field names all attempted mutation APIs, including denied calls; consult `blockedWrites` to distinguish them.

## Route matrix

Every cell below was observed in **both** themes. “N/A” marks content outside that role's permitted view or a privileged action deliberately excluded from this inventory; it does not replace a failed test. Protected guest redirects and member admin gates are UI observations using fixture roles, not a backend authorization certification.

| Router pattern | Guest | Member | Admin |
|---|---|---|---|
| `/` | Tested initial render | Tested redirect to `/events` | Tested redirect to `/events` |
| `/login` | Tested initial render | Tested initial render | Tested initial render |
| `/register` | Tested initial render | Tested initial render | Tested initial render |
| `/forgot-password` | Tested initial render | Tested initial render | Tested initial render |
| `/reset-password` | Tested initial render | Tested initial render | Tested initial render |
| `/terms` | Tested initial render | Tested initial render | Tested initial render |
| `/privacy` | Tested initial render | Tested initial render | Tested initial render |
| `/cookies` | Tested initial render | Tested initial render | Tested initial render |
| `/our-story` | Tested initial render | Tested initial render | Tested initial render |
| `/listings/:listingId` | Tested initial render | Tested initial render | Tested initial render |
| `/help` | Tested initial render | Tested initial render | Tested initial render |
| `/events` | Tested Sign In redirect; content N/A | Tested initial render | Tested initial render |
| `/events/:id` | Tested Sign In redirect; content N/A | Tested initial render | Tested initial render |
| `/purchase/:id` | Tested Sign In redirect; content N/A | Tested initial render | Tested initial render |
| `/admin` | Tested Sign In redirect; content N/A | Tested redirect to `/events` | Tested initial render |
| `/admin-legacy` | Tested Sign In redirect; content N/A | Tested locked screen; admin actions N/A | Tested locked screen; admin actions N/A |
| `/my-sales` | Tested Sign In redirect; content N/A | Tested initial render | Tested initial render |
| `/my-tickets` | Tested Sign In redirect; content N/A | Tested initial render | Tested initial render |
| `/create-listing` | Tested Sign In redirect; content N/A | Tested initial render | Tested initial render |
| `/fan-zone` | Tested Sign In redirect; content N/A | Tested initial render | Tested initial render |
| `/me` | Tested Sign In redirect; content N/A | Tested initial render | Tested initial render |
| `/upgrades` | Tested Sign In redirect; content N/A | Tested initial render | Tested initial render |
| `/upgrades/:id` | Tested Sign In redirect; content N/A | Tested initial render | Tested initial render |
| `/sell` | Tested Sign In redirect; content N/A | Tested initial render | Tested initial render |
| `/events/tm/:tmId` | Tested Sign In redirect; content N/A | Tested initial render | Tested initial render |
| `/account-settings` | Tested Sign In redirect; content N/A | Tested initial render | Tested initial render |
| `/edit-persona` | Tested Sign In redirect; content N/A | Tested initial render | Tested initial render |
| `/beta-qa` | Tested Sign In redirect; content N/A | Tested redirect to `/events` | Tested initial render |
| `/instant-listings` | Tested Sign In redirect; content N/A | Tested initial render | Tested initial render |
| `/seller-payout-guide` | Tested Sign In redirect; content N/A | Tested initial render | Tested initial render |
| `/why-peanut-gallery` | Tested Sign In redirect; content N/A | Tested initial render | Tested initial render |
| `/leaderboard` | Tested Sign In redirect; content N/A | Tested initial render | Tested initial render |
| `/founder` | Tested Sign In redirect; content N/A | Tested redirect to `/events` | Blocked: automatic alert write denied |
| `/beta-checklist` | Tested Sign In redirect; content N/A | Tested access-required screen; content N/A | Tested initial render |
| `/beta-testers` | Tested Sign In redirect; content N/A | Tested access-required screen; content N/A | Tested initial render |
| `/beta-dashboard` | Tested Sign In redirect; content N/A | Tested access-required screen; content N/A | Tested initial render |
| `/notifications` | Tested Sign In redirect; content N/A | Tested initial render | Tested initial render |
| `/event-mode/:id` | Tested Sign In redirect; content N/A | Tested redirect to `/upgrades/fixture-live` | Tested redirect to `/upgrades/fixture-live` |
| `*` | Tested initial render | Tested initial render | Tested initial render |

## R02, R04, and R05 focused checks

`listing-workflows-browser.mjs` passed **18 rendered checks and 28 safety checks**, with zero runtime errors, unexpected SDK calls, blocked mutation attempts, or external requests. Five screenshots were generated; two representative screenshots are committed.

- The actual production live-hub component returns through its Back to events link in both themes, preserving the submitted keyword, city, sort, and include-past URL plus control state. The fixture provides the same `discoveryReturnTo` router state contract used by discovery navigation.
- Ended hub and direct create-listing entry in both themes at 320, 375, 390, 430, and 1280 px: listing CTA removed, direct form closed, transfer/upload/publish prompts absent, and recovery returns to event selection.
- An already-open draft closes at the exact explicit event end after a simulated foreground clock update. Unknown timing remains labeled unconfirmed. A freshly ended event reread before submission stops before analytics or mutation APIs.
- Flash Drop lookup distinguishes idle, disabled/in-flight loading, failure, retry, populated selection, and successful empty state. The selection exposes `aria-pressed`, status announcements explain the loaded-history limitation, alternate proof input remains available, and Escape restores focus to the exact opener.
- The 320 px empty state has no page-wide overflow. No upload, Flash Drop creation, checkout, reservation, or live submission occurred.

The Escape assertion waits for Radix's asynchronous unmount focus restoration. Screenshot capture waits for dialog opacity to settle so evidence does not capture a transparent animation frame. These are harness corrections; no production code was changed by the verification task.

## Reproduction and environment

Linux x86_64, Node 24.19.0, local Playwright 1.62.1, Chromium 153.0.8010.0, Vite fixture, reduced-motion media preference. The retained browser executable was truncated after workspace restoration and was re-extracted from its existing compressed package; Chromium was not downloaded from a live app or production service.

With the local Chromium environment variables set (`PG_CHROMIUM_PATH`, JSON `PG_CHROMIUM_ARGS`, and any host library paths), run:

```sh
PG_ROUTE_START_FIXTURE=1 node tests/route-inventory-browser.mjs
node tests/listing-workflows-browser.mjs
```

The route runner starts its own isolated server on 4181 with HMR/watch disabled; the listing runner does so on 4178. `npm run test:audit-browser` also includes both suites. SDK/auth are explicit test aliases; the fixture is fail-closed and outbound calls are denied. No production credentials or customer records were used.

## Evidence and limitations

- [Route result JSON](oct06-evidence/routes/result.json)
- [Listing result JSON](oct06-evidence/listing/report.json)
- [Ended listing form, light 390 px](oct06-evidence/listing/R04-ended-form-light-390.png)
- [Successful lookup after retry, dark 390 px](oct06-evidence/listing/R05-lookup-retry-populated-dark-390.png)

Route inventory uses direct fixture loads and MemoryRouter Back/Forward, not production BrowserRouter history. The title comparison uses the shared static route title map; the separate unit suite verifies every route has an intentional title with no private IDs or stale “Final” suffix. Initial route rendering does not prove each route's loading, populated, empty, partial, or error workflows; focused suites and the parent audit report describe those separately. The listing clock and stale server record are simulated. Real financial, upload, transfer-security, payout, admin mutation, and identity-provider actions remain excluded or assigned to their existing owner.

Viewport sizes are browser emulation, not physical devices, touch, mobile software keyboards, screen-reader execution, or native app tests. These two suites do not verify 200%/400% browser zoom; legal reflow/zoom evidence is reported separately. The reduced-motion preference is set, but this inventory does not assert that every animation in the application honors it. External brand assets may be absent under the fixture's restrictive content policy. Policy content, event titles, people, and seats in these artifacts are fictional.
