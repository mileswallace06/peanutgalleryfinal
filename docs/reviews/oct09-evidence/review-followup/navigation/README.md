# Upgrades request restoration repair

Review baseline: `3a56073ba06f9f25b42844d2ca67068dafd4c554`. The source hashes identify the repaired working-tree files exercised here; no separate commit is claimed.

## Observed defect and repair

After three Phoenix pages (120 cards), switching to Live, selecting Boston, waiting for its completed empty result, and going Back restored only the first Phoenix page (40 cards). The history snapshot still contained three pages. The previous-render request caused the restoration effect to discard that snapshot immediately after starting its replacement request.

The page now ties the snapshot to the discovery hook's existing request generation. It waits through the old render, continues all saved pages, and discards restoration when a newer request supersedes it. A queued scroll/focus callback also checks the request generation. A related pre-existing condition also stopped as soon as an early-page target appeared, despite a deeper saved snapshot; restoration now reaches the saved depth before focusing that target. Owned-ticket targets remain excluded from discovery pagination. No production SDK call or backend behavior changes.

## Evidence

- `before-report.json`: the exact baseline source override fails with **40 !== 120** and the deep target absent. Exit 1 is the expected red result.
- `before-early-target-report.json`: a first-page target survives detail reload and Back, but the baseline stops at **40 !== 120** cards and loses the deep target. Exit 1 is the expected red result.
- `after-report.json`: **6 cases passed**, covering completed cross-city Back, early-page target restoration after detail reload, and deliberately delayed stale responses in dark and light themes at 390 × 844.
- The stale-response case holds both Phoenix provider reads, completes a newer Boston request, and then releases the old reads. Boston remains the only result; the old restoration does not start another page.
- Both reports contain zero attempted outbound requests and zero browser page errors. The fixture rejects production SDK imports and unexpected SDK operations. Synthetic reads only; no real user, provider, inventory, purchase, or payment action was performed.
- Existing `oct09-discovery-navigation-browser.mjs` passed unchanged: Events repeated queries, real Back/Forward, explicit detail Back, reload, fresh direct visits, sort/filter behavior, and Upgrades continuation depth.
- Scoped ESLint passed. `oct09-discovery-state.test.mjs` plus `upgrades-owned-navigation.test.mjs`: **11 passed**.

## Commands

Run from the repository root with the installed Playwright browser, or supply `PG_CHROMIUM_PATH` and `PG_CHROMIUM_ARGS` for the local runtime. Local evidence used Chromium 153 with `--no-sandbox` and `--disable-dev-shm-usage`.

```sh
PG_EXPECT_BEFORE=1 node tests/upgrades-history-request-browser.mjs
PG_EXPECT_BEFORE=1 PG_UPGRADE_HISTORY_BASELINE_CASE=early-target node tests/upgrades-history-request-browser.mjs
node tests/upgrades-history-request-browser.mjs
node tests/oct09-discovery-navigation-browser.mjs
npx eslint src/pages/Upgrades.jsx src/hooks/useSellingDiscovery.js tests/fixtures/events-search/base44.js
node --test tests/oct09-discovery-state.test.mjs tests/upgrades-owned-navigation.test.mjs
```

The baseline override reads only the two production navigation files from the recorded commit; the current fail-closed fixture and new assertions remain identical between red and green. Runtime reports/screenshots go to ignored `tests/artifacts/oct09-review/navigation`, or `PG_UPGRADE_HISTORY_EVIDENCE_DIR`. This is synthetic browser evidence, not production provider behavior or mobile-device certification.
