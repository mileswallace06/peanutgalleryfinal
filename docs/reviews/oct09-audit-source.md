# October 9 audit source and reconciliation

This repair follows the user-supplied **Peanut Gallery October 9 Repair Prompt** and **Peanut Gallery October 9 Regression Audit**. Both attachments were read completely, including all nine audit figures. The original documents remain attached to the review conversation; this public summary omits private transaction identifiers and account details.

| Input | SHA-256 |
| --- | --- |
| Repair Prompt(1).txt | `94e6bdf5d7ca0d4863fd49754dc49f5b06755ef3405599401d4b11256e1de53a` |
| Regression Audit(1).docx | `17f54f9ca2bbbacd4551ee4ded472ecd2ba44bfc9ce3ddd29ed63c9f56abc385` |

## Corrected inputs

The reuploaded versions incorporate the October 9 at 21:54 UTC evidence correction: historical CI 37984839871 timed out at `assertTrigger` (51:24), called at 74:67 after a raw backdrop click. Escape and Close-button assertions at lines 72–73 had already passed. This corrects baseline PR17 evidence; it is not a new audit of PR18. The original hashes above are retained for provenance.

| Corrected input | SHA-256 |
| --- | --- |
| Regression Audit (2).docx | `4568a1014206740869bf60af215f99ff19721bc7675f6a82b94eaf74e402f974` |
| Repair Prompt (1)(1).txt | `7b2d5311830aa69058922d90393d6b1f300455a1fe97c79000219100b729d8d0` |

## Comparison base

Current main was fetched before implementation and matched the audit: commit `c31a2e1aa9f9c7d7916908ab948201cfad3243a8`, tree `81a876421489227d8c6a9f8bbe9c41e018cd6283`. The initial local branch HEAD was `abfb8cb81955c6b744bfe359ebfe8f8ac5773d9f` with the same tree and no uncommitted changes. The dedicated `codex/pg-oct09-regression-repairs` branch starts from current main. No newer fix was reapplied; no prior evidence was rewritten.

Prior [PR17](https://github.com/mileswallace06/peanutgalleryfinal/pull/17) merged October 9 at 20:07:17 UTC. The audit records publication at 20:27 and user confirmation at 20:28, then observations around 20:29–20:45. Exact served frontend/backend versions were not exposed. This repair makes no deployment claim.

The audit used actual 1180×757 desktop Chrome, FAN/ADMIN and both themes. It did not certify phone, ordinary-member authorization, backend enforcement, or transactional behavior. New evidence is explicitly isolated and synthetic, with recorded actual viewport dimensions.

Historical [CI run 37984839871](https://github.com/mileswallace06/peanutgalleryfinal/actions/runs/37984839871) and [artifact](https://github.com/mileswallace06/peanutgalleryfinal/actions/runs/37984839871/artifacts/11642950335) remain historical evidence. Inspection corrected one detail: the failing Fan Zone call at line 74 followed a raw backdrop click, although the original audit attachment described Escape. The original runner passed unchanged locally; the cause remains unresolved. See [Fan validation](oct09-fan-validation.md).

## Figure-to-finding index

| Figure | Evidence actually shown |
| --- | --- |
| 1 | Duplicate discovery context and stale repeated-search focus, R02/R03 |
| 2 | Working ended-event form guard, R04; no member/backend proof |
| 3 | Empty Flash Drop lookup and recovery, R05 |
| 4 | Upgrades returns to Upcoming after Live hub, N01; selected state also confirmed in audit DOM |
| 5 | Indistinguishable composer choices, R16 |
| 6 | Desktop Privacy final column reachable, R06 |
| 7 | Visible refund fragment, R07; policy conflict remains R08 |
| 8 | Scoped queue count wording, R14; not the unnamed refresh controls |
| 9 | Closed admin event selector; N03 duplicate undated options established separately in audit DOM |

The written observations additionally establish N02/N04/N05 and the source-only N06 candidate. N06 was subsequently reproduced only in isolated fixtures. The [repair ledger](oct09-regression-repairs.md) separates repairs, preserved behavior, missing-coverage tests, and owner decisions.
