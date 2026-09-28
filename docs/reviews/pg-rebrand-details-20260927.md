# Detail, transaction entry, and community rebrand audit

Review date: 2026-09-28. Branch/worktree: `pg-rebrand-completeness-20260927`.

## Scope and findings

Source-level route/import audit of subviews reached from Events, Upgrades, Sell, and Fan Zone. The five approved main-page layouts are outside the redesign scope. No browser session, live backend action, payment, upload, follow, donation, post, or reservation was exercised.

The main gaps were legacy glass listing cards, gradient/glow checkout and seller controls, hardcoded dark-only sheets, saturated fixed status text in light mode, and location/community child surfaces that did not inherit the shared theme. Existing EventDetail/EventDetailTM heroes and EventDetailUpgrade's main ticket rail, ticket module, and Fan Karma already use the current ticket styles and were left intact.

## Reachable subviews

| Entry | Reachable screens and states | Presentation disposition |
| --- | --- | --- |
| `/events/:id` and `/events/tm/:tmId` | Loading/not-found; paper event hero; ticket listings; Live Hub/selling/alerts disclosures; `ListingCard`; `PurchaseDialog` | Existing detail route layouts retained. Listings now use a neutral shell, paper seat/price summary, perforated divider, solid accents, and theme-aware status text. |
| Event listing / live upgrade selection | Checkout loading, own-listing block, reservation errors, countdown/release/expired state; ordinary/demo/upgrade checkout; summary; card details; transfer acknowledgment; eligibility gate | Shared checkout sheet uses paper order summary, neutral surfaces, solid controls, consistent radii/focus targets. Literal Stripe iframe text sits on an explicitly dark field in both themes. |
| `/upgrades/:id` | Upgrades, Fan Gifts, Fan Karma tabs; admission/location eligibility; current ticket and move-closer rail; missing-event state | Approved ticket layout and Fan Karma retained. Reachable eligibility and Fan Gifts children updated separately below. |
| `/create-listing` from Sell or event details | Event picker and selected-event summary; live/upcoming/all filters; location search; loading/error/empty/retry states; transfer verification, blocked transfer, platform/proof/attestation; instant-transfer terms and confirmation | CreateListing page/handlers unchanged. Child surfaces use shared neutral/printed ticket vocabulary; picker event cards and selected summary use paper; confirmation controls use solid accents. |
| Events/Upgrades/Sell event picker location controls | City input, loading, recent cities, suggestion list, keyboard selection, current location | `LocationAutocomplete` uses theme tokens, compact field/button corners, and a portalled theme-aware suggestion surface. Geometry, keyboard behavior, selection and location requests unchanged. |
| Fan Zone sort sheet | Date/activity sort options; active choice; close | Overlay-only class/style refinement; no feed/main page layout changes. |
| Fan Zone Bucket List | My List/Add More tabs; loading/empty/saved artists/venues; search/loading/no-results; follow/remove controls | Sheet, search, and rows now inherit shared surfaces and theme-aware inks. Added accessible close/clear/remove names; existing requests and handlers unchanged. |
| Fan Zone composer | Existing approved `FanPostComposer`, including Seat Flex and search/upload modes | Inspected import path only; intentionally unchanged per scope. |
| Fan Zone people/reactions | Post reactions; Friends feed; links to `/me` for following/profile | No standalone profile/comment/share/seat-map modal is imported by these reachable detail/community routes. `/me` social panels are owned by the member audit. |

## Reachability exclusions

`SeatFlexSheet.jsx` is present but is not imported; the active composer supplies Seat Flex. No reachable seat-map component was found. The standalone `FlashDropAlertBanner` and `FlashDropExplainer` are not imported by the active routes, so they were not changed. This is a source reachability statement, not a claim that all possible data-dependent states have been exercised.

## Changes and boundaries

Shared scoped presentation: `src/components/events/detail-ticket.css`.

Edited JSX: `LocationAutocomplete`, `ListingCard`, `PurchaseDialog`, `SellerTransferAttestation`, `TransferAcknowledgment`, `TransferStatusBadge`, `InstantTransferAgreement`, `SellingEventPicker`, `SellingEventSummary`, `BucketListSheet`, `BucketListSearch`, and the Fan Zone sort-sheet class. `community-ticket.css` no longer pins overlay tokens to literal accent values.

All event lookup, listing visibility, fees, reservation/payment handlers, acknowledgment conditions, geolocation, upload, follow/remove behavior, query filters, action labels, and navigation targets were kept unchanged. Status rendering uses the existing status color as a presentation `data-tone`; scoring/status decisions remain in the existing library. CSS imports and aria-labels are presentation/accessibility only.

## Verification and limits

Targeted ESLint (`--quiet`) passed for the 12 edited JSX files above. No new broad tests were added. Root will run the aggregate build and change-scope review after all agents are stable.

Static review includes light/dark token handling, text on paper panels, fixed-dark Stripe iframe field, wrapping/min-width constraints, 44px touch targets, focus outlines, and mobile sheet dimensions. It does not establish actual browser rendering, live data behavior, keyboard/focus trapping, provider iframe behavior, or successful transaction execution. No browser screenshots or functional end-to-end claims are made.

## Live child audit

Completed source audit and scoped presentation updates for `FlashDropCenter`, `FlashDropCard`, `FlashDropCountdown`, `CreateFlashDropSheet`, and `UpgradeEligibilityGate`.

New CSS: `src/components/flashdrops/fan-gifts-ticket.css` and `src/components/upgrades/upgrade-eligibility-ticket.css`.

The active Fan Gifts branch (center → card → countdown), queued/completed/error/empty states, creation sheet, and eligibility checks use shared neutral surfaces, perforations, ticket accents, rectangular controls, theme-aware `--neon-*` text and `--pg-*` fills. The creation sheet scrolls within the viewport. The eligibility gate is shared with checkout. Handlers, queries, state logic and data remain unchanged.

Child targeted ESLint passed with zero errors and four existing unused-variable warnings (`createdDrop`, `setDrop`, `userEmail`, `pct`). Scoped `git diff --check` passed. No browser, real actions, broad tests, separate build, or commit was performed.

## Integration/publication status

Root's aggregate AST review reports all 465 existing handler expressions and 240 backend-call expressions unchanged across the current 96 edited JSX files. Dynamic data-dependent/provider states remain unexercised. Initial aggregate build encountered the parallel live-child CSS file before it had been written. The child files are now complete and stable; root has been notified to rerun the aggregate build.

This review documents the local candidate. Remote hosting/publication is not established: root reported a failed Base44 merge and a GitHub 403. No deployed appearance or live hosted result is claimed here.
