# Beta QA and BetaFeedback access correction — local review

Prepared September 23, 2026 on `codex/pg-beta-feedback-access-20260923`, based on branded-access commit `4d1cf5b7bda8615bbd69b93d2bbcb0ac18dcd885`.

## Problem and scope

The authenticated Final dashboard displayed BetaFeedback permissions as **All Users** for create, read, update, and delete. The existing BetaQA screen used a static browser-side password and could mount its children before its asynchronous account check finished. A browser password is not a server access control.

This patch preserves the intended internal admin QA flow. It changes no ticket inventory, event styling, purchase-security functions, scheduler, account permission, or app visibility setting.

## Changes

- `src/pages/BetaQA.jsx`: reuses the launch-readiness branch's account-based admin gate, with the QA workspace separated so children and stored tester/session state are not mounted before access succeeds. Pending authentication shows the existing checking treatment; other users return to Events. The existing colorful workspace, tabs, and tester fields remain.
- `src/lib/adminAccess.js`: requires a completed successful authentication check, an account ID, an active account, and the exact `admin` role. Compatible with the AuthContext in the branded-access base. No cached browser unlock or embedded password grants access.
- `base44/entities/BetaFeedback.jsonc`: requires `user_condition.role = admin` for every client CRUD operation. Existing feedback fields and required tester name remain unchanged.
- `src/components/beta/BetaFeedbackForm.jsx`: catches save failures, preserves answers, displays a retry message, and releases the busy state. A synchronous in-flight guard prevents repeat clicks issuing concurrent saves. An acknowledged save stays successful if only the subsequent history refresh fails.

No dependency additions or package/lockfile changes. Other launch-readiness fixes were not copied. The prepared patch is a descendant of the branded-access PR; it can be applied after that exact baseline or reviewed as an additional separate commit.

## Verification

- **11 focused tests passed**: actual BetaQA render with mocked authentication and child components, invalid/pending/stale admin denial, successful admin workspace render, exact RLS schema contract, actual feedback submit-handler failure/retry, concurrent-click suppression, and post-save history failure.
- Scoped ESLint passed for both changed JSX files.
- Tests use existing dependencies. No install, broad test suite, or full application build was run.

These are local checks, not verification of deployed Base44 RLS, a live account, or TestFlight.

## Deployment and remaining limits

Nothing was pushed, merged, deployed, or published. The reported live BetaFeedback permissions remain unchanged until a separately reviewed deployment applies this schema. A frontend publish alone must not be assumed to update entity permissions.

After deployment, confirm all four BetaFeedback permissions in Final and verify that an admin can save/read feedback while anonymous and regular accounts cannot perform CRUD. Do not use existing private records as test content.

Other BetaQA child entities and backend functions are outside this bounded change. Their authorization is not established by this UI gate. Base44 service-role calls bypass entity RLS and still require their own guards. This correction alone does not establish that switching the app to public access is safe.
