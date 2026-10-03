# Timing checks — October 3, 2026

Baseline: published `07d4031c816c7540b91ebff03671092abb1b265c`. Current branch: `codex/pg-audit-followup-20261003`.

## Implementation

F1: native detail and Events now share the upgrade timing state; estimated windows are labeled. Upcoming populated hubs retain a countdown rather than exposing offers early. Hub eligibility presentation follows the same live window; live empty inventory says “No upgrades listed yet.” Backend restrictions are unchanged.

F2: venue date labels use one strict instant parser and formatter. Missing/invalid venue zones use UTC with “venue time unconfirmed”; no zone is guessed from a state. Local/TM record timestamps are unchanged. The existing matching router-metadata fallback in imported detail remains intact; direct links without confirmed venue metadata remain explicit UTC/unconfirmed.

## Fresh checks

```bash
node --test tests/event-date-display.test.mjs tests/upgrade-showtime-state.test.mjs tests/upgrade-route-clock.test.mjs tests/selling-event-picker.test.mjs tests/upgrades-live-discovery.test.mjs tests/upgrade-discovery.test.mjs tests/upgrades-owned-navigation.test.mjs
```

59 passed, 0 failed. Actual JSX fixtures cover viewer zones, venue midnight, spring/fall DST and repeated-hour EDT/EST distinction, missing/invalid/TBA timestamps, estimated and explicit end boundaries, serialized reload records, upcoming populated inventory, eligibility presentation, clock resume/cleanup and native alert control scope. Scoped JSX lint and `git diff --check` passed.

The Unicode fixture preserves accents, apostrophes, non-Latin titles and literal mojibake through actual normalization, JSON serialization and the Events card. It is not a live storage/provider check or a repair of the reported title.

These are controlled unit/component/hook fixtures, not browser screenshots, physical iPhone tests or application connectivity evidence. No real records, transactions, alerts or provider requests were made.
