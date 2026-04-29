# Peanut Gallery — Stability Notes
_Last updated: 2026-04-29_

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
   - Countdown timer shows urgency from purchase creation time
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
   - All test Purchase records and PaymentIntents were programmatically cleaned up after each run

7. **Seller Performance Metrics**
   - `SellerMetrics` component on MySales calculates avg confirmation time
   - Tier badges: Elite (<2m), Fast (<5m), Reliable (<15m), Slow (15m+)

---

## 🔒 Do Not Touch Without Clear Reason

| File/Function | Why Protected |
|---|---|
| `functions/createPaymentIntent.js` | Core escrow logic; listing reservation; Stripe PI creation |
| `functions/capturePayment.js` | Dual-confirm gate; Stripe capture; listing finalization |
| `functions/cancelPurchase.js` | Refund logic; listing restoration; allows admin refund on disputed records |
| `components/events/PurchaseDialog.jsx` | Checkout form; reservation tracking; navigate-on-success |
| `pages/PurchaseSuccess.jsx` | Full transfer UX; seller/buyer role logic; proof upload |
| Listing `status` enum values | `active → pending_transfer → sold/cancelled` — order matters throughout |
| Purchase `transfer_status` enum values | `pending_transfer → completed/expired/disputed` — drives all UI states |
| Dispute logic in `capturePayment` / `cancelPurchase` | Verified with real Stripe test PIs — do not modify without full regression testing (all 4 dispute scenarios) |

---

## ⚠️ Known Remaining Gaps

1. **No seller notification** — Seller has no push/email alert when a purchase is created; they must check MySales manually.
2. **No buyer email confirmation** — No email sent to buyer after payment authorizes.
3. **Dispute resolution is manual** — Admin Dispute Queue in AdminMode provides Refund, Release, and Strike actions, but there is no automated escalation or SLA enforcement.
4. **Auto-expiry not implemented** — Purchases don't auto-expire if seller never confirms; requires manual admin action.
5. **MySales confirm button skips proof** — "Mark Tickets as Sent" button in MySales bypasses the proof upload UX (goes straight to capturePayment). Inconsistent with PurchaseSuccess flow.
6. **No in-app seller notification** — Seller sees pending count on MySales but no real-time alert.
7. **Stripe test mode only** — STRIPE_SECRET_KEY and publishable key are test keys; not production-ready.

---

## 🎯 Next Recommended Isolated Task

**Fix MySales "Mark as Sent" to require proof (gap #5)**

The MySales page has a quick-action button that calls `capturePayment` as seller without requiring a screenshot or note. This is inconsistent with the PurchaseSuccess transfer flow where proof is mandatory. 

Recommended fix: replace the inline button with a link to `/purchase/:id` so the seller always goes through the full PurchaseSuccess proof flow. Low risk, no backend changes needed.