# PRODUCTION LAUNCH AUDIT — MONEY, INVENTORY, PAYMENTS, LEGAL

*Code-level review of every money-critical path. No UI, no typography, no mobile.*
*Each issue rated by: 💰 Money Loss | 📦 Inventory Loss | 💳 Payment Failure | 🚫 Blocked Purchase/Listing | ⚖️ Legal/Support Incident*

---

## 💰 1. `cancelPurchase` — Seller Not Notified After Cancellation

**File**: `functions/cancelPurchase.js` (lines 51-54)

**What happens**: When a buyer cancels a purchase, the Purchase is marked `expired`, the listing is restored to `active`, but **no notification is sent to the seller**. The seller may have already initiated a ticket transfer on Ticketmaster/SeatGeek — they will transfer tickets and never get paid, with no idea the purchase was cancelled.

**Impact**: 
- Seller transfers real tickets, buyer gets refund, seller loses tickets + money
- Customer support incidents when sellers report "I transferred but never got paid"
- Legal exposure: sellers could claim PG facilitated fraud

**Fix**: After line 54, add seller notification via `sendUserNotification` with type `listing_expired` or a new `purchase_cancelled` type. Also notify admin if the seller had already confirmed transfer (`seller_confirmed === true`).

---

## 💰 2. `cancelPurchase` — Blindly Restores Listing to `active` Without Status Check

**File**: `functions/cancelPurchase.js` (line 54)

```js
await base44.asServiceRole.entities.Listing.update(purchase.listing_id, { status: 'active' });
```

**What happens**: This force-sets the listing to `active` regardless of its current status. If the seller manually cancelled the listing while the purchase was pending, or if the listing was already `sold` (edge case from a race), this overrides that state and re-activates the listing.

**Impact**: A cancelled-by-seller listing gets re-activated. A sold listing (from a double-purchase race) gets re-listed. Either scenario creates inventory inconsistency and potential double-sale.

**Fix**: Before updating, fetch the current listing status. Only restore to `active` if the listing is currently `pending_transfer`. If it's `cancelled`, `sold`, or `hidden`, leave it alone.

---

## 💰 3. `stripeWebhook` `payment_intent.succeeded` — Creates Inconsistent Payment State

**File**: `functions/stripeWebhook.js` (lines 95-103)

**What happens**: With manual capture, Stripe fires `payment_intent.succeeded` AFTER `capturePayment` calls `stripe.paymentIntents.capture()`. The webhook handler sets `payment_captured = true` but does **not** set `transfer_status = 'completed'`, does **not** mark the listing as `sold`, does **not** award points, and does **not** send notifications.

If `capturePayment` crashes after the Stripe capture call succeeds but before its DB update (network timeout, cold start, etc.), the webhook creates a state where:
- `payment_captured = true` (money is captured)
- `transfer_status = 'pending_transfer'` (purchase not completed)
- Listing status = `pending_transfer` (not marked sold)
- Seller not paid, buyer not notified, points not awarded

`processTransferReminders` then picks up this purchase. Since `seller_confirmed` is true, the 48h seller-no-show expiry doesn't fire. The 24h admin-review flag does fire, but the admin must manually resolve it by navigating to the purchase page and confirming as buyer. If the admin misses the email, the purchase sits in limbo indefinitely — money captured, no payout, listing locked.

**Impact**: Captured payment with no payout. Listing locked in `pending_transfer`. Requires manual admin intervention to resolve. If admin misses the email alert, funds are held indefinitely.

**Fix**: In the `payment_intent.succeeded` handler, if the purchase's `transfer_status` is still `pending_transfer` and both `seller_confirmed` and `buyer_confirmed` are true, complete the full capture flow (mark listing sold, set `transfer_status: 'completed'`, award points, notify). Alternatively, remove the `payment_captured = true` update from the webhook entirely — `capturePayment` already handles this atomically.

---

## 📦 4. `processTransferAlerts` — Fetches Only 50 Listings/Purchases (Default Limit)

**File**: `functions/processTransferAlerts.js` (lines 30, 120, 143)

```js
const activeListings = await base44.asServiceRole.entities.Listing.filter({ status: 'active' });
const pendingPurchases = await base44.asServiceRole.entities.Purchase.filter({ transfer_status: 'pending_transfer' });
const disputes = await base44.asServiceRole.entities.Purchase.filter({ transfer_status: 'disputed' });
```

**What happens**: The Base44 SDK `filter()` defaults to 50 results. These queries fetch only the first 50 active listings, 50 pending purchases, and 50 disputes. Everything beyond that is silently ignored.

- Active listings #51+ never get verification expiration warnings or auto-hide at 60 minutes. They stay active indefinitely with stale transfer verification.
- Pending purchases #51+ never get stalled-transfer admin alerts. Buyers waiting for sellers go unnoticed.
- Disputes #51+ never generate admin alerts. Chargebacks go unhandled.

**Impact**: At even moderate scale (50+ active listings or 50+ pending purchases), critical monitoring silently stops working. Stale listings stay visible (trust risk). Stalled transfers go unalerted (buyer waits indefinitely). Disputes go unhandled (legal/financial risk).

**Fix**: Paginate through all results using `skip` parameter, or add explicit `limit` with looping until `has_more` is false. Process in batches of 50.

---

## 📦 5. `processTransferReminders` — Fetches Only 100 Purchases, `cutoff` Never Used

**File**: `functions/processTransferReminders.js` (lines 51-54)

```js
const cutoff = new Date(now - 72 * 60 * 60 * 1000).toISOString();
const pending = await base44.asServiceRole.entities.Purchase.filter({
    transfer_status: 'pending_transfer',
}, '-created_date', 100);
```

**What happens**: The `cutoff` variable (72 hours ago) is defined but **never included in the filter**. The query fetches the 100 most recent pending purchases regardless of age. If >100 pending purchases exist, older ones are never processed — no reminders, no 48h expiry, no stale-PI warning, no admin review flag. Their Stripe PaymentIntents expire silently at 7 days.

**Impact**: At scale, purchases #101+ fall through the cracks. Stripe PIs expire without admin warning. Buyers' authorizations vanish. Sellers' listings stay locked in `pending_transfer` with no cleanup. Money is lost (authorization expires, buyer must re-authorize) and inventory is lost (listing stuck, never restored to active).

**Fix**: Add `created_date: { $gte: cutoff }` to the filter. Paginate with `skip` to process all matching purchases in batches.

---

## 🚫 6. `onboardSeller` — Stripe Redirect URLs Use Unreliable Origin Header

**File**: `functions/onboardSeller.js` (lines 20-22)

```js
const origin = req.headers.get('origin') || 'https://app.base44.com';
const returnUrl  = `${origin}/sell?onboarding=complete`;
const refreshUrl = `${origin}/sell?onboarding=refresh`;
```

**What happens**: The Stripe onboarding `return_url` and `refresh_url` are built from the request `Origin` header. If the header is missing or spoofed, the fallback is `https://app.base44.com` — which is not the app's domain. After completing Stripe onboarding, sellers are redirected to the wrong URL and land on a broken page. They think onboarding failed and abandon the flow.

**Impact**: Sellers cannot complete onboarding. No onboarded sellers = no listings = no marketplace. This is a **launch blocker** if the Origin header doesn't match the production domain.

**Fix**: Hardcode the production domain or read it from an environment variable. Do not rely on the `Origin` header for Stripe redirect URLs.

---

## 📦 7. `syncInventoryOnListingChange` — Doesn't Handle `hidden` Status

**File**: `functions/syncInventoryOnListingChange.js` (lines 36-54)

**What happens**: The automation handles `cancelled`, `expired`, `sold`, and `pending_transfer` listing statuses. But when `processTransferAlerts` hides a listing (sets `status: 'hidden'` for expired verification), this automation does nothing. The SeatInventory stays in `listed_for_sale` status.

Since the `flashDrop` and `submitListing` functions check for inventory conflicts, and `listed_for_sale` is a blocking status, the seat is now **locked**:
- Can't be sold (listing is hidden from buyers)
- Can't be flash-dropped (inventory conflict: "already has an active sale listing")
- Can't be donated (same conflict)
- No automation restores it (the listing is `hidden`, not `cancelled` or `expired`)
- Sellers can't re-verify from MySales (no edit/re-verify button exists)

The seat is permanently stuck until the seller manually re-verifies transfer availability (if they can find the hidden listing) or admin manually intervenes.

**Impact**: Inventory permanently locked after verification expires. At scale, a meaningful percentage of seats could be locked. Sellers lose the ability to sell, flash-drop, or donate those seats.

**Fix**: Add `hidden` to the terminal statuses in `syncInventoryOnListingChange`, releasing the SeatInventory to `available` (or a new `hidden` inventory status). Alternatively, when a listing is hidden for expired verification, also set SeatInventory to `available` so the seller can re-list or flash-drop.

---

## ⚖️ 8. `flashDrop` — `ALLOW_UNVERIFIED_BETA = true` in Production

**File**: `functions/flashDrop.js` (line 6)

```js
const ALLOW_UNVERIFIED_BETA = true;
```

**What happens**: Any authenticated user can create a Flash Drop for seats they don't own. No listing, purchase, or proof upload is required. The drop is created with `ownership_verified: false` and `abuse_flags: ['unverified_ownership']`, but it's still visible and enterable.

A malicious user could create Flash Drops for seats they don't own. A winner would be "awarded" non-existent seats, contact the "donor," and receive nothing. This undermines trust in the entire Flash Drop system.

**Impact**: Fraud. Users "win" non-existent seats. Customer support incidents. Reputation damage. Potential legal claims from winners who were defrauded.

**Fix**: Set `ALLOW_UNVERIFIED_BETA = false` before launch.

---

## 💳 9. Stripe Webhook Registration — No Verification

**File**: `functions/stripeWebhook.js`

**What happens**: The webhook handler exists and correctly verifies Stripe signatures. However, there is **no code or mechanism to verify the webhook URL is actually registered in the Stripe dashboard**. If the webhook is not registered:
- `charge.dispute.created` — chargebacks don't update Purchase status to `disputed`
- `payment_intent.payment_failed` — failed payments don't restore listings to `active`
- `payout.failed` / `transfer.failed` — sellers aren't notified of payout issues
- `charge.refunded` — admins aren't notified of refunds

This is a **silent failure**. Payments process normally, but edge-case events are missed entirely. The founder won't discover the gap until a dispute occurs and isn't handled — by then, the Stripe chargeback response window (typically 7-10 days) may have expired.

**Impact**: Unhandled chargebacks = lost money (Stripe auto-resolves in buyer's favor). Unhandled payment failures = listings stuck in `pending_transfer`. Unhandled payout failures = sellers not paid with no notification.

**Fix**: Register the webhook URL in Stripe dashboard before launch. Subscribe to: `payment_intent.payment_failed`, `payment_intent.succeeded`, `payout.failed`, `transfer.failed`, `charge.dispute.created`, `charge.refunded`. Add a startup health check that verifies webhook endpoint exists.

---

## ⚖️ 10. Inconsistent Email Domains — Broken Links + Deliverability Risk

**Files**: Multiple backend functions

| Domain | Used In | Purpose |
|--------|---------|---------|
| `experience@peanutgallery.store` | `capturePayment`, `stripeWebhook`, `processTransferReminders`, `verifyTransferProof`, `processTransferAlerts` | Admin alert recipient |
| `experience@peanutgallery.com` | `sendNotificationEmail` (SUPPORT_EMAIL), `CreateListing` instant transfer instructions | Support / Instant transfer recipient |
| `app.peanutgallery.app` | `processTransferAlerts` (lines 47, 77) | Email links |
| `app.peanutgallery.store` | `recordNotification` | Email link URLs |

**What happens**: Admin alerts go to `.store`. Instant transfer tickets go to `.com`. Email links point to `.app` and `.store` inconsistently. If any of these domains aren't properly configured (DNS, SPF, DKIM), emails bounce or go to spam. If the domains don't all resolve to the app, links are broken.

The instant transfer flow is particularly impacted: sellers are told to transfer tickets to `experience@peanutgallery.com`, but admin alerts about capture failures go to `experience@peanutgallery.store`. If only one inbox is monitored, critical alerts are missed.

**Impact**: Broken email links (sellers can't restore hidden listings). Missed admin alerts (disputes, capture failures). Email deliverability issues (inconsistent SPF/DKIM across domains). Support confusion (which email do users contact?).

**Fix**: Standardize on ONE domain and ONE admin email address across all functions. Update all hardcoded references.

---

## 📦 11. No Automation Cleans Up Orphaned Draft Listings (`pending_payout_setup`)

**File**: `entities/Listing.json` (status enum includes `pending_payout_setup`)

**What happens**: The Listing schema includes a `pending_payout_setup` status for draft listings created before seller Stripe onboarding. However, `submitListing` (lines 32-38) **blocks entirely** for non-onboarded sellers — it returns a 403 error instead of creating a draft. If the frontend ever creates drafts via a different path, or if the `pending_payout_setup` status is set by any code, there is **no automation** to clean them up. These drafts accumulate indefinitely, invisible to buyers, potentially confusing sellers.

**Impact**: Database pollution. Seller confusion (drafts that never become active). If the draft creation feature is ever enabled in the frontend, orphaned drafts will accumulate rapidly.

**Fix**: Either remove the `pending_payout_setup` status from the schema (since it's not used), or add a scheduled automation that deletes drafts older than 30 days and emails the seller.

---

## ⚖️ 12. `processTransferAlerts` — No Admin Auth Check

**File**: `functions/processTransferAlerts.js` (lines 18-24)

```js
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // This is a scheduled function — no user session expected.
    // When invoked manually via SDK (test tool or admin UI), the caller may not have
    // an admin session, so we skip user-level auth and rely on service-role operations only.
```

**What happens**: The function has **no authentication check**. Any authenticated user (or unauthenticated caller) can invoke it via `base44.functions.invoke('processTransferAlerts', {})`. While it only performs read operations and creates AdminAlerts, a malicious caller could:
- Trigger mass email sends to all sellers with expiring listings
- Create duplicate AdminAlerts (though `createAlertIfNew` guards against this)
- Consume API resources by repeatedly triggering expensive queries

**Impact**: Resource abuse. Unwanted email spam to sellers. Not directly money-losing, but creates operational noise and potential for abuse.

**Fix**: Add admin auth check (same pattern as `processTransferReminders` — allow if caller is admin or if called by automation scheduler with no session).

---

## Summary: Priority-Ordered Fix List

| # | Issue | Type | Severity | Blocks Launch? |
|---|-------|------|----------|----------------|
| 6 | `onboardSeller` broken redirect URLs | 🚫 Blocked Listing | Critical | **YES** |
| 9 | Stripe webhook not registered | 💳 Payment | Critical | **YES** (verify before launch) |
| 8 | `ALLOW_UNVERIFIED_BETA = true` | ⚖️ Legal/Fraud | Critical | **YES** |
| 1 | `cancelPurchase` no seller notification | ⚖️ Support | High | No, but will cause incidents |
| 3 | Webhook creates inconsistent payment state | 💰 Money Loss | High | No, but requires manual recovery |
| 4 | `processTransferAlerts` 50-item limit | 📦 Inventory | High | No, but breaks at scale |
| 5 | `processTransferReminders` 100-item limit | 📦 Inventory | High | No, but breaks at scale |
| 7 | `hidden` listing status not synced to inventory | 📦 Inventory | High | No, but locks seats permanently |
| 10 | Inconsistent email domains | ⚖️ Support | Medium | No, but causes missed alerts |
| 2 | `cancelPurchase` blind listing restore | 📦 Inventory | Medium | No, but edge cases cause re-listing |
| 11 | No orphaned draft cleanup | 📦 Inventory | Low | No |
| 12 | `processTransferAlerts` no auth | ⚖️ Abuse | Low | No |