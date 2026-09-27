# PG mobile clarity — September 26, 2026

Owner direction: keep the accepted neon ticket-stub design, make individual events easier to recognize, simplify Me, and reduce the number of controls competing for attention.

Base: published main `e3c77b08ea585ecc9743163473807c5028b2b6f8` (PR12).
Remote destination: `codex/pg-mobile-clarity-20260926`.
Current refinement branch: `codex/pg-header-hitfix-20260926`.
Status: Three-card head `e2804f28b3dcd1ddb9265b3b4510656155b9f304` was independently verified identical to the remote clarity branch and reviewed in Final's actual Base44 branch preview. Three complete card bounds fit above navigation on both feeds at 373×665. A header hit-target correction is now prepared locally; neither this refinement nor that correction is published.

## Actual three-card review and header correction — September 26, 19:19–19:30 Arizona

| Screen | First / second / third card bottom | Bottom navigation starts |
| --- | --- | --- |
| Events | 233.36 / 404.72 / 576.08px | 592px |
| Upgrades | 234.36 / 403.72 / 573.08px | 592px |

These measurements use the populated Phoenix catalog, normal text size and closed controls. Photos remain about119px high. Upgrades' first three events are in the same timing group. Native safe areas, enlarged text, alerts and mixed groups remain physical-device coverage limits. Existing floating feedback control overlaps part of the third title strip; the three card bounds are otherwise visible. Provider event catalog is not evidence of PG resale inventory. Browser UTC date display remains a separate existing issue.

Fresh preview load and tab changes render route-specific header controls. Events Search and filters opens and closes using keyboard activation; city entry and suggestion selection loaded40 events. Pointer activation of header buttons was blocked by two pre-existing empty, padded notification wrappers covering the top32px. Added `pointer-events-none` to both ToastProvider and ToastViewport; individual Toast already restores `pointer-events-auto`. This changes only hit testing, retaining actual toast pointer targets. Existing toast dismissal wiring was not changed or verified.

Correction verification: production build exited0 and whitespace check passed. The repository ESLint configuration excludes this UI component, so it supplied no lint coverage. Browser pointer retest remains pending the owner's push. No broad tests repeated. Me loaded with52px header and no horizontal overflow at373px. Screenshots and fuller review are saved in the separate coordination repository. No merge, publication, backend or purchase-security changes.


## Three-card refinement — September 26, 19:07 onward

Inspected the supplied marked screenshot. The blank area came from a forced64px
footer and vertical date/arrow stack. This revision reduces the title strip to
44px including a two-line title and keeps44px action targets. Venue/time move
onto a readable dark photo caption; listing price/count and status remain
available. The photo height is now100–120px (about119px at373px wide), about9%
shorter than the previously measured130.55px, still roughly twice the initial
design's image height. The date and arrow sit alongside each other.

Events/Upgrades now share one48px shell header with logo, page title, location
and notifications. Events search/sort/past controls open on demand from the
header. A small route-gated portal ensures retained inactive tabs cannot leave
their controls in the active header. Tab mounting, scroll memory and data
queries remain unchanged. The ordinary Events list starts after its compact
scope/count line; Upgrades starts at the first populated timing group.

Other top-screen cleanup: smaller52px brandbar on designed secondary pages;
remove generic eyebrow/subtitle from Me, Sell and Settings; inline Settings
Back/title; Fan Zone date and sort choices move inside one native Filters
disclosure while feed tabs stay visible. No functions or options deleted.

CSS sizing at373×665, with controls closed, no error/location/intro overlay and
normal text size: Events approximately68px to first card +3×165.36px +12px gaps
=576.08px; bottom navigation previously began592px. Upgrades is similar for
three cards in one group. Multiple group headings, alerts, native safe areas,
accessibility text sizing and smaller screens can change the fit. These are
calculations, not new screenshots or physical-phone evidence. Actual measurement
and header/filter/navigation checks remain required after the owner push.

Validation: Vite build passed; lint on changed JSX passed with zero errors and
four existing Sell/Upgrades warnings; all six changed CSS files parsed; diff
whitespace check passed. Peer review caught and corrected the header component's
named/default import mismatch before build. No browser or DOM-test dependency
is available locally; no substitute browser was used. Existing broad tests were
not repeated. Source review confirms retained navigation, location/search,
filtering and financial callbacks. No backend/auth/secret/payment changes.

The following sections preserve earlier iterations and their evidence. They do
not describe the current three-card geometry.

## Density refinement — September 26, 18:52 onward

The owner approved the larger photography but found the overall cards too tall.
The new changes retain the exact photo CSS (`clamp(112px, 35vw, 160px)`) and
make room around it:

| Area | Previous clarity pass | Refined layout |
| --- | --- | --- |
| Events footer | At least 88px; venue and full date on separate lines; 78px stub | At least 64px; title up to two lines; venue/time share a row; date retained in 60px stub |
| Upgrades footer | At least 98px plus stacked metadata | At least 60px, approximately 65px for two-line titles; date/action share the stub; category/status remain visible on photo |
| Card gaps | 16px | 10px |
| Events heading | City, title, tagline, search, scope, always-visible sort | Title/city share a row; search and a labeled Filters dropdown share a row; scope/count share a row |
| Upgrades heading | City, title, tagline, larger empty-live section | Title/city share a row; one-line empty-live notice; existing live/soon/upcoming groups retained |

At 373px width the unchanged photo is about 131px. A standard event card is
therefore approximately 197px including its 64px footer and borders; an upgrade
card approximately 191–196px, with longer action/date text allowed to grow.
Two standard cards plus a 10px gap are designed to fit in the available feed
area of the previously reviewed 373×665 viewport. These are CSS calculations,
not new browser measurements. Long titles, extra marketplace information,
location prompts, notices, text scaling and device safe areas may use more space.
Essential text and controls are not clipped to force an arbitrary card height.

Only Events/Upgrades JSX and their two existing stylesheets changed in this
refinement. Photo styles and all pre-render search/location/fetch behavior were
compared directly and are unchanged. Card navigation/sync callbacks are
unchanged by source diff. Existing marketplace price/count and availability
information remain visible. No backend, auth or financial logic changes.

Validation: final stable-source Vite build passed; changed-page lint has zero
errors and two existing Upgrades warnings; diff whitespace check passed. An
initial build overlapped a formatting write and read a partial file; it was
repeated after writes finished, successfully. No broad tests were repeated.
New Filters interaction and the denser layout require remote mobile review after
the owner pushes this revision. Earlier screenshots show the prior version.

The sections below document the preceding clarity implementation and its
original local checks; the density table above supersedes its card dimensions
and always-visible sort description.

## Changes

| Surface | What changed |
| --- | --- |
| Events | Photo height grows from 61px to 112–160px depending on viewport (about 137px at 390px wide). Photos open the same destination as the existing ticket action. More space between cards. Native date-sort menu plus an explicit Include past checkbox. Redundant Near Me action is hidden when already browsing the selected area. |
| Upgrades | Photo height grows from 64px to the same 112–160px range. Existing city control opens location options; duplicate controls disappear after location selection. Smaller empty-state notices. Existing Live, Starting soon, and Upcoming grouping retained. |
| Me | Compact personal ticket with banner/photo editing and private email reveal. My Tickets, My Sales, and Account Settings are prominent. Fan activity, following, About PG, and authorized admin tools use labeled expandable sections. |
| Account settings / Edit persona | Consistent headers, readable groups, visible session actions and Save. Existing account sections, photo uploads, profile fields, and deletion confirmation retained. |
| Event details | Unobscured photography, paper ticket summary, clear primary action, visible dates/venue/status and listings. Secondary explanations collapse. Live Hub guidance starts open for live or starting-soon events. Exact external ticket-provider URL and label retained. |
| Create listing | Numbered selling steps, one quantity selector, optional details expandable. Provider selection, eligibility attestations, agreements, fee breakdown, validation, and primary submit action remain visible. |
| My Sales | Transfer, verification and resume actions remain visible. Listing management and performance details expand on demand. Completed history starts open when a payout or capture needs attention. |
| Notifications | Readable rows, explicit read state, timestamps and semantic links/buttons. One mark-read call per linked row instead of the prior duplicate bubbling. |
| Purchase details | Fulfillment action/status before history. Neutral Order total and purchase-record wording instead of implying a pending order is already paid or valid for admission. Existing role checks, polling, status conditions, confirmations, dispute, cancellation and transfer handlers retained. |
| Shared shell | PG header and correct active tab on these account/detail/transaction routes. Existing mounted-tab and scroll-restoration logic retained. |

## Verification

- Production Vite build passed. Compiled Events and Me assets contain the new UI. The local build warns that Base44 public app environment values are absent; it is compilation evidence, not a connected application test. Base44 must build with its normal app configuration.
- Scoped ESLint passed with zero errors and seven existing warnings in EventDetail/Upgrades. Diff whitespace check passed.
- Existing event-search/location test suite: 13 passed. This checks retained search/location helpers, not visual fit.
- Source comparisons/review preserved data queries, mutation payloads, financial calculations, role/eligibility gates, provider URLs, and transfer/listing callbacks. Notification click bubbling is the intentional interaction correction.
- No backend, API, hook, database, dependency, authentication, or purchase-security implementation changes.

No mobile screenshot, touch, keyboard-navigation, light-theme, or physical TestFlight verification has been completed for this new pass. Local browser rendering is unavailable in this environment; no alternate browser/proxy workaround was attempted. Existing fixture route `/me` maps to MyTickets and must not be used as evidence for the new Me page.

## Mobile review before release

After the owner pushes this branch, import that existing GitHub branch into Final's Base44 preview and inspect the actual UI at phone size. This preview shares the app's data; use existing records and avoid listing submission, purchase confirmation, cancellation, uploads, following or other account writes during the visual review.

Review Events and Upgrades image distinction, city editor and sort controls; Me primary actions and optional sections; settings disclosure, sign-out/delete discoverability; event details; Create Listing's reversible form controls; My Sales/Notifications available states. Inspect populated purchase/seller states only where existing authorized records make them available. Record missing state coverage rather than inventing it. Check narrow width, readable labels, focus, scrolling and safe areas.

Then create/review the design-only PR, merge the accepted result, verify Base44's synchronized revision, publish, and ask Miles to reopen the TestFlight app. A successful local build or GitHub merge alone is not phone delivery.

## Boundaries and known limits

Purchase security continues in its separate workstream. This pass makes no new claim of payment-system safety, production database readiness, verified refunds, or provider inventory availability. Existing expired/refund copy and transaction-state limitations still need that workstream's validation. Legal/admin/help pages and expanded legacy account child components are not comprehensively redesigned here. No claim that every screen or every button has been audited.
