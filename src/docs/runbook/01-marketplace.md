# MARKETPLACE

## A Listing Won't Appear

**Escalation:** 🟡 Medium

**What happened:** A seller created a listing but it's not showing in the marketplace feed.

**How to recognize it:** Seller reports "my listing isn't showing" or you notice a listing in the admin panel with status that should be visible but isn't appearing on `/events/:id`.

**Where to go:** Admin Command Center → `/admin` → Marketplace Health module.

**What to check:**
1. Find the listing by seller email or event ID.
2. Check the listing's **status** field. It must be `active` to appear.
3. Check **proof_status** — if `pending_review` or `rejected`, it won't show.
4. Check **transfer_status** — if `transfer_disabled` or `transfer_expired`, the listing is hidden.
5. Check **listing_mode** — `standard` vs `instant`.
6. Check if **reservation_expires_at** is in the past (someone is holding it).
7. Check if **seat_inventory_id** is locked by another listing.
8. Check **hidden_reason** — if set, the listing is deliberately hidden.

**Actions to take:**
- If `proof_status` is `pending_review`: go to Review Queue, approve or reject.
- If `transfer_status` is `transfer_disabled`: ask seller to re-verify transfer capability.
- If status is `pending_payout_setup`: seller hasn't completed Stripe Connect onboarding. Direct them to `/sell`.
- If `hidden_reason` is set: determine if it should be unhidden (see "A listing disappeared").
- If reservation expired but inventory is still locked: the automation should release it. If not, check the `releaseReservation` function.

**What NOT to do:**
- Don't manually change the status to `active` without verifying the seat is legitimately available.
- Don't delete the listing — that loses the audit trail.

**Verify resolution:** Listing appears on the event detail page in the marketplace feed.

---

## A Listing Disappeared

**Escalation:** 🟠 High

**What happened:** A listing that was visible is now gone from the marketplace.

**How to recognize it:** Seller or buyer reports the listing vanished, or you notice fewer listings than expected on an event.

**Where to go:** Admin Command Center → Issue Feed. Also check the listing directly by ID.

**What to check:**
1. The listing's current **status** — changed to `sold`, `cancelled`, `expired`, or `hidden`?
2. **hidden_reason** — `transfer_disabled`, `admin_disabled`, `expired_verification`, `sold`, or `other`?
3. **transfer_status** — did the system detect transfer was disabled on the platform?
4. **reservation_expires_at** — is someone mid-purchase?
5. Check **TransferVerificationLog** for recent community reports that may have hidden it.
6. Check **BetaTransferLog** for `listing_hidden` events.

**Actions to take:**
- If `transfer_disabled`: the system hid it because transfer was reported as unavailable. This is correct behavior — don't override unless verified.
- If `admin_disabled`: another admin disabled it. Check who and why.
- If `expired_verification`: the 45-minute verification window passed. Seller needs to re-verify.
- If it was hidden incorrectly: update status back to `active` and clear `hidden_reason`.

**What NOT to do:**
- Don't unhide a listing with `transfer_disabled` without confirming the seller can actually transfer.
- Don't delete the listing — preserve the audit trail.

**Verify resolution:** Listing reappears in the marketplace feed for its event.

**Preventative measures:** The automated `processTransferAlerts` and `syncInventoryOnListingChange` functions handle this automatically. Ensure the scheduled automations are active.

---

## A Listing Sold

**Escalation:** 🟢 Low (normal flow) / 🔴 Critical (if duplicate sale)

**What happened:** A buyer purchased a listing. This is the normal flow.

**How to recognize it:** Listing status changes to `sold`, a Purchase record is created.

**Where to go:** Admin Command Center → Command Summary Bar shows total sales.

**What to check:**
1. The **Purchase** record — `payment_captured` should be `true`.
2. `transfer_status` on the purchase — should progress from `pending_transfer` → `completed`.
3. `seller_payout` amount is correct.
4. The listing's **status** is `sold`.
5. The **SeatInventory** record is updated (`inventory_status` → `transferred`).

**Actions to take:** Normally nothing — the flow is automated. Only intervene if:
- Payment capture failed (see Purchases → "Payment capture failed").
- Seller hasn't transferred within the expected window (see Purchases → "Seller never transferred").

**What NOT to do:**
- Don't mark a purchase as complete before the buyer confirms receipt.
- Don't release the seller payout before transfer is confirmed.

**Verify resolution:** Purchase shows `fulfillment_status: completed` and `transfer_status: completed`.

---

## A Listing Won't Sell

**Escalation:** 🟡 Medium

**What happened:** A listing has been active for a while but no purchases.

**How to recognize it:** Listing age is high, zero views/purchases. You notice stagnant inventory.

**Where to go:** Admin Command Center → Marketplace Health. Also Pricing Strategy Analyzer.

**What to check:**
1. Is the asking price above face value? Check `asking_price` vs `original_price`.
2. Is `transfer_status` showing `transfer_unconfirmed`? Buyers may be wary.
3. Is the event upcoming or past? Past events won't sell.
4. Is `transfer_window_status` on the event showing `closed`? Buyers may not want tickets they can't receive.
5. Check the **Pricing Strategy Analyzer** for pricing recommendations.

**Actions to take:**
- Suggest the seller lower the price (they can edit from `/sell`).
- If transfer window is closed, surface that information.
- Consider featuring the listing or notifying waitlisted buyers.

**What NOT to do:**
- Don't force a price change on the seller.
- Don't manually create a fake purchase.

**Verify resolution:** Listing receives interest or the seller adjusts pricing.

---

## A Listing Is Stuck

**Escalation:** 🟠 High

**What happened:** A listing is in an intermediate state — not active, not sold, not cancelled.

**How to recognize it:** Listing status is `pending_transfer`, `pending_verification`, or `pending_payout_setup` for an extended period.

**Where to go:** Admin Command Center → Issue Feed. Search by listing ID.

**What to check:**
1. **status** = `pending_verification` → proof review is pending. Check Review Queue.
2. **status** = `pending_transfer` → a purchase was made but transfer isn't complete. Check the Purchase record.
3. **status** = `pending_payout_setup` → seller hasn't finished Stripe onboarding.
4. **reservation_expires_at** — is the listing locked by an active reservation?
5. **seat_inventory_id** — is the SeatInventory record locked?

**Actions to take:**
- `pending_verification`: Review the proof, approve or reject.
- `pending_transfer`: Check the purchase — is the seller transferring? Run `processTransferReminders` if needed.
- `pending_payout_setup`: Contact the seller to complete Stripe Connect at `/sell`.
- If a reservation is stuck: run the `releaseReservation` function or wait for the 10-minute expiry.

**What NOT to do:**
- Don't force status to `active` if there's an active purchase/reservation.
- Don't delete the listing to "unstick" it.

**Verify resolution:** Listing moves to a terminal state (`active`, `sold`, or `cancelled`).

---

## A Listing Expired

**Escalation:** 🟢 Low

**What happened:** A listing's verification or reservation window expired.

**How to recognize it:** Listing status is `expired`, or `reservation_expires_at` is in the past.

**Where to go:** Admin Command Center → Marketplace Health.

**What to check:**
1. **status** = `expired` — verification window passed.
2. **verification_expired_sent_at** — was the expiration notification sent?
3. **reservation_expires_at** — is this a reservation expiry vs listing expiry?

**Actions to take:**
- If the seller wants to relist: they can create a new listing from `/sell`.
- If it expired due to a system issue: verify the expiration was legitimate.

**What NOT to do:**
- Don't revive expired listings without re-verification.

**Verify resolution:** Expired listings are no longer in the marketplace feed.

---

## A Listing Was Rejected

**Escalation:** 🟡 Medium

**What happened:** An admin or the AI rejected a listing's proof/verification.

**How to recognize it:** Listing `proof_status` = `rejected`, or `custody_status` = `rejected`.

**Where to go:** Admin Command Center → Review Queue / AI Verification Queue.

**What to check:**
1. **proof_status** and **proof_rejection_reason**.
2. **custody_status** — was it a custody rejection?
3. **admin_override_status** on any related purchase — was an admin override applied?
4. Check **BetaTransferLog** for the rejection event.

**Actions to take:**
- Review the rejection reason with the seller.
- If rejected in error: use `approveListingReview` to overturn.
- If legitimately rejected: the seller needs to provide valid proof and relist.

**What NOT to do:**
- Don't approve a listing with suspicious proof just to appease the seller.

**Verify resolution:** Seller understands the rejection and either relists with valid proof or accepts the decision.

---

## AI Rejected a Listing

**Escalation:** 🟡 Medium

**What happened:** The AI verification system flagged and rejected a listing's transfer proof.

**How to recognize it:** Purchase record shows `ai_proof_status` = `rejected_suspicious`, or `admin_override_status` is set.

**Where to go:** Admin Command Center → AI Verification Queue / AIVerificationPanel.

**What to check:**
1. **ai_proof_status** — `rejected_suspicious`, `needs_human_review`, or `failed_processing`.
2. **ai_confidence_score** — how confident was the AI?
3. **ai_flags** — what specific flags were raised?
4. **ai_review_notes** — the AI's plain-language explanation.
5. **fraud_risk_score** — overall risk assessment.
6. The actual proof image/screenshot.

**Actions to take:**
- Review the proof image yourself.
- If the AI was wrong: use `adminOverrideAIVerification` with status `approved` and provide a reason.
- If the AI was right: reject the listing via `rejectListingReview`.
- If uncertain: escalate to `escalated` status.

**What NOT to do:**
- Don't blindly trust AI rejections — always review the proof.
- Don't override without documenting your reason.

**Verify resolution:** The listing/purchase moves to a resolved state with documented reasoning.

---

## A Seller Wants to Edit a Listing

**Escalation:** 🟢 Low

**What happened:** A seller wants to change price, seats, or other details on an active listing.

**How to recognize it:** Seller contacts support asking to modify their listing.

**Where to go:** Direct the seller to `/sell` (their dashboard) or `/my-sales`.

**What to check:**
1. Is the listing `active`? If `sold` or `pending_transfer`, it can't be edited.
2. Is there an active reservation? If so, editing should be blocked.

**Actions to take:**
- Tell the seller to go to `/sell` → find the listing → edit.
- Price changes take effect immediately.
- Seat/section changes require re-verification.

**What NOT to do:**
- Don't edit listings on behalf of sellers from the admin panel unless there's a system issue.

**Verify resolution:** Seller confirms the edit is visible.

---

## A Seller Wants to Remove a Listing

**Escalation:** 🟢 Low

**What happened:** A seller wants to take down their listing.

**How to recognize it:** Seller asks to remove/cancel/delete their listing.

**Where to go:** Direct the seller to `/sell` or `/my-sales`.

**What to check:**
1. Is there an active purchase? If `pending_transfer`, the seller cannot simply remove it — a buyer has paid.
2. Is there an active reservation? The 10-minute window must expire or be released.

**Actions to take:**
- If no purchase/reservation: seller can cancel from their dashboard.
- If there's an active purchase: this requires the `cancelPurchase` flow — see Purchases → "Purchase disputed."
- If there's a reservation: wait for expiry or release it.

**What NOT to do:**
- Don't allow a seller to cancel a listing with an active purchase without going through the cancellation flow.
- Don't delete listings — use status `cancelled` to preserve the audit trail.

**Verify resolution:** Listing status is `cancelled` and no longer appears in the marketplace.

---

## Duplicate Listing Reported

**Escalation:** 🔴 Critical

**What happened:** The same seat(s) are listed by two different sellers or appear twice.

**How to recognize it:** Buyer or admin notices the same section/row/seats listed multiple times for one event.

**Where to go:** Admin Command Center → Marketplace Health. Search by event ID.

**What to check:**
1. Both listings' **section**, **row**, and **seats** fields.
2. Both listings' **seat_inventory_id** — are they linked to the same SeatInventory record?
3. **seller_email** for each — is it the same person or different?
4. **created_date** — which was created first?

**Actions to take:**
1. Immediately hide the newer listing (set status to `hidden`, `hidden_reason` to `admin_disabled`).
2. Verify which seller actually owns the seats (check SeatInventory ownership).
3. Contact both sellers if they're different people.
4. If fraud is suspected: check `fraud_risk_score` and AI flags.

**What NOT to do:**
- Don't allow both listings to remain active — this can lead to double-selling.
- Don't delete either listing — preserve for audit.

**Verify resolution:** Only one listing for those seats remains active.

**Preventative measures:** The `syncInventoryOnListingChange` function and SeatInventory entity are designed to prevent this. Ensure the automation is active.

---

## Incorrect Seat Information

**Escalation:** 🟠 High

**What happened:** A listing has wrong section, row, or seat numbers.

**How to recognize it:** Buyer or seller reports the seat info doesn't match what was delivered.

**Where to go:** Admin Command Center → search by listing ID.

**What to check:**
1. Listing's **section**, **row**, **seats** fields.
2. **seat_inventory_id** — check the SeatInventory record for canonical data.
3. **proof_url** or **ticket_file_url** — does the proof match the listed seats?
4. Related **Purchase** records — has anyone already bought based on wrong info?

**Actions to take:**
- If no purchase yet: ask the seller to correct the listing.
- If a purchase was made: this may require a refund — see Purchases → "Purchase disputed."
- If the seller intentionally listed wrong info: flag for fraud review.

**What NOT to do:**
- Don't silently correct seat info after a purchase — the buyer paid for specific seats.

**Verify resolution:** Seat information is corrected and any affected buyers are made whole.

---

## Pricing Dispute

**Escalation:** 🟡 Medium

**What happened:** A seller or buyer disputes the price charged or the payout received.

**How to recognize it:** Complaint about the amount charged, the fee, or the seller payout.

**Where to go:** Admin Command Center → Fee Simulator (or FeeSimulatorV2). Check the Purchase record.

**What to check:**
1. Purchase **subtotal** (ticket price before fee).
2. Purchase **platform_fee**.
3. Purchase **amount** (total charged to buyer = subtotal + fee).
4. Purchase **seller_payout** (subtotal - fee).
5. Verify the fee calculation matches the current fee engine.

**Actions to take:**
- If the fee was calculated incorrectly: adjust the payout and contact Stripe if needed.
- If the buyer was overcharged: issue a partial refund via Stripe.
- If the seller payout is wrong: adjust in Stripe and update the Purchase record.

**What NOT to do:**
- Don't manually override fee calculations without understanding the fee engine.

**Verify resolution:** Both parties agree the amounts are correct.