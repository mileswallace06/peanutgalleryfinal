# Fan Gift upload recovery — PR #18 review follow-up

Comparison head: `3a56073ba06f9f25b42844d2ca67068dafd4c554`. All files, events, identities and upload responses here are synthetic. No file was sent to Base44, no gift was created, and no production endpoint ran.

## Repair

The existing upload handler cleared its busy flag only after a successful upload. The reviewed head had added that flag to both creation buttons, so a rejected upload stranded the open draft: the file picker and creation button stayed disabled, no error appeared, and the only recovery was closing the form and losing the draft.

`CreateFlashDropSheet` now catches rejected or malformed upload responses, always clears the current request's busy state, and shows a specific retry message without resetting seat details. The native file input is cleared when a file is selected, allowing the same file to trigger another change event. Request identity guards prevent delayed responses from updating a closed/replaced draft or crossing an event/user change. Submission remains disabled during the upload itself.

Refund, payout, tracking and Account Transfer policy choices are unchanged. In particular, the Account Transfer option visible in the screenshots remains an unresolved owner decision.

## Red/green evidence

- `before-result.json`: the same regression runner fails on the exact reviewed component. It records the synthetic rejection, disabled file picker and submission button, persistent uploading text, and no displayed error. The 8-second wait for an actionable error expires. Zero forbidden calls occurred.
- `after-result.json`: 10 cases pass with zero browser errors, forbidden network/SDK attempts or creation calls. Light/dark × immediate/scheduled × rejected/malformed upload checks preserve section, row, seats, message and scheduled choice; busy disables submission, failure enables it again, and retrying the identical synthetic file succeeds. Two further cases settle a delayed rejection/success after close/reopen and verify the new draft is untouched.
- `before-rejected-light.png`, `after-rejected-light.png`, `after-rejected-dark.png`: actual sheet screenshots at 390×844. These show the upload/recovery UI, not production data or policy approval.

The baseline is a Vite load override for only `CreateFlashDropSheet.jsx` from the exact commit, with the same isolated test and fixture. It never replaces working-tree source, changes browser timers, swallows page errors, or runs a live SDK. Its expected failing exit is retained; assertions are identical for the repaired run.

## Reproduction

```sh
node tests/fan-gift-upload-browser.mjs --baseline
node tests/fan-gift-upload-browser.mjs
node --import ./tests/deny-network.mjs --test tests/oct09-lifecycle.test.mjs tests/flash-drop-dialog.test.mjs
npx eslint src/components/flashdrops/CreateFlashDropSheet.jsx tests/fixtures/oct09-lifecycle/base44.js tests/fixtures/oct09-lifecycle/vite.config.mjs tests/fan-gift-upload-browser.mjs
```

Local browser commands used `PG_CHROMIUM_PATH=/workspace/scratch/580f2607a348/browser-runtime/executable/chromium-oct09` and `PG_CHROMIUM_ARGS='["--no-sandbox","--disable-dev-shm-usage"]'` (Chromium 153.0.8010.0). CI uses its installed Playwright Chromium. The default evidence path is `tests/artifacts/oct09/fan-gift-upload/{before,after}`; the aggregate can set `PG_FAN_GIFT_UPLOAD_EVIDENCE_DIR`.

The 34 existing lifecycle/dialog unit checks passed. Focused ESLint passed with zero errors and one pre-existing `createdDrop` unused-variable warning. These checks establish local UI recovery and unchanged lifecycle behavior; they do not certify the provider's real upload service, content scanning, privacy, or final production deployment.
