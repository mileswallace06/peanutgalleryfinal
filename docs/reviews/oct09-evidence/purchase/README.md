# Seller transaction detail and history evidence

Comparison base: `c31a2e1aa9f9c7d7916908ab948201cfad3243a8`. All records, identities, amounts and events in this directory are synthetic. No live application or financial endpoint was contacted.

## Diagnosis and changes

- **N04 — reproduced and repaired locally.** The original `PurchaseSuccess` route inferred the viewer from legacy email fields while its summary and entry guidance always used buyer wording. Missing event/listing reads silently left a generic heading, with no full transaction reference in the body. The baseline was reproduced before editing in both themes, and can be replayed from the exact comparison commit with `--baseline`.
- The route now resolves the existing `getPurchaseParticipantView` response before any metadata read. Its explicit `viewer_is_seller` / `viewer_is_buyer` fields determine the perspective; an authorized nonparticipant admin gets a neutral transaction view. A denied, failed, mismatched or signed-out purchase never hydrates event/listing metadata.
- Completed history uses the existing participant listing view and ordinary event read. Full authorized references, available event/date/seat details, and independent loading/missing/error messages are visible. Retry recovers authorized context. Buyer **Order total** stays distinct from **Recorded seller amount**; payment capture never asserts a bank deposit. Absent/nonfinite amounts are unavailable.
- **R12 — missing isolated coverage added, no new list defect found.** Event hydration failure and a successful keyboard/pointer retry preserve two same-date, same-amount full sale references.
- **R13 — missing isolated coverage added.** Finite/zero/null/undefined/NaN/infinite/string seller amounts, demo and incomplete transfers are tested. The real participant handler executes against in-memory entities to verify caller identity, safe fields, its stable 500-record limit, and demo exclusion from the completed seller summary. No financial handler executes.
- **R17 — UI-state coverage added; timing policy remains owner-blocked.** Checking, failed/retry, disconnected-shaped and charge-ready-but-missing-payout-readiness responses remain honest without starting onboarding. Existing guide/FAQ/confirmation timing claims are unchanged.

## Existing pending-transfer dependency

The participant serializer intentionally omits contact/proof fields used by the existing transfer workflow. Pending buyer/seller views therefore retain their pre-existing **user-scoped** `Purchase.filter({ id })` read, only after the authoritative participant endpoint authorizes the exact record. Legacy fields cannot establish role or override the allowlisted transaction values. Failed or missing transfer context withholds action panels and offers retry. No service-role client, private entity query, new field exposure or backend authorization change was added. This remaining legacy workflow dependency belongs to the separate purchase-security workstream. Tests do not execute confirmation, capture, cancellation, refund, proof upload or payout setup actions.

## Commands and scope

```sh
node --import ./tests/deny-network.mjs --test tests/purchase-detail.test.mjs tests/sales-admin-presentation.test.mjs tests/audit-workflow-semantics.test.mjs
npx eslint src/pages/PurchaseSuccess.jsx src/lib/purchaseDetailRead.js
node tests/purchase-detail-browser.mjs --baseline
node tests/purchase-detail-browser.mjs
```

Offline result: 27 passing assertions across those three files, zero failed/skipped. New focused file: seven tests. Browser harness uses its own port 4188, fail-closed SDK and CSP, blocks outbound origins, and disables Vite HMR/watching. Set `PG_CHROMIUM_PATH` and `PG_CHROMIUM_ARGS` when a bundled Chromium is required. The baseline flag serves only the original purchase component from the pinned commit; it never overwrites repository files.

Browser matrix: ordinary seller and buyer, populated/sparse, light/dark at **1180×757, 320×844, 375×844, 390×844, 430×844, 1280×844, and 844×390 landscape** (56 cases), plus two-theme loading/read-error/recovery, stable-reference, guest/unauthorized/admin, My Sales recovery and payout-state checks. `after-result.json` records checks and errors. This is Chromium emulation with the actual route components and styles, synthetic data and locally available fallback fonts; no physical-device or full app-shell certification is claimed.

Screenshots pair baseline seller sparse views with repaired seller/buyer sparse/populated views at desktop and 390 pixels. Timing copy visible in the screenshots remains intentionally unresolved pending owner approval.
