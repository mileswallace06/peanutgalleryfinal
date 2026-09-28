# Isolated ticket design visual review

Run from the repository root using the existing dependencies:

```sh
./node_modules/.bin/vite --config tests/fixtures/ticket-design/vite.config.mjs
```

Optional compile-only validation: `./node_modules/.bin/vite build --config tests/fixtures/ticket-design/vite.config.mjs` (isolated ignored `.review-dist`, never the production `dist`).

Open `http://127.0.0.1:4174/tests/fixtures/ticket-design/`.
The parent gallery contains real 320 × 844, 390 × 844 and 430 × 844 iframe viewports. Use `?width=390` for one frame. Review screen links preserve scenario, width and theme. Browser automation can address `#preview-390` (or `iframe[name="preview-390"]`).

Examples:

- `?page=events&width=390&scenario=populated&theme=light`
- `?page=upgrades&width=320&scenario=empty&theme=light`
- `?page=hub&width=430&scenario=populated&theme=light`
- `?page=sell&width=390&scenario=provider-error&theme=light`
- `?page=fan-zone&width=390&scenario=provider-error&theme=light`
- `?page=my-tickets&width=390&scenario=provider-error&theme=light`

The real source Layout wraps the real source pages with a MemoryRouter. Real bottom navigation works within each frame. `/me` is mapped to the MyTickets screen for this review; other destinations display an explicit scope notice instead of contacting the application. The parent review banner labels all data as fictional without changing the app viewport layout. Direct `app.html` exists for debugging, but use the gallery for labeled review.

The fixture API and AuthContext replace the production imports only in this dedicated Vite configuration. Vite's production configuration, source pages, and dependencies are untouched. Test-only browser state marks onboarding complete, picks the requested theme, and provides a fictional Phoenix location. All event times are generated relative to the actual preview session time: one live event, one starting soon, and three upcoming events. Identities and data are deterministic; timestamps intentionally track real time.

SDK stubs include Event, Listing, FanPost, Notification, SeatDonation, BucketListItem, Follow, SeatInventory, FlashDropEntry, PointsActivity, local navigation telemetry, event discovery/city suggestions, participant listing/purchase views, and Fan Gifts views. Empty mode keeps direct event lookup available so the live hub shows empty content rather than an unrelated missing-event screen. Provider-error mode fails Ticketmaster, listings, purchases, gifts and the fan feed, retaining local event metadata to exercise the pages' existing failure behavior.

Every unknown SDK function, entity or method throws an explicit `Unexpected visual-review API` error; it never falls through to a real SDK. Payment, reservation, upload, feedback, posting and account mutations throw an explicit review-only error. Known navigation telemetry is recorded locally only. Content Security Policy restricts resources to the preview origin (plus inline/data assets) and blocks remote images/fonts/frames. Browser fetch is restricted to local Vite module and asset reads; XMLHttpRequest is disabled. Sandboxed iframes cannot navigate the top window or open payment popups. No real backend requests, writes, Stripe calls, email, or push initialization occur.

The dedicated Vite server also rejects document/frame navigation outside this fixture, preventing a hardcoded location change from reaching the production HTML entry. Use this dedicated Vite config, not the production dev server.

`window.ticketDesignFixture` within a frame exposes read-only inspection metadata plus `calls`, `blocked`, and `unexpected` logs. Do not consider provider-error console messages a fixture failure; unexpected APIs or render errors are fixture failures. This fixture intentionally does not implement checkout or unrelated production routes. It must not be imported into production entry code.

## September 28 secondary-screen extension

This narrow extension loads the current production components with fictional participant data; it does not change production code or implement a complete admin matrix.

| Gallery page parameter | Controlled state and review interactions |
| --- | --- |
| `my-tickets` | Received, confirm receipt, waiting on seller and disputed ticket rows; empty/provider-error modes remain available. Donation sheet may be opened; submitting is blocked. |
| `my-sales` | Send tickets, awaiting buyer, active/paused listing, paid and pending-payout sale rows; open Seller performance, Manage listing and Completed sales disclosures. Empty/provider-error modes are available; listing mutations are blocked. |
| `account-settings` | Fictional profile, connected payout account, populated purchase and sale history; open disclosures and purchase/sale tabs. Delete confirmation can be opened but deletion, settings saves, logout and Stripe setup are blocked. |
| `founder` | Fictional admin, populated health metrics, critical alert, transfer outcomes and navigation failure spike. The spike's automatic `AdminAlert.create` attempt is expected in `blocked`; no record is created. Use populated or empty, because the source page has no caught provider-error UI. |
| `seller-payout-guide` | Full informational guide, FAQ disclosures and corrected Back to Sell icon. |
| `upgrades-intro` | The real portalled WhatIsPGOverlay over Upgrades content, forced visible independently of saved preferences. Dismissal still calls the real handler; `auth.updateMe` is expected in `blocked`, and the fixture offers a reopen button. |

Example: `http://127.0.0.1:4174/tests/fixtures/ticket-design/?page=account-settings&scenario=populated&width=320&theme=light`.

Only a frame initially requested as `page=founder` receives the fictional admin role. All APIs remain the local alias, including `checkSellerOnboarding`, which does not call its potentially mutating backend implementation. Read response shapes explicitly include buyer purchases, seller sales, owned listings, Purchase, TransferOutcome, and navigation logs. Unknown API access still fails closed.

**Rendered verification: NOT RUN for these added fixture states.** The cloud browser rejected the local preview URL with `ERR_BLOCKED_BY_CLIENT`; compile validation is separate from a visual pass. Review locally at 320px and 390px in both themes, including account disclosures, founder spike rows, guide footer and overlay scrolling/focus. Full admin panels, purchase/checkout outcomes and physical TestFlight remain outside this extension.


## September 28 listing sharing extension

- `page=my-sales` includes one eligible fictional future resale listing. Its share action opens the real dialog, which performs its fresh participant and public-list reads through this local stub.
- `page=shared-listing&auth=guest` renders the real public destination for that exact listing without an authenticated fixture user.
- `page=shared-event` renders the real event detail with `?listing=fixture-seller-active`; it must show only that listing and must not open a purchase automatically.
- `scenario=share-unavailable` retains the seller inventory row but makes fresh sharing reads return unavailable. `empty` gives a missing shared destination; `provider-error` exercises its sanitized error state.
- Deliberately fictional proof, transfer-note and barcode canaries exist only in test data. They must never appear in exported metadata or the public landing page.

The focused runner is `tests/listing-share-browser.mjs`. It only accepts localhost fixture origins, intercepts all external requests, stubs clipboard/native sharing, and checks 320/390px dialog fit in both themes, Escape/focus return, PNG dimensions, copied canonical URL, native-share cancellation, fresh-unavailable handling and exact listing handoff. Run it against the isolated server using `PG_SHARE_REVIEW_URL=http://127.0.0.1:4174 node tests/listing-share-browser.mjs`. `PG_PLAYWRIGHT_MODULE`, `PG_CHROMIUM_PATH` (or `PG_TEST_CHROMIUM`), `PG_CHROMIUM_ARGS` (JSON argument array) and `PG_SHARE_EVIDENCE_DIR` can select locally installed test tools/output paths.

**Browser execution remains NOT RUN in this workspace:** Chromium was absent; one Playwright install invocation returned an empty/truncated download and failed. The runner is prepared and syntax-checked, not evidence of passing browser behavior. Compile results are reported separately. Native iPhone share sheets, camera QR scanning, hosted public routing and TestFlight remain separate checks even after a local Chromium pass.
