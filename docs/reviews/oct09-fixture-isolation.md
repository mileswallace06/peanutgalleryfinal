# October 9 browser fixture isolation

The six new browser runners now fail on forbidden attempts, including errors caught by application code and attempts made before a subsequent navigation. This closes a test-reporting gap; no production business behavior changed. Hardening checkpoint: `15df45e5c7d114a49074a3f6e92895e5626fe643`. The final aggregate/commit result is recorded by the main repair report.

Previously, several fixture `fetch`/XHR/beacon overrides rejected calls without recording them. Discovery navigation aborted external requests without asserting their absence. Some absent SDK methods could throw a caught TypeError without reaching a fixture's blocked-call list; purchase's per-document assertions did not cover every navigation. These paths could make a passing run overstate its isolation evidence.

[fixtureIsolation.mjs](../../tests/helpers/fixtureIsolation.mjs) now installs a Node-held recorder before application modules execute. It permits only exact local-origin GET/HEAD fixture documents and static assets, records and blocks other HTTP calls, protects network overrides, and records CSP violations, WebSocket, worker and service-worker attempts. Records survive page reload/navigation. A mandatory assertion runs before context disposal; runners retaining a single context also explicitly assert it. [fixtureSdkGuard.js](../../tests/helpers/fixtureSdkGuard.js) records unknown SDK access, while explicit denied operations signal the same persistent recorder. The approved synthetic Founder alert and lifecycle creation paths retain their separate exact count/payload assertions.

## Fixture substitutions and screenshot limits

The fixture Vite plugin rejects production Base44 SDK imports. App clients remain aliased to synthetic SDKs. It also provides these explicit, test-only substitutions:

- Vite's injected development client uses local CSS helpers without HMR/socket behavior. `hmr:false` alone had still allowed Vite's client to attempt a socket connection.
- The existing Google Fonts import is omitted; renders use fallback fonts, as the earlier fixture CSP already required.
- The exact existing Base44 logo URL and three known Landing/Layout hero-photo URLs become inert fixture images. Other external assets are not silently allowed.
- The Stripe loader import becomes a fail-closed stub. Importing the actual Stripe package had scheduled its external bootstrap script in identity/lifecycle fixtures before any checkout action; CSP blocked it. The stub records/fails if `loadStripe` is actually called.

These facts were established by failing local guard runs, not by a production network capture. No externally hosted provider script was downloaded and no live SDK call was authorized. Final hardened screenshots validate component behavior/layout with the stated substitutions; they are not an exact capture of external fonts, logos or photography. Earlier curated before/after evidence remains preserved separately, with its original provenance.

## Verification

All targeted current-tree processes exited 0 on Node 24.19.0 / isolated Chromium 153.0.8010.0:

| Runner | Result |
|---|---|
| `event-identity-browser.mjs` | [14 surface cases](oct09-evidence/isolation/identity-positive.txt), both themes |
| `founder-recovery-browser.mjs` | [36 cases](oct09-evidence/isolation/founder-positive.txt); only expected synthetic alert writes |
| `oct09-lifecycle-browser.mjs` | [45 cases](oct09-evidence/isolation/lifecycle-positive.txt); only explicitly enabled, counted synthetic creation |
| `purchase-detail-browser.mjs` | 62 current-tree cases and 2 pinned-baseline cases; 0 errors/blocked attempts (purchase owner's report) |
| `fan-behavior-browser.mjs` | [42 cases](oct09-evidence/isolation/fan-positive.txt); historical R09 remains unresolved |
| `oct09-discovery-navigation-browser.mjs` | [R02/N01 navigation scenarios](oct09-evidence/isolation/navigation-positive.txt), both themes, pointer/keyboard |
| `fixture-isolation-browser.mjs` | [Negative safety proof](oct09-evidence/isolation/negative-probe.txt): six deliberately forbidden attempts recorded, none delivered; caught errors and an attempted fixture override do not hide them; failure survives navigation and is enforced on close |

The negative gate starts its own ephemeral loopback HTTP server and prints JSON to stdout; it needs no artifact directory or fixed port. All runners use the installed Playwright and optional `PG_CHROMIUM_PATH` / `PG_CHROMIUM_ARGS`. No skips or assertion weakening were introduced. Helper lint and `git diff --check` passed. Scope is the six new runners plus the negative safety gate; older runners' optional SDK recording hooks remain inert without this guard.
