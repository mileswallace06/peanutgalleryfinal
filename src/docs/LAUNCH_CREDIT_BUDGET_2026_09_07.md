# WIP checkpoint and launch credit budget — 2026-09-07

This is a preservation checkpoint and a source-based budget, not a new launch audit or launch certification. Mission 1's existing reports and unresolved deployment dependencies remain in force. No runtime source, production entrypoint, credential, database-role password, maintenance setting, or automation schedule was changed in this pass.

## Checkpoint scope and preservation

- Repository: `mileswallace06/peanutgalleryfinal`; local branch: `astra/launch-readiness`.
- Starting local HEAD: `d7673a973d9d55cd51ce549f71f9488020cb6d93`.
- Remote main observed at `d5b098d3f81f2b4e83729c37c267b9ac468ff345`, one commit ahead of the starting local HEAD. That commit was inspected as remote metadata, not integrated into this tree.
- Checkpoint destination: new development branch `codex/wip-mission1-2026-09-07`. No push to main, merge, force-push, or deployment is part of this checkpoint.
- All 43 original changed files are preserved byte-for-byte: 23 tracked modifications and 20 relevant untracked files, totaling 674,581 bytes. They comprise 2 entity schemas, 8 handlers, 13 shared modules, 5 SQL files, 11 test files, 3 existing reports, and `package.json`.
- The [preserved-file inventory](WIP_CHECKPOINT_FILE_INVENTORY_2026_09_07.json) records each path, size, and SHA-256, plus the starting hashes of all 51 production entrypoints. This report and that inventory are the only new files created for the checkpoint pass.
- Selected files were reviewed for credentials and private artifacts without exposing matched values. Credential-pattern matches were explicit synthetic/local test fixtures. No unresolved secret or customer-data artifact was found. This targeted review is not a guarantee from a dedicated secret-scanning service.

Read-only GitHub evidence before checkpointing: zero installed Actions workflows and zero deployment records; no deployment workflows/configuration in the inspected local or remote-main tree, and no active local Git hooks. Base44 documents publication from main and live redeployment on main; an existing GitHub branch can be explicitly imported into Base44. This checkpoint branch is not imported or previewed there. Branch previews share app records, so they are not a data sandbox. Private external webhook/account configuration was not inspected. [Base44 branch documentation](https://docs.base44.com/Building-your-app/working-with-branches)

Final checkpoint SHA and remote parity are reported after the push; this pre-commit document does not assert a push succeeded.

## Allowance, rates, and evidence limits

The user-supplied allowance is **50,000 integration credits per month**, not a verified remaining balance. No current billing export, automation configuration export, or execution-volume evidence was available locally. No production dashboard, application endpoint, Stripe account, or database was accessed to obtain it.

Base44 estimates approximately one credit per automation run, with built-in calls charged additionally. Default-domain email is about one credit, custom-domain email about two, and public `UploadFile` about one. External services called using your own keys/backend functions do not themselves incur Base44 integration credits. These are variable published estimates; actual usage must be measured. This is not a basis for charging one credit per database read/write or every raw Stripe/Neon HTTP request. [Base44 credit pricing](https://docs.base44.com/Account-and-billing/Credits)

All schedules below come from current source comments, **not verified deployed schedules**. If an automation is enabled, an early maintenance return must not be assumed to eliminate its invocation cost. Retries can add automation costs. [Base44 automation billing](https://docs.base44.com/Building-your-app/Creating-automations)

## Three largest quantifiable launch consumers

These are the largest fixed consumers with explicit source cadences. They are conditional estimates, not a measured ranking across all customer activity.

| Consumer | Source cadence | 30-day runs / estimated credits | Share of 50,000 | Classification |
| --- | --- | ---: | ---: | --- |
| [`dispatchSaleNotifications`](../../base44/functions/dispatchSaleNotifications/entry.ts) | Every minute | 43,200 | 86.40% | Fixed automation |
| [`processTransferReminders`](../../base44/functions/processTransferReminders/entry.ts) | Every 5 minutes | 8,640 | 17.28% | Fixed automation, plus variable notifications |
| [`cleanupStaleDonations`](../../base44/functions/cleanupStaleDonations/entry.ts) | Every 10 minutes | 4,320 | 8.64% | Fixed automation |

Two other explicit schedules add 1,440 for [`scanTransferWindows`](../../base44/functions/scanTransferWindows/entry.ts) every 30 minutes and 720 for [`calibrateConfidenceWeights`](../../base44/functions/calibrateConfidenceWeights/entry.ts) hourly. Formula: `days × 24 × 60 / interval_minutes`.

**All five together: approximately 58,320 credits per 30 days (116.64% of the allowance), or 60,264 per 31 days**, before customer integrations, data-event automations, retries, and other workers. The dispatcher and reminders alone total 51,840 per 30 days. Thus this source-documented scheduling plan already exceeds 50,000 if all five are deployed as billed Base44 automations.

`processWebhookEvents`, `reconcilePurchaseOutcomes`, and `cleanupAbandonedCheckouts` have no verified current cadence here; their scheduled costs are uncounted, not zero. The historical `src/FOUNDER_AUDIT_PART5_AUTOMATIONS.md` is not current evidence: it names `processTransferAlerts`, whose handler is absent, and disagrees with current source about `scanTransferWindows`. Its old active-job counts must not be treated as today's configuration.

## Customer-driven and event-driven costs

| Consumer | Current source evidence | Budget treatment / missing evidence |
| --- | --- | --- |
| Transactional email | `base44/shared/notifications.ts` sends email by default even when OneSignal push succeeds. Up to two seller and two buyer reminders can occur on a stalled purchase, plus other alerts. Direct email calls also exist in transfer scanning and account/admin paths. | Approximately `default_emails + 2 × custom_domain_emails`; domain configuration, send volume, and reminder mix are unknown. OneSignal uses direct HTTP, not Base44's built-in push integration. |
| Uploads and proof processing | Public uploads appear in listing/profile/community/proof UI; private uploads use `uploadListingProof` and `uploadTransferProof`; proof viewing creates signed URLs. `verifyTransferProof` calls `InvokeLLM` with `claude_sonnet_4_6`. | Public uploads approximately one credit each. Private-upload and signed-URL tariffs, Sonnet 4.6 tariff, upload count, and resubmission volume are unverified. Do not substitute another model's rate. `PROOF_SCANNING_ENABLED=false` currently prevents the LLM path from running; it is a prospective launch cost, not present reachable LLM usage through this handler. |
| Data-event automation fan-out | `syncInventoryOnListingChange` and `recordTransferOutcome` handle entity changes; projections can also generate entity changes. | Approximately one per enabled event-automation invocation, plus integrations. Trigger filters, event multiplicity, recursion suppression, and actual volume are unknown. Customer and system-generated changes both matter. |

The one-minute dispatcher's sale-created and webhook notification channels are currently **in-app only** (`saleNotification.ts`, `webhookNotifications.js`). Do not add a per-minute email charge to that worker or re-enable its suppressed external channels as a credit optimization.

A useful variable-cost expression is `event_runs + default_emails + 2*custom_emails + public_uploads + c_private*private_uploads + c_signed*signed_urls + c_vision*vision_calls`, with the three `c_*` values and traffic volumes explicitly unverified. These variable consumers could exceed any fixed consumer at sufficient traffic; available evidence cannot establish their actual ranking.

## One recommended implementation task

**Move the existing one-minute notification-dispatch workload onto a PostgreSQL-backed worker outside Base44's billed automation scheduler.** Reuse the repository's approved authority/outbox architecture and current in-app delivery policy; do not invent another Base44 lock or enable external email/push. Preserve its one-minute cadence and all payment recovery jobs.

The bounded deliverable should be an external worker adapter with durable operation ownership, notification identity and ordering, idempotent receipts, crash recovery, and tests for overlapping workers, duplicate delivery attempts, interrupted persistence, and backlog draining. Preserve settlement-before-inventory-release ordering wherever notification work observes payment outcomes. Cutover must prove a single authorized dispatcher and fence the old executor; a timeout or cleared claim must not admit a stale sender. Validate current in-app behavior before a separately authorized deployment/cutover. Do not stop or slow safety jobs to realize savings, and do not change payment/inventory authority merely to move the scheduler.

The largest justified potential reduction is the dispatcher's **approximately 43,200 fixed Base44 credits per 30 days** (44,640 per 31 days), contingent on actual scheduler billing and a successful cutover. Remaining Base44 integrations/event triggers still count; external compute and provider costs are separate. No migration, cutover, or scheduler change was performed in this pass.

For planning after that cutover, reserve the 50,000 monthly credits as follows; this is a proposed allocation, not measured capacity:

| Allocation | 30 days | 31 days |
| --- | ---: | ---: |
| Other four documented fixed schedules, unchanged | 15,120 | 15,624 |
| Customer integrations and data-event activity | 25,000 | 25,000 |
| Uncounted schedules, retries, and contingency | 9,880 | 9,376 |
| Total | 50,000 | 50,000 |

Current enabled-job/cadence evidence and usage by integration are required to validate that allocation. Other apps sharing the allowance, if any, also consume its headroom. There is no proven production headroom or launch certification from this estimate.

## Validation boundary

This preservation pass checks original-file and entrypoint hashes, selected-file secret/private-artifact review, Git whitespace validation, staged-file coverage, and post-push SHA parity. Runtime source and tests were not changed, so completed behavioral audits and their failure ledger were not rerun or reinterpreted. The existing Mission 1 reports remain preserved in the checkpoint. Maintenance configuration was left untouched, consistent with the instruction to keep maintenance ON; its production value was not queried.
