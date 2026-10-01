# PG screen refinements — October 1, 2026

## Delivery state

Local review branch: `codex/pg-screen-refinements-20261001`.
Baseline: published Main `ce49debb0d5d5a855b59b054b792dac1f12decc6`.
This branch is not merged, deployed or published. All implementation and validation used local source, fictional data and in-memory adapters. No live listings, purchases, notifications, configuration writes or Mission 1 operations were performed.

Miles asked to stay in the creation stage and defer genuine listing tests until the separate purchase-security work is confirmed. This branch follows that instruction. It does not establish purchase-security readiness.

## The six requested repairs

| Request | Implemented | Remaining evidence |
| --- | --- | --- |
| Upgrade countdown / live state | Upcoming cards and empty hubs count down from explicit event timestamps. Hub, hero and browse agree about start, explicit end, estimated end, cancellation and unconfirmed times. At showtime the hub refreshes inventory; live empty inventory has a clear message and saved-alert control. No guessed countdown for TBA/naive/invalid times. | Physical iPhone transition and fresh hosted inventory not exercised. |
| Promote Bucket Lists | Prominent empty-feed CTA, compact invitation elsewhere in Fan Zone, dedicated Add favorites and Alerts views, saved-list updates, errors/retry and venue-aware related posts. Artists/teams use an explicitly selected area; venues stay attached to their location. | Search and preferences used local stubs; new alert deployment required. |
| My tickets back button | Back to Me in shared page header, including loading/error/empty states. | Hosted tap/spacing review. |
| My Sales back button | Back to Me across page states; listing controls preserved. | Hosted tap/spacing review. |
| Real Help Center | Public `/help` page with searchable questions, topic selection, expandable answers, useful route links and clearly labeled Email support. Own scroll container and safe-area spacing. Account Help Center opens this page. | Hosted mobile scroll and keyboard review. |
| Light mode | Unified warm surfaces, dark text and readable accent inks; softer ticket stock; themed navigation, account details, listing states, forms, guides and Our Story. Stripe field colors follow theme; its payment handlers are unchanged. | No completed browser rendering or physical TestFlight check in this session. Stripe iframe appearance remains unverified. |

## Alerts: implemented versus active

The new backend stores event watches and Bucket List preferences and processes in-app notifications. It is **off by default**, and the UI distinguishes saved preferences from active delivery. It does not send push notifications or email.

Supported upgrade watches require a Ticketmaster-linked event with authoritative provider timing and eligible PG listing metadata. Native events without a provider ID explicitly show unsupported alerts. Bucket alerts cover recently discovered PG events, not the entire Ticketmaster catalog. City choices currently use US city/state venue-area resolution. No continuous/device tracking is collected.

Activation requires the new entity/function deployment, existing Ticketmaster server key, scheduler authentication, a serialized schedule and verification before enabling `DISCOVERY_ALERTS_ENABLED`. Cache writes add no work to existing event searches while that flag is off. When enabled, at most eight result snapshots are awaited; failures preserve search results, but live latency must be measured.

The current bounded worker supports 100 opted-in recipient identities, 20 distinct watched events, 2,000 rows per scan and 200 candidates per run. Exceeding limits fails explicitly. Scaling and a retention policy remain launch work; do not describe this first implementation as launch-scale notification infrastructure.

Full deployment contract, privacy behavior, deduplication and limits: [DISCOVERY_ALERTS_RUNBOOK.md](../../src/docs/DISCOVERY_ALERTS_RUNBOOK.md).

No reward/paid entitlement was activated. These explicit user-requested controls are distinct from the earlier proposed advanced-watch incentive.

## Verification

- 81 focused committed tests pass: countdown/time-zone/strict timing, owned/discovered event navigation, exact-listing destinations, Bucket List feed matching, authenticated alert preferences, worker authorization, eligibility, fresh opt-out and time checks, notification visibility, account cleanup and default-off cache behavior.
- Production Vite compilation passes. The local build warns that deployment-specific Base44 app ID/base URL are unset; this is compilation evidence, not application connectivity evidence. No deployment environment or secret was changed.
- Changed-source ESLint and `git diff --check` pass. Repository-wide payment/security test suites were not rerun for these changes.
- Updated isolated fictional fixtures cover populated/empty/error states, upcoming/live/ended event times, Bucket List editing, alert service active/paused/error and Help Center. Fixture mutations cannot reach the production SDK.
- Independent source review found and corrected Help Center clipping and inconsistent event-end logic. PurchaseDialog changes were checked to be styling only.
- Computed palette contrast checks passed for body text, muted text, colored action text and ticket metadata. This is not a full accessibility certification.

### Visual verification limitation

The workspace had no installed browser binary. Automatic approval review rejected a new Chromium installation under the browser-runtime restriction. The existing cloud browser then rejected the local file preview protocol. Neither restriction was bypassed. Consequently there are **no new rendered mobile screenshots or physical TestFlight claims** for this branch. Source, build and behavior tests do not replace that remaining visual check.

## Next session

1. Push/import this review branch through the existing GitHub workflow.
2. Inspect the six changed surfaces on an isolated preview at phone widths in both themes, using fictional inventory. Check Help scrolling and back links, Bucket List sheet/keyboard and the countdown-to-live transition. No real listing or payment is needed for this review.
3. Review the alert activation runbook separately. Keep delivery off until the backend, schedule and representative notification flow are verified.
4. After approval, merge, verify Base44 synchronization and publish the reviewed revision so UI changes reach the phone. Record the published SHA and TestFlight observations.

This completes a local implementation milestone, not the remaining hosted/device or notification activation milestones. No launch-readiness percentage is inferred.
