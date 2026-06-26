# PURCHASES

## Buyer Says Payment Failed

**Escalation:** 🟠 High

**What happened:** Buyer attempted to purchase but the payment didn't go through.

**How to recognize it:** Buyer reports an error at checkout, or a Purchase record exists with `payment_captured: false`.

**Where to go:** Purchase detail page `/purchase/:id`. Admin Command Center → Stripe Panel.

**What to check:**
1. Purchase **payment_intent_id** — look it up in Stripe.
2. **payment_captured** — is it `false`?
3. **payment_capture_failed** — is it `true`?
4. Stripe dashboard → search the PaymentIntent ID → check status.
5. Was the card declined? Insufficient funds? 3D Secure failure?

**Actions to take:**
- If the PaymentIntent is still active in Stripe: the buyer can retry.
- If it expired: see "PaymentIntent expired."
- If capture failed: see "Payment capture failed."
- If the listing was reserved but payment failed: release the reservation via `releaseReservation`.

**What NOT to do:**
- Don't tell the buyer to pay again until you've confirmed the first attempt failed (to avoid double charges).

**Verify resolution:** Buyer successfully completes payment, or the reservation is released.

---

## Buyer Was Charged Twice

**Escalation:** 🔴 Critical

**What happened:** The buyer's card was charged more than once for the same listing.

**How to recognize it:** Buyer reports duplicate charges, or you see multiple PaymentIntents for one listing.

**Where to go:** Stripe dashboard → search by buyer email. Admin Command Center → Stripe Panel.

**What to check:**
1. How many **Purchase** records exist for this buyer + listing?
2. How many **payment_intent_id**s are there in Stripe?
3. Were both captures successful (`payment_captured: true`)?
4. Is there only one listing reservation, or multiple?

**Actions to take:**
1. Immediately refund the duplicate charge in Stripe.
2. Update the duplicate Purchase record to reflect the refund.
3. Ensure only one listing is marked `sold`.
4. Release any extra reservations.
5. Contact the buyer to confirm the refund.

**What NOT to do:**
- Don't leave duplicate charges unresolved — this is a chargeback risk.
- Don't delete the duplicate Purchase records — preserve the audit trail.

**Verify resolution:** Buyer has only one charge, one purchase, one set of tickets.

---

## Buyer Cannot Purchase

**Escalation:** 🟠 High

**What happened:** Buyer is trying to buy but can't complete the checkout.

**How to recognize it:** Buyer reports they can't click "buy" or checkout fails.

**Where to go:** The event detail page `/events/:id`. Check the listing and reservation system.

**What to check:**
1. Is the listing still `active` and visible?
2. Is there already an active reservation (check `reservation_expires_at` and `reserved_by_email`)?
3. Does the buyer already have an active reservation for this listing? (One-reservation-per-buyer rule)
4. Is the listing `requires_existing_ticket` or `requires_location`? If so, the buyer may not meet eligibility.
5. Is the buyer authenticated?

**Actions to take:**
- If reserved by someone else: the buyer must wait for the 10-minute window to expire.
- If the buyer has their own stale reservation: release it via `releaseReservation`.
- If eligibility-gated: explain the requirement (existing ticket or location proximity).
- If auth issue: direct to login.

**What NOT to do:**
- Don't bypass the reservation system — it prevents double-selling.

**Verify resolution:** Buyer can successfully reserve and purchase.

---

## Buyer Says Listing Vanished

**Escalation:** 🟠 High

**What happened:** Buyer was viewing a listing and it disappeared before/during purchase.

**How to recognize it:** Buyer reports the listing is gone from the event page.

**Where to go:** Admin Command Center → search by listing ID or event.

**What to check:**
1. Listing **status** — did it change to `sold`, `hidden`, `cancelled`, or `expired`?
2. **reservation_expires_at** — did someone else's reservation lock it?
3. **hidden_reason** — was it hidden by the system?
4. **transfer_status** — did transfer get disabled?

**Actions to take:**
- If sold to someone else: explain it was purchased by another buyer.
- If hidden due to transfer issues: explain the listing was removed for safety.
- If the reservation expired but the listing should still be available: check if the SeatInventory was released.

**What NOT to do:**
- Don't promise the buyer they can still get those specific seats if they're sold.

**Verify resolution:** Buyer understands what happened. If the listing should be available, restore it.

---

## Buyer Abandoned Checkout

**Escalation:** 🟢 Low

**What happened:** Buyer started checkout but didn't complete the purchase.

**How to recognize it:** A reservation exists (`reservation_expires_at` in the future) but no Purchase was created.

**Where to go:** Admin Command Center → Marketplace Health.

**What to check:**
1. **reservation_expires_at** — when does it expire?
2. **reserved_by_email** — who reserved it?
3. Is the listing still locked?

**Actions to take:**
- Wait for the 10-minute reservation to expire — the system auto-releases.
- If it's stuck: run `releaseReservation` manually.

**What NOT to do:**
- Don't contact the buyer about an abandoned checkout — this is normal behavior.

**Verify resolution:** Listing becomes available again after reservation expiry.

---

## Purchase Stuck in Pending Transfer

**Escalation:** 🟠 High

**What happened:** Payment was captured but the ticket transfer hasn't been completed.

**How to recognize it:** Purchase `transfer_status` = `pending_transfer` for an extended period.

**Where to go:** Purchase detail page `/purchase/:id`. Admin Command Center → Transfer Intelligence.

**What to check:**
1. **seller_confirmed** — has the seller confirmed they initiated the transfer?
2. **seller_confirmed_at** — when?
3. **buyer_confirmed** — has the buyer confirmed receipt?
4. **reminder_flags** — which reminders have been sent (seller_r1, seller_r2, buyer_r1, buyer_r2)?
5. **auto_review_flagged** — has the system flagged this for admin review?
6. **fulfillment_status** — for instant listings, what's the PG fulfillment state?

**Actions to take:**
- If seller hasn't confirmed after R2 reminder: contact the seller directly.
- If seller confirmed but buyer hasn't confirmed receipt: send buyer reminder.
- If 24h past seller confirmation with no buyer action: the system flags `auto_review_flagged` — review manually.
- For instant listings: check if PG fulfillment is pending (see Instant Ops panel).

**What NOT to do:**
- Don't mark the transfer as complete without buyer confirmation (unless overriding for cause).

**Verify resolution:** `transfer_status` moves to `completed` and `buyer_confirmed: true`.

**Preventative measures:** The `processTransferReminders` automation runs on a schedule and handles reminders automatically. Ensure it's active.

---

## Purchase Completed

**Escalation:** 🟢 Low (normal flow)

**What happened:** A purchase reached its final state — payment captured, transfer confirmed.

**How to recognize it:** Purchase `transfer_status` = `completed`, `buyer_confirmed: true`.

**Where to go:** Purchase detail page. Admin Command Center → Command Summary Bar.

**What to check:**
1. `payment_captured: true`.
2. `transfer_status: completed`.
3. `buyer_confirmed: true`.
4. `seller_confirmed: true`.
5. **seller_payout** is correct.
6. A **Notification** of type `sale_complete` was sent to the seller.
7. Points were awarded (check **PointsActivity**).

**Actions to take:** Normally nothing. Verify:
- The seller received their payout notification.
- The buyer received their tickets.
- Points were awarded for both parties.

**What NOT to do:**
- Don't re-process completed purchases.

**Verify resolution:** Both parties are satisfied. No disputes open.

---

## Purchase Disputed

**Escalation:** 🔴 Critical

**What happened:** A buyer opened a dispute — either through Peanut Gallery or through Stripe.

**How to recognize it:** Purchase `transfer_status` = `disputed`, or a Stripe chargeback/dispute appears.

**Where to go:** Purchase detail page. Admin Command Center → Issue Feed. Stripe dashboard → Disputes.

**What to check:**
1. **dispute_reason** on the Purchase record.
2. **transfer_proof_url** — did the seller provide proof?
3. **ai_proof_status** — what did the AI say?
4. Stripe dispute status and deadline for response.
5. **TransferOutcome** record — was the transfer actually successful?
6. **BetaTransferLog** for dispute events.

**Actions to take:**
1. Review all evidence: transfer proof, AI analysis, communication logs.
2. If the seller is at fault: accept the dispute, refund the buyer via Stripe.
3. If the buyer is making a false claim: submit evidence to Stripe (transfer proof, timestamps).
4. Set `false_claim_recorded` if applicable (prevents triple-counting strikes).
5. Update the Purchase record with resolution.
6. Create an **AdminAlert** if not already created.

**What NOT to do:**
- Don't ignore Stripe dispute deadlines — you typically have 7-10 days to respond.
- Don't refund without reviewing evidence.

**Verify resolution:** Dispute is resolved in Stripe. Purchase record reflects the outcome.

---

## Purchase Refunded

**Escalation:** 🟠 High

**What happened:** A refund was issued to the buyer.

**How to recognize it:** Stripe shows a refund, or the Purchase record indicates a cancelled/refunded state.

**Where to go:** Stripe dashboard → Payments → find the charge. Purchase detail page.

**What to check:**
1. Was the refund full or partial?
2. Was the seller payout reversed/clawed back?
3. Listing status — should be `cancelled` or back to `active`.
4. SeatInventory record — is the seat released back to available?
5. Was the seller notified? (They must be notified on cancellation to prevent financial loss.)

**Actions to take:**
- Ensure the seller is notified via `sendUserNotification` + `sendNotificationEmail`.
- Release the SeatInventory if it was locked.
- Update listing status appropriately.
- If the refund was an error: contact Stripe support immediately.

**What NOT to do:**
- Don't refund without notifying the seller — unauthorized transfers can cause financial loss.
- Don't leave the listing in a `sold` state after a refund.

**Verify resolution:** Buyer has their money back, seller is notified, listing/seat is released.

---

## Buyer Says Tickets Never Arrived

**Escalation:** 🟠 High

**What happened:** Buyer paid but says they never received the tickets.

**How to recognize it:** Buyer reports non-delivery. Purchase `transfer_status` = `pending_transfer`, `buyer_confirmed: false`.

**Where to go:** Purchase detail page `/purchase/:id`. Admin Command Center → Transfer Intelligence.

**What to check:**
1. **seller_confirmed** — did the seller confirm they sent the transfer?
2. **seller_confirmed_at** — how long ago?
3. **transfer_proof_url** — is there proof of transfer?
4. **fulfillment_status** — for instant listings, did PG fulfill?
5. **reminder_flags** — have reminders been sent?
6. **auto_review_flagged** — is this already flagged?

**Actions to take:**
- If seller hasn't confirmed: escalate to seller immediately (this is urgent — buyer has paid).
- If seller confirmed but buyer says no transfer: ask buyer to check their email/spam, verify the platform.
- If no proof from seller: request transfer proof, set a deadline.
- If seller is unresponsive after R2: consider cancellation + refund.
- For instant listings: check if PG needs to fulfill manually (Instant Ops panel).

**What NOT to do:**
- Don't assume the buyer is lying — verify with the seller first.
- Don't refund before giving the seller a chance to respond.

**Verify resolution:** Buyer receives tickets, or a refund is processed with seller notification.

**Decision Tree:**
```
Buyer says tickets never arrived
↓
Was seller_confirmed = true?
├── NO → Has R2 reminder been sent?
│        ├── NO → Wait for reminder automation / trigger processTransferReminders
│        └── YES → Contact seller directly. Set 24h deadline.
│                  ↓
│                  Seller responds?
│                  ├── YES → Seller confirms transfer → Ask buyer to check email
│                  └── NO → Cancel purchase, refund buyer, notify seller
└── YES → Is there transfer_proof_url?
         ├── NO → Request proof from seller. Set deadline.
         └── YES → Review proof with AI (verifyTransferProof)
                   ↓
                   AI verified?
                   ├── verified_high/medium_confidence → Ask buyer to recheck. If still claims non-receipt → escalate.
                   ├── needs_human_review → Admin reviews proof manually
                   └── rejected_suspicious → Flag for fraud. Consider refund.
```

---

## Buyer Confirmed Incorrectly

**Escalation:** 🟡 Medium

**What happened:** The buyer confirmed receipt of tickets but later says they didn't actually receive them.

**How to recognize it:** Purchase `buyer_confirmed: true` but buyer reports non-receipt.

**Where to go:** Purchase detail page. Check transfer proof.

**What to check:**
1. **transfer_proof_url** — is there proof of transfer?
2. Timeline — when did buyer confirm vs when did they complain?
3. **ai_proof_status** — did the AI verify the transfer?

**Actions to take:**
- Review the transfer proof carefully.
- If the proof is valid: the buyer may have confirmed prematurely. Help them locate the tickets.
- If the proof is invalid or missing: investigate potential fraud. Consider refund.
- If the buyer made a false claim: set `false_claim_recorded: true`.

**What NOT to do:**
- Don't reverse a confirmed purchase without evidence.
- Don't penalize the buyer without proof of false claiming.

**Verify resolution:** Buyer locates tickets, or fraud is documented and refund processed.

---

## Seller Never Transferred

**Escalation:** 🔴 Critical

**What happened:** Payment was captured but the seller never initiated the ticket transfer.

**How to recognize it:** Purchase `payment_captured: true`, `seller_confirmed: false`, extended time since purchase.

**Where to go:** Purchase detail page. Admin Command Center → Issue Feed / Transfer Intelligence.

**What to check:**
1. **payment_captured** — is money held?
2. **seller_confirmed** — `false`?
3. **seller_confirmed_at** — null?
4. **reminder_flags** — have seller_r1 and seller_r2 been sent?
5. **auto_review_flagged** — is this flagged?
6. Seller's **reliability/trust** score.

**Actions to take:**
1. Ensure reminder automation has fired (R1 at 15min, R2 at 1hr).
2. Contact the seller directly via email.
3. Set a firm deadline (typically 24h).
4. If seller is unresponsive or refuses: cancel the purchase, refund the buyer, notify the seller.
5. Flag the seller for reliability review.
6. Create an AdminAlert of type `seller_missed_deadline`.

**What NOT to do:**
- Don't release the seller's payout.
- Don't leave the buyer hanging — they've paid.

**Verify resolution:** Seller transfers, or buyer is refunded and seller is flagged.

---

## Seller Transferred but Buyer Won't Confirm

**Escalation:** 🟠 High

**What happened:** Seller confirmed transfer with proof, but the buyer won't confirm receipt.

**How to recognize it:** Purchase `seller_confirmed: true`, `buyer_confirmed: false`, buyer unresponsive.

**Where to go:** Purchase detail page. Check reminder flags.

**What to check:**
1. **seller_confirmed_at** — how long ago?
2. **transfer_proof_url** — is there proof?
3. **reminder_flags.buyer_r1** and **buyer_r2** — have reminders been sent?
4. **auto_review_flagged** — is it flagged for review?

**Actions to take:**
1. Ensure buyer reminders have fired (R1 at 15min after seller confirmation, R2 at 1hr).
2. Contact the buyer directly.
3. If buyer is unresponsive 24h after seller confirmation: the system auto-flags for review.
4. If the transfer proof is valid: consider auto-completing the purchase (admin override).
5. If the buyer is making a false non-receipt claim: set `false_claim_recorded`.

**What NOT to do:**
- Don't withhold the seller's payout indefinitely if proof is valid.
- Don't auto-complete without reviewing proof.

**Verify resolution:** Buyer confirms, or admin completes the purchase with documented proof.

---

## Payment Capture Failed

**Escalation:** 🔴 Critical

**What happened:** The payment was authorized but the capture (actually taking the money) failed.

**How to recognize it:** Purchase `payment_capture_failed: true`.

**Where to go:** Admin Command Center → Issue Feed (type: `failed_transfer_after_payment`). Stripe dashboard.

**What to check:**
1. **payment_intent_id** — check status in Stripe.
2. **payment_capture_failed** — `true`?
3. Stripe → is the PaymentIntent in `requires_capture` or did capture fail?
4. Was it a card error, fraud block, or Stripe issue?

**Actions to take:**
1. Retry the capture from the Admin panel (the `capturePayment` function).
2. If it fails again: the buyer's card may be declined. Contact the buyer.
3. If it's a Stripe-side issue: check Stripe status page.
4. Release the listing reservation if the payment can't be captured.
5. Create an AdminAlert if not already created.

**What NOT to do:**
- Don't mark the purchase as complete if capture failed.
- Don't release tickets without confirmed payment.

**Verify resolution:** Payment is successfully captured, or the purchase is cancelled and reservation released.

---

## PaymentIntent Expired

**Escalation:** 🟠 High

**What happened:** The Stripe PaymentIntent expired before the buyer completed payment.

**How to recognize it:** Stripe shows the PaymentIntent as `canceled` or past its expiry. No `payment_captured: true` on the Purchase.

**Where to go:** Stripe dashboard → PaymentIntents. Purchase detail page.

**What to check:**
1. **payment_intent_id** — status in Stripe.
2. **payment_captured** — `false`?
3. Listing **reservation_expires_at** — has the reservation also expired?

**Actions to take:**
1. Release the listing reservation via `releaseReservation`.
2. Tell the buyer they can retry the purchase — a new PaymentIntent will be created.
3. If the buyer's card was the issue: they may need to use a different card.

**What NOT to do:**
- Don't try to capture an expired PaymentIntent — it won't work.
- Don't leave the reservation locked.

**Verify resolution:** Reservation is released, listing is available, buyer can retry.