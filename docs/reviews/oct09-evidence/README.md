# October 9 isolated evidence

All new captures use synthetic identities and local fixtures. They are not live production screenshots or transaction certification. The original audit and its nine figures remain a separate input: [source record](../oct09-audit-source.md).

| Area | Evidence |
| --- | --- |
| R02/N01 navigation and continuation | [Before/after, source provenance and commands](discovery/README.md) |
| R03/R16/N03 identity and admin options | [Before/after and identity decision](identity/README.md) |
| R04/R05 lifecycle and Flash Drop | [Before/after, authoritative handler tests](lifecycle/README.md) |
| R09/R15 focus and controlled location | [Full original/diagnostic and controlled evidence](../oct09-fan-validation.md) |
| R06/R07 legal preservation | [46 check results](legal/result.json): 320/375/390/430/1280×844 and 844×390, both themes; staged content/keyboard/history/reduced motion |
| R11/N02/N05/N06 operational controls and Founder | [Before/after, exact viewport/role, state and alert-write counts](founder/README.md) |
| N04/R12/R13/R17 transactions and payout presentation | [Before/after and exact commands](purchase/README.md) |
| R14 queue recovery | [56 check results](sales-admin/result.json), includes each independent source fault/retry |
| I2 tracking characterization | [Seven offline probes](tracking/offline-probe.txt), [interpretation and unknowns](../oct09-tracking-investigation.md) |

## Continuation evidence

See [Fan startup repair](../oct09-fan-startup-repair.md) for the reproduced timing window and before/after evidence. Full repository lint now passes after removing 23 unused imports; CI now enforces full lint and includes a fifteenth browser runner for startup dismissal. The original combined results below retain their original provenance. Current-head CI is recorded in [PR18](https://github.com/mileswallace06/peanutgalleryfinal/pull/18).

## Original combined local results

| Command | Actual result |
| --- | --- |
| `npm run lint` | Exit 1: 23 existing unused-import errors, all 12 affected files unchanged from comparison base; [log](gates/lint-full.txt), [verification](gates/lint-baseline.json) |
| `npm run lint:audit` | Exit 0: 94 production files, 0 errors, 21 warnings; [log](gates/lint-audit.txt) |
| `npm run test:audit-safe` | Exit 0: 39 suites, 384 passed, 0 failed/skipped; [log](gates/safe-unit.txt) |
| `npm run build` | Exit 0; missing app-ID/deployment-URL warning in local build and stale Browserslist advisory; no dependency changes; [log](gates/build.txt) |
| `npm run test:audit-browser` | Exit 0: all 14 runners; [summary](gates/browser-summary.json), [full output](gates/browser-full.txt) |

The fresh route smoke result is 252 passed of 254 cases plus 2 known Founder `AdminAlert.create` fixture blockers, 0 unexpected blockers/failures/overflow. [Actual report](gates/route-inventory.json). It is initial route rendering, not254 fully verified workflows. The separate Founder suite passes 36 cases with explicit local mock alert-write counts.

The production/test source is identified in [source-checkpoint.json](source-checkpoint.json). The browser aggregate began at local `15df45e`; only unused temporary Founder baseline capture copies were removed during that run, yielding `f6063ba`. None was loaded by a runner. Uploaded review commit `850605eec75f8316f94df27129a954de39647d89` was fetched and verified byte-for-byte equal to the final local source/test/workflow trees. The later `5f02eb1` cleanup removes trailing whitespace from two fixture files and one log; it changes no executable behavior. The checkpoint records those final source trees. All other evidence commits leave source unchanged. Final-head GitHub CI is separately reported in the draft PR, without borrowing a historical green run.

Known limitations and owner decisions remain in the [ledger](../oct09-regression-repairs.md).

## Reproducible environment

Local verification uses Node 24.19.0, locked Playwright 1.62.1 and Chromium 153. CI uses Node 22 and Playwright's installed Chromium. No dependency versions were changed. Set `PG_CHROMIUM_PATH` and JSON `PG_CHROMIUM_ARGS` only when the environment needs an existing Chromium executable; normal CI installs its browser with `npx playwright install --with-deps chromium`.

Commands: `npm run lint`, `npm run lint:audit`, `npm run test:audit-safe`, `npm run build`, `npm run test:audit-browser`. The browser aggregate writes each runner log, report and `browser-summary.json` under `tests/artifacts/oct09`; GitHub Actions uploads that directory as `isolated-audit-evidence` even on failure. The optional tracking characterization command is `node --test tests/tracking-bootstrap-investigation.test.mjs`.

The six new component/browser fixtures replace the Base44 client with explicit local stubs, block production SDK imports, and record forbidden attempts in the Node runner across navigation. An exact-local-origin asset policy rejects network mutations. The separate negative isolation gate deliberately triggers six denied attempts and proves that caught errors, overwritten fetch and reload cannot erase them. Expected local Founder alert / lifecycle writes are counted in explicit in-memory mocks.

Fixture-only rendering substitutes inert local logo/hero placeholders, omits Google Fonts, and replaces Stripe's eager loader with a fail-closed stub. Vite's CSS helper is retained without its development reconnect socket. These are declared fixture boundaries, not production changes or evidence of those providers' runtime behavior. Curated before/after visuals retain their documented original capture provenance; final gate captures are available in CI artifacts.
