# Production Payment-Security Remediation — Verified 2026-07-24

## Eight-point verification

1. **Stripe status fallthrough eliminated** — `capturePayment` now implements an explicit state table. `requires_capture` → capture (idempotent) → require `succeeded`; `succeeded` → complete; every other status (`requires_payment_method`, `requires_confirmation`, `requires_action`, `processing`, `canceled`) → 402 error with NO completion, NO listing-sold, NO points, NO notifications. Capture exceptions set `payment_capture_failed=true` and alert the team. Verified by code inspection; runtime state transitions require a live Stripe PaymentIntent.

2. **Strict destination verification** — for real purchases where the seller has a `stripe_account_id`, `capturePayment` requires `pi.transfer_data.destination` to exist AND exactly equal the seller's current connected account. Admin/test listings (no connected destination) are explicitly permitted with a documented note.

3. **Server-side cleanup for abandoned checkouts** — `abortCheckout` (Purchase-scoped, called by the frontend on failure/close) + `cleanupAbandonedCheckouts` scheduled automation (every 10 min) recover checkouts whose PaymentIntents were never authorized: cancel the PI, expire the Purchase, release the Listing. Expiry does NOT affect trust, points, or transfer intelligence (recordTransferOutcome only acts on completed/disputed).

4. **Reservation ownership verified** — `capturePayment` requires all of: listing seller == purchase seller, PI metadata `purchase_id` == purchase id, PI metadata `reservation_token` == purchase `reservation_token` (both must exist), purchase `reservation_token` == listing `reservation_token` (both must exist), listing still `pending_transfer` reserved by the buyer. No optional-only comparisons.

5. **purchase_id in Stripe metadata** — `createCheckout` writes `purchase_id` onto the PaymentIntent metadata after creating the Purchase; `capturePayment` adds it if missing and rejects mismatches.

6. **No non-admin frontend Purchase mutations** — source scan found `Purchase.create/update/delete` only in admin components (admin-gated by RLS); zero in buyer/seller-facing flows and zero `createPaymentIntent` references. `optimisticUI.js` writes are local-only optimistic patches, not server mutations.

7. **All financial fields server-side** — `createCheckout` derives `buyer_email` from the authenticated user (ignores frontend input) and calculates subtotal, platform fee, buyer total, and seller payout; `capturePayment` re-derives and verifies amount/currency/destination against the authoritative Listing + Purchase. No financial field is set from frontend input.

8. **RLS lockdown** — `Purchase` create/update/delete are admin-only (frontend routes through server functions); `buyer_email`/`seller_email` reads self-serve. Demo purchases (`is_demo=true`) are isolated from real revenue, points, trust, and transfer intelligence.

## Runtime tests performed (2026-07-24, UTC)

| Test | Expected | Result |
|---|---|---|
| `abortCheckout` on pending never-authorized purchase | 200 expired, PI null | ✅ `{status:"expired", pi_status:null}` |
| `abortCheckout` on already-completed purchase | 409 refuse | ✅ `Cannot abort a completed purchase` |
| `abortCheckout` repeated on expired purchase | 200 already_expired (idempotent) | ✅ `{status:"already_expired"}` |
| Post-abort listing state | `active`, reservation cleared | ✅ `status:"active"`, token null, reserved_by null |
| `capturePayment` on unverifiable PI | 500, no fallthrough | ✅ `Payment verification failed` |
| `recordTransferOutcome` on expired transition | no trust/points/intelligence effect | ✅ confirmed (skips non-terminal statuses) |

Test purchases were created and deleted after verification.