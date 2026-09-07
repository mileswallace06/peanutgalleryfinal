# Mission 1 audit repairs — local acceptance record

> Historical shared-code stage. The subsequent authorized local handler integration and current acceptance status are recorded in [MISSION_1_HANDLER_INTEGRATION.md](MISSION_1_HANDLER_INTEGRATION.md). The stage-specific findings and baseline failure ledger below are preserved.

Repository: `mileswallace06/peanutgalleryfinal`. Branch: `astra/launch-readiness`.
Baseline/HEAD: `d7673a973d9d55cd51ce549f71f9488020cb6d93`. Work completed across 2026-09-05–06.

**BLOCKED for merge/deployment.** The repaired shared orchestration and PostgreSQL functions pass local tests. Production entry points, production authority coverage, the ordered Base44 projector and schema rollout are not proven. All 51 production `entry.ts` files were hashed before this follow-up and preserved, including the six already modified by the earlier Mission 1 implementation. Nothing was committed, pushed, merged or deployed. Mission 2 was not started.

## Acceptance matrix

| Reproduced defect | Local fix | Evidence | Remaining concrete dependency |
|---|---|---|---|
| Checkout creates Purchase/PP after release's negative lookup | `m1_begin_checkout` durably admits checkout before PI or Purchase creation. Admission, binding and release use the same `reservation_authority` row lock. Negative Base44 reads are only additional drift checks. | Exact audit interleaving; two actual PostgreSQL connections, both lock acquisition orders; bound-payment release/expiry rejection. | D1: ordinary production writers must use this authority. |
| Unpaid release becomes available before its mirror write finishes | Release and pending projection ownership commit together in the existing operation/outbox tables. Canonical checkout remains blocked until worker acknowledgement. Old reminder tuple categories fail closed. | Unpaid projection-gap test, unchanged unpaid-release success assertions, real unwired reminder handler test. | D1/D2: coordinator wiring and ordered projector. |
| Retained claim / crash before action cannot recover | PostgreSQL owns the claim and increments a recovery epoch. Recovery before dispatch fences the previous owner. Base44 claims no longer establish exclusion. | Retained claim, pre-dispatch crash, stale epoch and legacy-worker-fencing tests. | D1/D3: trusted recovery invocation and verified draining/fencing of old implementations. |
| Financial settlement happens before persistence | Persist dispatch identity before the action; keep its stable Stripe key. After a dispatch, recovery only retrieves provider state. Terminal verification and authority release/outbox insertion commit in one transaction. | Settlement-before-persistence, outbox failure rollback, lost response and duplicate-worker tests. | D1: same-database executor/recorder clients; no actual Stripe execution was tested. |
| Inventory release happens before Purchase/completion writes | Original purchase/PI/tuple snapshot is already durable. The operation stays `committed` and authority remains blocked until all mirror writes are verified. Retry starts from this context, including cleared mirror halves. | Release-before-completion reproduction, fresh retrieval failure on committed retry, missing projection receipt, stale worker resuming after a newer reservation. | D2: production projector and verified persistence/ordering. |
| Captured seller-expiry quarantine has no recovery route | `reconcilePaymentRelease` recognizes a freshly retrieved, independently fully refunded charge. It does not initiate seller-expiry refunds. Alert resolution does not change authority eligibility. | Captured quarantine → alert resolved → still blocked → independent full refund → completed; partial/unverified refunds stay blocked. | D1/D2: trusted recovery worker/admin integration and projection. Existing alert/refund UI is insufficient. |
| Missing completion marker blocks historical account deletion | Reconcile historical provider state and record durable settlement. Cancelled and fully refunded obligations can settle without the new marker. Completed sales require fresh `succeeded` verification and cannot promote an unfinished canonical capture to finalized. | Cancelled, refunded with captured flag, unresolved, completed-sale and provider-outage historical tests. | D1: deletion handler must pass trusted Stripe/authority dependencies and retain the canonical obligation check. |
| Admission interrupted before PI identity or Purchase persistence | Persist the creation key and operation identity first; put operation identity in PI metadata. `reconcileCheckoutAdmission` accepts only an independently identified terminal PI, then creates a blocked projection checkpoint. A stale admission cannot create a replacement PI under a retry key. | Lost PI identity/attachment, unresolved-provider refusal, stale attach/bind rejection and missing projection tests. | D1/D2: trusted discovery/recovery invocation and partial-Purchase projection. Unknown PI identity remains blocked. |
| Base44 conditional-write probes were treated as exclusion evidence | Removed the Base44 claim state machine. Reuse the approved PostgreSQL authority, binding, action, unique incident and outbox tables. | Actual local PostgreSQL 18.4 transactions, row-lock waits, rollback, role boundaries and SQL NULL persistence. | D3: schema-first rollout and actual platform evidence. Local tests are not production exclusion evidence. |

## Authority and recovery contract

The architecture remains the one selected in `ATOMICITY_ARCHITECTURE_DECISION.md`: PostgreSQL stored functions through restricted clients; Base44 holds projections. No new payment-state enum, Base44 lock service or second payment authority was introduced. The JSON `phase` is a workflow checkpoint in the existing operation ledger; payment settlement still uses the existing binding states and action ledger.

Checkout now records its admission before creating a PI or either Base44 purchase row. Its creation idempotency key is durable and belongs to that admission. It attaches the PI identity before Purchase creation and calls the existing `bind_payment_intent` through the same locked authority before returning a checkout. `release_listing` and `expire_listing` acquire the same row lock before checking admissions, release ownership and unsettled bindings. The exact audit interleaving is exercised after the negative PurchasePrivate read, with a real admitted/bound checkout appearing before release continues.

Purchase cleanup persists `m1-release:<purchase_id>`, original identity/tuple, owner and epoch before financial work. A single dispatch records the action, stable Stripe key and `recovery_dispatch_started=true`. Its action lease is infinite intentionally: the generic expired-action worker cannot grant another dispatch. Time passage and manual Base44 claim clearing do not confer any authority.

Before dispatch, a trusted recovery invocation can replace ownership and increment the epoch; the old owner cannot dispatch. After dispatch, a replacement can only retrieve provider state. An old worker may still finish its already-authorized provider request, but cannot persist a release after being fenced. No replacement financial command is issued; recovery cannot make inventory eligible while the provider remains unresolved. A test pauses the old worker after dispatch, independently settles the PI, completes recovery, admits a newer reservation and then resumes the old worker. The old worker cannot overwrite it. Real Stripe behavior and production worker fencing have not been exercised.

Terminal provider evidence, binding settlement, canonical release, durable snapshot and the projection outbox event commit atomically. The listing may have canonical lifecycle `available` while `recovery_blocked` and `checkout_quarantined` remain true: that combination is **not eligible for checkout**. PostgreSQL reservation admission checks those flags. Only an ordered worker's verified projection acknowledgement clears them. A failed or missing receipt returns a non-success result. A failure writing the incident does not release the durable claim or report that the alert exists. There is one canonical incident key; Base44 AdminAlert remains a non-authoritative projection and is not newly claimed to have global uniqueness.

### Concrete operator recovery sequence (not executed)

1. Use the restricted executor to read `m1_release_context(purchase_id)` and the existing pending outbox/incident evidence. Retain the purchase, listing, PI, original tuple, action key, phase and epoch. Do not clear claims or resolve an alert as a substitute for settlement.
2. For retained **legacy Base44** claims, first establish that old workers cannot resume with mutation capabilities. A configured `legacyWorkersFenced` fact must come from that verified rollout, never request JSON or a timeout. It is not established in this workspace.
3. Invoke the shared `reconcilePaymentRelease` through a trusted recovery worker/admin integration. A prepared, undispatched action can proceed with a new epoch; a dispatched action is read-only reconciliation. A cancelled PI needs no new cancellation. Lost settlement responses are recovered by fresh reads.
4. For a captured seller expiry, review ownership, fulfillment and the existing refund policy. Any independent refund requires separate operator authorization. Once Stripe independently shows the same charge's `refunded=true`, a positive original amount, and `amount_refunded === amount`, invoke recovery again. Partial/pending refunds and unresolved states stay blocked. A seller-confirmed/delivered purchase or conflicting seller intent still requires its existing fulfillment review; this cleanup function does not override it.
5. On `committed`, the ordered outbox worker must reconcile Listing, ListingPrivate, Purchase, PurchasePrivate and inventory projection from the durable snapshot, re-read every required field, and acknowledge the exact operation/version. It must safely resume partial writes and fence old projection attempts. Then the canonical context becomes `completed`. Request handlers may wait for this receipt without receiving worker credentials.
6. For an interrupted checkout admission, use `m1_operation_context(operation_id)` and its PI creation key/metadata. Pass the independently discovered PI to `reconcileCheckoutAdmission`. Empty search results or an expired timeout do not prove that no PI exists. Terminal evidence can queue recovery of partial Purchase/PP rows; absent identity stays blocked for discovery.

The callable recovery modules and SQL exist locally. A production admin control/invocation and the ordered projector do **not** exist for these new checkpoints. Existing alert resolution only updates the alert. The existing captured-payment guard in the cancellation UI/handler is not a substitute for the trusted recovery invocation. These are concrete integration blockers, not a claim that current support tooling can complete the sequence today.

## Schema-first rollout and platform evidence

No Base44/Neon production environment, production schema, data or credentials were accessed. Repository evidence does **not** establish whether Base44 GitHub sync deploys entity changes, what ordering it uses, or whether a separate editor/CLI action is required. Those behaviors are **UNVERIFIED**. The older Base44 CAS probes do not establish a supported atomicity contract and are not acceptance evidence here.

New PostgreSQL fields in `001b_mission1_fields.sql`:

| Table in `authority_v1` | Field | Type / default | Required by |
|---|---|---|---|
| `reservation_authority` | `checkout_operation_id` | nullable TEXT, default NULL | Admission, binding, ordinary release exclusion and interrupted-admission recovery |
| `reservation_authority` | `payment_release_operation_id` | nullable TEXT, default NULL | Cleanup ownership, release exclusion and exact projection acknowledgement |
| `reservation_operations` | `recovery_owner` | nullable TEXT, default NULL | Claim/recovery fencing |
| `reservation_operations` | `recovery_epoch` | BIGINT NOT NULL, default 0 | Reject stale dispatch/persistence |
| `reservation_operations` | `recovery_evidence` | nullable JSONB, default NULL | Identity, original snapshot, provider evidence and all interrupted-write checkpoints |
| `reservation_operations` | `recovery_dispatch_started` | BOOLEAN NOT NULL, default false | Irrevocable single-dispatch boundary |

The five Base44 fields already present in the starting Mission 1 working tree remain optional **string** fields with **no declared defaults**:

| Entity | Field | Current role / absence behavior |
|---|---|---|
| PurchasePrivate | `cleanup_claim` | Legacy claim / operational mirror only. Retained old values require verified old-worker fencing; clearing never grants ownership. |
| PurchasePrivate | `cleanup_started_at` | Legacy/operational timestamp, not an expiry or lease authority. |
| PurchasePrivate | `cleanup_completed_at` | Projection completion evidence. Missing values trigger reconciliation, not automatic success or permanent historical rejection. |
| PurchasePrivate | `cleanup_evidence` | Operational mirror; canonical durable evidence is PostgreSQL JSONB. |
| ListingPrivate | `cleanup_purchase_id` | Operational ownership mirror; canonical authority uses the release operation ID. |

The production projector must persist and re-read the completion and ownership fields; a dropped write must not yield a verified receipt. Clearing a field must actually clear it, rather than omit an update or retain the old value. Required clears include the existing reservation token/buyer/expiry fields, the legacy claim and cleanup ownership mirror, and quarantine/recovery fields. SQL NULL behavior for the new PostgreSQL fields is tested locally. **Base44 explicit-null acceptance and persistence, including these optional string schemas, are UNVERIFIED.** A string schema is not evidence that the deployed API accepts null. The separately authorized schema action must resolve and verify this contract before enabling code that depends on it.

Required rollout order, for a later authorized change:

1. Fence/drain conflicting old writers. Establish same-database, role-restricted clients and authoritative listing/payment coverage; reconcile legacy bindings without treating mirrors alone as truth. No automatic production backfill was added or run.
2. Apply PostgreSQL `001b` **before** the changed release/expire functions in `002` and the new `005` routines. Fresh local installation order tested: `001`, `001b`, `002`, `002b`–`002f`, `003`, `004`, `005`. Existing-install migration must use the established migration owner and verify its permissions; `005` preserves the executor/recorder/worker boundary and the `neondb_owner` ownership convention.
3. Deploy/verify the required Base44 schema through its actually supported mechanism. Verify create/update/read persistence, explicit null clearing, and retained historical rows in an authorized non-production environment. GitHub sync ordering remains unverified; do not assume code and schema arrive together.
4. Install and verify the ordered projection/recovery worker, then enable the coordinated handlers only when authority coverage and projection fencing are proven. Prevent newer admissions until the exact operation's projection is complete. Do not use a worker timeout or a Base44 conditional-write probe as proof that a delayed old projector cannot resume.

If code precedes the SQL fields/functions, authority calls fail before financial dispatch. If schema/projection dependencies are absent, cleanup remains blocked and checkout/deletion can be unavailable. That is financial fail-closed behavior, **not a safe merge or rollout plan**. Missing-field fail-closed behavior is tested locally; actual production schemas remain unknown.

## Required entry-point/integration work — not performed

**D1 — authority wiring and coverage.** `createCheckout`, `releaseReservation`, `abortCheckout`, `cancelPurchase`, `processTransferReminders` and `deleteAccount` need restricted same-database authority dependencies. Extend the existing allowlisted executor/recorder client approach; do not expose raw SQL or reuse an admin/probe credential. `mission1Authority.js` is a transport-injected allowlist, not a credential factory or evidence that the existing client factories already expose the new methods. The ordinary reservation/payment writers must honor the same authority for this exclusion proof to apply in production. Existing canary-only integration does not establish that coverage. In particular, scheduler unpaid sweeps must call the coordinator instead of `applyReservationTuple`; deletion must pass Stripe/authority dependencies to the guard. The current unwired paths fail closed. No new `entry.ts` edit was made.

**D2 — ordered projection and recovery access.** Wire the existing outbox worker to these operation payloads, including interrupted admission recovery, and supply verified receipts. Keep acknowledgement privileges on `authority_worker`; do not give ordinary request callers arbitrary worker capabilities. Provide a trusted admin/worker call to the shared reconciliation functions for captured or retained cases. The synthetic test projector is deliberately in `tests/helpers`, not production. It proves interruption handling in the coordinator only. Concurrent/delayed Base44 projection writes and production inventory-automation ordering remain unproven.

**D3 — schema and old-worker evidence.** Resolve the Base44 deployment/null contracts above; apply schema first in a separately authorized rollout; verify old-worker fencing and restricted-client fingerprints. Local atomic SQL execution and mock Base44 writes cannot prove any of those production facts.

## Verification and preserved failure ledger

The audit reproductions initially reported **1 pass / 4 failures** against the unrepaired implementation. They now pass with real PostgreSQL coordination. The exact interleaving test was strengthened to admit/bind through PostgreSQL after the negative Base44 lookup and assert the conflict reason, so missing dependencies cannot make that test pass accidentally.

Final focused commands/results:

| Command / check | Result |
|---|---|
| `node tests/run-mission1-local.mjs tests/mission1-audit-reproductions.test.mjs tests/mission1-authority.test.mjs tests/seller-expiry-safety.test.mjs tests/checkout-concurrency.test.mjs tests/mutation-paths.test.mjs` | 9/9 audit/history; 20/20 SQL/recovery; 36/36 Mission 1 (all original 34 retained); 58/58 checkout; 12/12 mutation. |
| `node tests/payment-reconciliation.test.mjs` | 17/17 pass. |
| `node tests/payment-webhook.test.mjs` | 21/21 pass. |
| `node tests/process-transfer-reminders-wiring.test.mjs` | 5/5 pass; existing canary wiring check, not proof of new production wiring. |
| `node tests/authority-contract.test.mjs` | 266/266 static contracts pass; its 7 existing runtime skips remain. Actual Mission 1 SQL runtime coverage is in the separate PostgreSQL suite. |
| `npm run build` | Exit 0. No Base44 app ID/base URL configured; existing Browserslist warning. Build was not opened against production. |
| Scoped ESLint over the 10 changed/shared modules and six preserved Mission 1 entry files | Exit 0, zero errors, 13 warnings on existing unused variables in checkout/tuple modules. No lint suppression added. |
| Node syntax checks for 10 shared modules; TypeScript transpilation diagnostics for the six existing entry modifications | Pass. Scoped backend syntax validation, not a claim that the frontend typecheck passes. |
| Entry-point SHA-256 comparison and `git diff --check` | All 51 entry files preserved; no whitespace errors. |

The new suites use a temporary **real PostgreSQL 18.4** cluster over a local Unix socket, with TCP listeners disabled and synthetic data only. The runner reads no database URL. Base44 and Stripe remain test doubles; projection receipts in those tests are not platform evidence. Runtime roles are exercised with `SET ROLE`; the local migration-owner role is a test stand-in, not a verification of Neon production grants.

Test runtime setup used `npm install --prefix /private/tmp/pg-mission1-local-runtime embedded-postgres --ignore-scripts --no-audit --no-fund --cache /private/tmp/pg-remediation-npm-cache --fetch-retries=0` (sandbox DNS failed; approved retry installed 17 packages), then the inspected platform hydration script and `postgres --version`. Installed runtime version: `embedded-postgres@18.4.0-beta.17`. No repository dependency/lockfile change was made for that temporary runtime. Reproduction requires this pinned runtime at that location (or `PG_MISSION1_RUNTIME` pointing to another local `/private/tmp/` installation) and local PostgreSQL shared-memory permission. The tests do not silently skip when it is absent. Package and aggregate suite entries now invoke the local runner for the affected suites and preserve every existing required suite.

During iteration, tests caught a SQL variable-placement error, a duplicated unpaid-release outbox event/missing block metadata, an incorrect checkout-conflict response status, and an incomplete checkout mock adapter. These were corrected. The existing different-revision checkout test now settles its first purchase through the real authority before expecting a second successful purchase; all original success and PI-count assertions remain. A caught test-runner error now sets its failure exit code before asynchronous cleanup. The static authority contract also caught a column-name substring collision; the column was renamed to `payment_release_operation_id` without changing that assertion.

The existing audit failure ledger is retained in `MISSION_1_PAYMENT_INVENTORY_SAFETY.md`: function count 21/22 (expected 50, actual 51); ownership registry 16/17 (missing `migrateSensitiveData/entry.ts`); launch gate 12/14 (`PRODUCTION_INTEGRATION_NOT_IMPLEMENTED`, `CONCURRENT_ALERT_DUPLICATION_BLOCKER`); frontend typecheck 192 diagnostics, previously compared byte-for-byte against the exact baseline. Those full-suite checks were **not rerun or repaired** in this focused follow-up. Their prior results are historical evidence, not a claim of a fresh aggregate pass. The ten-minute capture window and all other Mission 2 backlog items remain untouched.

Smallest next action: review and authorize the narrow D1/D2 integration work and non-production D3 schema/worker validation. Until that evidence exists, Mission 1 remains **BLOCKED**.
