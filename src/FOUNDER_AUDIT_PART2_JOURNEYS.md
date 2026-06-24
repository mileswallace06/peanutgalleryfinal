# PART 2: USER JOURNEYS

---

# SECTION 3: USER JOURNEYS

---

## Journey 1: New Fan Account Registration

**Step-by-step:**
1. User visits app (unauthenticated) → sees Landing page
2. User clicks "Sign In" → redirected to Base44 auth
3. User creates account (email/password or OAuth)
4. After auth, user is redirected back to `/events`
5. On first visit, Onboarding overlay shows (dismissed via `localStorage` + `has_seen_onboarding` User field)
6. OneSignal push notification permission may be prompted after actions

**Backend actions triggered:**
- `base44.auth.me()` resolves user
- `initOneSignal()` initializes push SDK
- `loginOneSignalUser(email)` links OneSignal to user

**Database updates:**
- User record created automatically by platform auth
- `has_seen_onboarding` set to `true` after onboarding dismissal

**Notifications sent:**
- None (registration is silent)

**Possible failure points:**
- Auth provider down → user can't sign in
- OneSignal init failure → push won't work (non-blocking)
- User not registered for app → `UserNotRegisteredError` shown

---

## Journey 2: Seller Stripe Onboarding

**Step-by-step:**
1. User navigates to `/sell`
2. If `stripe_onboarding_complete` is false → onboarding CTA shown
3. User clicks "Set Up Payouts with Stripe" → `onboardSeller` function called
4. Stripe Express account created (or reused if exists)
5. User redirected to Stripe onboarding page
6. User completes Stripe onboarding (bank account, identity verification)
7. User redirected back to `/sell?onboarding=complete`
8. `checkSellerOnboarding` called → verifies `charges_enabled`
9. If complete → `stripe_onboarding_complete` set to `true` on User
10. Seller can now list tickets

**Backend actions triggered:**
- `onboardSeller` — Creates Stripe Express account, generates onboarding link
- `checkSellerOnboarding` — Verifies charges_enabled, updates User

**Database updates:**
- User: `stripe_account_id`, `stripe_onboarding_complete`
- Stale accounts auto-cleared if invalid

**Notifications sent:**
- None

**Possible failure points:**
- Stripe onboarding incomplete → user can save draft listings but not publish
- Stale test-mode account → auto-cleared, user must re-onboard
- Stripe API error → onboarding fails, error shown
- User abandons onboarding → listing saved as `pending_payout_setup` draft

---

## Journey 3: Create Listing (Standard)

**Step-by-step:**
1. Seller navigates to `/sell` → clicks "List My Tickets"
2. Redirected to `/create-listing` (3-step wizard)
3. **Step 0 — Pick Event**: Browse recommended events (geo/city) or search TM
   - If TM event selected → `syncTMEvent` called to create local Event record
4. **Step 1 — Seat Info**: Enter section, row, seats, quantity, tier
   - Must complete `SellerTransferAttestation` (confirm transfer is available)
   - Optional: upload transfer capability screenshot (boosts confidence score to 75)
5. **Step 2 — Price & Proof**: Set asking price ($10 min), face value (optional), upload proof (optional), select transfer method
6. Seller clicks "List My Tickets" → `submitListing` called

**Backend actions triggered:**
- `submitListing` function:
  - Validates Stripe onboarding complete
  - Checks SeatInventory conflicts (no double-listing)
  - Blocks listings for ended events
  - Runs suspicious seller check (strikes, disputes, expired transfers, listing count, price)
  - Checks for duplicate proof images
  - Creates Listing entity
  - Creates/updates SeatInventory (fire-and-forget)
  - Creates TransferVerificationLog (fire-and-forget)
  - Returns flagged status

**Database updates:**
- **Listing** created (status: active, proof_status: approved or pending_review)
- **SeatInventory** created/updated (status: listed_for_sale)
- **TransferVerificationLog** created

**Notifications sent:**
- None (listing is silent)

**Possible failure points:**
- Seller not onboarded → listing saved as draft (`pending_payout_setup`)
- Suspicious seller flagged → listing goes to `pending_review`
- Duplicate proof image → listing goes to `pending_review`
- Seat already in Flash Drop → `INVENTORY_CONFLICT` error
- Event ended → listing blocked
- Minimum price ($10) not met → UI blocks submission

---

## Journey 4: Create Listing (Instant Transfer)

**Step-by-step:**
1-5. Same as Standard listing
6. Seller selects "⚡ Instant Transfer" mode
7. Seller must upload transfer proof screenshot (mandatory)
8. Seller enters transfer notes (optional if screenshot provided)
9. Seller clicks "List My Tickets" → listing created with `pending_verification` status

**Backend actions triggered:**
- Direct entity creation (no `submitListing` function call for instant mode)
- Listing created with `custody_status: 'pending_pg_verification'`, `status: 'pending_verification'`

**Database updates:**
- **Listing** created (status: pending_verification, custody_status: pending_pg_verification)

**Notifications sent:**
- None

**Possible failure points:**
- No admin workflow exists to verify custody — founder must manually check `pending_verification` listings and update them
- No notification to admin when instant listing is created
- Seller may wait indefinitely for custody verification

---

## Journey 5: Purchase Ticket

**Step-by-step:**
1. Buyer browses events → selects event → views listings
2. Buyer clicks "Buy" on a listing → PurchaseDialog opens
3. Self-purchase check: if buyer email === seller email → blocked
4. Buyer sees fee breakdown, escrow protection, transfer status
5. For upgrades: eligibility gate (location/ticket checks) must pass
6. Buyer enters name, phone (email locked to authenticated user)
7. Buyer enters card details (Stripe Elements)
8. Buyer clicks "Pay Securely" → `createPaymentIntent` called

**Backend actions triggered:**
- `createPaymentIntent` function:
  - Rate limit check (15s cooldown per user)
  - Validates listing active, approved, not self-purchase
  - Checks reservation token (10-min lock)
  - Checks for existing pending purchase by same buyer
  - Sets reservation token on listing
  - Re-fetches to verify reservation ownership (race condition prevention)
  - Validates seller Stripe account (live mode)
  - Creates Stripe PaymentIntent (manual capture) with transfer_data to seller
  - Returns client_secret + fee breakdown
- Frontend: `stripe.confirmCardPayment()` authorizes the card
- Frontend: Creates Purchase entity
- Frontend: Calls `recordNotification` to notify seller (fire-and-forget)
- Frontend: Navigates to `/purchase/:purchaseId`

**Database updates:**
- **Listing**: status → `pending_transfer`, reservation_token set
- **Purchase** created: payment_intent_id, transfer_status: pending_transfer, buyer/seller confirmed: false
- **Notification** created for seller: `sale_created` type

**Notifications sent:**
- Seller: In-app + push + email: "🎉 Your ticket sold!" with deep-link to `/purchase/:id`

**Possible failure points:**
- Listing already reserved by another buyer → 409 conflict
- Seller Stripe account invalid → 402 "Seller has not completed payout onboarding"
- Stripe PI creation fails → reservation released, error shown
- Card declined → listing restored to active
- Rate limit hit → 429 "Please wait Xs before trying again"
- Self-purchase → blocked in both UI and backend

---

## Journey 6: Seller Confirms Transfer

**Step-by-step:**
1. Seller receives notification → navigates to `/purchase/:id`
2. Seller sees PurchaseSuccess page (seller view)
3. Seller clicks "Confirm Transfer" in TransferAssistant
4. Seller must upload proof screenshot OR add transfer note (required)
5. `capturePayment` called with `confirming_role: 'seller'`
6. `seller_confirmed` set to true, `seller_confirmed_at` timestamp set
7. If screenshot uploaded → `verifyTransferProof` triggered (fire-and-forget)
8. Buyer notified: "Tickets sent 🚀"

**Backend actions triggered:**
- `capturePayment` (confirming_role: seller):
  - Validates proof exists (screenshot or note)
  - Sets seller_confirmed = true
  - If buyer already confirmed → captures payment, completes purchase
  - If buyer not yet confirmed → sends "tickets_sent" notification to buyer
  - Awards speed bonus points if seller confirmed within 1 hour
- `verifyTransferProof` (fire-and-forget if proof uploaded):
  - AI vision analysis (Claude Sonnet 4.6)
  - Confidence scoring, OCR extraction, fraud flags
  - If rejected → false claim count incremented, admin alerted

**Database updates:**
- **Purchase**: seller_confirmed = true, seller_confirmed_at, transfer_proof_url, ai_* fields
- **User** (seller): transfer_false_claim_count (if AI rejects)
- **PointsActivity**: seller_transfer_1hr (if within 1 hour)

**Notifications sent:**
- Buyer: "Tickets sent 🚀" (in-app + push + email)
- Admin (if AI flags suspicious): "🚨 AI Flagged Suspicious Transfer Proof"

**Possible failure points:**
- Seller doesn't upload proof → confirmation blocked
- AI verification fails → marked `failed_processing`, human review needed
- AI false positive → seller gets false claim strike (deduped per purchase)
- Seller never confirms → 48h auto-expire (listing restored, buyer notified, PI cancelled)

---

## Journey 7: Buyer Confirms Receipt

**Step-by-step:**
1. Buyer receives "Tickets sent" notification → navigates to `/purchase/:id`
2. Buyer checks their email/ticket app for transferred tickets
3. Buyer clicks "Confirm Receipt" on PurchaseSuccess page
4. `capturePayment` called with `confirming_role: 'buyer'`
5. Cannot confirm before seller confirms (blocked)
6. If seller already confirmed → payment captured, purchase completed
7. Both parties notified of completion

**Backend actions triggered:**
- `capturePayment` (confirming_role: buyer):
  - Validates seller has confirmed first
  - Sets buyer_confirmed = true
  - If both confirmed → atomic capture guard (re-fetch), Stripe capture, mark complete
  - Awards points (sale_completed to seller, purchase to buyer)
  - Sends completion notifications
  - Clears listing reservation
  - Marks listing as sold

**Database updates:**
- **Purchase**: buyer_confirmed = true, transfer_status = completed, payment_captured = true
- **Listing**: status = sold, reservation cleared
- **User** (buyer): total_purchases, peanut_points
- **User** (seller): total_sales, peanut_points, seller_streak
- **PointsActivity**: purchase (buyer), sale_completed (seller)
- **TransferOutcome**: created by entity automation

**Notifications sent:**
- Buyer: "Transfer confirmed ✅"
- Seller: "Sale complete 💸" (payout processing, 2-7 business days)

**Possible failure points:**
- Buyer confirms before seller → blocked (409)
- Stripe capture fails → `payment_capture_failed` flag, admin notified, manual retry needed
- Buyer never confirms → 24h auto-review flag (admin must manually capture or dispute)
- Atomic capture race (mitigated by re-fetch guard)

---

## Journey 8: Open a Dispute

**Step-by-step:**
1. Buyer on PurchaseSuccess page clicks "Open Dispute"
2. DisputeModal opens → buyer enters dispute reason
3. Purchase transfer_status set to `disputed`
4. Admin alerted via email and AdminAlert entity
5. Founder must manually review and resolve

**Backend actions triggered:**
- Direct Purchase update (transfer_status = disputed, dispute_reason)
- `recordTransferOutcome` (entity automation): creates TransferOutcome, updates seller reliability, creates AdminAlert

**Database updates:**
- **Purchase**: transfer_status = disputed, dispute_reason
- **TransferOutcome**: created (transfer_successful = false)
- **AdminAlert**: created (alert_type: failed_transfer_after_payment, priority: critical)
- **User** (seller): transfer_fail_count, seller_transfer_reliability, transfer_false_claim_count

**Notifications sent:**
- Admin: "🚨 Stripe Dispute Created" (if chargeback via Stripe webhook)
- Admin: AdminAlert created

**Possible failure points:**
- No automated dispute resolution — founder must manually handle
- Stripe chargeback may happen separately (webhook creates its own alert)
- Seller reliability score impacted

---

## Journey 9: Cancel Purchase (Buyer)

**Step-by-step:**
1. Buyer on PurchaseSuccess page clicks "Cancel Purchase"
2. `cancelPurchase` called
3. If PI status is `requires_capture` → Stripe PI cancelled
4. If PI status is `succeeded` → Stripe refund created
5. Purchase marked as expired, listing restored to active

**Backend actions triggered:**
- `cancelPurchase`:
  - Only buyer or admin can cancel
  - Cannot cancel completed or expired purchases
  - Cannot cancel if payment already captured
  - Cancels or refunds Stripe PI
  - Updates Purchase and Listing

**Database updates:**
- **Purchase**: transfer_status = expired
- **Listing**: status = active, reservation cleared

**Notifications sent:**
- None (no notification sent on cancellation — potential gap)

**Possible failure points:**
- Stripe cancellation/refund fails → error returned
- Listing not restored if function fails partway
- No notification to seller that purchase was cancelled

---

## Journey 10: Flash Drop (Create & Win)

**Step-by-step:**
1. Donor navigates to Live Hub (`/upgrades/:id`) → "Fan Gifts" tab
2. Donor clicks "Drop Seats" → CreateFlashDropSheet opens
3. Donor enters section, row, seats, message, drop type (immediate/scheduled)
4. Ownership verification (listing link, purchase link, or proof upload)
5. `flashDrop` (action: create) called
6. FlashDrop created, SeatInventory updated
7. Other fans see the drop → enter within entry window (30-90s)
8. After entry window → `flashDrop` (action: close_and_pick) called
9. Winner randomly selected (trust-score weighted)
10. Winner notified → both parties confirm delivery

**Backend actions triggered:**
- `flashDrop` (create): rate limiting, ownership verification, trust score calculation, SeatInventory sync
- `flashDrop` (enter): entry validation, duplicate check
- `flashDrop` (close_and_pick): lock acquisition, race-safe winner selection, SeatInventory update
- `flashDrop` (confirm_delivery): both parties confirm → SeatInventory transferred

**Database updates:**
- **FlashDrop** created with trust_score, entry_count, winner
- **FlashDropEntry** created per entrant
- **SeatInventory**: inventory_status → in_flash_drop → claimed_by_winner → transferred
- **Notification**: winner notification (donation_won type)

**Notifications sent:**
- Winner: "🎁 You won a Flash Drop!" (in-app + push + email)

**Possible failure points:**
- Unverified ownership (beta flag allows it)
- Winner doesn't confirm delivery → SeatInventory stuck in `claimed_by_winner`
- Race condition in winner selection (mitigated with lock + re-fetch)
- Donor cannot enter own drop (enforced)

---

## Journey 11: Seat Donation (Create & Accept)

**Step-by-step:**
1. Donor (with ticket) navigates to donate seats
2. Donor enters section, row, seats, message
3. `seatDonation` (action: create_donation) called
4. Donation created, donor awarded +150 points
5. Draw immediately runs → weighted winner selection
6. Winner notified → has 4 hours to accept/decline
7. Winner accepts → +75 points to donor, +10 to recipient
8. Winner declines → reroll (up to 3 times) or expire

**Backend actions triggered:**
- `seatDonation` (create_donation): validates ticket ownership, rate limits, creates donation, runs draw
- `seatDonation` (respond): accept/decline with reroll logic
- `cleanupStaleDonations` (scheduled, 10 min): rerolls/expired stale drawn donations

**Database updates:**
- **SeatDonation** created with draw state, winner, reroll_count
- **DonationOptIn** updated (recent_win_count, last_win_at)
- **PointsActivity**: seat_donation_created, donation_accepted, donation_received
- **User**: total_donations_made, peanut_points
- **Notification**: winner notification

**Notifications sent:**
- Winner: "🎁 You won a seat donation!" (in-app + push + email)

**Possible failure points:**
- No eligible opt-ins → donation expires
- Winner doesn't respond → `cleanupStaleDonations` rerolls after 3 minutes
- Geo-spoofing (mitigated with precision checks)
- Donor cannot win own donation (enforced)

---

## Journey 12: Upgrade Purchase (Demo Mode)

**Step-by-step:**
1. Attendee navigates to Live Hub (`/upgrades/:id`)
2. Views upgrade listings (demo mode)
3. Hub-level eligibility gate (location/ticket checks, simulated in demo)
4. Attendee clicks "Simulate Upgrade Purchase"
5. PurchaseDialog opens (demo mode — no card element)
6. Attendee clicks "Simulate Upgrade Purchase"
7. $0 Purchase created with completed transfer status
8. Navigated to PurchaseSuccess page

**Backend actions triggered:**
- No `createPaymentIntent` call (demo mode)
- Direct Purchase creation (amount: 0, transfer_status: completed)

**Database updates:**
- **Purchase** created (amount: 0, completed status)
- No Listing status change (demo)

**Notifications sent:**
- None

**Possible failure points:**
- Demo mode may confuse users
- No real payment, no real ticket transfer
- No real geofencing

---

## Journey 13: Account Settings

**Step-by-step:**
1. User navigates to `/me` → clicks account settings
2. Redirected to `/account-settings`
3. User can manage: profile identity, persona, notifications, Stripe payout, verification, transactions, security
4. User can delete account

**Backend actions triggered:**
- `base44.auth.updateMe()` for profile updates
- `base44.auth.me()` for reads

**Database updates:**
- **User**: profile fields, notification preferences, persona

**Notifications sent:**
- None

**Possible failure points:**
- Account deletion may leave orphaned data
- No data export

---

## Journey 14: Admin Listing Review

**Step-by-step:**
1. Admin navigates to `/admin` → Review Queue section
2. Views listings with `proof_status: pending_review`
3. Admin clicks "Approve" or "Reject" (reject requires reason)
4. `approveListingReview` or `rejectListingReview` called
5. Seller notified

**Backend actions triggered:**
- `approveListingReview`: sets proof_status = approved, status = active, creates BetaTransferLog, notifies seller
- `rejectListingReview`: sets proof_status = rejected, status = hidden, hidden_reason = admin_disabled, creates BetaTransferLog, notifies seller

**Database updates:**
- **Listing**: proof_status, status, hidden_reason, proof_rejection_reason
- **BetaTransferLog**: listing_restored or listing_hidden
- **Notification**: listing_approved or listing_rejected

**Notifications sent:**
- Seller: "Listing approved ✅" or "Listing not approved" (in-app + email)

**Possible failure points:**
- No confirmation dialog for destructive actions (known issue)
- Rejection requires a reason (enforced)