# TestFlight display, discovery and feedback patch

Implementation only. Maintenance configuration is untouched (keep ON); no publication, deployment, customer-data access, credentials, transactions, or new services. Mission 1 and PG-CREDITS-01 remain preserved, with their existing blocked/cutover status unchanged. Financial eligibility and the independent add-on upgrade model are unchanged.

## Review boundary

Started with a clean working tree on `codex/external-notification-worker` at `f5932b3280490803fcaa8159e3dc3f917baba28c`. Created `codex/testflight-ui-discovery-feedback` from that exact tree. Review this patch against **f5932b3**, not as the entire branch-versus-main delta. The branch includes earlier unfinished launch work by ancestry; it is not permission to release that work.

Remote main was read at `d86dbe492d32bf066b4695fa44afec7b631e0061`. Its changes since d7673a9 are package updates and nine workflow migrations, with no overlap in this patch's files. They were not overwritten or imported. No workflows or schedules are changed here.

## Changes and file inventory

| Files | Purpose |
| --- | --- |
| `src/pages/Me.jsx`, `src/index.css` | Remove the blank top safe-area strip; let banner artwork cover the whole hero, including the inset. Hero height is original 10rem plus the environment inset; the banner-edit hit area begins below that inset. Add the admin Feedback entry. Remove the existing unused Star import encountered by scoped lint. |
| `src/pages/Upgrades.jsx` | Use discovery timing, saved city across reopening, independent source results, partial-error messaging and local minute/foreground updates. Show “Estimated event window” where appropriate. |
| `src/lib/eventClock.js` | One local 60-second redraw, paused while hidden; immediate foreground/page-show/focus update; listeners and timer cleaned up on unmount. Foreground discovery uses existing cache. |
| `src/lib/upgradeDiscovery.js` | Independent PG/Ticketmaster reads, coordinate-radius PG membership and exact city/optional state matching; deduplicate while retaining matching provider end metadata in memory. |
| `src/lib/tmCache.js` | Preserve existing three-minute TTL and request coalescing. Partial results stay identifiable and retryable. |
| `src/lib/eventTiming.js`, `base44/shared/eventDiscoveryTiming.js` | Share unchanged category defaults, add a separate discovery calculator with explicit-zone timestamps, valid provider end times, configured duration, category defaults, then four hours. Existing getEventLiveStatus behavior stays unchanged. |
| `base44/functions/getTicketmasterEvents/entry.ts`, `base44/shared/tmEventDiscovery.js` | Validated `includeOngoing` opt-in: separate future and recent-start queries, bounded results, timeouts and sanitized partial errors. Existing callers without the opt-in still issue one future query. |
| `base44/shared/tmResponseHandler.js` | Add response-only UTC/end certainty/category/timezone metadata; preserve legacy `date` and eligibility-facing category behavior. Ticket-sale closing time is never treated as an event ending. |
| `src/pages/BetaDashboard.jsx`, `src/components/beta/FeedbackInbox.jsx`, `src/lib/feedbackInbox.js` | Admin-only entry and paginated inbox, four categories, complete text, originating page and time, load more/refresh/loading/empty/error states. No queries until admin identity is established. Existing beta metrics remain available. |
| `src/components/beta/FeedbackWidget.jsx` | Existing submitFeedback pipeline; show success only for its accepted-record acknowledgment (`status: submitted`, record ID). |
| `tests/testflight-discovery-feedback.test.mjs` | Eleven focused tests including the real handler import graph with synthetic provider transport, legacy timing preservation, discovery boundaries, caching, PG independence, inbox pagination past 500 and submission acknowledgment. |
| `tests/testflight-browser.test.mjs`, `tests/fixtures/testflight.jsx`, `tests/fixtures/testflightSdk.js` | Actual Layout/Me/Upgrades/BetaDashboard components on a localhost-only fixture server, isolated browser profile and blocked external requests. Synthetic user/data/clock only. |
| This report | Scope, verification and release/device boundaries. |

No entity schemas, RLS rules, payment/transfer handlers, native files, Layout.jsx, index.html, package files, or maintenance settings were changed.

## Discovery bounds and evidence

- Upgrades retains the full **40 future results** and requests up to **200 recent-start results** from the preceding **24 hours**, filtering those to ongoing windows locally on the server. Recent results never consume the future budget. This is at most two Ticketmaster requests per uncached Upgrades discovery call, with parallel eight-second timeouts; other callers retain one request. No scheduler was added.
- Ticketmaster documents `endDateTime` as an upper bound on event **start** time; `dates.end.dateTime` is event end, distinct from `sales.public.endDateTime`. Only an explicit, valid, non-approximate end after the start is confirmed. [Discovery API documentation](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/)
- An estimated window is not an actual-end assertion. Exact start is included; exact end is excluded from discovery. A visible page updates within a minute; foreground updates immediately. Existing admin beta-live overrides remain supported.
- Dense markets with more than 200 starts in 24 hours, and events starting more than 24 hours earlier, can exceed this bounded provider discovery. The pre-existing PG query cap remains 200. Missing PG coordinates cannot establish GPS proximity; those records remain discoverable by matching city. No inference from provider cities remains.
- Confirmed provider ending metadata is transient and merged only into a PG duplicate with the same start. No schema rollout is required for these response fields. Provider failure is surfaced and independently matching PG results survive it; complete provider coverage during an outage is not promised.

## Local verification

| Command/check | Result |
| --- | --- |
| `node --experimental-vm-modules tests/testflight-discovery-feedback.test.mjs` | 11 passed. Includes actual getTicketmasterEvents entrypoint execution, synthetic fetch only. |
| `npm run test:tm-response` | 15 passed. |
| `npm run test:search` | 28 passed. |
| `node tests/mobile-search-report.test.mjs` | 22 passed. |
| `node tests/sync-coordinate-contract.test.mjs` | 30 passed. |
| `node tests/testflight-browser.test.mjs` with Playwright/Chrome paths supplied below | Passed: four viewport/inset layouts; admin/non-admin/anonymous access; all feedback categories and pagination; full messages/page/time; loading, error, retry, empty, refresh; ongoing events retained on reload and removed at expiry on foreground. |
| `npm run build` | Passed. Existing warnings: missing VITE_BASE44_APP_ID/app base URL and stale Browserslist. This local build is validation, not a configured publishable app bundle. |
| Scoped ESLint on changed handler/shared/components/pages | Zero errors; six existing warnings. The old unused Star import caused the first scoped run to fail and was removed from the already-edited import. |
| Additional ESLint no-undef/no-unused-vars on the five changed src/lib modules | Passed. |
| `git diff --check` and selected-file secret/private-artifact review | Passed; synthetic test values only, no credentials or private artifacts added. |

Browser command for this workstation (paths can be replaced with locally installed equivalents):

```sh
CHROMIUM_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
PLAYWRIGHT_MODULE=/Users/mileswallace/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright \
node tests/testflight-browser.test.mjs
```

Browser setup initially needed localhost permission, the installed Chrome executable and fixture routing/subscription/clock corrections. Those are test-harness changes, not external app configuration. No unrelated financial suites or broad audits were rerun. Existing failure ledgers are untouched.

## Publication and native boundary

Me previously owned a top padding strip before the image; Layout owns the shell background and already positions the bell/sign-in controls below `env(safe-area-inset-top)`. The HTML already has viewport-fit=cover. The patch moves Me's inset into the hero height without adding Layout padding. Four browser sizes were checked: 390×844, 393×852, 430×932 and 844×390, with synthetic 47/59/59/0px insets. These inset values are fixtures, not device offsets in production code. Browser screenshots use synthetic banner artwork and do **not** prove physical iPhone or native status-bar behavior.

There is no native-wrapper project/configuration in this repository. Whether the installed IPA loads a hosted URL or bundled assets, its WKWebView frame, status-bar background and native inset adjustment are **UNVERIFIED**. No exact responsible native source line can be identified from this tree.

If an opaque strip remains outside the web viewport after web publication, the wrapper owner must make its web view extend behind the top safe area, remove any duplicate native top inset/opaque status-bar backing, and match the remaining host background/status-bar contrast to the app. Inspect the actual wrapper before applying settings: UIKit has a separate automatic inset adjustment policy; `.never` disables that adjustment when the web layout is the chosen owner. This is a conditional native remedy, not a claim about current wrapper settings. [Apple inset adjustment documentation](https://developer.apple.com/documentation/uikit/uiscrollview/contentinsetadjustmentbehavior-swift.enum)

| Fix | Required later release action | Replacement IPA? |
| --- | --- | --- |
| Profile top edge | Publish updated frontend/CSS. | Only if assets are bundled or native framing/background also needs correction; wrapper configuration must establish this. |
| Live Now | Publish updated frontend plus getTicketmasterEvents and its shared import graph. | Frontend delivery depends on hosted-vs-bundled wrapper; backend publication alone does not require an IPA. |
| Admin Feedback | Publish updated frontend. Existing submitFeedback and BetaFeedbackEvent RLS stay in use. | Only for a wrapper shipping bundled web assets. |

Miles's next release steps are separate from implementation: authenticate/publish the feature branch if the push is blocked; review only this commit against f5932b3 and carry it onto the intended release baseline without releasing blocked Mission 1 work. Then authorize Base44 publication of the frontend and changed Ticketmaster handler/shared modules. Check the wrapper's hosted URL versus bundled assets. For a hosted app, fully close/reopen PG after publication, open Upgrades and refresh, and open **Me → Feedback** while signed in as an admin. For bundled assets or a native inset correction, produce/upload a replacement IPA and install that TestFlight update first. Verify notch clearance, status-bar contrast and scroll/rotation on the actual phone. Maintenance remains ON throughout; use existing authorized admin access for checks.

Commit SHA and final remote result are reported after committing. GitHub connector write preflight returned HTTP 403 `Resource not accessible by integration`; no ref was created by that attempt.
