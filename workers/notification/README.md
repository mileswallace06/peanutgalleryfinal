# PG-CREDITS-01 — external notification worker

This prepares the existing in-app notification dispatcher to run outside Base44's billed automation scheduler. It does not deploy anything or change an existing production entrypoint, maintenance setting, or schedule. Mission 1 remains **BLOCKED** under its existing reports; Mission 2 is untouched. No credits have been saved by this implementation. The estimated 43,200 credits per 30 days is conditional on the actual one-minute Base44 schedule and a later successful cutover. See the [checkpoint budget](../../src/docs/LAUNCH_CREDIT_BUDGET_2026_09_07.md).

## Commands

From the repository root, with the existing dependencies installed:

```sh
npm run notifications:once
npm run notifications:schedule
node workers/notification/cli.mjs --once --batch-size=25
node workers/notification/cli.mjs --status
node workers/notification/cli.mjs --recover
npm run test:external-notifications
```

`--once` executes one bounded page. `--schedule` awaits each run and then waits until its next 60-second start; it never starts overlapping callbacks or catch-up batches. A run longer than 60 seconds delays the next run. Maintenance defaults ON: without `MAINTENANCE_MODE` exactly `false`, processing returns `MAINTENANCE` without opening connections. This pass leaves maintenance ON. The active processing path is exercised by the local tests with injected dependencies.

Exit 0 means successful completion or maintenance skip; exit 2 means failure, overlap, retained ownership, or unresolved work. `--status` displays sanitized coordination state. `--recover` only reads Base44 records and reconciles PostgreSQL receipts; it does not dispatch or send Base44 mutations and can run under maintenance. A successful recovery is followed by a separately invoked ordinary run.

SIGINT/SIGTERM stops new work, interrupts the scheduler's wait, and lets the current request settle. After 30 seconds the CLI exits with `SHUTDOWN_STATE_RETAINED`; it does not unlock a pending write. A transport timeout also leaves the write uncertain. Neither timer proves provider execution ended.

## Configuration and the unprovisioned adapter boundary

| Variable | Requirement |
| --- | --- |
| `MAINTENANCE_MODE` | Defaults ON; must be exactly `false` to attempt dispatch. Do not change it for this preparation pass. |
| `PG_NOTIFICATION_SCOPE` | Exact app/scope identifier, used consistently by all external workers and the provisioned adapter. |
| `PG_NOTIFICATION_DATABASE_URL` | Dedicated notification workload identity on the approved Neon/PostgreSQL database; never an authority, owner, or admin credential. No generic `DATABASE_URL` fallback. |
| `PG_NOTIFICATION_ADAPTER_MODULE` | Absolute path to a trusted `.mjs` module implementing the workload adapter below. There is no automatic SDK/service-token/admin-login fallback. |

**No production workload adapter or credentials are assumed to exist.** This repository ships the runnable loop, dispatcher integration, PostgreSQL coordination and injected local verification, not a fabricated authentication scheme. The installed Base44 SDK and [official client documentation](https://docs.base44.com/developers/references/sdk/getting-started/client) describe service-role access as available in Base44-hosted functions. They do not establish a supported external workload identity for this worker's cross-user private reads/writes or its live maintenance read. An account key or admin session must not be substituted to bypass that unresolved dependency.

A later approved adapter must export:

```js
export async function connectNotificationAdapter({ scope, signal }) {
  // Connect using a separately provisioned, supported workload identity.
  // Return { entities, maintenance, close } as specified below.
}
```

The interface reuses the shared dispatchers' `deps.entities` contract:

- `Notification`, `Purchase`, `PurchasePrivate`, `AdminAlert`: `filter(query, sort, limit, skip)` returning an array. Reads must honor the requested bound, ascending `created_date` ordering and offset semantics. Queries use only equality and an empty filter. No unverified compare-and-set or request-fencing header is required.
- `Notification`, `Purchase`, `PurchasePrivate`: `update(id, patch)`. `AdminAlert`: `create(fields)`. No other mutations or integrations are exposed. Successful writes must resolve only on a terminal, completed provider response, not queue acceptance. Alert creation must return the persisted ID.
- `maintenance()`: fresh authoritative PG maintenance state, returning exactly `false` only when processing is allowed. A missing, stale, failed or unauthorized maintenance read must fail closed. This feed must stay synchronized with PG's actual maintenance control; a local environment flag alone is insufficient.
- `close()`: optional awaited cleanup; transport connections must close without silently resending requests.

The adapter must not retry mutations internally. HTTP errors, aborts, dropped responses and timeouts remain ambiguous. Only a positively known pre-send rejection may throw the exported `WriteNotSent` error. It must never wrap an uncertain HTTP result in that error. The transport must sanitize its own logs too: catching an SDK error afterward cannot undo logging performed inside an SDK. Bounded request timeouts are appropriate, but a timed-out mutation remains blocked.

A supported narrowly authenticated data/maintenance gateway might be necessary. Its authentication, provisioning, endpoint semantics and any required future handler changes are **unverified and outside this patch**. The current admin-only `getMaintenanceStatus` handler is not used with an admin credential as a workaround. This is a concrete prerequisite for live execution, not a claim that supplying an environment variable proves platform support.

## Shared behavior and bounded backlog processing

The worker calls `dispatchSaleNotificationsDeps` and `dispatchWebhookNotifications` directly. Their only changes are an optional preloaded `notifications` array. Existing hosted callers retain their original queries; `saleNotification.ts` and all 51 production entrypoints are unchanged.

The in-app Notification record remains the delivery mechanism. The worker preserves its content, recipient, read flag and action URL. It supersedes duplicates, marks the canonical dispatched, and persists the existing `skipped` email/push channel statuses on Purchase and PurchasePrivate. It has no Stripe, payment authority, inventory or external notification integration. Runtime SQL only accepts these narrow status patches and the shared dispatcher's critical AdminAlerts. It cannot create PurchasePrivate as an implicit fallback.

The scan defaults to 50 rows (maximum 100), ordered by creation date over **all** notifications. Its PostgreSQL offset advances and wraps; completed recent rows therefore do not occupy the only page forever. Each selected logical key is re-read as a complete group of at most 100 records, including earlier dispatched canonicals. Late duplicates can then be superseded without promoting a second canonical. Stable ID ordering breaks equal-date ties. There are at most 500 actual write attempts per run; fresh equality avoids repeating known completed updates.

Oversized groups receive no partial canonicalization. Hashed-key `GROUP_TOO_LARGE`, `LEGACY_DISPATCHING` and integrity issues appear in bounded run output with non-success. Known missing Purchase/PP cases retain the notification and use the existing alert logic; completed alert receipts deduplicate repeat alerts. No raw exception, credentials, email address, title or notification body is printed by the worker.

Offset pagination is not a Base44 snapshot: concurrent inserts/deletes may delay an item until a later sweep. Tests prove finite-backlog progress and duplicate handling locally, not fairness under unbounded concurrent creation or instantaneous global uniqueness. Group size, observed oldest pending age and throughput need validation before cutover. An ambiguous write blocks the entire notification scope, making the failure visible and preserving safety at the cost of notification processing availability.

## Separate schema and durable coordination

Apply [001_dispatch.sql](../../database/notification_worker/001_dispatch.sql) once, **before starting a worker**, through a separately authorized migration owner. The worker never installs it. It creates only the `notification_worker` schema, its `control` and `writes` tables, narrow functions and two NOLOGIN capability roles. It does not reference financial outbox tables, alter existing roles/passwords or add Base44 schema fields. Existing notification/channel fields still require correct persistence; this patch does not resolve Mission 1's schema/persistence gates.

Provision separate runtime and reconciliation identities later. Grant the runtime only the `notification_worker` capability and the operator `notification_reconciler`; neither receives table mutation access or financial authority grants. Verify effective grants, ownership, schema installation and the exact app/database binding. The migration owner retains object ownership and must not be a runtime identity. No passwords or credential provisioning are included in the SQL.

The operator initializes the scope using `notification_worker.configure(scope, maintenance, cutover_reference)`. Maintenance defaults true. The cutover reference must point to independently collected evidence; it is **not a supported request fence** and does not itself disable the old Base44 worker. Turning this field on is forbidden until cutover prerequisites below are met.

An atomic row lock serializes ownership. Each Base44 write gets a durable `started` intent **before** the request. A terminal response is recorded as `returned`; a fresh read verifying every intended field allows `applied` and clears the pending pointer. The owner token is checked at every mutation boundary and run completion. No timer expires ownership. Notification processing never calls or leases Mission 1's financial outbox.

| Interruption | Result and concrete recovery |
| --- | --- |
| Before first write / between acknowledged writes | Ordinary overlap returns `BUSY`. Explicit `--recover` rotates ownership and finishes the old idle run; its stale owner cannot start another write. Retry dispatch afterward. |
| Write intent persisted, but request or its response is uncertain | `started` remains durable. `--once` and `--recover` return `WRITE_BLOCKED`, regardless of age or current entity equality. Independent operator evidence is required. |
| Known pre-send rejection | Journal records `not_sent`, clears pending, and reports failure. A later run retries using fresh reads. |
| Terminal response persisted, before verification / completion acknowledgement | `returned` remains pending. `--recover` takes SQL ownership, re-reads the exact entity/patch, then acknowledges it. It does not resend. Mismatch or read failure remains blocked. |
| All writes acknowledged, before run/cursor completion | Explicit idle recovery fences the old owner. The same page is safe to rescan; fresh field equality skips completed updates. |
| Alert-create response lost | Same `started` barrier; no duplicate create. Reconciliation needs the actual alert ID and independent terminal-request evidence. Resolving an alert alone changes none of this state. |

### Operator path for an unknown write

1. Keep maintenance ON and inspect `--status`; a privileged status read provides the exact intent/patch/owner needed for investigation. Retain journal evidence and process/request logs securely.
2. Independently establish that the old executor cannot resume **and** every issued request is terminal. Killing a process alone does not prove the provider stopped; a timeout or a matching current record is insufficient. If provider terminality cannot be proven, leave the write blocked and escalate. There is no automatic unlock fallback.
3. Using the separate reconciliation identity, call `notification_worker.reconcile_unknown(scope, expected_owner, write_id, outcome, target_id, evidence)`. Evidence must contain a durable `reference` plus `executor_stopped: true` and `provider_terminal: true`; these are operator attestations, not tests that create the facts. Expected owner/write must still match, and PostgreSQL maintenance must be true. The runtime role cannot call this function.
4. For independently verified `applied`, provide the real target ID. The journal becomes `returned`, **not completed**: `--recover` must still verify fresh persisted fields. For independently verified `not_applied`, the intent becomes `not_sent` and a later normal run may retry. Reconciliation records the database operator and evidence, rotates SQL ownership, and rejects old-owner acknowledgements.

This mechanism fences cooperating PostgreSQL callers at write boundaries. It does **not** cancel a request already sent to Base44 or prove provider-side request fencing. The operator route is only safe when its independent evidence is true. Neither local mocks nor local PostgreSQL tests establish that external guarantee. No exactly-once delivery claim is made.

## Prerequisites for a later single-dispatcher cutover

1. Verify the actual Base44 automation exists, its enabled state and cadence, metered credits, and all other/manual invocations of `dispatchSaleNotifications`. The checkpoint's one-minute comment is not deployed configuration evidence.
2. Provision and validate the supported workload adapter, fresh maintenance feed, dedicated identities, transport terminal-response/no-hidden-retry semantics, bounded pagination and field persistence in an authorized non-production environment.
3. Install the notification schema first, verify grants and app binding, configure maintenance ON, and rehearse read-only recovery and unresolved-write escalation with an operator.
4. Reconcile pre-existing `dispatching` notifications and all in-flight/uncertain legacy writes. Prevent **all** old dispatcher invocations and prove outstanding requests are terminal before enabling the external executor. The existing hosted handler admits scheduler requests without a session; disabling only its schedule is insufficient proof against other callers. A later explicitly authorized handler retirement/access-control change may be necessary. No such entrypoint change is made here.
5. Under a separate cutover authorization, establish one effective dispatcher, transfer the same 60-second workload, record the evidence and monitor backlog, errors and usage. Preserve payment/recovery jobs and their cadence. Do not enable external sending or overlap an old and new executor during rollback. A rollback needs the same stop/drain/reconcile proof in the reverse direction.

## Focused verification

`npm run test:external-notifications` reuses the existing isolated PostgreSQL runner, a separate empty test database and injected Base44 entity stores. It never reads a live database URL or calls Base44/Stripe. Production table exclusion and provider fencing are not inferred from those tests. Affected shared-module regressions, build and scoped lint are recorded in the implementation report; the full launch audit and existing failure ledger are unchanged.

Results on 2026-09-07, starting from checkpoint `072e4a1d621650ad167b49d62c511b392167f3e9`:

| Command / check | Result |
| --- | --- |
| `npm run test:external-notifications` | 25/25 passed with real isolated PostgreSQL 18.4. Initial sandbox attempt could not allocate PostgreSQL shared memory; the authorized local retry passed. |
| `node tests/payment-reconciliation.test.mjs` | 17/17 passed; run once. |
| `node tests/payment-webhook.test.mjs` | 21/21 passed; run once. |
| `npm run build` | Passed; run once. Warnings: absent local Base44 app ID/base URL and outdated Browserslist data. No production configuration was added. |
| `./node_modules/.bin/eslint --config workers/notification/eslint.config.mjs workers/notification/*.mjs tests/external-notification-worker.test.mjs tests/helpers/notificationWorker.mjs` | Passed without warnings; run once. |
| `./node_modules/.bin/eslint base44/shared/saleDispatch.js base44/shared/webhookNotifications.js` | Passed, zero errors; 15 unused-variable warnings in unchanged existing code; run once. |
| `node workers/notification/cli.mjs --help` | Passed. |
| `npm run notifications:once` | Passed with `MAINTENANCE`; no connections opened. |

The 25 focused tests cover shared behavior equivalence, real independent PostgreSQL worker overlap, stale ownership, no automatic timeout recovery, known-not-sent retries, lost begin/return/completion acknowledgements, contradictory writes, read-only recovery, operator permissions/evidence, alert ambiguity/deduplication, late duplicates, finite backlog progress, oversized groups, write limits, maintenance, serial scheduling, shutdown and sanitized errors. Only local synthetic maintenance flags were false inside tests. Existing production entrypoints, baseline failure reports, credentials/passwords, and financial SQL were not changed.
