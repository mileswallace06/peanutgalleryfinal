# October 9 identity presentation evidence

Scope: R03 discovery/detail identity, R16 composer choices, N03 Live Upgrades
selection, and the Live Upgrades portion of N02/R11 refresh naming.

These are **isolated fixture captures**, not production screenshots. Each capture
used an actual **1180 × 757 CSS-pixel desktop viewport**, in the named light or
dark theme. Every copied PNG is also 1180 × 757 pixels. The centered fixture is
at most 780 pixels wide; this does not establish mobile coverage. The production
components and ticket/theme styles are mounted without the connected Layout
shell. No post, release, upload, catalog write, or production navigation occurred.

The six `before` images render reviewed production source at
`c31a2e1aa9f9c7d7916908ab948201cfad3243a8` through a read-only Vite loader.
The eight `after` images render the uncommitted October 9 repair worktree.
Both sets use the same fictional catalog. Capture times are October 10 UTC during
the continuing October 9 repair session. `report.json` records original times,
routes, roles, dimensions, and SHA-256 hashes; copied PNG bytes are unchanged.
No exact deployed frontend/backend revision is asserted by this evidence.

## Capture map and role limits

All routes below are MemoryRouter routes inside
`/tests/fixtures/event-identity/index.html`; they are not live application URLs.

| Surface | Before | After | Route and role |
| --- | --- | --- | --- |
| Discovery cards | [Light](before-cards-light.png), [dark](before-cards-dark.png) | [Light](after-cards-light.png), [dark](after-cards-dark.png) | `/events?browse=1&q=Fixture%20Knocked&past=1&scope=nationwide`; synthetic signed-in member, SDK role `user` |
| Composer search | [Light](before-composer-light.png), [dark](before-composer-dark.png) | [Light](after-composer-light.png), [dark](after-composer-dark.png) | `/composer`, search `Fixture Hail`; synthetic fan passed directly as a component prop, no real session |
| Admin selector | [Light](before-admin-light.png), [dark](before-admin-dark.png) | [Light](after-admin-light.png), [dark](after-admin-dark.png) | `/admin`; admin panel mounted directly with mocked reads, so role-gate/backend authorization is not tested |
| Native detail | Not captured | [Light](after-detail-light.png), [dark](after-detail-dark.png) | `/events/fixture-alias-b`; synthetic signed-in member, SDK role `user` |

The admin screenshots show the closed selector and, after repair, the selected
record's wrapped context. Dated option names and their association with the
persistent Select Event label were asserted in DOM checks; the screenshots do
not claim to show an expanded native menu.

The browser suite additionally visits both Knocked fixture IDs and both original
native alias IDs in each theme. Only the final alias detail is captured. Provider
detail timing/metadata and card destinations have focused unit coverage; this
folder contains no provider-detail browser screenshot or authorization proof.

## What collapses, and what remains separate

Discovery/composer collapse `fixture-alias-a` with `fixture-alias-b` because they
share one exact provider identity, and `fixture-verified-a` with
`fixture-verified-b` because the fixture explicitly supplies verified provider
aliases. Occurrence, venue, session, and known inventory conflicts prevent such
collapsing. Original native references remain resolvable; an ambiguous provider
reference does not arbitrarily choose one retained inventory record.

The providerless pair/triple, recurring dates, separate named sessions, separately
owned inventory, and sparse metadata remain separate. Unproven same-context rows
show uncertainty and their full record reference. References identify records;
they do not claim the records represent different performances. Missing venue
time remains explicit UTC/unconfirmed context, rather than a guessed local zone.
Complete unique discovery cards do not gain unnecessary reference text.

Admin retains every original record, including display aliases, because release
controls must keep the operator's exact selected target. No action was invoked.
The selected summary supplies full context even when a native select clips its
closed display. Refresh naming/focus and a rejected event-list read followed by
retry are also checked; controls are disabled while data is unavailable.

## Production metadata inspection limits

Root performed a narrow read-only Event/schema/Listing inspection and supplied
this summary. This fixture agent made no production query. The complete summary
is retained in `report.json`.

- Knocked Loose `6ac55d18a763c3a4dddbbf4a` has provider ID
  `Z7r9jZ1A70yAZ`, provider venue ID `Z7r9jZadrI`, and a Ticketmaster event page.
- Knocked Loose `6ac55d18bc452cf0f0bfaec3` has provider ID `k7vGF_5wSdRv6`,
  provider venue ID `KovZpZAatEFA`, and an AXS event page. Both records show
  The Rooftop at Pier 17 and October 6 at 22:00 UTC, with venue timezone
  unconfirmed. Distinct provider IDs/pages do not prove either alias equivalence
  or distinct performances; the repair preserves both records and references.
- The inspected Hail the Sun pair and Diamondbacks/Pirates triple lack provider
  IDs/URLs and confirmed venue-local time/timezone/session context. Their
  equivalence remains unproven. No invented distinction or destructive merge was
  used to make the choices appear unique.
- A bounded public Listing read for the seven inspected event IDs returned zero
  rows with limit 500. This does **not** prove universal zero inventory, absence
  of inaccessible or differently linked inventory, or alias equivalence.

The screenshot catalog uses fictional IDs and event data. The metadata-shaped
Knocked Loose source-page case is a pure test fixture, not a production copy.

## Verification and assertion integrity

The implementation handoff recorded **74 passing focused tests**, zero failures,
and **14 passing browser surface cases** across both themes. Six baseline browser
cases reproduced the original visual-context problems. The final browser run
asserted zero page errors, outbound requests, unexpected SDK calls, and mutation
calls. Targeted ESLint and `git diff --check` passed at source freeze.

During this documentation-only curation, the same focused command passed
**75 tests**: the integrated suite now also includes
`native and provider details retain the originating list entry in their actual Back links`.
The complete fresh output is in [unit-tests.txt](unit-tests.txt). Historical
browser terminal summaries and reproduction commands are in [logs.txt](logs.txt);
machine-readable scope and results are in [report.json](report.json). Browser
tests were not rerun merely to curate these copied screenshots.

No assertion was skipped, removed, or loosened to obtain a pass. Old alias samples
that relied on title/venue/time similarity now explicitly supply verified alias
evidence; new negative cases prove similarity cannot merge records. Existing
date, zone, destination, route state, and input-preservation assertions remain.
The unique-record metadata fix omits an unnecessary false ambiguity field rather
than weakening the merge-preservation deep-equality assertion.

Run the focused command recorded in `report.json`, or run
`node tests/event-identity-browser.mjs` for the isolated browser checks. The latter
starts its own server on port 4179. `PG_IDENTITY_REVIEW_URL` overrides that server,
`PG_IDENTITY_EVIDENCE_DIR` chooses screenshot output, and
`PG_IDENTITY_CAPTURE_BEFORE=1` selects the read-only reviewed baseline. Local
Chromium installations can use `PG_CHROMIUM_PATH` and JSON `PG_CHROMIUM_ARGS`.
