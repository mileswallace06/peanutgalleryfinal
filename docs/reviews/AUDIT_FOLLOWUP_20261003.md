# PG audit follow-up — October 3, 2026

## Current state and preservation

Branch: `codex/pg-audit-followup-20261003`.

Baseline: `07d4031c816c7540b91ebff03671092abb1b265c`, the normal merge of PR14, independently observed published in Peanut Gallery Final on October 3. GitHub Main still matched it when this follow-up began. The October 1 audit predates that release. The prior screen-refinements worktree and its release evidence were preserved; this work uses a separate worktree from the published baseline.

This branch contains repository repairs and controlled tests. It has **not** been pushed, merged, imported into Base44, deployed or published. Existing purchase-security work, backend code, credentials, policies, maintenance and real user records were not changed. No active listing, inventory hold, payment, refund, payout or notification was exercised.

## Findings and disposition

“Fixed locally” means implemented and checked with the stated source/unit/component evidence; it does not mean rendered or live-verified.

| Finding | Disposition | Result and remaining evidence |
| --- | --- | --- |
| F1 contradictory upgrade state | Fixed locally | Native detail, Events badges, hub, countdown and eligibility presentation use the shared timing decision. Upcoming populated inventory still shows the countdown; live empty inventory says “No upgrades listed yet.” Estimated windows remain qualified. Server restrictions unchanged. Boundary/resume/reload fixtures pass; browser transition review pending. |
| F2 venue time | Fixed locally, missing source data disclosed | One strict instant/venue formatter across native/imported detail, Events, upgrades, seller chooser/summary and Sell cards. UTC plus “venue time unconfirmed” when no valid venue zone is known. Explicit zones/DST/repeated hours and viewer zones tested. No timestamp repairs or timezone guesses. Direct links with incomplete stored metadata remain explicitly unconfirmed. |
| F3 cream chooser title | Fixed locally | An existing paper-color declaration was overridden by a more specific generic heading rule. Corrected selector wins; title/paper token contrast 16.73:1. Selected-event card preserved. Browser-computed cascade verification pending. |
| F4 Sell location | Fixed locally | Shared validated city, retained-tab synchronization, manual picker, denied/unavailable recovery and partial-results retry. Browsing market confers no venue eligibility. Fixture persistence/navigation/reload checks pass. |
| F5 Help Center | Already fixed in PR14; preserved | Real `/help` route and distinct email Contact Support action. Earlier PR14 rendered evidence covers it; this branch does not duplicate that implementation. Fresh source routing check only. |
| F6 input contrast | Fixed locally | Dedicated active border/fill/hover/focus/error/autofill/disabled tokens for real branded auth and shared/seller controls. Auth messages associated with affected fields. Default border/card ratios 4.54:1 light, 5.12:1 dark. Actual browser autofill/focus paint pending. |
| F7 headings/slides | Fixed locally | Main landmark and real h1 on landing/onboarding; only the current slide title is exposed. Visual typography and existing navigation preserved in fixtures. Screen-reader review pending. |
| F8 FAQ semantics | Fixed locally | Closed panels use native hidden; unique IDs, focus return, and no fixed answer-height clipping. Keyboard activation uses existing native buttons. DOM fixtures pass; actual assistive-technology check pending. |
| F9 malformed imported title | Open: source evidence required | No proven encoding transform at ingestion. Unicode survives normalization, JSON roundtrip and real card fixtures. No guessed spelling or global substitution. Need same-ID provider/stored payload comparison before repair. |
| F10 image-back overlay | Existing text fix preserved; focus improved locally | Explicit invariant light ink/dark overlay and inset focus. Worst-case white-image composited contrast 12.65:1. Navigation unchanged; rendered varied-image check pending. |
| F11 Why light accent | Already fixed; source/token verified | Existing semantic light green yields 5.95:1 on page and 5.45:1 on raised background. No copy/style rewrite. Fresh rendered verification pending. |
| F12 switches | Fixed locally | Actual Settings switches and shared Radix switches have clear off/on boundaries and contrasting thumbs. Names/roles/state and existing hit areas retained. No real preference changed. |
| F13 refund conflict | Owner decision required | FAQ, checkout and cancellation promises conflict with Terms. Inventory and exact questions in `AUDIT_DATA_POLICY_20261003.md`; no legal/promise text changed. |

### Additional workflow gaps

- **Event alerts:** replaced native detail’s unsupported instant general-ticket alert promise and generic-settings link with the existing event-specific **Upgrade alerts** control. Unsupported events, inactive delivery, errors and unsubscribe remain explicit. This is not a new general ticket-listing notification service. No dispatcher/scheduler activation or real subscription change occurred.
- **Find fans:** removed circular find-people guidance. Following/Friends offer the real Trending feed and explain existing follow-back behavior. There is no newly promised people search or new user lookup backend.
- **Duplicate-looking events:** both reported pairs have distinct provider IDs. Existing exact-ID reconciliation is retained. Source admission/session identity must be established before any cross-ID alias or merge; no links/inventory were deleted.
- **Flash Drop modal:** replaced a route-contained z-50 layer with a portaled Radix dialog above navigation, bounded scrolling/safe-area padding, focus entry/return and step focus, connected field labels and keyboard-accessible anonymous/upload controls. Both launch buttons explicitly establish a return-focus target. Removed a Fan Gifts “Notify me” button with no handler and explained that gift alerts are unavailable. Creation/upload/ownership handlers and payloads are unchanged. Actual native focus/keyboard/overlap rendering remains pending.
- **Privacy table:** source already uses wrapping fixed-layout tables rather than a horizontal scroll container. No speculative table rewrite. Real provider content, keyboard and narrow/zoom rendering remain review targets.

## Validation

Fresh focused runs (overlap between suites is intentional; counts must not be summed):

| Command | Result |
| --- | --- |
| `node --test tests/event-date-display.test.mjs tests/upgrade-showtime-state.test.mjs tests/upgrade-route-clock.test.mjs tests/selling-event-picker.test.mjs tests/upgrades-live-discovery.test.mjs tests/upgrade-discovery.test.mjs tests/upgrades-owned-navigation.test.mjs` | 59 passed |
| `node --test tests/audit-workflow-semantics.test.mjs tests/event-search-request.test.mjs tests/selling-event-picker.test.mjs tests/public-access-render.test.mjs tests/bucket-list-feed.test.mjs` | 43 passed |
| `node --test tests/ui-control-contrast.test.mjs tests/branded-auth-fields.test.mjs tests/branded-auth.test.mjs` | 25 passed |
| `node --test tests/audit-workflow-semantics.test.mjs` after effect cleanup typing correction | 9 passed |
| `node --test tests/upgrade-route-clock.test.mjs tests/flash-drop-dialog.test.mjs` after final launcher recovery changes | 8 passed |

The public-route fixture needed a test-only CSS-empty loader. It checks server-rendered routing/auth behavior, not styling. Its StaticRouter warning is not proof of browser redirect behavior. Mocked 429 logs intentionally exercise provider error states.

Detailed evidence: `AUDIT_TIMING_CHECKS_20261003.md`, `AUDIT_WORKFLOW_CHECKS_20261003.md`, `AUDIT_CONTRAST_CHECKS_20261003.md`.

## Integration checks

- Production compilation: `npm run build` passed on the final source. Base44 build-time app ID/base URL are intentionally not configured here, so its warning means this is compilation evidence, **not a deployable or connected runtime build**. No app identifiers or provider settings were changed merely to suppress it. Existing Browserslist data warning remains.
- Scoped ESLint passed across 17 changed non-ui JSX files, followed by the final hub/Fan Gifts pair after its small recovery adjustment. Shared ui class edits compile; the repository ESLint config excludes that directory.
- `npm run typecheck -- --noEmit` remains nonzero: **593 existing diagnostics versus 596 on the exact baseline**, with **zero new diagnostic occurrences** after comparing by file/error text independent of shifted line numbers. The first pass identified three new diagnostics (effect cleanup return type and an explicit optional-control prop); those were corrected and the affected workflow fixtures rerun. This is not a clean repository-wide typecheck claim.
- `git diff --check` passed. Backend, dependencies, refund/legal text and payment code have no diff.

## Changed source and test files

- `src/components/Onboarding.jsx`
- `src/components/account/NotificationsSection.jsx`
- `src/components/account/SessionSection.jsx`
- `src/components/control-contrast.css`
- `src/components/education/FaqAccordion.jsx`
- `src/components/eventmode/FlashDropCenter.jsx`
- `src/components/eventmode/MoveCloserRail.jsx`
- `src/components/events/detail-ticket.css`
- `src/components/flashdrops/CreateFlashDropSheet.jsx`
- `src/components/flashdrops/fan-gifts-ticket.css`
- `src/components/listings/SellingEventPicker.jsx`
- `src/components/listings/SellingEventSummary.jsx`
- `src/components/member-surfaces.css`
- `src/components/ticket-design.css`
- `src/components/ui/input.jsx`
- `src/components/ui/switch.jsx`
- `src/hooks/useEventClock.js`
- `src/hooks/useSellingDiscovery.js`
- `src/lib/eventDateDisplay.js`
- `src/lib/eventLocation.js`
- `src/lib/eventTimestamp.js`
- `src/lib/sellingEventTiming.js`
- `src/lib/upgradeEventState.js`
- `src/pages/BrandedAuth.jsx`
- `src/pages/CreateListing.jsx`
- `src/pages/EventDetail.jsx`
- `src/pages/EventDetailUpgrade.jsx`
- `src/pages/Events.jsx`
- `src/pages/FanZone.jsx`
- `src/pages/Landing.jsx`
- `src/pages/Me.jsx`
- `src/pages/Sell.jsx`
- `src/pages/event-detail-clarity.css`
- `tests/audit-workflow-semantics.test.mjs`
- `tests/branded-auth-fields.test.mjs`
- `tests/event-date-display.test.mjs`
- `tests/flash-drop-dialog.test.mjs`
- `tests/public-access-render.test.mjs`
- `tests/ui-control-contrast.test.mjs`
- `tests/upgrade-route-clock.test.mjs`
- `tests/upgrade-showtime-state.test.mjs`

## Route/state review checklist

| Surface | Fresh evidence in this branch | Still required before publication |
| --- | --- | --- |
| Landing/login/register/reset/onboarding | Actual JSX/hook fixtures, auth handlers/return-to rules, main/h1/current-slide semantics, contrast tokens | Real appearance switch in both themes, auth error painting/autofill, browser Back/deep-link return, mobile keyboard |
| Events/location/search | Retained market persistence, denied/unavailable/stale GPS, existing request/search regressions, timing and Unicode card fixtures | Both themes, search/sort/past/pagination/Clear, long text/missing images, actual navigation/reload |
| Native/imported detail | Venue-time fixture coverage, native alert control identity/scope, overlay contrast, unchanged provider matching fallback | Empty/populated fixture UI, ticket anchors, disclosures, invalid IDs/network errors, focus/back controls |
| Upgrades/hub | Upcoming/boundary/live-empty/live-populated/ended/estimated states; owned-ticket routes; eligibility presentation and clock resume fixtures | Upcoming/Live tabs, hub sub-tabs/help overlay and transitions in browser |
| Sell/Create Listing | Manual market, chooser/summary times, empty/partial/error/retry fixtures, field tokens | Transferability rejection/back recovery, seat/quantity validation and fixture review; no real publish |
| Me/Fan Zone/Settings | Truthful recovery routes, bucket-feed tests, switch semantics/token checks | Both themes, real accordion controls, back buttons, isolated preference fixtures |
| Why/Help/Story/legal | FAQ open/closed/focus fixtures; Help route and legal policy inventory; Privacy source inspection | Screen-reader tree, long answers, legal anchors, external policy table keyboard/zoom; intentional Story design preserved |
| Flash Drop | Local modal checks recorded below | Bottom navigation, touch/safe areas, Escape/focus return, long form and software keyboard in browser |

**No new browser screenshots were produced for this branch.** The current environment does not provide an approved local-browser rendering path; prior attempts to install a separate browser/open local files were blocked. Those restrictions were not bypassed. Published PR14 screenshots concern the baseline and must not be presented as evidence for these new changes. The next rendered pass should use the uploaded branch in the approved Base44 preview flow.

Desktop 1180×757, narrow mobile 320/390/430 widths, landscape, safe areas, actual touch/keyboard, 200%/400% zoom, screen reader and physical TestFlight remain explicit pending checks. No full-app/accessibility/security/payment/production readiness claim is made.

## Owner decision and next delivery step

Confirm the authoritative refund policy for ordinary tickets and upgrades, Standard/Instant delivery: which cases qualify (invalid/fraudulent ticket, seller cancellation, delivery failure, buyer cancellation), whether all fees are included, automatic versus reviewed refunds, and the timeframes/process that may be promised. After approval, align all inventoried text; operational verification belongs to the separate purchase-security workstream.

Next: upload this branch, review the changed UI with safe fixtures in both themes, then authorize a verified merge/publication. Encoding/duplicate identity evidence and refund policy remain separate open items. No further diagnostic or security work was undertaken merely to fill this UI audit.

## Session and launch tracking

October 3 goal: reconcile the October 1 audit with today’s shipped PR14, repair remaining demonstrated UI/workflow defects, and preserve a reviewable delivery package. December 17 remains the launch target, 75 calendar days away. Elapsed session duration is not reliably measured; this work establishes completed UI code and test evidence, not a launch-readiness percentage or security completion.
