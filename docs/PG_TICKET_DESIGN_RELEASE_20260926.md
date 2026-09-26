# PG ticket design — implementation and delivery checkpoint

## Current state

Miles approved both six-screen neon ticket concepts on September 26, 2026.
This branch implements that direction in real source components. It has not
been pushed, merged, published, or verified on an installed iPhone.

- Branch: `codex/pg-ticket-design-20260926`.
- Base: `27b9884b640da1e2c55b224029977a21a21f5024`, independently matched to
  remote main at the start of implementation.
- Destination: the existing `mileswallace06/peanutgalleryfinal` repository and
  Peanut Gallery Final, app `69ef9900cf3862dc0ea39734`.
- Scope: visual design only. Purchase security and the native location-origin
  support case remain separate.

## Implemented

1. Shared brand header, neon navigation, typography, paper/ink tokens, accessible
   focus styles and physical ticket cutouts. Existing mounted-tab caching and
   scrolling are retained; My Tickets identifies Me as the selected nav item.
2. Upgrades: compact photographic tickets, colored action ends, real location
   controls and Live Now / Starting Soon / Upcoming sections.
3. Live Hub: compact event hero, current-seat stub, vertical Move Closer offers,
   and matching Fan Karma presentation. Existing Fan Gifts and eligibility
   controls remain connected.
4. Events: compact photographic event stubs, date endcaps, search and real date
   filters. The mockup's category filters were not invented in production.
5. Sell: orange listing action, payout setup, real counts and listing stubs.
   Existing nearby-event data supplies photos/titles when available; unknown
   images fall back to an icon. No fake Edit actions or inventory were added.
6. Fan Zone: compact feed controls, header compose, and Seat Flex from/to stubs
   with actual before/after photographs when supplied.
7. My Tickets: compact status-aware order stubs, View/Confirm, and completed-only
   Upgrade/Donate actions. These are order records, not fabricated admission passes.

All production photography, prices, seats and statuses use existing app data.
No generated mockup content is installed as customer inventory. No additional
fonts, dependencies or runtime services are required. The existing PG logo and
font stack are preserved.

## Behavior and intentional UI differences

Source review preserved API calls, authentication, member route guards, search,
location handling, listing eligibility/reservations, purchase callbacks, donation
gates, social reactions and compose flows. Backend files, entity permissions,
credentials, auth implementation, package files and migration files are unchanged.

Upgrades event cards now use one keyboard-accessible button, replacing a nested
button/click container. The same destination handler is retained. My Tickets
retains its action-first order and also shows any other returned transfer status
explicitly instead of implying receipt. Sell's unverified 95%/instant-payout/
two-minute marketing claims were replaced by neutral wording; fee logic was not
changed. Existing reaction semantics remain, including their user-facing symbols.

Source review also caught and fixed inherited action backgrounds, light-theme
text contrast, focus outlines clipped by ticket masks, and newly introduced LIVE
badges using raw status instead of the existing timing helper. MoveCloserRail's
pre-existing availability decisions still use stored event status; this redesign
does not change that business rule.

## Validation and its limits

- Production Vite build passed (compile evidence only).
- Changed JSX passes scoped ESLint with no errors. Existing warnings are retained.
- 61 existing focused checks passed: branded auth 12, member access 5,
  event-search request behavior 13, Fan Gifts client behavior 8, limited-view
  projection/handler protection 23. All are offline; no live services were invoked.
- Independent source review examined the changed queries, callbacks, routes and
  conditional actions. `git diff --check` passed.
- An isolated review harness compiles and renders the real Layout and six pages
  with fictional SDK fixtures at 320/390/430px widths, dark/light themes, and
  populated/empty/provider-error states. See
  `tests/fixtures/ticket-design/README.md`.
- **Browser visual checks were not run.** This cloud browser blocked localhost
  and file previews by security policy. No alternate browser or policy workaround
  was attempted. A compiled fixture is not a browser pass.
- **Physical TestFlight verification is outstanding.** No claim of exact visual
  parity, measured touch targets, screen-reader behavior or iPhone safe-area
  correctness is established until the actual pages are inspected.

The current fixture blocks remote images and fonts and uses local sample artwork.
It is useful for structure/state checks, but the supported Base44 preview with
real imagery and fonts is needed for final appearance acceptance. The harness
never substitutes its mock API into production.

## Delivery path

The GitHub connector attempted to create only this new branch and returned HTTP
403, `Resource not accessible by integration`. No remote branch was created.
Use the saved Git bundle to import/push the branch through Miles's working SSH
remote; this does not check out or alter his current working tree.

1. Import and push `codex/pg-ticket-design-20260926`.
2. Review the PR against current main. If main moved, reconcile only this scoped
   visual diff and retain all newer work.
3. Run the isolated local mobile checks through local Codex/browser, including
   populated/error/empty states, long titles, keyboard focus, navigation, light
   theme, and safe-area fit. Record actual screenshots and findings.
4. Carry the reviewed changes through the existing GitHub/Base44 workflow. Inspect
   the supported preview with real fonts and images before publication. Verify
   synced source and resolve any unexpected provider commit instead of assuming
   an exact SHA match.
5. Publish the approved visual release and verify the live destination, then
   have Miles reopen his existing TestFlight app for physical acceptance.

Do not describe this checkpoint as delivered to the phone. Supporting routes and
transaction dialogs keep their existing behavior and may need a subsequent
visual pass after these six screens are accepted. Rollback is a normal revert of
the scoped visual commit after integration, never a reset that discards other work.
