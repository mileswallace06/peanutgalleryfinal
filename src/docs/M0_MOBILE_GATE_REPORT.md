# M0 Mobile Launch-Blocker Gate — Final Report

**Phase 1B · Gate M0 · Bounded Functional Mobile Pass**
**Date: 2026-08-18**
**Commit: `50c2fc1`**
**Maintenance: ON · Launch gate: RED · Function count: 50 · Provider calls: 0**

---

## 1. Checkpoint (Before)

| Item | Value |
|------|-------|
| HEAD | `d6a70969d68f0837df888caecf65ffc8b0f9d0e4` |
| git status | CLEAN |
| Function count | 50 |
| Maintenance | ON (`MAINTENANCE_MODE=true`) |
| Build result | exit 0 (PASS) |
| Relevant files | Events.jsx, Layout.jsx, FeedbackWidget.jsx, BugTracker.jsx, tmCache.js, Event.jsonc, BetaFeedbackEvent.jsonc |

---

## 2. Issues Reproduced & Root Causes

### Issue 1: Searches for specific artists/teams returning no results

**Root cause (confirmed):** The PG and TM fetches were coupled in `Promise.all`. If the TM API failed (rate limit, network, no results without location), the entire fetch rejected, and PG events that matched the search were never shown. Additionally, the `ll` (latlong) filter contained `pgFiltered = []` when TM returned zero cities — clearing ALL PG events.

**Secondary:** The keyword filter was applied only to PG events, not TM events. TM events were shown unfiltered, causing noise when TM succeeded but irrelevance when searching specific terms.

**Tertiary:** All 50 Event records have `artist` field empty (null). Search relied on `title` matching only, which worked for most events but missed artist-only queries.

### Issue 2: Report Bug feature doing nothing

**Root cause (confirmed):** The FeedbackWidget FAB was positioned at `bottom-24` (96px) with `z-40`. The bottom nav is ~110px tall on iPhone (76px content + 34px safe-area) at `z-50`. The nav overlapped the FAB, intercepting taps.

**Secondary:** `handleSend` had no try/catch. If `BetaFeedbackEvent.create` threw (network error, RLS issue), the button stuck at "Sending…" with no error feedback — silent failure.

### Issue 3: Non-working buttons

**Root cause:** Same as Issue 2 — the FeedbackWidget FAB was covered by the bottom nav. No other non-working buttons were confirmed in the primary mobile flows (nav, search, event selection, sort, past-events toggle, location chip, retry buttons all have working handlers).

---

## 3. Fixes Implemented

### Fix 1: Search — Decouple PG/TM fetches (`Events.jsx`)
- Replaced `Promise.all` with `Promise.allSettled` — TM failure no longer blocks PG results
- Removed `pgFiltered = []` bug in the `ll` filter — PG events are no longer cleared when TM returns nothing
- TM rate-limit (429) errors are surfaced without blocking PG events

### Fix 2: Search — Apply keyword filter to TM events (`Events.jsx`)
- TM events are now filtered client-side by the same keyword logic as PG events
- Ensures consistent search results regardless of whether TM filtered server-side

### Fix 3: Search — Punctuation-insensitive, whitespace-normalized matching (`searchNormalize.js`)
- Extracted `normalizeSearch` and `eventMatchesKeyword` to `src/lib/searchNormalize.js`
- Normalization: lowercase → strip punctuation → collapse whitespace → trim
- Applied to both PG and TM keyword filters and the city filter

### Fix 4: Report Bug — FAB position and z-index (`FeedbackWidget.jsx`)
- Moved FAB from `bottom-24` (96px) to `calc(5.5rem + env(safe-area-inset-bottom))` (122px on iPhone)
- Raised z-index from `z-40` to `z-[60]` (above nav's `z-50`)
- FAB now clears the nav by ≥12px on all tested viewports

### Fix 5: Report Bug — Error handling and double-submit prevention (`FeedbackWidget.jsx`)
- Added try/catch to `handleSend` with visible error feedback
- Added `sending` guard to prevent double submission
- Error message displayed in the sheet on failure

---

## 4. Files Changed

| File | Change |
|------|--------|
| `src/pages/Events.jsx` | Decouple PG/TM (allSettled), fix ll-filter bug, apply keyword to TM, use normalizeSearch, remove unused import |
| `src/components/beta/FeedbackWidget.jsx` | FAB position/z-index, error handling, double-submit prevention |
| `src/lib/searchNormalize.js` | NEW — normalizeSearch + eventMatchesKeyword (testable) |
| `tests/search-normalize.test.mjs` | NEW — 34 regression assertions for search normalization |
| `tests/mobile-search-report.test.mjs` | NEW — 18 regression assertions for M0 root causes |
| `package.json` | Added `test:search` and `test:mobile-m0` scripts |

---

## 5. Before/After Behavior

| Scenario | Before | After |
|----------|--------|-------|
| Search "Diamondbacks" with TM rate-limited | 0 results (Promise.all rejected) | 5 PG results shown |
| Search "RAYE" with no location set | 0 results if TM fails | 1 PG result shown |
| Search "Arizona Diamondbacks vs Pittsburgh Pirates" (no dots) | 0 matches (punctuation-sensitive) | 3 matches (punctuation-insensitive) |
| Search "  RAYE   THIS   TOUR  " (extra spaces) | 0 matches (whitespace-sensitive) | 1 match (whitespace-normalized) |
| Tap Report Bug FAB on iPhone | No response (nav intercepts tap) | Feedback sheet opens |
| Submit feedback with network error | Button stuck at "Sending…" | Error message shown, button resets |
| Double-tap Send Feedback | Two create calls | One create call (sending guard) |
| "Near me" with TM returning 0 events | 0 PG events shown (pgFiltered=[]) | All PG events shown |

---

## 6. Viewport Matrix

| Viewport | Search | Report Bug FAB | Nav | Event Selection |
|----------|--------|---------------|-----|-----------------|
| 320×568 | PASS | PASS | PASS | PASS |
| 360×800 | PASS | PASS | PASS | PASS |
| 390×844 | PASS | PASS | PASS | PASS |
| 430×932 | PASS | PASS | PASS | PASS |

---

## 7. Tests & Exit Codes

| Command | Exit Code | Notes |
|---------|----------|-------|
| `npm run test:search` | **0** | 34 passed, 0 failed |
| `npm run test:mobile-m0` | **0** | 18 passed, 0 failed |
| `npm run build` | **0** | Vite build succeeded |
| `npm test` | **1** | Pre-existing launch-gate RED (not M0). 19/21 suites PASS. |
| Scoped ESLint `Events.jsx` | **0** | 0 errors (fixed unused import) |
| Scoped ESLint `FeedbackWidget.jsx` | **0** | 0 errors |
| Scoped ESLint `searchNormalize.js` | **0** | Clean |
| Scoped ESLint `search-normalize.test.mjs` | **0** | Clean |
| Scoped ESLint `mobile-search-report.test.mjs` | **0** | Clean |

**Pre-existing failures (not caused by M0):** `launch-gate` (RED — production integration not implemented), `concurrent-alert-deduplication` (known-limitation).

---

## 8. Synthetic Cleanup

No synthetic data was created during testing. All search tests ran against existing Event records. No BetaFeedbackEvent or BugReport records were created. No database mutations occurred.

---

## 9. Remaining Mobile Blockers

- **None confirmed** in the bounded flows tested (search, Report Bug, nav, event selection, sort, purchase dialog not tested in this pass).
- **Not tested:** Purchase dialog open/close, account/settings navigation, modal/dialog close controls (outside the scope of the three reported blockers; no defects reported in these flows).
- **Pre-existing:** Launch gate remains RED (production integration not implemented). Maintenance remains ON.

---

## 10. Search Investigation Summary

**Path traced:** `input → keyword state → form submit → fetchEvents → Promise.allSettled [PG .list, TM fetchTMEvents] → normalizeSearch → eventMatchesKeyword filter (PG + TM) → setEvents → filtered (date sort) → rendered EventRow list`

**5 real artist/team names tested:** Hail the Sun (2), Arizona Diamondbacks (5), RAYE (1), Phoenix Mercury (1), Season Closing Singalong (1)
**No-result query:** "Taylor Swift Nonexistent 12345" → 0 results ✓
**Case-insensitive:** "hail the sun" → 2 results ✓
**Punctuation-insensitive:** "Arizona Diamondbacks vs Pittsburgh Pirates" (no dots) → 3 results ✓
**Whitespace-normalized:** "  RAYE   THIS   TOUR  " → 1 result ✓
**No external providers contacted.** No private fields exposed.

---

**M0 mobile gate complete. Stopping. No Neon work resumed. 7C.9D not started.**