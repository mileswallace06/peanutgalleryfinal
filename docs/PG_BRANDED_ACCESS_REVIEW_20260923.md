# PG branded access — prepared, not activated

Goal: public homepage and legal pages for Google's review, and Peanut Gallery
sign-in using existing accounts. This is not an app redesign or a purchase
security rollout.

Source baseline: GitHub main `31f537a0130713b9f44a4680999f4d34e6d227cd`.
Branch: `codex/pg-branded-access-20260923`. No unrelated launch-readiness commits
were included. Backend files, schemas, settings and dependencies are unchanged.

## Changes prepared

- Existing Landing design/copy retained, with scrolling on small screens and
  readable policy links. Existing members go to Events after session validation.
- Public homepage, privacy, terms, cookies and Our Story routes render without
  waiting for sign-in. All member routes require a verified current account.
- PG-branded email login, registration with email verification, Google/Apple
  login and recovery screens use the existing SDK/client. No account migration.
- Auth checks use the SDK's current credential, rather than a separate client
  with an outdated boot-time token. Late checks cannot restore a logged-out
  account. Failed/unknown identity does not mount member screens.
- Return URLs reject other origins and credential/configuration injection.
  Passwords and reset credentials are not logged by the new code. Provider error
  text is replaced with safe messages; duplicate submission is prevented.
- Existing Usercentrics policy rendering now has loading, retry and failure
  feedback. No privacy/legal promises were invented or rewritten.

## Evidence and limits

22 focused tests passed: auth delegation, denied/unknown access, real App route
rendering with simulated sessions, hostile returns, duplicate submits, and
reset-link storage handling. Changed-page lint and production compilation passed.
SSR route tests do not validate browser navigation, keyboard layout or iPhone UI.
Browser service became unresponsive; visual and live account checks were not run.

The local build reused installed SDK 0.8.48; baseline package manifests remain
unchanged at ^0.8.50. Final's platform must build with its pinned dependencies.
No compiled artifact from this work was uploaded or deployed.

Reset link contract: on September 23, the public Base44 script served from
`https://peanutgallery.store/static/ResetPassword-DpDktso9.js` reads query `token`
and uses it for reset. It was traced from the login entry script through the
WebApp and ResetPasswordGate imports. The implementation follows that observed
provider code; an actual owner-controlled reset round trip remains untested.
The token is held in component memory, removed from the address, and excluded
from boot-time persisted return URLs. No real reset link/token was obtained.

## Activation remains pending

1. Restore browser access to Final. Confirm the supported custom-auth migration
   controls and any required CAPTCHA. The helper accepts an optional CAPTCHA
   token; the UI does not yet render a CAPTCHA. Do not disable provider checks.
2. Verify current deployed entity/function permissions before expanding global
   visibility. Frontend route guards are not server-side authorization. No
   backend changes are included or authorized by this draft.
3. Review and apply the supported platform custom-auth transition together with
   the approved frontend revision. Base44 documentation describes Public (no
   login) and Enable custom auth, including automatic AI wiring; reconcile that
   behavior before allowing it to overwrite these prepared pages. Do not flip
   Private in isolation or merge this draft solely to clear a Google warning.
4. Verify existing email/Google/Apple accounts, email verification, canceled
   provider login, recovery and logout in the resulting app. Confirm signed-out
   homepage and complete privacy content, then resubmit Google branding.
5. Verify login on the installed TestFlight build. The location permission domain
   still requires the separate native-origin rebuild; this patch cannot change
   the embedded BrandedSiteUrl in the existing IPA.

Current live status: no merge, Base44 visibility/authentication change, publish,
build generation, email/reset request, credential change or account creation.
Google domain ownership is complete; Google brand approval remains pending.

Sources:
- https://docs.base44.com/Setting-up-your-app/Managing-login-and-registration
- https://docs.base44.com/Community-and-support/Troubleshooting
- https://docs.base44.com/developers/references/sdk/docs/interfaces/auth

Run only the focused suite for changes here:

```sh
node --test tests/member-access.test.mjs tests/branded-auth.test.mjs tests/public-access-render.test.mjs tests/reset-link-bootstrap.test.mjs
```
