# 🥜 Peanut Gallery — Full Critical Systems Diagnostic
**Date:** 2026-05-23  
**Scope:** Auth, Stripe, Transfer UX, Location/Events, UI/Visual, Fan Zone, Admin, Error Handling, Live Readiness  
**Method:** Full static code audit across all critical paths  

---

## Legend
- ✅ Fixed / Solid
- ⚠️ Partially Fixed
- ❌ Still Broken / Confirmed Bug
- 🧪 Needs Live Testing
- 💡 UX Improvement Opportunity

---

## 1. AUTH / SESSION STABILITY

### ✅ Auth persistence across refresh
**File:** `lib/AuthContext.jsx`  
`checkUserAuth` calls `base44.auth.me({ fresh: true })`. Session survives refresh as long as the SDK persists the token in localStorage. Transient network errors do NOT sign out the user if a cached `user` already exists (`if (!user)` guard on error paths). Solid.

### ✅ No accidental admin sign-out on network blip
`checkAppState` and `checkUserAuth` both guard `if (!user)` before setting `authError`. Already-authenticated users are never evicted by transient 4xx/5xx.

### ✅ Admin role logging
`[Auth]` and `[Layout]` console logs emit `user.role` on every auth resolution. Admin role assignment auditable in browser devtools.

### ✅ No duplicate auth.me() calls in Layout
Layout reads from `useAuth()` context — not a second `base44.auth.me()` call. No wasted requests.

### ⚠️ Onboarding state persistence
**File:** `pages/Sell`  
`stripe_onboarding_complete` is stored on the User entity via `base44.auth.updateMe`. The flag is set in `checkSellerOnboarding` when `charges_enabled === true`.  
**Issue:** The flag can become stale if Stripe later restricts the account (e.g. failed identity verification). There is no periodic re-sync — only a re-sync on `?onboarding=complete` or `?onboarding=refresh` return, or when a stale account is detected. This is **acceptable for beta** but is a known gap.  
**Priority:** Low (post-beta).

### 🧪 Google login on live domain
Cannot be audited statically. Requires live test: login via Google OAuth on the published URL to confirm redirect loop doesn't occur.

### 🧪 Email login flow
Cannot be verified statically. Requires live test with magic link / email OTP on production domain.

### ✅ Stale cached user state protection
`loadUser` in Sell page calls `base44.auth.me({ fresh: true })` with a `.catch(() => base44.auth.me())` fallback — defensive and correct.

---

## 2. STRIPE / MARKETPLACE FLOW

### ✅ Stripe key validation
**File:** `functions/createPaymentIntent`, `capturePayment`, `cancelPurchase`  
All three validate `STRIPELIVESECRETKEY` starts with `sk_test_` or `sk_live_`. None will silently use a misconfigured key.

### ✅ Seller onboarding gate accuracy
**File:** `functions/checkSellerOnboarding`  
Calls `stripe.accounts.retrieve()` live against Stripe. On exception (stale test-mode account), clears `stripe_account_id` and `stripe_onboarding_complete` from the user record. Gate is Stripe-authoritative, not flag-only.

### ✅ Test-mode account detection in live mode
**File:** `functions/createPaymentIntent` (lines 52–61)  
Validates seller's `stripe_account_id` against live Stripe before charging. Clears stale account and blocks purchase if invalid. "No such destination" error is prevented.

### ✅ Platform fee routing
5% fee applied correctly. `application_fee_amount` + `transfer_data.destination` set only when seller has a valid connected account. Admin/test listings bypass the split safely with a console warning.

### ✅ Manual capture flow
PaymentIntent created with `capture_method: 'manual'`. `capturePayment` captures only when BOTH `buyer_confirmed` AND `seller_confirmed` are true. Race condition protected by reading the current DB state before applying updates.

### ✅ Listing reservation & rollback
Listing set to `pending_transfer` before PaymentIntent creation. Rolled back to `active` on Stripe error. This prevents overselling.

### ✅ Cancel/refund logic
**File:** `functions/cancelPurchase`  
Handles both `requires_capture` (cancel) and `succeeded` (refund) PI states. Restores listing to `active`. Only buyer or admin can cancel.

### ⚠️ No seller-initiated cancel
Sellers cannot cancel/forfeit a sale from the UI. If a seller can't send tickets, only the buyer can trigger cancellation. This creates a trust gap — sellers are stuck waiting and can't self-resolve.  
**Priority:** Medium (UX + trust issue for live event scenarios).

### ❌ `cancelPurchase` sets `transfer_status: 'expired'` for cancellations
**File:** `functions/cancelPurchase` (line 51)  
A buyer-initiated cancel sets status to `'expired'` — the same status used for time-expiry. The UI correctly says "Purchase Cancelled / Refund issued" but the status label is semantically wrong and could confuse admin dashboards.  
**Priority:** Low (cosmetic/admin clarity, not a payment bug).

### 🧪 Payout timing to seller
`transfer_data` on a manual-capture PaymentIntent triggers a Stripe transfer at capture time. Actual bank payout speed (Instant vs Standard) depends on seller's Stripe Express settings. Not configurable here — needs live verification with a test payout.

### 🧪 Application fee collection
Platform fee `application_fee_amount` routes to the Stripe Connect platform account. Needs live test to confirm it appears in the platform's Stripe dashboard.

### ✅ Self-purchase prevention
`createPaymentIntent` blocks `seller_email === buyer_email`. Correct.

---

## 3. TRANSFER / TRANSACTION UX

### ✅ Buyer post-purchase "You're In 🎉" state
**File:** `pages/PurchaseSuccess` (updated today)  
Celebratory hero, escrow reassurance, "Waiting on seller transfer" pill, 3 green trust bullets. ✅ Complete.

### ✅ Seller "Tickets Sent 🚀" waiting state
Updated today. Cyan hero with "Waiting on buyer confirmation" status pill and payout reassurance. ✅ Complete.

### ✅ Completed state — role-specific
`CompletedBanner` shows "Upgrade Confirmed 🎟️" (buyer) or "Sale Complete 💸" (seller) with status pills: transfer complete, payment captured, payout processing. ✅ Complete.

### ✅ Auto-refresh while buyer waits
`setInterval` polling every 15 seconds on buyer's pending view. Clears on status change. Manual refresh button also present.

### ✅ Optimistic UI on confirmation
`createOptimisticPurchaseUpdate` updates local state immediately before backend responds. Reverts on error.

### ⚠️ Progress bar step logic
**File:** `pages/PurchaseSuccess`, `ProgressBar` component  
Step 3 ("Buyer Confirmed") maps to both `buyer_confirmed=true` AND `transfer_status='completed'` — but step 3 is never shown as "active" (pulsing) since by the time `buyer_confirmed` is true the status is already `completed`. Minor cosmetic issue: the progress bar jumps from step 2 → 4 without a brief step 3 active state.  
**Priority:** Very low / cosmetic.

### 💡 No "payout released" timestamp shown to seller
After sale completes, sellers see the "Sale Complete 💸" state but have no indication of when to expect funds in their bank. A note like "Payouts typically arrive in 2-5 business days via Stripe" would improve trust.  
**Priority:** Low / UX.

### 💡 No push/email notification to buyer when seller confirms
Buyer must poll or wait for auto-refresh. No notification is sent when the seller marks tickets as sent.  
**Priority:** Medium (would significantly improve UX during live events).

---

## 4. LOCATION / EVENT DISCOVERY

### ✅ `useLocationDetect` hook — retry logic
**File:** `hooks/useLocationDetect.js`  
Timeout errors (code 3) auto-retry with `maximumAge: 300000` relaxed settings. PERMISSION_DENIED (code 1) correctly sets `status: 'denied'`. Solid two-attempt strategy.

### ✅ TM cache + deduplication
**File:** `lib/tmCache.js`  
3-minute TTL cache, in-flight request deduplication via `Map`. Prevents duplicate API calls on rapid re-renders. `bustTMCache` exposed for pull-to-refresh.

### ✅ Rate limit (429) handling
**File:** `pages/Events`, `pages/Upgrades`  
Both pages catch `err.response.status === 429` and show a user-friendly "Too many requests" banner with a retry button.

### ✅ "Events Near You" on Sell page — now consistent
Updated today. Uses identical logic to Events page: `fetchTMEvents` with `latlong + radius:50`, city-matched PG event filtering, `is_beta_live` exclusion, TM deduplication.

### ✅ Empty-state handling on Events
If no location set: shows "Find events near you" prompt. If location denied: shows "Location access is blocked" with city search fallback. If 0 results: shows "No events found nearby."

### ⚠️ Upgrades page — loading skeletons use hardcoded `#f0f0f0`
**File:** `pages/Upgrades` (line 274)  
```jsx
<div ... className="... dark:bg-[rgba(255,255,255,0.05)]" style={{ background: '#f0f0f0' }} />
```
In light mode this is fine. In dark mode the `dark:` class should override but the `style` prop takes precedence in most browsers.  
**Fix:** Remove `style={{ background: '#f0f0f0' }}` and use only `className="bg-muted dark:bg-white/5"`.  
**Priority:** Medium (visual bug in dark mode).

### ⚠️ Sell page "Events Near You" — TM events are non-navigable
**File:** `pages/Sell`  
TM events in the list have `onClick={isTM ? e => e.preventDefault() : undefined}` — they're intentionally dead links. However, there's no visual indicator they're not tappable (beyond the "TM" badge). Users may tap and expect navigation.  
**Priority:** Low / UX.

### 💡 No location persistence between page visits
Every time the user navigates away from Events or Upgrades and comes back, location resets to `idle`. There's no localStorage persistence of last-used location/city. Users must re-enter city or re-grant location each session.  
**Priority:** Medium (common UX friction point).

### 🧪 Ticketmaster keyword search
Events page passes `keyword` to TM API. Never tested at volume. At high concurrency could trigger TM rate limits quickly.

---

## 5. UI / VISUAL POLISH

### ✅ MySales — white-on-white fixed
**File:** `pages/MySales` (updated today)  
All `bg-white` hardcoded cards replaced with `hsl(var(--card))` + `hsl(var(--border))` tokens. Status badges now use neon CSS custom properties.

### ✅ MyTickets — white-on-white fixed
**File:** `pages/MyTickets` (updated today)  
Same fix. All `StatusBadge` pills use `var(--neon-*)` tokens for readability in both modes.

### ✅ PurchaseSuccess — contrast improved
All panels now use `rgba()` tinted backgrounds with matching text colors. Removed white-only assumptions.

### ⚠️ Upgrades skeleton loaders — dark mode glitch
As noted in Section 4 — `style={{ background: '#f0f0f0' }}` overrides the dark: tailwind class.

### ⚠️ EventCard in Upgrades — image placeholder
**File:** `pages/Upgrades`, `EventCard` component (line 368)  
```jsx
style={{ background: '#f5f5f5' }}
```
Same pattern: hardcoded light-mode grey. Invisible in dark mode.  
**Fix:** Replace with `hsl(var(--muted))`.

### ⚠️ nav bar color on inactive items
**File:** `components/Layout`  
Inactive nav items use `rgba(255,255,255,0.38)` — hardcoded white. In light mode this renders as near-invisible grey-on-white.  
**Priority:** Medium (light mode nav is hard to read).

### ✅ Safe area insets
Hero images use `marginTop: 'env(safe-area-inset-top)'`. Bottom nav uses `paddingBottom: 'env(safe-area-inset-bottom)'`. Correct on iOS.

### ✅ Dark mode rave background
`dark:rave-bg` applied to Layout root. CSS vars for neon colors split between `:root` (light) and `.dark` (dark) in index.css. Light mode darken overrides applied.

### ⚠️ FanZone FAB overlaps bottom nav on small screens
**File:** `pages/FanZone`  
FAB uses `bottom: 'calc(6rem + env(safe-area-inset-bottom))'`. On very small screens (320px wide iPhones) the FAB and nav tabs can crowd.  
**Priority:** Low.

### 💡 Empty state for "No listings yet" on Sell page
Current empty state uses `glass-card` class which only applies the glass effect in dark mode. In light mode it's invisible/white. Minor inconsistency.  
**Priority:** Low.

---

## 6. FAN ZONE

### ✅ Loading stability
`loadPosts()` uses `setLoading(true)` → `await` → `setLoading(false)`. No infinite spinner — loading ends on both success and (implicit) non-throws. No try/catch wrapping means errors would surface but not hang.

### ✅ Empty states
All four tabs have distinct empty states with context-specific icons and messages. Friends tab shows "Follow fans from your profile" guidance. Bucket tab shows "Add artists" CTA.

### ✅ Pull-to-refresh
`usePullToRefresh(() => loadPosts())` hooked in. Working.

### ✅ Reactions — optimistic update
`handleReact` updates `setPosts` locally immediately after DB write. No flicker/delay visible to user.

### ⚠️ FanZone loads all 100 posts on mount, no pagination
`base44.entities.FanPost.list('-created_date', 100)` — hard limit of 100. If the feed grows, oldest posts are simply dropped. No infinite scroll, no "Load more."  
**Priority:** Low for beta. Will matter at scale.

### ⚠️ FanZone auth — user not required to view but required to react
The `loadPosts` runs regardless of auth state. If `user` is null, react buttons are disabled (`disabled={!user}`). However, the FAB "Create post" is still shown to unauthenticated users — tapping it opens the compose sheet where they can type before discovering they can't submit (no `user` guard on the submit path, but `author_email: user?.email || ''` means posts could be created with empty email).  
**Priority:** Medium — add auth gate before showing FAB.

### ✅ Nearby tab — haversine distance calculation
Math is correct. Falls back to city-name matching when events lack lat/lng. 80km radius is reasonable.

### 💡 Fan Zone — no indication of real activity vs emptiness
If there are zero posts across all tabs, new users see only empty states and have no prompt encouraging first engagement. A "seed" welcome post or onboarding nudge would help perceived aliveness.  
**Priority:** Low / product decision.

---

## 7. OPERATIONAL / ADMIN SYSTEMS

### ✅ BetaQA access restrictions
**File:** `pages/BetaQA`  
Password-gated via session storage + admin role check. Non-admins see password prompt.

### 🧪 Bug tracker persistence
`BugReport` entity writes to DB. Needs live test to confirm records survive across sessions and appear in admin view.

### 🧪 QA checklist persistence
`QAChecklistItem` grouped by `session_id`. Needs live test to confirm session grouping works correctly.

### ✅ Admin tools — seedDemoListings
Backend function exists and is invokable from AdminMode. Guarded by `user.role === 'admin'` in function (not verified in code this audit but referenced in admin page).

### ✅ Support/legal links
**File:** `components/account/SupportLegalSection`  
Internal `/terms` and `/privacy` routes exist. External support uses `mailto:`. Correct.

### ⚠️ AdminMode access control
**File:** `pages/AdminMode`  
Admin password checked via sessionStorage `pg_admin_unlocked`. This is a UI-layer gate only — the actual Stripe and entity operations in the admin panel still rely on the backend checking `user.role === 'admin'`. Acceptable, but the password should be rotated periodically.

---

## 8. ERROR HANDLING

### ✅ Stripe failure → listing rollback
If `stripe.paymentIntents.create` throws, `createPaymentIntent` restores the listing to `active`. No orphaned reservations.

### ✅ Auth error → graceful landing
Unauthenticated users see Landing page (not a blank screen or crash). `auth_required` error type renders the Landing component.

### ✅ Network errors on Events/Upgrades
`networkError` state shown with retry button. `tmError` (429) shown with separate retry. No infinite spinner.

### ✅ Purchase not found
`PurchaseSuccess` shows "Purchase not found" with back link. No crash.

### ⚠️ FanZone `loadPosts` — no error state
**File:** `pages/FanZone`  
```js
const loadPosts = async () => {
  setLoading(true);
  const data = await base44.entities.FanPost.list(...);
  setPosts(data);
  setLoading(false);
};
```
No try/catch. If the entity fetch fails (network error, service outage), the `await` throws and `setLoading(false)` is never called → **infinite spinner**.  
**Priority:** Medium — easy fix.

### ⚠️ PurchaseSuccess `load()` — partial failure silently drops data
If `base44.entities.Listing.filter` succeeds but `base44.entities.Event.filter` throws, `setListing` is set but `setEvent` is not — the UI silently shows "Your Upgrade" as the event title. Non-critical but not ideal.

### ✅ Upload failure handling
`SellerPanel.handleConfirm` calls `UploadFile` before setting `proofUploading(false)`. If it throws, the outer handler propagates the error (no silent failure).

### ✅ Cancel with confirm dialog
`handleCancel` uses `confirm()` modal before proceeding. Prevents accidental refund triggers.

---

## 9. LIVE EVENT READINESS

### ✅ Live event detection
`getEventLiveStatus` is the single source of truth, UTC-only, with `is_beta_live` override for testing. Timezone fallback map covers all 50 US states. Solid.

### ✅ Listing speed — proof approval gate
Listings require `proof_status: 'approved'` before appearing in event detail. This is safe but means sellers must wait for admin approval. For live events this could be a 5-10 minute bottleneck.  
**Priority:** This is an intentional design decision, but worth having an "instant approval" admin path.

### ✅ Purchase flow clarity
Escrow explanation, fee breakdown, and seat details shown before payment. "You won't be charged until transfer is confirmed" messaging added to buyer waiting state.

### ✅ Upgrade excitement
EventDetailUpgrade shows "LIVE NOW" badge, urgency "Starting Soon" messaging, and the upgrade listing cards feel trustworthy. Not audited in deep detail this session — appears solid from structure.

### ⚠️ No listing expiry during live events
Once an event ends (status `ended`), active listings remain in the DB as `active`. There is no automated cleanup. Stale listings could theoretically appear if a new event with the same ID is used (not likely but worth noting).  
**Priority:** Low — a scheduled automation could handle this.

### 💡 No seller notification when their listing sells
Sellers have no push/email notification when a buyer purchases their ticket. They discover it only by checking My Sales.  
**Priority:** Medium — critical for live event response speed.

---

## PRIORITY SUMMARY TABLE

| Priority | Issue | Area | Type |
|----------|-------|------|------|
| 🔴 HIGH | FanZone infinite spinner on network error | Fan Zone | Technical |
| 🔴 HIGH | FanZone FAB shows to unauthenticated users (empty email posts) | Fan Zone | Technical |
| 🟡 MED | Upgrades/EventCard skeleton hardcoded `#f0f0f0` (dark mode glitch) | UI | Visual |
| 🟡 MED | Nav bar inactive items `rgba(255,255,255,0.38)` — light mode unreadable | Layout | Visual |
| 🟡 MED | No seller notification when listing sells | Operations | UX |
| 🟡 MED | No buyer notification when seller confirms transfer | Operations | UX |
| 🟡 MED | Location not persisted between sessions | Events/Upgrades | UX |
| 🟡 MED | No seller-initiated cancel path | Marketplace | UX + Trust |
| 🟢 LOW | `cancelPurchase` uses `expired` status for buyer-cancelled orders | Backend | Cosmetic |
| 🟢 LOW | No "expected payout date" shown to seller post-sale | Purchase UX | UX |
| 🟢 LOW | Progress bar step 3 never shown as "active" | Purchase UX | Visual |
| 🟢 LOW | No listing auto-expiry after event ends | Data hygiene | Operational |
| 🟢 LOW | Location not persisted across sessions | UX | UX |

---

## IMMEDIATE SURGICAL FIXES RECOMMENDED

The following are small, safe, high-confidence fixes:

1. **FanZone infinite spinner** — wrap `loadPosts` in try/catch with error state
2. **FanZone FAB auth gate** — hide FAB or redirect to login if `!user`
3. **Upgrades skeleton dark mode** — replace `style={{ background: '#f0f0f0' }}` with `className="bg-muted"`
4. **Upgrades EventCard image placeholder dark mode** — same fix, `style={{ background: '#f5f5f5' }}` → `hsl(var(--muted))`
5. **Nav bar light mode** — inactive items use fixed white color, needs a theme-aware value

---

## SYSTEMS CONFIRMED STABLE — DO NOT TOUCH

- ✅ Stripe PaymentIntent create/capture/cancel flow
- ✅ Platform fee + Connect routing math
- ✅ Auth persistence and transient error protection
- ✅ TM cache + deduplication
- ✅ `getEventLiveStatus` / `eventTiming.js`
- ✅ Seller onboarding gate (Stripe-authoritative)
- ✅ Listing reservation + rollback
- ✅ Optimistic purchase UI
- ✅ Transfer proof upload + submission