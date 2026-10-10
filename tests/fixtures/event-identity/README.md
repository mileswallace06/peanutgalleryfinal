# October 9 identity review fixture

This fixture mounts the production Events cards, native/provider detail routes,
FanPostComposer and LiveUpgradeControlPanel against fictional local data. It
imports the production ticket/theme styles, without the connected Layout shell.
The SDK is aliased to the ticket-design fixture, with a strict read-function
allowlist. Navigation telemetry stays in a local array. The browser runner blocks
all outbound traffic, asserts no mutation calls, and never posts or releases.

Run `node tests/event-identity-browser.mjs`. It starts its own Vite server on 4179;
set `PG_IDENTITY_REVIEW_URL` only to use an already running identity fixture.
`PG_IDENTITY_EVIDENCE_DIR` selects screenshot output. The runner accepts the shared
`PG_CHROMIUM_PATH` and JSON `PG_CHROMIUM_ARGS` launch overrides.

`PG_IDENTITY_CAPTURE_BEFORE=1` loads production source read-only from reviewed
commit `c31a2e1` through Vite, and reproduces six before cases in both themes. It
does not revert or modify the worktree. The normal mode checks 14 surface cases,
including composer search/select/remove/cancel/no match; dated accessible admin
options, exact selection and failed-read retry; card reference wrapping; and
both original native alias URLs. Screenshots use 1180 by 757 pixels; these are
isolated presentation checks, not production release or mobile certification.

The catalog contains a providerless pair/triple with equal visible context,
two copies of one exact provider ID, explicitly verified cross-provider aliases,
recurring dates, named separate sessions, same-provider separate inventory and
unknown date/venue metadata. Public discovery/composer collapse only the two
proven alias pairs. Unproven duplicates remain marked with uncertainty and their
exact record reference; no new performance distinction is invented. Admin keeps
every original record because an action must target the operator's exact choice.

`tests/event-identity-presentation.test.mjs` also models the observed Knocked Loose
shape: distinct provider IDs and venue IDs, one AXS page and one Ticketmaster
page, with the same visible occurrence. It does not use production IDs or data.
That evidence supports source context and an unconfirmed relationship, not a
destructive merge or a claim of distinct performances. Provider page labels only
recognize actual AXS/Ticketmaster hostnames. Venue time is never inferred from a
state or the browser time zone.
