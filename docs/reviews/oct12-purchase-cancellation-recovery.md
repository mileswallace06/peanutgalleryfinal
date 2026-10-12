# Purchase cancellation recovery checkpoint

This follow-up was prepared separately from PR18 head `9d7aa593d8d6a8177eac7fb37d4d2cfc0fe99e84`. After the local checks below, the user authorized adding it to GitHub and running full CI. The integration head and CI outcome are recorded in [PR18](https://github.com/mileswallace06/peanutgalleryfinal/pull/18). The hosted app and the user's separate Mac checkout were not changed.

A rejected cancellation request or malformed response previously left the purchase page's action-loading flag set. The callback now releases that flag in `finally` and explains that the result is uncertain: refresh the page to check the latest status before trying again. It does not automatically repeat the cancellation or claim that a refund occurred. Existing confirmation, endpoint, payload, explicit server errors and successful read-back behavior are preserved. Refund, payout, tracking and Account Transfer policy are unchanged.

The existing `PG-Purchase-Recovery.zip` was inspected without executing its Mac-specific installer. Its prepared recovery and 13 regression cases were applied to an isolated worktree. The archive targets a different Mac-only base (`883903786057d16fa368e04095e948e349dccb0a`); this checkpoint does not establish whether the user already installed it there.

Verification on the actual extracted component callback with synthetic dependencies:

- Before: 5 passed, 8 failed, 0 skipped.
- After: all 13 passed, covering rejection, delayed rejection, malformed responses, read-back failure, confirmation decline, explicit errors, success and a later explicit retry.
- The complete offline allowlist: 418 passed across 41 suites, 0 failed/skipped.
- Full repository lint and `git diff --check`: passed.

Commands: `node --test-reporter=tap --import ./tests/deny-network.mjs tests/purchase-cancellation-recovery.test.mjs`, `npm run test:audit-safe`, `npm run lint`.

## Actual purchase-screen verification

The follow-up browser runner renders the actual `PurchaseSuccess` page at 390 × 844 in light and dark themes. Against the exact old component, rejection leaves Cancel disabled, produces an unhandled synthetic exception, and displays no recovery alert. Against the repaired component, **10 cases pass**: rejected/missing/string responses and explicit server errors release both Cancel and Dispute, preserve the transaction reference, and make no automatic repeat. A page refresh followed by an explicit successful retry reads the updated purchase back. Declining the original confirmation sends no request. Corrected runs record zero page errors and zero forbidden network/SDK attempts.

The synthetic success fixture uses the backend's existing `expired` purchase state. It exercises the existing cancelled banner without certifying an actual refund. Only the explicit `cancelRecovery=1` buyer fixture permits this fake cancellation; all existing non-opted-in mutation boundaries remain denied. Reports, inspected screenshots and source hashes are saved in [the evidence folder](oct12-cancellation-evidence/after.json).

Reproduce: `node tests/purchase-cancellation-recovery-browser.mjs --baseline` (expected failure) and `node tests/purchase-cancellation-recovery-browser.mjs` (10 passing checks). Use the installed Playwright Chromium, or the existing local `PG_CHROMIUM_PATH`/`PG_CHROMIUM_ARGS` overrides. The new runner is registered as the nineteenth group in this branch's browser aggregate. This pass ran the focused regression and the existing 14-check transfer-platform runner; it did not repeat the full browser aggregate.

No network, payment or real cancellation occurred. These local checks do not certify a later GitHub head; its full CI must pass separately. The earlier green PR18 CI applies only to its recorded head. No merge, publication or deployment was performed. Refund, payout, tracking and Account Transfer policy remain unchanged. The separately repaired Fan Zone startup race and the still-unattributed original historical R09 failure remain as documented in the earlier review.
