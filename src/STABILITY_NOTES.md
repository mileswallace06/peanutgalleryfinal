# Peanut Gallery — Stability Notes
_Last updated: 2026-05-18_

---

## ✅ Confirmed Working (Stable)

1. **Checkout & Payment Authorization**
   - Stripe PaymentIntent created server-side in `manual` capture mode (escrow)
   - Card authorized but NOT charged at checkout
   - Listing status atomically set to `pending_transfer` during checkout

2. **Listing Reservation**
   - Listing marked `pending_transfer` at PaymentIntent creation
   - Restored to `active` if checkout fails or dialog is closed before completion
   - PurchaseDialog tracks `reservedListingId` to release on early close

3. **Seller Transfer Flow**
   - Seller sees step-by-step instructions with platform launch buttons
   - Seller CANNOT confirm without proof screenshot and/or transfer note
   - Proof saved to Purchase entity before `capturePayment` is called

4. **Buyer Confirmation Flow**
   - Buyer sees waiting state with reassurance copy
   - Auto-refreshes every 15 seconds while pending
   - Seller's transfer proof shown to buyer before confirm CTA
   - Buyer can open dispute or cancel/refund

5. **Dual-Confirmation Payment Capture**
   - Payment captured ONLY after BOTH `seller_confirmed` AND `buyer_confirmed` are true
   - `capturePayment` function handles both roles idempotently
   - Listing set to `sold` only on full completion

6. **Cancellation & Refund**
   - `cancelPurchase` cancels or refunds the Stripe PaymentIntent
   - Listing restored to `active` on cancel

7. **Dispute Capture Blocking**
   - `capturePayment` explicitly blocks on `transfer_status === 'disputed'`, returning a 409 conflict
   - Disputed purchases cannot be captured under any circumstances — requires admin intervention first
   - `cancelPurchase` allows admin refunds on disputed records (while still blocking other terminal states)

8. **Admin Dispute Resolution — Verified with Real Stripe Test PIs**
   - All three admin dispute actions (Refund Buyer, Release to Seller, Refund + Strike) were regression-tested using real Stripe test PaymentIntents in `manual` capture mode
   - **Refund Buyer**: Stripe PI cancelled → Purchase marked `expired` ✅
   - **Release to Seller**: Stripe PI captured → Purchase marked `completed` ✅
   - **Refund + Strike**: Seller `strike_count` incremented correctly ✅

9. **Seller Performance Metrics**
   - `SellerMetrics` component on MySales calculates avg confirmation time
   - Tier badges: Elite (<2m), Fast (<5m), Reliable (<15m), Slow (15m+)

10. **Full End-to-End Flow — Confirmed Working ✅** _(2026-05-06)_
    - Seller lists tickets → Buyer purchases → Payment authorized in escrow
    - Seller sends tickets + submits proof → Buyer confirms receipt
    - Payment captured → Transfer complete
    - All intermediate states (dispute, cancel, refund) verified

---

## ✅ Stripe Connect Marketplace Verification — Completed _(2026-05-18)_

> **Payment infrastructure is stable and verified. Do not modify payment architecture casually moving forward.**

### Verified Systems
- Stripe Connect Express onboarding (Phase 1 + Phase 2)
- Non-admin seller payout onboarding gate (`submitListing` + `createPaymentIntent` both enforce)
- `transfer_data.destination` payout routing to seller's connected Express account
- `application_fee_amount` platform fee retention by Peanut Gallery
- Manual capture escrow flow preserved (`capture_method: manual` — unchanged)
- Dual-confirmation capture flow preserved (`capturePayment` unchanged)
- Seller payout blocking for non-onboarded users (402 returned, listing not reserved)
- Admin/test listing fallback behavior (no Connect split, warning logged)

### Verified Fee Structure
| Party | Amount |
|---|---|
| Buyer pays | subtotal + 5% fee |
| Seller receives | subtotal (via `transfer_data.destination` on capture) |
| Peanut Gallery keeps | 5% (via `application_fee_amount`) |

**Example:** 2 tickets @ $50 → buyer pays $105.00, seller receives $100.00, PG keeps $5.00.

### Verified Behaviors
- Uncaptured auth before dual confirmation — payment held in escrow, not charged
- Successful Stripe capture after dual confirmation routes payout to connected account
- Connected account destination transfer confirmed on PaymentIntent (`acct_1TYXagIkbrKeayd4`)
- Cancellation before capture safely voids the authorization (no charge)
- Admin permissions hardened — `isAdmin()` checks `user.role === 'admin'` strictly, no fallbacks
- Non-admin users blocked from bypassing onboarding at both frontend and backend layers
- Safety gate blocks real seller purchases if `stripe_account_id` is missing (402, not 500)

### Test Run Results (2026-05-18)
- `createPaymentIntent` with real seller + no `stripe_account_id` → **402 BLOCKED** ✅
- `createPaymentIntent` with admin/test listing → **200, Connect fields present** ✅
- `application_fee_amount: 245` cents ($2.45 on $49 subtotal) confirmed in Stripe ✅
- `transfer_data.destination: acct_1TYXagIkbrKeayd4` confirmed in Stripe ✅
- `capturePayment` code unchanged — zero modifications during Phase 2 ✅

---

## 🔒 Do Not Touch Without Clear Reason

| File/Function | Why Protected |
|---|---|
| `functions/submitListing.js` | Fraud checks; listing creation; proof status logic |
| `functions/createPaymentIntent.js` | Core escrow logic; listing reservation; Stripe PI creation; **Connect split via `transfer_data` + `application_fee_amount`** |
| `functions/capturePayment.js` | Dual-confirm gate; Stripe capture; listing finalization; **triggers destination transfer on capture** |
| `functions/cancelPurchase.js` | Refund logic; listing restoration; allows admin refund on disputed records |
| `components/events/PurchaseDialog.jsx` | Checkout form; reservation tracking; navigate-on-success |
| `pages/PurchaseSuccess.jsx` | Full transfer UX; seller/buyer role logic; proof upload |
| Listing `status` enum values | `active → pending_transfer → sold/cancelled` — order matters throughout |
| Purchase `transfer_status` enum values | `pending_transfer → completed/expired/disputed` — drives all UI states |
| Dispute logic in `capturePayment` / `cancelPurchase` | Verified with real Stripe test PIs — do not modify without full regression testing |

---

## 🎨 Approved Next Work

Only the following categories of work should proceed unless explicitly decided otherwise:

- **Visual polish** — styling, spacing, animations, dark mode consistency
- **Onboarding** — new user flow, tooltips, empty states
- **Non-core UI** — profile page, settings, discovery improvements, event search UX

---

## ⚠️ Known Remaining Gaps

1. **No seller notification** — Seller has no push/email alert when a purchase is created; they must check MySales manually.
2. **No buyer email confirmation** — No email sent to buyer after payment authorizes.
3. **Dispute resolution is manual** — Admin Dispute Queue in AdminMode provides Refund, Release, and Strike actions, but there is no automated escalation or SLA enforcement.
4. **Auto-expiry not implemented** — Purchases don't auto-expire if seller never confirms; requires manual admin action.
5. **MySales confirm button skips proof** — "Mark Tickets as Sent" button in MySales bypasses the proof upload UX. Inconsistent with PurchaseSuccess flow. Fix: link to `/purchase/:id` instead.
6. **Stripe test mode only** — STRIPE_SECRET_KEY and publishable key are test keys; not production-ready. To go live, replace both with `sk_live_` / `pk_live_` keys and verify seller accounts are fully activated in Stripe Dashboard.
7. **No seller notification on purchase** — Seller has no push/email alert when a purchase is created; they must check MySales manually.