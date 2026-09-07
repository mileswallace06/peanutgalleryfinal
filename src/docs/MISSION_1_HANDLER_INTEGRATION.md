# Mission 1 handler integration — local acceptance record

Repository: `mileswallace06/peanutgalleryfinal` · branch: `astra/launch-readiness` · HEAD/baseline: `d7673a973d9d55cd51ce549f71f9488020cb6d93` · 2026-09-07.

**BLOCKED for merge/deployment.** Eight existing application entry points now call the repaired authority/recovery logic locally. The source projector and authenticated recovery invocation now exist. Local integration is verified against real PostgreSQL and synthetic Base44/Stripe adapters. Production writer exclusion, Base44 persistence/null clearing, schema deployment ordering and recovery of an unknown external write remain unverified. Configuration assertions are prerequisites, not evidence that those prerequisites have been satisfied.

This stage follows the user's explicit authorization for necessary local handler/worker source changes. The existing working tree was preserved. No commit, push, merge, deployment, production access, live credential use or financial transaction occurred. Mission 2 remains untouched. This is the integration acceptance record, not a new general audit.

## Acceptance matrix

| Reproduced defect / integration gap | Local repair | Test result | Remaining concrete dependency |
|---|---|---|---|
| Actual checkout can bind after release's negative Purchase/PP lookup | `createCheckout` admits and binds through the same PostgreSQL authority row used by `releaseReservation`. Both actual handlers are executed in the exact interleaving. | PASS: checkout succeeds; release conflicts; the new token/purchase/inventory link survives. Prior two-connection race tests also pass. | All conflicting Base44 writers must be coordinated or verifiably fenced before rollout. |
| Ordinary reserve / scheduler unpaid sweep bypasses coordination | `reserveListing` uses the same authority; both reminder sweeps delegate to `runReleaseReservation`. | PASS: reserve → release via actual handlers; unpaid release; existing scheduler wiring and mutation assertions. | Existing source outside these paths still needs cutover/fencing coverage. |
| Handler dependencies omit the repaired orchestration | Restricted executor/recorder transports and narrow worker callbacks are constructed in `mission1Runtime`. Eight entries use them. | PASS: actual checkout, reserve, release, abort, cancellation, reminder, historical deletion guard and inventory handler. | Matching authorized database, restricted grants and server configuration. |
| Settlement occurs before persistence | Real handler records dispatch before cancellation; recovery retrieves provider state and commits settlement through the existing Mission 1 saga. | PASS: injected commit failure; actual recovery succeeds with exactly one cancellation. | Actual provider/runtime behavior remains untested here. |
| Worker interrupted after claim, before any Base44 write | Recovery changes ownership under the outbox lock only when there is no pending external write; the old owner cannot plan, start a write or complete afterward. | PASS: claim-response crash, recovery without timeout, stale owner rejected. Prior payment-epoch tests pass. | No platform dependency for the demonstrated PostgreSQL fencing itself; deployed grants/configuration still unverified. |
| Inventory release occurs before completion persistence | Persist plan and write-start markers before writes. Publish Listing last. Keep authority blocked until every field is re-read and completion is recorded. | PASS: completion failure leaves `committed` ownership; new checkout fails; provider outage prevents recovery; fresh verification then completes. | Base44 read/write persistence and clear semantics. |
| Unknown inventory write permits unsafe takeover | Retain the outbox owner and pending step indefinitely. Neither timeout nor alert resolution permits takeover. Generic worker claim/complete/recover APIs exclude Mission 1 events. | PASS: ambiguous write, expired lease, generic completion attempt, alert resolution and scheduled retry all remain blocked. | **Unresolved:** a supported way to prove the old external request cannot finish, or a supported externally fenced/idempotent projection transport. No automatic recovery API for this case is claimed. |
| Another PostgreSQL writer advances inventory authority during projection | Common `reservation_authority` trigger rejects version/ownership/lifecycle/fulfillment/intent changes while a Mission 1 projection is undelivered. | PASS: independent connection cannot advance version, change seller intent or transfer state until completion. | This does not fence writers that bypass PostgreSQL and write Base44 directly. |
| Captured seller-expiry quarantine lacks an operator route | Existing reminder entry now provides authenticated `recover_purchase` and `recovery_status`. Fresh full-refund evidence uses the existing settlement verifier. | PASS: captured payment stays blocked after alert resolution; independently verified full refund completes; zero automatic refunds. | Authorized runtime/schema deployment; no dedicated admin UI was added. Unknown projection writes still require the separate fencing dependency. |
| Historical purchases lack completion markers | `deleteAccount` supplies Stripe/authority dependencies to the historical obligation guard. | PASS: actual guard reconciles cancelled and fully refunded historical cases; unresolved case stops before private data access. Existing historical suite passes. | Tests intentionally stop after this guard; they do not certify the unrelated deletion body or concurrent account closure/cutover. |
| Inventory automation trusts stale status/ownership payload | Automation supplies an ID only. SQL selects current payment ownership; the same worker writes inventory from current authority under the projection barrier. | PASS: delayed cancelled-status event cannot clear a captured purchase or its inventory link. | Other inventory writers must use the versioned authority or be fenced. |
| A matching mirrored tuple lets checkout retry bypass incomplete projection | Client-secret retry also requires a completed canonical checkout projection for the same purchase/PI/buyer/current authority. | PASS: incomplete receipt returns 503 without a secret; existing retry-success assertions still pass. | Historical unbound checkouts need explicit authoritative reconciliation, not a permissive fallback. |
| Schema silently drops completion or null clears | Worker verifies exact stored patch, including explicit null, before acknowledging each write. | PASS: dropped completion or claim clear cannot produce a successful receipt or activate the listing. | **UNVERIFIED:** deployed Base44 field/null semantics and schema sync ordering. |
| Duplicate workers / incident-write failure falsely succeed | Existing financial claim/epoch and unique incident remain authoritative; worker failures retain durable ownership. | PASS: actual duplicate aborts cancel once; failed incident insert reports `alert_proven: false`; authenticated status exposes durable incidents. | Operator access must be configured; the new incident API is not a deployed monitoring service. |

## Changed application behavior

| Existing handler | Before this integration stage | After this stage / valid-flow impact |
|---|---|---|
| `createCheckout` | Admission/binding code lacked real authority dependencies; reservation publication remained direct Base44 writes. | Supplies authority dependencies; publishes reservation and inventory through the worker; requires completed projection on retry. Existing price/fee/ten-minute TTL policy is unchanged. Missing rollout configuration returns 503. Existing checkout failure compensation still quarantines; its unresolved projection cannot silently become available. |
| `reserveListing` | Direct tuple writes and expired-other-reservation clearing. | Same PostgreSQL reserve authority and ordered projection; expired other reservations go through verified release. A reservation awaiting cleanup must finish reconciliation before reuse. |
| `releaseReservation` | Common coordinator had no production authority/projector dependencies. | Supplies them and waits for a verified release receipt. |
| `abortCheckout` | Common expiry helper was unwired; Base44 completion marker could short-circuit recovery. | Supplies dependencies and relies on durable completion. Buyer/admin, captured/dispute and canary guards remain. |
| `cancelPurchase` | Common expiry helper was unwired. | Uses the same settlement/recovery/projector. Existing captured-payment guard remains; captured recovery uses the trusted worker action. |
| `processTransferReminders` | Unwired expiry; direct unpaid sweeps; no recovery invocation; absent session could run worker. | Wires expiry, routes unpaid sweeps through authority, drains durable recovery and reports failures. Adds the recovery actions below. Requires an admin session or configured scheduler bearer token. Existing reminder notifications/review policy remains. |
| `deleteAccount` | Historical guard lacked provider/authority dependencies. | Supplies them; missing markers trigger reconciliation. Existing deletion body is retained. This is guard integration, not proof that account deletion and all new obligation creation are globally serialized. |
| `syncInventoryOnListingChange` | Direct inventory writes from automation data/current listing status. | Enqueues a versioned inventory job; reads stored identity/current canonical payment ownership; never writes from the supplied status. Pending transition owns its inventory projection. |

The worker writes release projections in this order: Purchase → PurchasePrivate completion/claim clear → ListingPrivate tuple/flags → SeatInventory links/status → Listing activation. Every write has a prior durable start marker and a subsequent exact read verification. Canonical reservation eligibility remains blocked through the final receipt. A transient Base44 `active` value during an interrupted final acknowledgement is not permission for a new canonical checkout.

The PostgreSQL ordering trigger also means existing authority operations must retry while projection is pending. This is an intentional safety restriction, not a new fulfillment/refund policy. A failed or unavailable projection can therefore prevent reservations, fulfillment changes or checkout until reconciliation succeeds.

## Recovery invocation and operational limits

These are **local source interfaces**, not deployed commands. Use the existing `processTransferReminders` function, with an actual admin session or the separately configured `MISSION1_WORKER_TOKEN` bearer credential:

| JSON body | Purpose |
|---|---|
| `{"action":"recovery_status"}` | Read up to 50 pending operation contexts and 50 unresolved authoritative incidents. |
| `{"action":"recover_purchase","purchase_id":"…"}` | Reconcile the stored purchase/PI/ownership; retrieve provider state; finish safe pending projection. |
| `{"action":"recover_admission","operation_id":"…","payment_intent_id":"…"}` | Reconcile interrupted checkout admission. Discovered PI is accepted only when provider metadata/hash proves the stored operation identity. |
| `{"action":"drain_recovery"}` | Run bounded recovery; any failed job yields a non-successful result. Scheduled calls also retain these failures. |

Recovery ignores request-supplied epochs, completion flags, refund flags and rollout assertions. Ordinary users and anonymous callers without the scheduler credential are rejected before SQL/financial actions. Existing alert resolution cannot settle a payment or complete projection. Status output is operational evidence restricted to this trusted boundary; it is not a new public customer API.

For captured seller expiry: inspect the durable operation and actual fulfillment state; obtain any separately required refund authorization; perform that independent authorized refund outside this task; then invoke `recover_purchase`. It accepts only a fresh matching PaymentIntent/charge with a positive original amount, `refunded=true` and `amount_refunded === amount`. Partial refunds, missing identity, active fulfillment or provider errors remain blocked. This task performed no refund.

For payment-worker interruption: pre-dispatch recovery fences the old epoch; after durable dispatch recovery is read-only and cannot issue another cancellation/refund. Unknown provider identity requires discovery; an empty search is not proof of settlement.

For projection-worker interruption: if no external step is pending, recovery can fence the previous owner, reverify provider state and resume the persisted plan. If a step is pending, there is **no safe timeout takeover**. Do not manually clear the owner/pending marker, resolve an alert or use a repeated Base44 read as a substitute for proving that the old external request cannot still complete. A supported fencing/drain mechanism and its recovery implementation remain required before rollout. This limit also applies to interrupted checkout publication/compensation. An ownership or seller-intent mismatch deliberately requires review rather than overwriting the current row.

No admin screen was added. The bounded status/action endpoint gives an operator a concrete source-level route for supported recovery, but it does not provide bulk backlog pagination, a monitoring deployment or recovery of an unknown Base44 request.

## Schema-first rollout and evidence

No new Base44 entity fields were added during this integration stage. The existing Mission 1 schema changes remain:

| Entity/table | Field | Type/default |
|---|---|---|
| Base44 PurchasePrivate | `cleanup_claim`, `cleanup_started_at`, `cleanup_completed_at`, `cleanup_evidence` | Optional strings; no declared default. |
| Base44 ListingPrivate | `cleanup_purchase_id` | Optional string; no declared default. |
| PostgreSQL reservation_authority | `checkout_operation_id`, `payment_release_operation_id` | Nullable TEXT, default NULL. |
| PostgreSQL reservation_operations | `recovery_owner`, `recovery_evidence` | Nullable TEXT / JSONB, default NULL. |
| PostgreSQL reservation_operations | `recovery_epoch`, `recovery_dispatch_started` | BIGINT NOT NULL default 0 / BOOLEAN NOT NULL default false. |

`006_mission1_projection.sql` adds restricted functions and one ordering trigger; no columns. It uses the existing outbox `lease_owner`, `lease_expires_at`, `delivery_status` and JSONB payload. Durable payload keys `projection_plan` (array of entity/id/before/patch), `projection_done` (integer) and optional `projection_pending` (integer) describe exact ordered write progress. These are PostgreSQL evidence, not Base44 schema locks.

The real projector requires persistence/readback of Purchase status; PurchasePrivate completion/claim clear; Listing/ListingPrivate reservation token, buyer, expiry and revision; ListingPrivate quarantine/recovery/cleanup fields; Listing status/hidden reason; and SeatInventory status, intent and linkage. Required explicit clears include token/buyer/expiry, cleanup claim/owner, hidden reason and inventory purchase/listing links where applicable. A string schema does not establish null support. Historical rows without markers are reconciled rather than silently accepted.

**Verified locally:** actual PostgreSQL 18.4 transactions, restricted roles, stored-function execution, ordered claim/write/ack barriers, unique incident persistence, stale-owner rejection and synthetic field-drop detection.

**UNVERIFIED:** whether Base44 GitHub sync deploys schemas at all; whether code/schema deployment order is guaranteed; whether a separate Base44 action is required; actual schema persistence and explicit-null clearing; Base44 read consistency and request drain/fencing; scheduler authentication compatibility; production authoritative row/binding coverage; old-worker exclusion; matching deployed database grants. No deployment or external probe was performed to obtain evidence.

Required later authorized rollout:

1. Keep traffic/workers gated. Establish the authoritative listing/payment binding cutover and fence every conflicting legacy writer. Current unmodified Base44 capture/fulfillment/reconciliation paths and checkout's legacy failure compensation are not globally certified by these tests. The existing deletion body also requires account-obligation/cutover review. Setting an evidence flag cannot fix a bypass.
2. Apply `001b` before functions that need its fields. Tested fresh installation: `001`, `001b`, `002`, `002b`–`002f`, `003`, `004`, `005`, `006`. For existing installations, apply the changed `002`/`003` definitions and the new `005`/`006` functions/trigger using the established migration owner. Do not reapply the destructive fresh schema to an existing database. Verify restricted grants, revoked generic acknowledgements and the common ordering trigger.
3. Deploy/verify Base44 schema through its supported mechanism in a separately authorized non-production environment. Verify persistence and null clearing before handler activation. Resolve the unknown-write fencing/recovery dependency.
4. Configure the three restricted role URLs for the same reviewed database: existing `AUTHORITY_V1_DB_URL_DEV_EXECUTOR`, `AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER`, and new `AUTHORITY_V1_DB_URL_DEV_WORKER`. The existing DEV names are retained; they are not permission to point a production app at a development authority.
5. Only after the evidence exists, configure server-side `MISSION1_ROLLOUT_EVIDENCE` with schema revision `mission1_projection_v1`, the reviewed authority host/database, and verified persistence/exclusive-writer/legacy-fencing assertions. Configure the scheduler credential separately. Missing/mismatched configuration fails closed. Do not enable it merely because local tests passed.

Deploying code before these dependencies can make checkout, release and deletion unavailable. Financial fail-closed behavior is not a safe deployment plan. **Mission 1 cannot be called merge-ready on this evidence.**

## Files and verification

Eight of 51 existing entry files changed in this stage; no endpoint was added. Their names are in the behavior table. All other entry hashes match the start-of-stage snapshot.

Other production changes: new `mission1Runtime`, `mission1Projector`, `mission1Reserve`; extended `mission1Authority` and checkout receipt orchestration; pending-projection guards in `002`/`005`; generic-worker exclusion in `003`; new `006` projection functions/trigger. These are root-cause integration or correlated ordering fixes. Schema/deployment dependencies are explicit above. No unrelated production refactor was made.

Evidence changes: new real-handler VM edge adapter/integration suite; existing synthetic fixtures now use canonical revisions and the real checkout projector; older handler contract tests have an explicit synthetic runtime adapter and retain their original assertions. The new integration suite replaces only external SDK/Stripe/secret/SQL transport boundaries, not the runtime/projector or authority receipts. The runner preserves failed test exit status after local PostgreSQL teardown. Package/full-suite registration includes integration tests. No existing test was removed or weakened.

| Command/check | Final result |
|---|---|
| `node tests/run-mission1-local.mjs tests/mission1-audit-reproductions.test.mjs tests/mission1-authority.test.mjs tests/seller-expiry-safety.test.mjs tests/mission1-handler-integration.test.mjs tests/checkout-concurrency.test.mjs tests/mutation-paths.test.mjs` | 9/9; 20/20; 36/36; 24/24; 58/58; 12/12. Exit 0. |
| `node tests/payment-reconciliation.test.mjs` | 17/17, exit 0. |
| `node tests/payment-webhook.test.mjs` | 21/21, exit 0. |
| `node tests/process-transfer-reminders-wiring.test.mjs` | 5/5, exit 0. Canary/static wiring evidence only. |
| `node tests/authority-contract.test.mjs` | 266/266, exit 0; seven pre-existing runtime skips. Separate Mission 1 tests execute real PostgreSQL. |
| `npm run build` | Exit 0. Base44 app ID/base URL absent; existing Browserslist warning. No app was opened against production. |
| Node syntax checks and TypeScript transpilation diagnostics over all 21 changed backend files; scoped ESLint over those files | Zero syntax/transpilation errors; lint zero errors and 13 existing warnings. This is not a claim of full frontend typecheck success. |
| `node tests/run-mission1-local.mjs /private/tmp/mission1-intentional-test-failure.mjs` (fixture sets `process.exitCode = 7`) | Expected exit 1 verified; failing suites cannot report success. |
| `git diff --check`; branch/remote/HEAD and entry hash checks | No whitespace errors; correct repository/branch/baseline; exactly eight entry files changed. |

During integration, tests first reproduced missing maintenance setup in the external-edge fixture, a synthetic/canonical revision mismatch, incomplete checkout publication support and missing generic-worker exclusion. All acceptance assertions remain. The checkout suite temporarily reported 57/58 before its projector fixture used the same canonical completion revision. The temporary embedded runtime uses `async-exit-hook`, whose `beforeExit` handler hardcodes exit 0. An intentional failing test exposed that merely setting `exitCode` was insufficient; the runner now explicitly exits with the suite result after awaiting teardown. The intentional failure now exits 1. These were local test/implementation iterations, not production failures.

The prior baseline failure ledger is preserved: function-count 21/22 (expected 50, actual 51); ownership-registry 16/17 (missing `migrateSensitiveData/entry.ts`); launch-gate 12/14 (`PRODUCTION_INTEGRATION_NOT_IMPLEMENTED`, `CONCURRENT_ALERT_DUPLICATION_BLOCKER`); frontend typecheck 192 previously baseline-matched diagnostics. Those full-suite gates were not rerun or repaired in this focused integration stage. The prior ledger remains historical evidence, not a fresh aggregate pass. The ten-minute capture-window and Mission 2 backlog are unchanged.

Smallest next action: review these local changes and resolve the non-production Base44 schema/null/fencing evidence and remaining writer-cutover dependencies under separate explicit environment authorization. Until then, leave rollout disabled and retain the merge/deployment block.
