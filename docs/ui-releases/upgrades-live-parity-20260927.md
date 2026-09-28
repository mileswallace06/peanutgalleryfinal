# Upgrades live discovery correction — September 27, 2026

User report: Sell lists events within a live window while Upgrades reports none.
Published baseline: 65aec5f19054b11d6fde6e808f1094e2dd49ad6e.

## Cause and correction

Upgrades previously made only the default future Ticketmaster request. The
provider query starts at now, excluding already-started events before the page
can classify them. Sell's event picker already uses separate future/ongoing
requests. Upgrades also independently filtered PG data by future provider cities.

Upgrades now reuses the existing useSellingDiscovery hook unchanged: bounded
future and ongoing queries, validated city/state or GPS radius, shared saved
location, provider cache reuse, canonical deduplication and partial failures.
This also avoids sending a display label such as Phoenix, AZ as a city name.

Upgrade discovery uses Sell's timing rules for explicit end times, bounded
estimated live windows, uncertain timestamps, cancellation and ended states.
Soon remains an Upgrades-only label for starts within 60 minutes. Estimated cards
say Live · est. Both confirmed and estimated live cards retain the live-hub
navigation path. The local clock still updates without provider polling.

Partial failures retain successful results and provide a retry instead of an
unqualified no-live claim. Result limits receive a qualified empty state. The
existing owned-ticket query and checkout/security boundaries are unchanged.

## Verification

- 7 new loader/timing regression tests passed: ongoing-only provider events,
  Sell/Upgrades parity, timezone offsets and end boundaries, shared cache and
  refresh, partial provider/PG failures, and GPS with empty upcoming results.
- 13 owned discovery/navigation and grouping tests passed, including estimated
  live card navigation. Synthetic beta events are excluded consistently with Sell.
- Scoped ESLint and git diff --check passed.
- Build exited successfully; compile-only because local Base44 app environment
  is absent. No local build artifact is deployed.
- Independent bounded source review found no blocking issue.

No fresh browser or physical TestFlight validation has been completed. No CSS or
layout changes; existing three-card layout evidence belongs to the prior release.
Event hub/detail components retain their older timing logic: explicit long end
times may still differ after opening a hub. This follow-up was not silently
changed as part of the discovery correction.

## Delivery

Prepared on codex/pg-upgrades-live-parity-20260927, directly atop published Main.
Only two frontend source files and three tests changed, plus this report.
No backend, payment security, secrets, migration, maintenance or other app changes.
Transfer the bundle to GitHub, verify synced live/upcoming results using the same
location, then merge and publish. The correction is not live yet.
