# PR 14 mobile review — October 3, 2026

## Reviewed state

Peanut Gallery Final, app `69ef9900cf3862dc0ea39734`, imported branch `codex/pg-screen-refinements-20261001` after Miles explicitly approved import for preview. GitHub head remained `c15067b9ffe4d925415b2e1dec5744dd31dcfe09`; Main remained `ce49debb0d5d5a855b59b054b792dac1f12decc6`. PR #14 remained an open, mergeable draft. Base44's imported branch had no version-history SHA available, so the provider's exact revision was not independently exposed.

The hosted preview was 373 × 665 CSS pixels. This was a desktop-browser phone-width review, not physical TestFlight or iOS keyboard verification. The reviewed data was existing account state and public Phoenix event discovery. No listings, purchases, favorites, or alert preferences were created or changed. Only local preview theme/location choices were used. Import may synchronize shared app functions/configuration; it is not backend isolation.

## Observations

| Area | Hosted evidence |
| --- | --- |
| My tickets | Visible Back to Me, working return navigation, readable empty state in light and dark themes. |
| My Sales | Back to Me worked. Loading and loaded headers rendered; active-listings empty state and collapsed history fit in both themes. History records were not opened. |
| Help Center | Account Settings link opened `/help`, not email. Search, no-results recovery, topic filtering and expanded answers worked. Footer reached by scrolling; 373px content width had no horizontal overflow. Both themes captured. |
| Bucket List | Empty-list invitation, Add favorites input, My list and Alerts tabs rendered in both themes. Escape/Close returned focus to the trigger. Alerts explicitly reported inactive delivery. No preference was saved. |
| Upgrades | Public discovery returned 40 nearby results, 39 upcoming and no live events at review time. Cards showed venue-local countdowns. Upcoming and live-empty states rendered; three cards fit above navigation in both themes. |
| Events | Three ticket-stub cards fit above navigation in both themes. Photos, page color and texture remained. A date/time inconsistency was found and corrected locally below. |
| Light theme | Help, account settings, tickets, sales, Fan Zone/Bucket List, Events and Upgrades used warm surfaces and dark readable text. This is bounded visual evidence, not an audit of every route or a full accessibility certification. |

## Two corrections from the review

1. Events displayed the Phoenix event at 10:00 PM in the UTC browser while Upgrades correctly displayed 3:00 PM MST. Events now uses explicit venue timezone for its visible time, accessible label and date stub. Ticketmaster detail had the same formatter defect, so it uses the same helper and retains canonical time/zone/TBA fields in its existing local-event mapping. Unknown venue zones are explicitly labeled; naïve/invalid/TBA timestamps do not become guessed showtimes. Data loading, synchronization and listing behavior are unchanged.
2. On this short phone viewport, the main empty Bucket List action appeared below the explanatory benefits. The action and short footnote now follow the introduction, before the artist/venue details. Text, colors, event handlers and saved data are unchanged.

These two local corrections are newer than the hosted screenshots and still need the small branch update plus targeted rendered recheck.

## Verification and remaining limits

Five focused new date-display tests passed, covering actual card JSX across UTC/New York/Tokyo viewer zones, venue-day rollover, daylight saving, canonical/legacy timestamps, uncertain times, and the isolated detail read path. Changed-page/component lint and whitespace checks passed. Production compilation passed after these corrections. The previous 81-test result is retained as prior evidence; it was not presented as a fresh rerun.

No suitable live existing PG event was opened to exercise a real countdown-to-live transition. Clicking a provider-only upgrade card can synchronize an Event record, so that action was omitted from this read-only review. Exact showtime transitions, populated upgrade hubs, native keyboard behavior, Stripe iframe appearance and physical TestFlight remain unverified here.

Discovery alerts remain off. The UI's inactive message was observed. No worker schedule or flag was changed; no delivery claim is made. Follow `src/docs/DISCOVERY_ALERTS_RUNBOOK.md` separately before activation. Purchase-security work remains in its separate workstream.

Twenty-one labeled screenshots, including the prior import-selection screenshot, were retained in `pg-pr14-mobile-review-20261003.zip`. Current screenshots show the imported revision before the two follow-up corrections.

## Next step

Update the existing PR branch with the two corrections; recheck Events time/stub/detail consistency and Bucket List action placement. Then seek merge/publication approval for the reviewed result. No merge or publication was performed in this review.
