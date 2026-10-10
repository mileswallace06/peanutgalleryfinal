# Founder recovery fixture

This fixture imports the real Founder, navigation health, three admin panels and
Beta Live Event checklist, with an aliased SDK and synthetic admin. No production
credentials or endpoints are used. The CSP and browser runner block external
traffic; application fetch/XHR is blocked. Mutations are intercepted locally:
only expected navigation-spike `AdminAlert.create` calls may succeed in memory;
all other mutation attempts fail and the runner asserts their absence.

Run `node tests/founder-recovery-browser.mjs`. It starts its own local Vite server
(port 4183 by default); `PG_FOUNDER_REVIEW_URL` is only for an already running copy
of **this** fixture, not the shared ticket-design fixture. Browser options:
`PG_CHROMIUM_PATH`, JSON `PG_CHROMIUM_ARGS`, and `PG_PLAYWRIGHT_MODULE`. Evidence
is written to `PG_FOUNDER_EVIDENCE_DIR` (default `/tmp/pg-founder-recovery`).
Run unit checks with `node --test tests/founder-read-recovery.test.mjs`.

`fail`, `delay`, and `unavailable` query parameters accept comma-separated entity
names. `empty=1` supplies valid empty arrays; `spike=1` supplies three fictional
navigation failures. `screen=windows|drops|instant|beta` opens the other controls.
`window.founderFixture` exposes local modes, deferred-source release, mount state,
read-call records and synthetic writes for deterministic failure/retry tests.

Before repair, the c31a2e1 source was run with the same isolated SDK. Each of six
reads was rejected separately in both themes. Founder/Nav refresh stayed disabled;
optimistic health remained visible. Two mounts of a spike produced two synthetic
alerts. The three loaded refresh controls had unnamed button accessibility
snapshots, and Beta's field had no associated label. Baseline screenshots were
captured from exact `git show c31a2e1:<component path>` snapshots, using original
operations CSS and current unchanged design tokens. The temporary baseline copies
are not part of the fixture or production build.

The new alert guard deduplicates an incident within a browser session and checks
existing unresolved alerts before writing. It is **not an atomic cross-client
uniqueness guarantee**. That requires a separate backend unique key/constraint
and is outside these display/recovery repairs.
