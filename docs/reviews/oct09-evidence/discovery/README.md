# October 9 discovery navigation validation

R02 and N01 reproduced before repair and pass after repair in an isolated Chromium browser. R01 independent paging behavior remains intact. No production app, provider service, account record, or production mutation was used.

## Evidence scope

- Viewport: **390 × 844 CSS pixels** for every image below; dark and light themes.
- Role: guest (`user: null`); no owned-ticket, seller, admin, or founder read authorization is simulated.
- Actual React `Events`, `Upgrades`, and `Layout` are mounted, including preserved tab containers, real history, header controls, page transitions, and inner scrolling. Only event detail destinations are small local stubs for navigation; separate tests render the actual native and provider detail Back links.
- The initial Events URL is `/events?browse=1&q=Knocked+Loose&city=Phoenix&state=AZ&past=1`. Two synthetic Knocked Loose occurrences have distinct future dates. The second card is opened and returned from, another query is submitted, then the original query is explicitly submitted again.
- The Upgrades route begins at `/upgrades`; Live is selected, a synthetic native live event is opened, and Back/reload are exercised. Pointer selection is tested in dark mode and keyboard Enter selection in light mode.
- Before mode loads the audited `Events.jsx`, `Upgrades.jsx`, `useSellingDiscovery.js`, and `eventDiscoveryState.js` from **c31a2e1** through a read-only Vite source override. Current shell/styles and the same local fixture are used in both phases. No working-tree rollback is performed.
- External image/provider requests are blocked in the local harness, so header artwork/logo show unavailable-image placeholders. These are controlled fixture screenshots, not production screenshots.

| Finding | Before evidence | After evidence | Observed result |
| --- | --- | --- | --- |
| R02 dark | [Before](r02-before-dark.png) | [After](r02-after-dark.png) | Stale anchor focus / interior scroll 78px becomes search-input focus / interior scroll 0px. |
| R02 light | [Before](r02-before-light.png) | [After](r02-after-light.png) | Same result with light theme. |
| N01 dark | [Before](n01-before-dark.png) | [After](n01-after-dark.png) | Live selection previously reset to Upcoming; now survives hub Back and reload. |
| N01 light | [Before](n01-before-light.png) | [After](n01-after-light.png) | Same result through keyboard selection. |

Structured observations: [before](discovery-before.json), [after](discovery-after.json).
Additional continuation evidence: [dark](n01-depth-after-dark.png), [light](n01-depth-after-light.png). The restored Upcoming card is `fixture-continuation-100`; provider streams have exhausted at page 0 while local pages continue. Back and reload restore the same card and loaded depth.

## Diagnosis and repair

**R02:** return snapshots were indexed only by query text. Every new query/filter URL read that snapshot, including a fresh submission that happened to repeat an earlier search. Snapshots now require a matching history entry, pathname, and submitted query. Genuine Back/Forward/reload or explicit in-page Back can restore that entry. Fresh searches and filters cannot borrow another entry's focus target. Same-query refresh cancels its pending restoration, and generation checks discard delayed restoration callbacks.

**N01:** Upgrades kept Live/Upcoming solely in component state. The validated URL now holds `view=live`; absent, invalid, and unrecognized values intentionally display Upcoming without rewriting history. Cards carry an originating entry token. Actual detail and hero Back links propagate that token. Upgrades restores the saved request/area, independent paging depth, and selected card when returning, including when Layout preserved the tab across a native Events detail route.

**R01:** no pager algorithm change. New tests cover either source exhausting first, no unnecessary refetch of the exhausted source, failure on a later provider page and retry at the same cursor, retention of successful local rows, and truthful incomplete/capped coverage. Existing tests cover stable timestamp ties in both sort directions and later local/provider pages.

## Validation

Focused unit result: **79 passed, 0 failed, 0 skipped**. [Full output](unit-results.txt).

```sh
node --test tests/oct09-discovery-state.test.mjs tests/oct09-discovery-paging.test.mjs tests/event-discovery-paging.test.mjs tests/event-date-display.test.mjs tests/browse-ticket-interaction.test.mjs tests/upgrades-owned-navigation.test.mjs tests/selling-ongoing-provider.test.mjs tests/selling-event-picker.test.mjs tests/upgrade-route-clock.test.mjs
```

Browser commands used from repository root:

```sh
export PG_CHROMIUM_PATH=/workspace/scratch/580f2607a348/browser-runtime/executable/chromium-oct09
export PG_CHROMIUM_ARGS='["--no-sandbox","--disable-dev-shm-usage"]'
export LD_LIBRARY_PATH=/workspace/scratch/580f2607a348/browser-runtime/executable:/workspace/scratch/580f2607a348/browser-runtime/executable/al2023/lib
export FONTCONFIG_PATH=/etc/fonts
PG_EXPECT_BEFORE=1 PG_FIXTURE_PORT=5195 node tests/oct09-discovery-navigation-browser.mjs
node tests/oct09-discovery-navigation-browser.mjs
node tests/events-search-browser.mjs
```

All three completed successfully. New after checks cover repeated fresh search, same-query refresh, sort/past/Clear, original-entry Back/Forward, explicit in-page Back, reload, fresh direct visit, invalid Upgrades view defaults, Live persistence, and continuation depth. The existing Events runner additionally covers stale query responses, source retry, submitted draft isolation, nationwide/location transitions, and widths 320/375/390/430/1280 in both themes.

Focused lint returned **0 errors**. Four pre-existing unused-variable warnings remain in `EventDetail.jsx`; no new lint warnings in the discovery/hero files.

## Source and test files

Production changes for this repair:

- `src/lib/eventDiscoveryState.js`
- `src/hooks/useSellingDiscovery.js` (optional restoration API; existing Sell call contract retained)
- `src/pages/Events.jsx`
- `src/pages/Upgrades.jsx`
- Navigation-only integration in `src/pages/EventDetail.jsx`, `EventDetailTM.jsx`, `EventDetailUpgrade.jsx`
- `src/components/eventmode/EventHero.jsx`, `GeneratedHero.jsx`

Events/Upgrades also consume the R03 owner's shared `eventIdentityLabel` and wrapping class; identity equivalence and presentation validation are documented by that owner separately.

Tests/fixtures:

- `tests/oct09-discovery-state.test.mjs` (5 tests)
- `tests/oct09-discovery-paging.test.mjs` (4 tests)
- `tests/oct09-discovery-navigation-browser.mjs`
- `tests/events-search-browser.mjs`
- `tests/fixtures/events-search/{main.jsx,index.html,base44.js,auth.js}`
- `tests/event-date-display.test.mjs` (actual source-specific Back-link coverage and updated helper globals)
- `tests/upgrade-route-clock.test.mjs` (updated helper global)

Limits: local browser emulation and fixture SDK only; live Base44 pagination behavior, live identity cleanup, and production reload were not claimed. Detail data flows/mutations were not exercised by this navigation browser. The final repository-wide gate and fail-closed harness hardening are integrated separately by the verification owner.
