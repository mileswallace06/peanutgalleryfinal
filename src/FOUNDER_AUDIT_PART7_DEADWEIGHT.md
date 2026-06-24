# PART 7: CODEBASE DEAD WEIGHT ANALYSIS

---

# SECTION 11: CODEBASE DEAD WEIGHT ANALYSIS

## Unused Pages

| Page | Path | Status | Recommendation |
|------|------|--------|----------------|
| `pages/AdminMode` | `/admin-legacy` | Superseded by `AdminCommandCenter` | Remove after verifying no features are missing |
| `pages/EventMode` | `/event-mode/:id` | Deprecated — only redirects to `/upgrades/:id` | Remove component and route |
| `pages/Home` | Not routed | Not in App.jsx routes | Remove if truly unused |

## Unused/Duplicate Entities

| Entity | Issue | Recommendation |
|--------|-------|----------------|
| `BetaFeedback` | Overlaps with `BetaFeedbackEvent` — both collect feedback | Consolidate into `BetaFeedbackEvent` (which has more structure) |
| `BugReport` | Separate from `BetaFeedbackEvent` bug reports | Consolidate into `BetaFeedbackEvent` with `feedback_type: 'bug'` |

## Unused Components

| Component | Status | Recommendation |
|-----------|--------|----------------|
| `components/admin/FeeSimulator` | Superseded by `FeeSimulatorV2` | Remove if not imported anywhere |
| `components/admin/TransactionAnalytics` | May be unused if not in AdminCommandCenter | Verify and remove |
| `components/admin/InstantFulfillmentCenter` | No fulfillment workflow exists | Remove |
| `components/admin/InstantListingsQueue` | No queue workflow exists | Remove |
| `components/admin/FeeComparisonReport` | May be unused | Verify and remove |
| `components/admin/MinListingPriceConfig` | Config is in `feeEngine.js` | Remove if just a UI wrapper with no backend |
| `components/admin/EventTimingDebug` | Debug component | Remove for production |
| `components/admin/AIVerificationQueue` | May be superseded by `AIVerificationPanel` | Verify and remove if duplicate |
| `components/admin/fulfillment/*` (all) | Entire fulfillment directory — no fulfillment workflow exists | Remove all: `FulfillmentMetrics`, `FulfillmentItem`, `FulfillmentQueue`, `useUrgency` |

## Duplicate Systems

| System | Duplicates | Recommendation |
|--------|-----------|----------------|
| Admin dashboards | `/admin` (Command Center) and `/admin-legacy` (AdminMode) | Consolidate to one, remove legacy |
| AI verification queue | `AIVerificationQueue` and `AIVerificationPanel` | Consolidate to one |
| Fee simulators | `FeeSimulator` and `FeeSimulatorV2` | Remove old version |
| Feedback entities | `BetaFeedback` and `BetaFeedbackEvent` | Consolidate |
| Bug reporting | `BugReport` entity and `BetaFeedbackEvent` with `feedback_type: 'bug'` | Consolidate |

## Legacy Logic

| Item | Location | Recommendation |
|------|----------|----------------|
| Fee model legacy aliases (`current_5pct`, `pct5_min1`) | `lib/feeEngine.js` | Keep for backward compat with old purchases, or remove if no old data |
| Stripe SDK version | `npm:stripe@14.21.0` in all functions | Consider updating to latest |
| Base44 SDK version mismatch | `npm:@base44/sdk@0.8.25` in most functions, `0.8.31` in `releaseDemoUpgrades` | Standardize to latest |
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` secrets | May be unused legacy secrets | Verify and remove if superseded by `STRIPELIVE*` variants |
| `date` field on Event | Legacy UTC ISO string, `event_start_utc` preferred | Migrate all to `event_start_utc` |

## Placeholder Features

| Feature | Location | Status |
|---------|----------|--------|
| Instant Transfer fulfillment | `fulfillment_*` fields on Purchase, `fulfillment/*` components | No workflow — fields and components exist but nothing uses them |
| Venue partner system | `inventory_source: 'venue_partner'` on Listing | No implementation — field exists but no code creates venue partner listings |
| Referral system | `awardPoints` function, User fields `referral_code`/`referred_by` | Disabled — code exists but returns `referral_system_not_yet_live` |
| Real geofencing | `UpgradeEligibilityGate` component | Simulated only — uses browser geolocation with no server-side validation |
| `upgrade_window_opens_at` / `upgrade_window_closes_at` | Listing entity fields | Not enforced — fields exist but no code checks time windows |
| `transfer_window_*` on Event | Multiple fields | Mostly `unknown` — no automated checking |
| `pg_fulfilled_at` / `pg_fulfilled_by` on Listing | Fields for Instant Transfer | No fulfillment workflow uses these |
| `fulfillment_*` on Purchase | Multiple fields | No fulfillment workflow uses these |

## Demo Leftovers

| Item | Location | Status |
|------|----------|--------|
| `functions/seedDemoListings` | Backend function | Admin-only, useful for testing — keep but ensure not called in production accidentally |
| `functions/releaseDemoUpgrades` | Backend function | Admin-only, creates demo upgrade listings — keep for demo events |
| Demo listing detection | `is_demo_listing` flag + `[DEMO]` notes prefix | Both used — `is_demo_listing` is the canonical check |
| `LiveUpgradeControlPanel` | Admin component | Manages demo upgrade listings — keep for admin use |
| `seedDemoListings` creates 3 events + 15 listings | Hardcoded demo data | Useful for testing — keep but clean up before launch |

## Experimental Code

| Item | Location | Recommendation |
|------|----------|----------------|
| `lib/OPTIMISTIC_UI_GUIDE.md` | Documentation only | Remove or move to wiki |
| `STABILITY_NOTES.md` | Documentation | Remove or move to wiki |
| `STABILIZATION_SPRINT_1.md` | Documentation | Remove or move to wiki |
| `DIAGNOSTIC_REPORT_2026_05_23.md` | Documentation | Remove or move to wiki |
| `EVENT_NOT_FOUND_ROOT_CAUSE_REPORT.md` | Documentation | Remove or move to wiki |
| `PG_BASE44_CODE_SNAPSHOT.md` | Documentation | Remove or move to wiki |

## What Can Be Safely Removed

### High Confidence — Safe to Remove

1. **`pages/EventMode`** (`/event-mode/:id`) — Only redirects to `/upgrades/:id`, serves no purpose
2. **`pages/Home`** — Not routed, appears unused
3. **`components/admin/FeeSimulator`** — Superseded by `FeeSimulatorV2`
4. **`components/admin/fulfillment/*`** (entire directory) — No fulfillment workflow exists: `FulfillmentMetrics`, `FulfillmentItem`, `FulfillmentQueue`, `useUrgency`
5. **`components/admin/InstantFulfillmentCenter`** — No workflow
6. **`components/admin/InstantListingsQueue`** — No queue workflow
7. **Markdown documentation files** — Not code, but clutter in repo: `STABILITY_NOTES.md`, `STABILIZATION_SPRINT_1.md`, `DIAGNOSTIC_REPORT_2026_05_23.md`, `EVENT_NOT_FOUND_ROOT_CAUSE_REPORT.md`, `PG_BASE44_CODE_SNAPSHOT.md`, `lib/OPTIMISTIC_UI_GUIDE.md`

### Medium Confidence — Verify Before Removing

8. **`pages/AdminMode`** (`/admin-legacy`) — Verify no features are missing from Command Center before removing
9. **`components/admin/FeeSimulator`** — Verify it's not imported anywhere
10. **`components/admin/TransactionAnalytics`** — Verify not used
11. **`components/admin/FeeComparisonReport`** — Verify not used
12. **`components/admin/MinListingPriceConfig`** — Verify not used
13. **`components/admin/EventTimingDebug`** — Debug only
14. **`components/admin/AIVerificationQueue`** — Verify not duplicate of `AIVerificationPanel`
15. **`BetaFeedback` entity** — Consolidate into `BetaFeedbackEvent`
16. **Legacy fee model aliases** — Keep if old purchases reference them, remove otherwise
17. **Legacy Stripe secrets** (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`) — Verify unused and remove

### Low Confidence — Requires Careful Analysis

18. **Legacy `date` field on Event** — Migrate all code to use `event_start_utc`, but keep field for backward compat with existing data
19. **`diagnoseSeller` function** — Has no admin check (security issue). Either add admin gate or remove if not needed
20. **Unused User fields** (`referral_code`, `referred_by`) — Keep if planning to build referral system, remove if not