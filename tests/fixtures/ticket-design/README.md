# Isolated ticket design visual review

Run from the repository root using the existing dependencies:

```sh
./node_modules/.bin/vite --config tests/fixtures/ticket-design/vite.config.mjs
```

Optional compile-only validation: `./node_modules/.bin/vite build --config tests/fixtures/ticket-design/vite.config.mjs` (isolated ignored `.review-dist`, never the production `dist`).

Open `http://127.0.0.1:4174/tests/fixtures/ticket-design/`.
The parent gallery contains real 320 × 844, 390 × 844 and 430 × 844 iframe viewports. Use `?width=390` for one frame. The six review screen links preserve scenario, width and theme. Browser automation can address `#preview-390` (or `iframe[name="preview-390"]`).

Examples:

- `?page=events&width=390&scenario=populated&theme=light`
- `?page=upgrades&width=320&scenario=empty&theme=light`
- `?page=hub&width=430&scenario=populated&theme=light`
- `?page=sell&width=390&scenario=provider-error&theme=light`
- `?page=fan-zone&width=390&scenario=provider-error&theme=light`
- `?page=my-tickets&width=390&scenario=provider-error&theme=light`

The real source Layout wraps the real six source pages with a MemoryRouter. Real bottom navigation works within each frame. `/me` is mapped to the MyTickets screen for this six-screen review; other destinations display an explicit scope notice instead of contacting the application. The parent review banner labels all data as fictional without changing the app viewport layout. Direct `app.html` exists for debugging, but use the gallery for labeled review.

The fixture API and AuthContext replace the production imports only in this dedicated Vite configuration. Vite's production configuration, source pages, and dependencies are untouched. Test-only browser state marks onboarding complete, picks the requested theme, and provides a fictional Phoenix location. All event times are generated relative to the actual preview session time: one live event, one starting soon, and three upcoming events. Identities and data are deterministic; timestamps intentionally track real time.

SDK stubs include Event, Listing, FanPost, Notification, SeatDonation, BucketListItem, Follow, SeatInventory, FlashDropEntry, PointsActivity, local navigation telemetry, event discovery/city suggestions, participant listing/purchase views, and Fan Gifts views. Empty mode keeps direct event lookup available so the live hub shows empty content rather than an unrelated missing-event screen. Provider-error mode fails Ticketmaster, listings, purchases, gifts and the fan feed, retaining local event metadata to exercise the pages' existing failure behavior.

Every unknown SDK function, entity or method throws an explicit `Unexpected visual-review API` error; it never falls through to a real SDK. Payment, reservation, upload, feedback, posting and account mutations throw an explicit review-only error. Known navigation telemetry is recorded locally only. Content Security Policy restricts resources to the preview origin (plus inline/data assets) and blocks remote images/fonts/frames. Browser fetch is restricted to local Vite module and asset reads; XMLHttpRequest is disabled. Sandboxed iframes cannot navigate the top window or open payment popups. No real backend requests, writes, Stripe calls, email, or push initialization occur.

`window.ticketDesignFixture` within a frame exposes read-only inspection metadata plus `calls`, `blocked`, and `unexpected` logs. Do not consider provider-error console messages a fixture failure; unexpected APIs or render errors are fixture failures. This fixture intentionally does not implement checkout or unrelated production routes. It must not be imported into production entry code.
