# Listing sharing kit — September 28, 2026

Status: implemented and locally verified; not pushed, merged, published or verified on TestFlight in this session.

Branch: `codex/listing-share-kit-20260928`. Application baseline: `f4172e4578c1cd92610ffc932c39529d4418aed3`, the existing rebrand-completeness branch. Its previous work remains intact. The new branch also preserves the two in-house incentive planning commits. It is a follow-up to that rebrand branch, not an unrelated main-branch replacement.

## Delivered behavior

- My Sales has one Share listing action for an eligible active native listing. Opening it performs fresh checks through the existing safe participant views and Event read.
- Square (1080 × 1080) and Story (1080 × 1920) PNGs use original textured PG ticket-stub artwork, public event/section/row/quantity/asking-price details, fee and current-availability notices, and a genuine QR code for the exact listing.
- No remote artwork, ticket proofs, admission barcodes, exact seat numbers, seller contact details or preview tokens enter the export. The image clearly says it is not a ticket; upgrades additionally state that admission is required.
- Native file sharing is offered when the device reports support. Save image and Copy link remain available. Cancelling the native share panel does not silently download or send anything. Clipboard failure leaves a selectable exact URL.
- The public `/listings/:listingId` page reads current public availability. Unavailable, transport-error and authentication-denied states are distinguished. Sign-in preserves the exact destination.
- Ticket and upgrade handoffs narrow their existing views to the requested listing. No checkout or reservation opens automatically, and a missing target never silently substitutes another ticket. Existing purchase/upgrade gates remain in place.
- QR/link origin is fixed to `https://peanutgallery.store`; an editor, preview, localhost or authentication-token URL cannot become the share URL.

The sharing tool is not a reward claim, proof-review shortcut, trust boost or points award. No promise of the proposed 90-day watches is active. This is the first usable tool underlying the in-house rewards proposal.

## Verification

- 29 focused model/loader tests passed. Covered private-field omission, canonical URLs, ownership, inactive/demo/reserved state, timezone/invalid-date handling, transfer/instant conditions, exact ID/type handoff and sign-in return paths. The 14 loader tests were rerun after the authentication-denial correction and passed.
- Production-source compilation passed. Local build lacked Base44 app environment configuration, so it is compilation evidence only; its `dist` is not a deployment artifact and is not included in the bundle.
- Changed-page/component scoped lint and diff whitespace checks passed.
- Isolated fixture compilation passed.
- 10 focused local Chromium cases passed with fictional data and network restricted to the fixture origin. Three targeted follow-ups passed after correcting the modal stack/width and adding the authentication-denial presentation.
- Mobile coverage: 320/390px, both themes, dialog fit, private-field omission, exact copied URL, Escape/focus return, actual PNG downloads, simulated native-share cancellation, stale inventory rejection, guest destination states and exact ticket handoff. No external requests, mutating SDK calls or browser runtime errors were recorded.
- Independently decoded both exported sample QR codes and confirmed the exact canonical URL and image dimensions. Sample images use fictional data.

Evidence: [browser checks and current screenshots](listing-share-evidence/browser/README.md), [PNG checks](listing-share-evidence/png-checks.json). The current corrected dialog screenshots are `browser/share-320-dark.png` and `browser/share-390-light.png`; two older screenshots are explicitly historical. [Square export example](listing-share-evidence/sample-square.png) and [Story export example](listing-share-evidence/sample-story.png) are fictional examples, not real offers.

## Implementation scope and boundaries

- Frontend pages/components/helpers and narrowly scoped offline fixtures/tests only. Existing Base44 function source, entities, payment logic, roles, secrets, workers and Mission 1 work were not changed.
- Added pinned production dependency `qrcode@1.5.4`, generated locally in the browser; no external QR service. Documentation: https://github.com/soldair/node-qrcode . Local-only browser/QR verification packages were installed outside the repository and are not application dependencies.
- DialogContent gained one optional overlay-class prop; its default behavior is unchanged. The sharing modal uses that to appear above the existing feedback widget, with phone-width margins and internal scrolling.
- Public-list verification inherits the existing endpoint's 200-result limit; a legitimate listing outside that result conservatively becomes unavailable. No unsafe fallback is introduced.
- Some transfer-window fields are not exposed by the current safe serializer. Known returned closure fields are honored; existing server purchase rules remain authoritative.
- Actual hosted anonymous availability, native iOS file saving/sharing, camera scanning, universal-link behavior and physical TestFlight remain unverified. Source contains existing read APIs, but local fixtures cannot prove hosted access. If hosted access is denied, the page offers branded sign-in without discarding the listing.
- A downloaded image is a snapshot; its printed URL/QR retrieves the current listing. No guarantee of live price in an old screenshot, traffic or a sale.

## Delivery

Upload the separate branch using the provided incremental Git bundle. It requires the existing f4172e4578c1cd92610ffc932c39529d4418aed3 history, which the user previously imported and pushed. No force push, reset, main-branch replacement or local working-tree switch is needed.

Review the feature against `codex/pg-rebrand-completeness-20260927`, then complete the rebrand/sharing merge and Base44 publication path together so no earlier visual work is lost. Publishing has not occurred in this session. After publication, validate with one genuine active listing in My Sales on TestFlight: open the kit, share/save/copy, scan the QR from another device, and confirm the exact listing destination. No sale is necessary to use the tool.

## Session checkpoint

Today's goal: turn the in-house incentive proposal into the first functional seller tool. Completed: sharing tool, live-record destination logic, local mobile checks, export/QR verification and delivery package. Approximate work-session timing is not used to infer launch velocity because active model/tool time is not reliably measured.

Next session: complete hosted/TestFlight delivery of this slice, then build advanced saved event watches. Reward eligibility, durable grants and any new points/donation-weight policy remain a separate implementation step. Purchase-security work stays with its existing task. No launch-readiness percentage is claimed.
