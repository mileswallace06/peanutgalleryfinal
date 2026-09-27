# PG mobile clarity — September 26, 2026

Owner direction: keep the accepted neon ticket-stub design, make individual events easier to recognize, simplify Me, and reduce the number of controls competing for attention.

Base: published main `e3c77b08ea585ecc9743163473807c5028b2b6f8` (PR12).
Branch: `codex/pg-mobile-clarity-20260926`.
Status: implemented and checked locally; not yet reviewed in the live mobile renderer, pushed, merged, or published.

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
