# Mission 1 — Payment / inventory safety

> Historical implementation and command ledger, retained for comparison. The pre-merge audit rejected the Base44 claim protocol and found a checkout/release race and incomplete recovery. The current repair and its unresolved deployment dependencies are documented in [MISSION_1_AUDIT_REPAIRS.md](./MISSION_1_AUDIT_REPAIRS.md). Claims of remediation below describe the earlier implementation, not current merge readiness.

Inspection baseline: `d7673a9`, `mileswallace06/peanutgalleryfinal`, branch `astra/launch-readiness`.

The seller-expiry defect and correlated release bypasses are remediated locally. This is not a production deployment or a certification of Base44 datastore atomicity. The launch gate remains red. The ten-minute capture-window blocker was not changed.

## Root cause and before/after behavior

The deployed `processTransferReminders` handler caught Stripe retrieval/cancellation failures and then expired the purchase, cleared both reservation records, and set the listing active. It did not establish current purchase ownership, did not retrieve Stripe after cancellation, and returned success even after failed writes. The separately tested reminder orchestrator was not the deployed implementation.

The new regression suite first executed the actual handler against a failing Stripe mock and failed because the listing became `active`. After remediation, the same test passes: the purchase stays pending, the reservation is preserved, a verified recovery block and operational alert are attempted, and the worker returns HTTP 500.

All ordinary seller-expiry, checkout-abort and buyer-cancellation release paths now share `expirePurchaseSafely` and `verifyPaymentRelease`:

1. Require an unambiguous private purchase record and matching listing/buyer/token identity. Synthetic canary purchases remain owned by their Postgres authority.
2. Acquire and re-read an exclusive conditional claim on `PurchasePrivate`. Persist the intent before provider work and preserve the original reservation and settlement evidence for reconciliation.
3. Check both reservation records, the linked purchase, other pending purchases, fulfillment state, and seller pause/cancel intent.
4. Retrieve the latest PaymentIntent. For cancellable states, use a stable cancellation idempotency key and retrieve again, including after exceptions/lost responses. Only a verified `canceled` state permits release.
5. Captured seller expiries remain blocked for review; this task did not introduce automatic seller-expiry refunds. An already fully refunded charge can be verified. The existing buyer-cancellation refund policy uses a stable refund key, rejects existing partial/pending refunds, and verifies the PaymentIntent and full charge refund after the attempted action.
6. Recheck ownership after provider I/O and immediately before tuple writes. Reuse `applyReservationTuple`, with the original tuple and conditional writes to each record; never copy an older tuple over a newer one.
7. Verify release and purchase expiry, then persist completion. Completed retries do not repeat provider or inventory effects.
8. On failure, preserve reservation fields, persist recovery evidence, use the existing `durableBlockAndAlert` primitive, and report a non-successful result. Failed or ambiguous alert persistence retains the claim instead of risking a duplicate alert create.

## Correlated paths inspected

| Path | Action |
|---|---|
| Production seller expiry and shared reminder orchestrator | Replaced unsafe expiry/relist sequence with the common verified workflow. Failed expiries remain eligible beyond the former 72-hour query window. |
| Production and shared checkout abort | Removed swallowed payment errors and buyer-OR-token release. Uses the same verified workflow; seller-confirmed fulfillment cannot be released. |
| Production and shared buyer cancellation | Uses the same verification and ownership checks. Existing post-transfer dispute behavior remains. Successful API response remains `cancelled`. |
| Generic reservation release | Rejects payment-bound or unresolved pending-transfer reservations. Unpaid releases use conditional tuple writes and preserve competing ownership. |
| Reminder orphan/active reservation sweeps | Failed lookups no longer mean no purchases. Payment-bound/unknown pending-transfer reservations cannot bypass the purchase workflow. |
| Inventory entity automation | Hidden payment quarantines preserve inventory custody instead of mapping to `available`. This also protects quarantines created by existing capture/webhook/abandoned-checkout recovery. |
| Account deletion | Blocks unresolved payment/reservation obligations before mutation. Removed best-effort Stripe cancellation followed by removal of ownership/recovery evidence. Obligation reads are paginated. |
| Abandoned-checkout recovery | Inspected. Phase 1 quarantines rather than directly relisting; Phase 2 re-reads Stripe, requires safe recovery conditions and null reservation snapshots. No separate financial rewrite was made. |
| Capture/webhook reconciliation | Inspected and regression-tested; existing freeze/finalize model retained. |
| Seller listing management | Inspected existing reservation, pending-transfer/sold, quarantine, and seller-intent protections; no unrelated changes. |

## Files changed

New shared modules:

- `base44/shared/paymentRelease.js`
- `base44/shared/purchaseExpiry.js`

Existing shared modules using or supporting the guarded flow:

- `base44/shared/abortOrchestrator.js`
- `base44/shared/cancelOrchestrator.js`
- `base44/shared/remindersOrchestrator.js`
- `base44/shared/releaseOrchestrator.js`
- `base44/shared/tupleTransition.js`

Deployed entry wrappers and inventory boundary:

- `base44/functions/processTransferReminders/entry.ts`
- `base44/functions/abortCheckout/entry.ts`
- `base44/functions/cancelPurchase/entry.ts`
- `base44/functions/releaseReservation/entry.ts`
- `base44/functions/deleteAccount/entry.ts`
- `base44/functions/syncInventoryOnListingChange/entry.ts`

Schema additions:

- `base44/entities/PurchasePrivate.jsonc`: claim, start/completion timestamps and durable evidence.
- `base44/entities/ListingPrivate.jsonc`: ownership of a payment-release recovery block.

Verification and documentation:

- `tests/seller-expiry-safety.test.mjs`: new offline handler and failure/concurrency regression suite.
- `tests/helpers/mockDeps.mjs`: conditional-write support for the mock datastore, including missing-field predicates and silent-write simulation.
- `tests/mutation-paths.test.mjs`: corrected success fixtures, retaining all success assertions. Unpaid release fixtures now have no purchase; the abort success fixture has no seller transfer; seller expiry supplies a retrievable mock PaymentIntent. New tests explicitly cover rejection of the former unsafe conditions.
- `tests/run-all-suites.mjs`: adds the regression suite as required; retains every previous suite and failure classification.
- `package.json`: adds `test:payment-inventory` and runs it before existing launch-script checks. Lockfile unchanged.
- This report.

## Regression coverage

34 passing cases cover the actual production reminder handler, abort, cancellation, generic release, inventory automation and deletion boundary, plus shared workflow interleavings. Platform authentication/data access and Stripe are mocked; request-controlled test bypasses were not added to production.

Coverage includes Stripe retrieval failure, cancellation failure, misleading cancellation response, failed verification read, lost response, missing Stripe configuration, newer reservations before/during cleanup and between writes, another active purchase before/at release, already-cancelled retry, captured seller expiry, already-refunded payment, verified buyer refund, partial/pending/unverified refunds, duplicate successful/failing workers, alert write failure, unpersisted claim, recovery retry, later-page obligations, expiry older than 72 hours, and synthetic-canary isolation.

## Command and result ledger

All commands ran locally. Read-only inspection also used `git remote -v`, `git branch --show-current`, `git status --short`, `git diff`, `git diff --stat`, `git diff --numstat`, `rg`, `sed`, `cat`, `tail`, and `node --version` / `npm --version`. Versions: Node 22.19.0, npm 10.9.3. File edits used patches and local Python transformations; no deployment, push, merge or database command was run.

| Command | Result |
|---|---|
| `node --experimental-vm-modules tests/seller-expiry-safety.test.mjs` | Initial regression failed on the actual unsafe `active` transition. Iterative failure/race cases guided the fix; final 34/34 pass. |
| `npm run test:payment-inventory` | 34/34 pass. |
| `node tests/payment-reconciliation.test.mjs` | 17/17 pass. |
| `node tests/payment-webhook.test.mjs` | 21/21 pass. |
| `node tests/checkout-concurrency.test.mjs` | 58/58 pass. |
| `node tests/mutation-paths.test.mjs` | Final 12/12 pass. Initial invalid success fixtures were corrected as documented above; assertions retained. |
| `node tests/process-transfer-reminders-wiring.test.mjs` | 5/5 pass. |
| `node tests/freeze-completeness.test.mjs` | 21/22 pass; pre-existing function-count assertion fails (51 deployed function directories). Same failure on untouched baseline. |
| `node tests/listing-status-ownership.test.mjs` | Pre-existing registry reference to missing `base44/functions/migrateSensitiveData/entry.ts` fails. Same failure on untouched baseline. |
| `node tests/launch-gate.test.mjs` | 12/14 pass; existing production-integration and concurrent-alert-duplication blockers remain. |
| `npm run test:launch-gate` | New suite passes, then existing freeze-count failure stops the chained script. The launch-gate file was therefore also run directly. |
| `npm test` | All 22 suites executed. 18 suites pass; three required suites fail (freeze count, ownership registry, launch gate), plus the existing nonblocking concurrent-alert limitation suite. No newly introduced failing suite. |
| `npm ci --ignore-scripts --cache /private/tmp/pg-remediation-npm-cache --no-audit --no-fund` | First sandboxed attempt failed resolving npm registry hosts. Approved retry succeeded, installing 656 locked dependencies with lifecycle scripts disabled. |
| `npm run build` | Pass. Expected warning: no Base44 app/backend environment configured. Build was not opened against a production backend. |
| `npm run lint:backend` | Exit 0; repository warnings remain. |
| `./node_modules/.bin/eslint base44/shared/{purchaseExpiry,paymentRelease,abortOrchestrator,cancelOrchestrator,remindersOrchestrator,releaseOrchestrator}.js base44/functions/{abortCheckout,cancelPurchase,processTransferReminders,releaseReservation,deleteAccount,syncInventoryOnListingChange}/entry.ts --max-warnings 0` | Pass, zero errors/warnings in the targeted modules/wrappers. |
| `npm run typecheck -- --noEmit` | Exit 2, 192 existing frontend errors. Exact output matches the untouched baseline (`cmp` succeeds). No frontend or typecheck-config files changed. |
| `git archive --format=tar HEAD` | Read-only baseline exported into `/private/tmp/pg-mission1-baseline`, sharing installed dependencies. Freeze, ownership and typecheck were rerun there to establish existing failures. The initial Python extraction invocation used an unsupported `filter` argument; corrected extraction succeeded. |
| `cmp /private/tmp/pg-baseline-typecheck.log /private/tmp/pg-mission1-typecheck.log` | Exit 0: identical diagnostics. |
| `git diff --quiet -- src/pages src/components jsconfig.json` | Exit 0: those files unchanged. |
| `git diff --check` | Pass. |

The aggregate runner also reran legacy revision, durable recovery, partial finalization, post-clear verification, post-prefetch concurrency, tuple invariants, authority concurrency/adversarial, correction rounds 5/6/6B, submission test authorization and authority-contract suites; all passed.

## Operational limits and remaining launch blockers

- Conditional Base44 `updateMany` is the same empirically tested single-record primitive used by the existing authority prototype. Local tests model atomic predicate/write behavior. This task does not turn that into a vendor guarantee or make multiple Base44 records transactional. Production authority integration remains a launch blocker.
- Deploy the added entity fields together with the functions in a separately authorized deployment. If claims/evidence do not persist, cleanup fails closed. No schema migration or Base44 deployment was performed here.
- A crash or ambiguous alert write leaves a non-stealable claim and durable evidence. An operator must reconcile provider state, prove the old worker cannot resume, inspect alert persistence and any partial local writes before releasing that claim. Automatic lease stealing would risk duplicate effects. A batch exceeding 10,000 matching rows fails closed for review.
- Other legacy writers and the general alert helper still lack global transactional coordination. This change serializes this purchase-release workflow; it does not claim global alert uniqueness or repair the separate reservation-acquisition blocker.
- Account deletion now requires unresolved obligations to be settled first. Success notifications retain best-effort delivery; financial completion is not rolled back for a notification failure.
- Unchanged backlog: ten-minute capture/fulfillment mismatch; non-atomic ordinary reservation acquisition; scheduler authentication that accepts missing sessions; disabled proof scanning/review; incomplete production integration evidence, absent checked-in CI, and general concurrent alert duplication.
- Additional pre-existing verification debt confirmed during this mission: stale function-count/ownership-registry tests and 192 frontend type errors. These were not weakened, suppressed or repaired through unrelated changes.

No production/Base44/customer data was read or changed. No live credentials were used, no real financial transaction occurred, and no Stripe/Base44 external request was made. Network access was limited to downloading locked npm dependencies. Nothing was pushed, merged or deployed.
