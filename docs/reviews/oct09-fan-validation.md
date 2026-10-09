# October 9 Fan Zone validation

Base: `c31a2e1aa9f9c7d7916908ab948201cfad3243a8`, tree `81a876421489227d8c6a9f8bbe9c41e018cd6283`. Tests used the repair working tree, Node 24.19.0 and isolated Chromium 153.0.8010.0. Final branch/CI evidence belongs to the parent repair report. No Fan Zone production behavior or policy was changed by this task.

| Finding | Current result | Evidence |
|---|---|---|
| R09 | **Unresolved historical failure.** Exact original full runner passed before edits; no reliable cause established. Diagnostics added, assertions retained. | [Original gate log](oct09-evidence/fan/original-gate.txt), historical [CI failure](https://github.com/mileswallace06/peanutgalleryfinal/actions/runs/37984839871) |
| R09 repeated/async coverage | Six isolated component scenarios passed, each exercising 12 close cycles after an asynchronous parent render: 72 cycles total, both themes, 320/390 px and 844 × 390 landscape. | [Controlled browser report](oct09-evidence/fan/controlled-report.json) |
| R15 | 36 controlled location scenarios passed across both themes; no new location defect demonstrated. | [Controlled browser log](oct09-evidence/fan/controlled-browser.txt) |

The October 9 audit described the historical timeout as Escape. The downloaded job log instead points to original `fan-zone-browser.mjs:74`, whose action at the reviewed commit is `page.mouse.click(2, 2)` immediately after opening the sort sheet. Escape and the explicit Close button precede that action at lines 72–73. The audit's 11 successful live Escape trials concern a different close path and do not resolve this failure.

The historical artifact contains pre-close screenshots but no failure DOM or focus trace. It cannot establish whether the backdrop click failed to dismiss the sheet or dismissal succeeded and focus was then lost. Radix delays installation of its outside-pointer listener until a timer task; a low-level coordinate click bypasses locator actionability checks. That is a possible timing mechanism, not a demonstrated diagnosis. Earlier isolated raw/actionability comparisons also failed to reproduce the problem. Local Chromium 153 differs from historical CI Chromium 151.

The original full runner was executed unchanged before modifications and passed all 19 scenarios. The updated runner then passed all 19 scenarios with the diagnostic changes ([updated gate log](oct09-evidence/fan/diagnostic-gate.txt)). Both processes exited 0. Its raw backdrop action, 30-second timeout and exact-trigger focus requirement remain. Added diagnostics save failure stage, dialog presence, active element, original trigger connectivity/identity, pointer/focus events, screenshot and rejected SDK calls. The trigger assertion now also verifies the original DOM node survives, so a replacement node cannot silently satisfy it. No sleep, retry-to-green, skip or weaker assertion was introduced.

The new `fan-behavior-browser.mjs` mounts the actual `FanSortSheet`, `FanLocationFilter` and `useFanLocation` with a separate fail-closed fixture. It tests six choices and selected state, trapped Tab/Shift+Tab, repeated Escape/button/backdrop/selection closure, and exact original-trigger restoration across asynchronous parent renders. Passing this minimized fixture does not close the historical R09 failure.

R15 coverage includes deliberate success, denial, timeout, unavailable geolocation, invalid coordinates, disabled in-flight duplicate requests, deliberate retry, stale failure from an earlier request, manual-city and retained-tab cancellation, unmount/remount callbacks, valid zero coordinates, current/expired/future/invalid/malformed caches, validated city cache, legacy GPS cache, and delayed legacy-city migration losing to a newer manual/GPS choice. All GPS and city results are synthetic; no actual location was requested. The new tests cover the real composed hook/control lifecycle. Existing full-page Fan Zone checks separately cover manual selection and nearby-feed behavior.

## Reproduction

Use installed Playwright and a local Chromium; this environment used `PG_CHROMIUM_PATH=/workspace/scratch/580f2607a348/browser-runtime/executable/chromium-oct09`, `PG_CHROMIUM_ARGS='["--no-sandbox","--disable-dev-shm-usage"]'`, and the existing executable/al2023 library paths. The original unchanged run used the equivalent previously restored `chromium-verify` executable.

```sh
# Start the isolated ticket-design Vite fixture, then run the existing full gate:
PG_REVIEW_BASE_URL=http://127.0.0.1:4189 PG_FAN_EVIDENCE_DIR=/tmp/pg-oct09-fan-original node tests/fan-zone-browser.mjs

# Starts its own isolated Vite server on 4191, with HMR/watch disabled:
PG_FAN_BEHAVIOR_EVIDENCE_DIR=/tmp/pg-oct09-fan-behavior node tests/fan-behavior-browser.mjs
```

The parent browser aggregate must include `fan-behavior-browser` and set `PG_FAN_BEHAVIOR_EVIDENCE_DIR` to its artifact directory. Both runners reject unexpected APIs/outbound calls. No posts, uploads, GPS permission prompts, provider code execution or production writes occurred. Browser sizes are emulation; no physical-device or screen-reader execution is claimed. There is no before/after product screenshot claim because no visible product repair was established here.

The controlled runner subsequently passed all 42 cases with the stricter context-level isolation recorder. See [fixture isolation](oct09-fixture-isolation.md) for the additional failure-on-attempt proof and explicit fixture asset/provider substitutions.
