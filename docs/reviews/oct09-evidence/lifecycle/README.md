# R04 lifecycle and R05 lookup evidence

Comparison base: `c31a2e1aa9f9c7d7916908ab948201cfad3243a8` (reviewed main). Before screenshots were captured from that source before the lifecycle repairs. After screenshots and passing checks were captured from the repair working tree on `codex/pg-oct09-regression-repairs`, still based on that commit. They are working-tree evidence, not a separately committed or deployed SHA. The PR's final verification record identifies the eventual tested commit.

All data, identities, reads, and successful writes below are synthetic local fixtures. Chromium `153.0.8010.0` ran against `127.0.0.1:4187`, with reduced motion and outbound requests blocked. These are actual browser viewports, not a claim that a narrow centered column is a phone viewport.

## Before and after screenshots

Every image in this table was captured at **1180 × 757**. `user` means an ordinary member, distinct from the admin fixture. Paths are simulated production routes inside the isolated MemoryRouter.

| Surface / route | Role | Theme | Before | After |
|---|---|---|---|---|
| Native detail `/events/fixture-live` | Admin | Light | [First-sale invitation](before-native-ended-admin-light.png) | [Closed listing entry](after-native-ended-admin-light.png) |
| Native detail `/events/fixture-live` | Admin | Dark | [First-sale invitation](before-native-ended-admin-dark.png) | [Closed listing entry](after-native-ended-admin-dark.png) |
| Provider detail `/events/tm/tm-fixture-live` | Ordinary member | Light | [First-sale invitation](before-provider-ended-user-light.png) | [Closed listing entry](after-provider-ended-user-light.png) |
| Provider detail `/events/tm/tm-fixture-live` | Ordinary member | Dark | [First-sale invitation](before-provider-ended-user-dark.png) | [Closed listing entry](after-provider-ended-user-dark.png) |
| Hub `/upgrades/fixture-live`, Fan Gifts | Admin | Light | [Drop / Offer entry](before-hub-ended-admin-light.png) | [Closed fan-gift entry](after-hub-ended-admin-light.png) |
| Hub `/upgrades/fixture-live`, Fan Gifts | Admin | Dark | [Drop / Offer entry](before-hub-ended-admin-dark.png) | [Closed fan-gift entry](after-hub-ended-admin-dark.png) |

The screenshots establish visible copy and control availability only. The header logo is unavailable in the isolated fixture; no live asset was fetched to fill it. The browser result records six baseline checks and 45 repaired checks. The after run produced ten screenshots; this folder curates the six directly comparable screenshots above. Four additional draft/lookup screenshots remain in the local test artifact directory and are not included in this curated set.

## Diagnosis and verified result

Native detail's admin/unlocked empty-state branch bypassed its ended-event presentation. Provider detail discarded end/status fields and did not guard its selling invitation. Fan Gifts exposed Drop/Offer without lifecycle eligibility. Normal creation now uses the same closure predicate as the existing listing form, including exactly at the end instant. Unknown timing remains unknown rather than being turned into an invented end.

The existing Flash Drop create handler lacked an ended-event check. [Baseline backend log](baseline-backend.txt) records the pinned base handler returning HTTP 200 and three **mocked** inventory/drop writes at the exact end for both ordinary member and admin. The repaired handler checks authorized event data early, then reads it again immediately before the first inventory write after the awaited ownership/rate checks. Both reads fail closed for missing, failed, or ended records. The final read catches status or end-time changes during validation as well as an elapsed clock boundary. Tests assert HTTP 409 and zero writes at/after the end, plus zero writes for denied guest, maintenance, missing-event, failed-read, and stale-draft paths. The baseline harness overrides `Date.now`; unrelated generated timestamps in its log use the runner's date and are not production timestamps.

R05's targeted coverage verifies eligible listing selection, error/retry recovery, visible status, and a synchronous duplicate-submit attempt. The repaired component issues one fresh event read and one local-only scheduled create while the first submission is pending. Selection and lookup are not treated as conclusive ownership approval.

## Commands and results

Run from the repository root:

```bash
node --import ./tests/deny-network.mjs --test \
  tests/oct09-lifecycle.test.mjs \
  tests/flash-drop-dialog.test.mjs \
  tests/listing-event-lifecycle.test.mjs \
  tests/flash-drop-read-view.test.mjs \
  tests/upgrade-route-clock.test.mjs \
  tests/event-date-display.test.mjs
```

Result: **80 tests passed, 0 failed, 0 skipped**. [Exact focused log](final-focused-unit.txt).

```bash
PG_CHROMIUM_PATH=/workspace/scratch/580f2607a348/browser-runtime/executable/chromium-oct09 \
PG_CHROMIUM_ARGS='["--no-sandbox","--disable-dev-shm-usage"]' \
LD_LIBRARY_PATH=/workspace/scratch/580f2607a348/browser-runtime/executable:/workspace/scratch/580f2607a348/browser-runtime/executable/al2023/lib \
FONTCONFIG_PATH=/etc/fonts \
node tests/oct09-lifecycle-browser.mjs
```

Result: **45 repaired browser checks passed**, zero runtime errors and zero external requests; ten screenshots captured. [Exact browser log](final-browser.txt) and [after result](after-result.json). The browser runner starts its own fixture server and requires an available local Chromium; the executable and library paths above describe this execution environment.

The before capture used `PG_LIFECYCLE_CAPTURE=before` with the same runner while the production components were still at the comparison base: **6 reproduction checks passed**, six screenshots. This mode checks the pre-repair defect and is not expected to pass against repaired components. [Before result](before-result.json). Both result files are preserved as emitted, including original local screenshot paths.

## Coverage limits and retained boundaries

- Browser checks exercise guest gates, member/admin before/exact/after states, native/provider/hub/direct-form entry, a drop draft crossing its boundary, fresh-ended and failed-read recovery, unknown timing, eligible lookup/error/retry, and duplicate submission. Most functional checks use 1180 × 757; lookup recovery uses a real 390 × 844 viewport in both themes. This group does not claim a complete mobile/device or screen-reader audit.
- Server tests execute the actual handler in an offline VM with fake SDK records and mutation counters. They establish local source behavior, not deployment, production authorization, atomicity, or payment correctness.
- Existing `submitListing` admin/test exemptions remain unchanged. No new admin exemption was added to normal Flash Drop creation. The existing unknown-timing admission behavior is preserved.
- Client-side duplicate suppression is not a new server idempotency or transactional guarantee. Existing ownership, maintenance, rate, and purchase-security policy remain separate.
- No production calls, uploads, listing/drop publication, scheduling, financial operations, permission changes, deployment, or merge occurred. No source snapshot of the entire baseline handler is copied into this evidence folder.
