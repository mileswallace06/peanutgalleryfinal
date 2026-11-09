# Autonomous readiness audit

Cycle: 2026-11-09. Inspected remote main: `a8d53251db3e57aee833b68447fe04bab1c59f34`. Environment: isolated Linux cloud checkout, Node v24.22.1. Audit branch: `audit/autonomous-readiness`. No production code, provider configuration, accounts, financial operations, or deployed state changed.

This is an initial bounded cycle, not an exhaustive certification. The separate unreleased Mission 1 local candidate was not available here and is not replaced or disproved by remote-main findings. Classifications describe the specific behavior, not an entire feature. Evidence levels: E1 policy/design; E2 inspected implementation; E3 executable synthetic/mocked checks; E4 real isolated integration; E5 verified deployed behavior.

## A. DONE, CONFIRMED, AND TESTED

### PG-AUD-001 — Cancellation recovery preserves uncertainty
- Severity: informational; status: verified locally; blocker: no; founder decision: no.
- Evidence: E3, 13/13 current-revision checks in `tests/purchase-cancellation-recovery.test.mjs`; included in the 418/418 offline allowlist. Actual extracted component callback runs with synthetic API dependencies.
- Covers rejected/malformed replies, explicit errors, declined confirmation, refresh failure and deliberate later retry without automatic cancellation repetition.
- Resolution: retain behavior. Does not prove a refund, provider behavior or rendered device behavior. See TEST_MATRIX.md for command and limits.

### PG-AUD-002 — Offline allowlist passes on current remote revision
- Severity: informational; status: E3 regression baseline; blocker: no.
- 41 suites, 418 checks passed, none failed/skipped. Scope is the exact allowlist, not all features or the entire app.
- Resolution: rerun relevant suites after implementation changes; never transfer this result to another head without comparison.

## B. DONE AND CONFIRMED, BUT NOT TESTED

### PG-AUD-003 — Hosted financial and deployment evidence is not established by this checkout
- Severity: critical release-evidence gap; unresolved blocker: yes; founder decision: no new question.
- E2: authority code, SQL, canary wrappers and launch-gate sources exist. The current offline launch gate exits 1 with two explicit gate failures. This is a test-harness declaration, not fresh proof that no newer local implementation exists.
- The gate contains unconditional failures for unverified entry-wrapper integration and concurrent incident uniqueness. No live probe was run; no Base44/Neon/Stripe binding, migration, scan engine or provider response was inspected.
- Needed: existing security owner supplies exact tested/deployed head and actual entry-wrapper/infrastructure evidence, then an authorized composed capture → authoritative Purchase → refund observation. Do not repeat financial work from this audit.
- Resolution: open; keep genuine-listing acceptance deferred. The entire app must not be called tested or production-ready.
- Sources: [launch gate](https://github.com/mileswallace06/peanutgalleryfinal/blob/a8d53251db3e57aee833b68447fe04bab1c59f34/tests/launch-gate.test.mjs), [authority contract classification](https://github.com/mileswallace06/peanutgalleryfinal/blob/a8d53251db3e57aee833b68447fe04bab1c59f34/tests/authority-contract.test.mjs).

## C. FEATURE NEEDING ADDITION

### PG-AUD-004 — Proof verification can remain stuck after signed-URL failure
- Severity: high functional risk; unresolved blocker: yes before scanning activation; founder decision: no.
- E2/E3: actual handler sets both Purchase and PurchasePrivate to `processing`, then signed-URL issuance failure returns 500 without releasing that state. Subsequent ordinary retry returns 200/skipped `already_processing_or_verified`.
- Reproduced with synthetic signing failure and actual TypeScript handler transpiled without semantic edits; network denied. Full reproducer is in TEST_MATRIX.md.
- Current exposure: normal path is blocked by hardcoded scanning=false; test injected scanning=true and maintenance=false to exercise the dormant path. No claim of a deployed incident.
- Root cause: [claim and signing path, lines 136–175](https://github.com/mileswallace06/peanutgalleryfinal/blob/a8d53251db3e57aee833b68447fe04bab1c59f34/base44/functions/verifyTransferProof/entry.ts#L136-L175), [retry guard, lines 108–112](https://github.com/mileswallace06/peanutgalleryfinal/blob/a8d53251db3e57aee833b68447fe04bab1c59f34/base44/functions/verifyTransferProof/entry.ts#L108-L112).
- Proposal and closure criteria: FEATURE_BACKLOG.md. Status: defect reproduced, fix not implemented.

### PG-AUD-005 — Participant-controlled force flag bypasses processing guard
- Severity: high resource/race risk; unresolved blocker: yes before scanning activation; founder decision: no.
- E2/E3: authenticated seller/buyer authorization does not restrict `force_reprocess` to admin. True bypasses both status guard and compare-and-set, reaching signed-URL work repeatedly despite processing state. Two seller forced attempts reached that dependency in the sealed fixture.
- Limit: this does not prove duplicate LLM billing or a financial exploit. The synthetic signer always fails before the LLM. Current normal path is gated off.
- Sources: [participant authorization and guard](https://github.com/mileswallace06/peanutgalleryfinal/blob/a8d53251db3e57aee833b68447fe04bab1c59f34/base44/functions/verifyTransferProof/entry.ts#L100-L112), [forced update](https://github.com/mileswallace06/peanutgalleryfinal/blob/a8d53251db3e57aee833b68447fe04bab1c59f34/base44/functions/verifyTransferProof/entry.ts#L136-L149).
- Status: defect reproduced, conservative repair proposed; not fixed.

### PG-AUD-006 — Transferability is labeled confirmed without independent confirmation
- Severity: critical marketplace trust/policy gap; unresolved blocker: yes for release review; founder decision: not yet required.
- E1 founder requirement: every listed ticket must be confirmed transferable. E2 inspected normal creation path: URL presence selects `screenshot_verified`; absence selects `seller_attestation`; both set `transfer_status: transfer_confirmed`. No provider confirmation is checked in this path before creation. This cycle did not execute listing creation.
- Source: [creation, lines 411–442](https://github.com/mileswallace06/peanutgalleryfinal/blob/a8d53251db3e57aee833b68447fe04bab1c59f34/base44/functions/submitListing/entry.ts#L411-L442). Eligibility and seller onboarding checks do not establish transferability of the specific ticket.
- Scope: remote legacy creation path, not a claim about the unavailable newer Mission 1 candidate or production reachability.
- Resolution: open. Require conservative unverified state and explicit evidence before purchasability; implement the existing policy rather than ask Miles to repeat it.

### PG-AUD-007 — Permanent proof-scanning capability unavailable in remote baseline
- Severity: high launch dependency; unresolved blocker: yes; founder decision: no.
- E2 `base44/shared/maintenance.ts` hardcodes `PROOF_SCANNING_ENABLED = false`; pending assets cannot become usable through this flag alone. No real scanner integration was exercised.
- Fail-closed refusal is appropriate. Missing capability is not solved by toggling the flag. Reconcile with existing security-owner scanner work before proposing duplicate implementation.
- Resolution: open; require real scan-result provenance, adverse-file testing and authorized integration evidence.

## D. NEW FEATURE / SOLUTION NEEDED

### PG-AUD-008 — Audit publication isolation is not established
- Severity: medium workflow blocker; unresolved blocker: yes for GitHub publication; founder decision: only if isolation cannot be verified.
- E2 README says any push is reflected in Base44 Builder. `.github/workflows/audit-regression.yml` runs on pull requests and main pushes, but does not document external Base44 hook exclusions.
- Local branch/commit satisfies local version control only; it does not make these records accessible on GitHub. No remote branch was pushed while sync effects were uncertain.
- Provisional solution: verify Base44 integration branch scope or establish an explicitly excluded audit-only branch. Then publish only these five documentation files without a PR/merge/deployment unless separately authorized.
- Resolution: open; see FOUNDER_DECISIONS.md. No claim of a production side effect from a docs-only branch, only uncertainty.

## Resolution protocol

Keep IDs stable. Update classification and status in place, link exact implementation/test revisions, preserve prior limitations, and distinguish proposed, coded, locally tested, integration-tested and deployed. Reopen an item if relevant behavior changes. Do not close any C/D item on the strength of its proposal.
