# PR15 hosted preview review — October 3, 2026

## Result

Miles approved importing PR15 into Peanut Gallery Final for preview review only. The import completed on `codex/pg-audit-followup-20261003`. No merge or publication was performed. The hosted review found two remaining faint discovery input borders; a narrow correction is prepared locally, with 10 passing focused tests and scoped lint. That correction is not yet in the hosted preview.

GitHub PR15 remained open, draft and mergeable at `b680b26ecc1416f76c971d3122c14115215fbc6b`; Main remained `07d4031c816c7540b91ebff03671092abb1b265c`. Base44 visibly identified the imported branch, but its Version History said “No versions yet,” and its visible sandbox iframe exposed no commit SHA. Therefore the branch import is verified, while an independent exact deployed-SHA match remains unavailable. Do not treat the GitHub head alone as proof of Base44’s exact served revision.

Preview: https://app.base44.com/apps/69ef9900cf3862dc0ea39734/editor/preview?branch=codex%2Fpg-audit-followup-20261003

## Rendered evidence

Browser phone preview: 373 × 665 CSS pixels. Desktop Events preview: 1363 × 883. This is browser evidence, not physical iPhone/TestFlight evidence. Both themes were selected through the app’s Appearance switch; it was restored to dark.

| Area | Observed result |
| --- | --- |
| Events/Upgrades density | Three event cards fit in the 373 × 665 mobile views in the saved light-mode examples. Existing PG imagery, ticket texture, type and page colors remained. Dark Events and desktop Events also rendered. |
| Settings switches | Real on/off notification switches remained unchanged. Dark tracks rendered #bf5fff / #92869f; light tracks #75439a / #786b80 with white thumbs. Labels and boundaries were readable. |
| Branded auth | Light fields rendered border #786b80, fill #eeeae3, ink #241f29. Dark fields rendered #92869f, #0d0b14, #f9f7f1. Keyboard focus used purple in light mode and cyan in dark mode with 3px outline offset. Registration and forgot-password links opened the correct forms. No credentials were entered and no authentication/reset request was submitted. |
| Seller chooser | Paper event titles rendered #111217 on #f6f2e8 in light and dark modes. Seat fields used the intended control boundary. One search input had retained the faint decorative border; see correction below. |
| Transferability UI | Selecting “No, I cannot transfer” displayed Listing not allowed and kept Price & review disabled. Go back restored the question. No ticket, proof, price, or actual listing was submitted. |
| Browsing location | Manual Phoenix selection populated Sell and carried into Create Listing and Upgrades. Changing Events to New York carried into Sell and persisted through a preview reload into Create Listing. No GPS permission requested. This verifies these two markets, not worldwide coverage. |
| Timing | Phoenix Upcoming showed venue-local MST and countdown labels. Live now and Sell agreed about a stored event’s estimated live window. Its hub showed “No upgrades listed yet.” A New York native event’s future hub showed an active countdown. No clock manipulation or wait through the showtime boundary was performed; boundary fixtures remain separate evidence. |
| Upgrade alerts | UI explicitly said alerts start when the service is enabled. No preference was saved. Native event detail had the event-specific Upgrade alerts disclosure. |
| Flash Drop | Dialog opened over navigation at z-index 151; initial focus was Close, next-step focus was its heading. Long form had a 637px scrollport for 1049px content. Shift+Tab kept focus inside; Escape closed it and restored focus to + Drop Seats. No proof upload, ownership lookup or gift submission. |
| Fan Gifts/Friends | Gift empty state honestly stated alerts are unavailable. Friends offered Explore Trending; clicking it switched to Trending, replacing the former circular people-finding path. No follows/posts/reactions submitted. |
| FAQ | Enter opened and closed a question. Open answer had no max-height clipping (179px client/scroll height); closed panel had native hidden and focus remained on its trigger. |
| Why / image Back | Light guide accent computed #246345. Native image-back link computed #f9f7f1 on rgba(13,11,20,.86). |
| Privacy | Actual provider body rendered. At 373px, document/body scroll width remained 373px. The table measured 267px with fixed layout and wrapping cells; no horizontal overflow was observed at this size. |

## Narrow correction from this review

`SellingEventPicker.jsx` search was missing `pg-control-input`, so its computed light border remained `rgb(207,197,186)` against `rgb(248,244,236)`. `LocationAutocomplete.jsx` also lacked the marker and used an inline decorative-border token. The correction adds the class to both and makes the city input's inline border use the existing state-aware boundary token. It preserves its fill, sizes, handlers and data behavior.

Changed source: `src/components/listings/SellingEventPicker.jsx`, `src/components/LocationAutocomplete.jsx`.

Verification: `node --test tests/ui-control-contrast.test.mjs` passed 10/10. The added check reads actual JSX input classes/styles, generates their Tailwind rules and checks default/hover/focus/invalid/autofill boundary cascade in both source orders and themes. It is a focused source-cascade model, not browser verification. Scoped ESLint and `git diff --check` passed. Existing build and other suites were not needlessly repeated for this class/token-only change. Existing search-icon width was preserved after diff review.

Next upload should update the same PR15 branch. Recheck only these two corrected controls in the hosted preview after synchronization. Screenshots in this package precede the correction.

## Catalog timezone issue: still open

New York initially showed 76 results with provider links and EDT labels. On a later reload it showed 40 native-event links with UTC plus “venue time unconfirmed.” For the observed 7PM EDT / 11PM UTC pair, the instant agrees; this does not establish timestamp corruption.

Read-only source inspection explains how metadata can be lost:

1. Events schedules `syncTMEvent` for provider results during browsing, without a listing submission.
2. The sync payload omits the provider's venue timezone and other timing metadata; the existing backend neither persists nor backfills it.
3. The source merger prefers a local Event by provider ID without combining richer timing metadata, and routing then uses the native event ID.
4. PR15's explicit UTC/unconfirmed fallback exposes the missing zone rather than guessing one.

The sync block, merger, route helper, provider normalization and backend sync are unchanged from the published baseline. This is a pre-existing catalog defect, not introduced by this review. The specific write history and the initial count of 76 were not independently established from backend responses or a database inventory. No data/backfill/backend change was made to address it in this UI follow-up.

**Operational limitation:** the approved Base44 branch shares Final's data environment. Ordinary Events browsing invokes existing catalog synchronization that can create/update Event and Venue records and remove duplicates. Thus this session cannot truthfully be described as “no database writes”; no before/after record inventory was performed. No explicit listing, purchase, payment, refund, gift, follow, post or alert-subscription submission occurred. Purchase-security/Mission 1 was not accessed.

## Remaining limits and next work

- Exact Base44 deployed SHA must be exposed/verified before any exact-revision publication claim.
- Upload the small contrast correction and inspect those fields; then review merge/publication separately. This approval did not authorize either action.
- Repair venue-timezone persistence/reconciliation in a separately scoped catalog task, with fixtures and a reviewed migration/backfill plan if needed; do not guess venue zones or mutate records merely to make screenshots look correct.
- Previously recorded malformed provider title/duplicate-identity questions and refund-policy conflict remain open. No policy wording was changed.
- No physical TestFlight, software keyboard, screen reader, 320/390/430 width matrix, landscape, 200%/400% zoom, real listing, or payment verification. Landing/onboarding and simulated error/boundary states retain prior fixture evidence, not fresh rendered certification here.

## Session checkpoint

October 3 continuation, approximately 15:25–15:50 Arizona time (roughly 25 minutes; estimate, not a billing measurement). Goal: import approved PR15, inspect its rendered UI, and fix demonstrated misses. Completed: hosted review, screenshot evidence, two local discovery-control corrections, and a concrete catalog metadata follow-up. December 17 is 75 calendar days away. This is measurable UI progress, not an overall launch-readiness percentage.
