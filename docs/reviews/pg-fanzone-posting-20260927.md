# Upgrades introduction and Fan Zone posting

Branch: `codex/pg-fanzone-posting-20260927`

Baseline: published Final Main `dee12087782ac179355a17f0bce6679052ff8d3a`.
GitHub Main remained identical when checked during preparation.

## Changes

- Upgrades replaces the separate “Move closer to the moment” block and three-step list with a compact “Find your event” section containing its location actions. The photo header, event cards, owned-ticket panel, live/upcoming discovery and timing logic are unchanged.
- Fan Zone's labeled Create button opens one composer directly. Post and Seat Flex are choices inside it. Caption, full image previews and searchable event tagging are together; optional seat details stay collapsed.
- The photo picker supports the device library instead of forcing camera capture. Existing photo formats still depend on the device and upload provider; this does not add video or carousel support.
- Dialogs include focus handling, Escape/back navigation and discard confirmation. Upload and share failures retain the open draft. Pending uploads and duplicate taps are guarded in memory. Drafts are not persisted across reloads, and this does not introduce server-side idempotency.
- A successful share shows confirmation and selects the general feed, All dates and Newest Posted. Failed event loading is labeled and offers retry. Existing feed filters remain available.
- Existing FanPost fields and upload, event and participant-view endpoints are preserved. No backend code, credentials, permissions, payment controls or maintenance settings changed.

## Verification

- 12 focused asynchronous posting tests passed with mock upload/create functions. They cover payload compatibility, required fields, invalid authors, concurrent uploads, duplicate taps, failed requests and deliberate retries. No real posts or uploads were created.
- 20 existing upgrade discovery/owned-navigation tests passed, including Sell/Upgrades live-window parity, incomplete-provider results and card destinations.
- Changed JavaScript/JSX lint and whitespace checks passed.
- Production compilation passed locally. Its local environment has no deployment app ID; the generated build is not a deployment artifact. Base44 will build the source branch using its environment.
- Browser mobile review and physical TestFlight behavior remain pending. The cloud browser could not access the isolated local preview (`ERR_BLOCKED_BY_CLIENT`); no screenshots or layout-pass claims are inferred from compilation.

## App Store scan — pending branch transfer, before merge

Inspected the actual Final editor, app `69ef9900cf3862dc0ea39734`, without publishing.
The supported path is Publish → Mobile app → Check Your App → Run App Scan,
then App Store guidelines. This is distinct from Dashboard → Security.

The new branch is local at this checkpoint. Transfer it to GitHub and import it
through Base44's branch controls. Verify the updated branch, review the actual
mobile composer and Upgrades section, then run the App Store check and preserve
the exact findings and revision coverage. Do not merge just to make the scan
available. If the scan only covers Main/published source, disclose that limitation
instead of claiming the new branch was scanned.

No App Store scan has run for this revision, and nothing in this report is an
App Store approval. No merge, publication or native store-file generation occurred.

## Next review

Check the composer at narrow phone widths in both themes: text-only Post,
Post/Seat Flex switching, event search, back, close and discard. Do not submit real
content merely to test layout. Report scan findings before any merge/publish.

Separate follow-ups from the previous release remain open: live event-hub empty
state wording and venue-local date display consistency. Purchase security remains
owned by the separate workstream.
