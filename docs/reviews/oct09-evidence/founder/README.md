# October 9 Founder and control recovery evidence

N06 was a source hypothesis in the supplied audit. It was reproduced **in this
isolated fixture**, then repaired. No live Founder route or production backend
was opened. The fixture renders real components with a synthetic administrator,
aliased in-memory SDK, blocked application network, and intercepted mutations.

| ID | Before | Current result |
| --- | --- | --- |
| R11 / N02 (three assigned panels) | Loaded Transfer Windows, Flash Drop Metrics and Instant Transfer Ready refresh buttons had unnamed accessibility snapshots. | Stable purpose-specific names; coherent busy/disabled/error/retry state; actual Tab/Enter navigation and visible focus in both themes. Live Upgrades is covered by the separate Fan Zone repair. |
| N05 | Beta Live Event name relied on its placeholder and had no associated label. | Persistent **Event name** label with explicit `htmlFor`/`id`; example remains a described hint after typing. Some browsers can derive a name from the old placeholder; this evidence does not claim otherwise. |
| N06 | Rejecting each of six reads left a refresh stuck disabled and unsupported healthy copy visible. Two mounts of a navigation spike created two synthetic alerts. | Each source settles separately to loading, loaded, error or unavailable. Successful metrics survive independent failures; overall health is withheld until sources are known, and for an active navigation spike. Empty transfer samples are not 100% health. Retry works after failure or a 15-second timeout; late/unmounted responses cannot replace recovery. |

`before-report.json` records the baseline from exact c31a2e1 component/operations
CSS snapshots. `founder-recovery-report.json` records **36 passing isolated
browser checks**, including each read rejected or malformed, mixed/delayed reads,
retry, timeout, unmount/remount, repeated refresh, control names/focus and field
association. `unit.txt` records **10 passing helper tests**; `browser.txt` is the
actual browser runner log. Expected baseline page errors are deliberate injected
read failures, not production errors.

The 20 curated PNGs are before/after pairs for Founder failure, each of the three
refresh controls, and Beta, in light and dark themes. Every image is an actual
**390 × 844 CSS-pixel desktop Chromium viewport**, with a synthetic administrator;
this is not physical-device testing. `screenshots.json` maps every image to its
role, viewport, theme, source and fixture. Components are isolated from the full
application shell. Names and associations are demonstrated by the report's
accessibility snapshots/assertions; screenshots alone cannot prove them.

Reproduce with `node --test tests/founder-read-recovery.test.mjs` and
`node tests/founder-recovery-browser.mjs`. The browser runner starts its own
fixture server on port 4183; do not point it at the shared ticket-design fixture.
It supports `PG_CHROMIUM_PATH`, JSON `PG_CHROMIUM_ARGS`, `PG_PLAYWRIGHT_MODULE`,
and `PG_FOUNDER_EVIDENCE_DIR`. See the fixture README for scenario parameters.

The alert guard preserves the existing automatic spike policy. It verifies
unresolved alerts before creating one and shares an in-flight decision plus a
session incident fingerprint. Repeated refresh/remount produces one expected
synthetic alert; a reload adds none. Failed dedup reads block creation. There were
**no external requests or unexpected mutations** in the repaired browser suite.
This is not atomic deduplication across different clients. A backend unique
incident key/constraint remains a separate proposal; no backend policy or
security change is included. Timestamp/timezone correctness and live alert
emission remain unverified.
