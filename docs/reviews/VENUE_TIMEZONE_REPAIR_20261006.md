# Venue timezone preservation — October 6, 2026

## Goal and baseline

Keep the venue-local time consistent when a Ticketmaster event becomes a native PG event. The observed New York example changed from 7 PM EDT to 11 PM UTC / venue time unconfirmed after synchronization; these represented the same instant, but PG had lost the venue timezone.

Branch: `codex/pg-venue-timezone-20261006`.

Baseline: `8fea9d0221f505e045b045a22eed746a52eb3b88`, independently verified Main and the published PR15 release immediately before this task. Work is isolated from the previous worktree.

## Changes

- Events background synchronization, Upgrades selection and seller selection now include the existing `venue_timezone` field in their full sync payloads.
- `syncTMEvent` validates the timezone and persists it on creation. Existing and deduplicated canonical records receive it only when their saved timezone is missing/invalid and venue identity matches. Valid saved zones are preserved.
- Matching uses stable Ticketmaster venue IDs when both are available, rejects conflicts in any venue identity field present in both records, and otherwise requires matching venue, city and state. Repeated-sync tests prevent the handler's existing venue-ID update from bypassing this check on a subsequent request, including incomplete records with known conflicts.
- Browse reconciliation keeps the native PG route, identity, timestamps and status while filling missing/invalid timezone metadata from the matching provider event and venue. It does not mutate either source object.
- Seller discovery and canonical rereads use the same timezone rule. The final resolver validates against the original persisted record, not an object that inherits missing identity fields from the provider candidate.

Validation checks timezone syntax supported by the runtime. This does not independently attest a client payload against Ticketmaster. The existing authenticated request boundary remains in place; no new provider calls or wider authority were added.

## Focused evidence

- Eight focused test files passed: handler timezone, frontend timezone, provider normalization, sync coordinates, venue date display, event search, ongoing seller discovery and seller selection. The combined run reported 70 passing Node test entries and no failures; some legacy files additionally run internal assertions.
- Final review added regressions for the resolver identity boundary and incomplete conflicting venue records. The resulting frontend timezone suite passed 10/10 and handler suite passed 14/14: 24 new behavior tests. Tests execute the actual handler with in-memory service stubs; they do not connect to Base44 or Ticketmaster.
- Import/normalize → actual handler create → serialized reread → date formatter preserves exact UTC instants and venue-local labels for New York, Phoenix, Los Angeles, London and Tokyo, including summer/winter DST differences.
- Missing/invalid zones, conflicting provider and venue identities, duplicate records, repeated synchronization, preserved valid zones, authentication failures and unchanged timing reconciliation are covered.
- Vite build passed. Scoped ESLint passed with zero errors and the existing `_error` catch-variable warning; whitespace checks passed.
- Build used the existing installed dependency tree to avoid an unnecessary installation: SDK 0.8.52, while unchanged package-lock specifies 0.8.53. Vite, React and the Base44 Vite plugin matched their locked versions. This proves compilation with the available dependency tree, not an exact locked-dependency or hosted-runtime build. No app environment was supplied; this was a compile check, not a connected app preview.

## Delivery and remaining limits

Prepared locally; not merged, deployed, published or verified in TestFlight by this task. The frontend and `syncTMEvent` backend change must both reach the intended Final release. GitHub presence alone is not runtime evidence.

There is no schema change, migration, bulk historical backfill or extra sync call. Existing records can be enriched in memory when matching provider results are returned, and persisted when the existing normal sync path runs with the corrected payload and handler. An old record reached directly without matching provider metadata may still correctly say venue time unconfirmed. A valid but incorrect saved timezone is deliberately not silently replaced. Existing deduplication still keeps the newest canonical event; this repair does not adopt timezone data from an older duplicate that it removes.

No event dates, live/upcoming rules, listing submission/proof requirements, security gates, payment code, policies, credentials, maintenance, workers or Mission 1 files were changed. No application invocation or real record mutation was performed for this task. The unrelated existing `tm_id`-only EventDetailTM fallback remains unchanged.

Next: import and push the prepared branch, review the narrow PR, verify Base44 synchronization and the intended backend revision, then approve delivery and confirm one matched event retains venue-local time after synchronization/reload. Do not run a broad data repair merely to validate this change.

## Session checkpoint

October 6 session continuation: approximately 13:34–13:45 Arizona time (11 minutes, an estimate rather than billing time). Goal: close the known timezone-loss defect while Miles runs a separate screen audit. Implementation, focused regressions, independent review, build verification and a complete verified delivery bundle completed in this session; deployment confirmation remains outstanding. December 17 is 72 calendar days away. This records completion of one specific repair, not overall launch readiness.
