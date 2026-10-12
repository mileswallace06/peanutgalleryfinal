# PR #18 review follow-up repairs

Reviewed baseline: `3a56073ba06f9f25b42844d2ca67068dafd4c554`. This follow-up repairs the three concrete defects found during merge-readiness review. The reviewed baseline's green CI does not certify these changed files. The authoritative candidate SHA and its final CI run are recorded in [PR #18](https://github.com/mileswallace06/peanutgalleryfinal/pull/18). No merge, publication or deployment is recorded by this report.

## Findings and repairs

| Finding at the reviewed head | Repair | Meaningful red/green evidence |
| --- | --- | --- |
| A rejected Fan Gift upload left the busy flag set. The reviewed head also disabled submission while uploading, so the open draft became stranded without an actionable error. | Catch rejected/malformed responses, clear the current request's busy state, preserve the draft, allow the identical file to be retried, and ignore late results for a closed/replaced draft. | Baseline fails with disabled picker/submission and no error. Repaired runner: **10 cases passed**, including immediate/scheduled drafts, rejected/malformed responses, same-file retry and delayed settlement after close/reopen. [Upload evidence](oct09-evidence/review-followup/upload/README.md) |
| Upgrades Back discarded its saved snapshot while a different city request was being restored. Separately, an early-page focus target could stop restoration before all saved pages loaded. | Bind restoration and its queued focus callback to the request generation, reject superseded work, and load the saved page depth before focusing the target. | Both baseline cases stop at **40 instead of 120 cards**. Repaired runner: **6 cases passed**, covering settled cross-city Back, an early-page target after detail reload, and two delayed old responses after newer intent, in both themes. [Navigation evidence](oct09-evidence/review-followup/navigation/README.md) |
| The authorized purchase listing projection omitted the known transfer platform, so the actual transfer assistant displayed generic guidance instead of its existing Ticketmaster/AXS shortcut. | Add only the schema's six-value platform enum inside the existing seller/confirmed-buyer/admin projection. Public and separate seller-list projections remain unchanged; unknown/malformed/missing values become null. | Actual endpoint tests: **16/21 failed before, 21/21 passed after**. The old endpoint response also fails the actual page's shortcut assertion; repaired browser runner: **14 checks passed**, including exact links, generic fallback and role/denial cases. [Transfer evidence](oct09-evidence/review-followup/transfer/README.md) |

The navigation condition that stopped at an early target predates the request-generation fix. It is included here because the requested repair must restore all saved pages, not merely locate a row. The tested three-page sequence restores the existing request/city and Upcoming view; no query scope or provider limit is invented. Owned-ticket targets do not trigger unrelated discovery pagination.

## Combined verification and review

After the final early-target page-depth condition was added, the combined local checks passed full repository lint; scoped audit lint (**95 files, 0 errors, 23 warnings**); **405 safe tests in 40 suites**, with no failed/skipped tests; and production build. The safe allowlist denies network access. `npm test`, which includes live financial canaries, was not used.

The aggregate now includes **18 browser runners**. Its final combined run and final-head CI are pending at the time this report is written; focused runner results above are not a claim that the final aggregate or a later GitHub head is green. Consult the current SHA and run linked in PR #18. A canceled or superseded run is not success evidence.

Independent review reported no remaining blocker in the focused repair designs. The final candidate still requires its own completed gates. Existing navigation, lifecycle/dialog and participant-privacy checks remain in place; this follow-up does not remove the original raw Fan Zone backdrop action or weaken its assertions.

## Fan Zone distinction

The earlier **reproduced Fan Zone startup race is repaired**: a trusted backdrop click could arrive before Radix installed its outside-pointer listener, and a guarded overlay-click fallback closes that gap. Its separate deterministic and native-timing evidence remains in the [startup repair report](oct09-fan-startup-repair.md).

**R09's original historical CI failure is still unattributed.** A later pre-fix CI run reproduced a stuck backdrop, but its limited diagnostics do not establish that the original historical failure had the same cause. These three follow-up repairs neither resolve that attribution question nor modify FanSortSheet.

## Unchanged decisions and limits

Refund eligibility/funding/wording, payout timing promises, tracking/provider disclosure and consent, and the Account Transfer option remain [owner decisions](oct09-owner-decisions.md). No policy selection or new promise is made here.

All new evidence uses synthetic data with production SDK/network access blocked. The transfer browser fixture consumes output from the actual handler under synthetic SDK/auth/storage boundaries; it does not hand-add the missing platform field. Local Chromium 153 results do not replace CI's installed Playwright browser or physical-device testing. No real upload, gift creation, provider-link visit, ticket transfer, payment, onboarding or production endpoint deployment occurred.

Previously documented limitations remain: legacy Purchase context for pending transfers, no cross-client atomic Founder alert uniqueness, unknown production tracking behavior, unresolved provider-record equivalence and unverified deployed transaction flows. These repairs improve the reviewed PR; they do not certify a public launch.
