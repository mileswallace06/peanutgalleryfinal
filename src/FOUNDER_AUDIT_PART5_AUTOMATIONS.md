# PART 5: AUTOMATIONS & BACKGROUND SYSTEMS + STRIPE & PAYMENTS AUDIT

---

# SECTION 7: AUTOMATIONS & BACKGROUND SYSTEMS

## Active Automations (5 total)

---

### 1. Transfer Reminder Notifications (Scheduled — every 5 minutes)

**Automation ID**: `6a1218bf2f021b62d0a3a987`  
**Function**: `processTransferReminders`  
**Trigger**: Every 5 minutes (AWS EventBridge)  
**Status**: Active, last run: success

**Conditions**: Purchases with `transfer_status: 'pending_transfer'` from last 72 hours (paginated, 100 max)

**Actions performed**:
- **Seller reminder 1** (5 min after purchase, if not confirmed): Push + email to seller "Transfer reminder"
- **Seller reminder 2** (15 min after purchase, if not confirmed): Push + email to seller "⚠️ Final transfer reminder"
- **Buyer reminder 1** (5 min after seller confirms, if buyer hasn't confirmed): Push + email to buyer "Confirm your tickets"
- **Buyer reminder 2** (15 min after seller confirms, if buyer hasn't confirmed): Push + email to buyer "⏰ Please confirm your tickets"
- **Auto-expire**: Seller no-show at 48 hours → cancel Stripe PI, restore listing to active, notify both parties
- **Auto-review flag**: Buyer inactive 24h after seller confirms → flag for admin review (NO auto-capture), notify admin via email, notify buyer with urgency, notify seller
- **Stale PI warning**: Purchase >6 days old → warn admin before 7-day Stripe expiry
- **Clear expired listing reservations**: Listings stuck in `pending_transfer` with expired reservation tokens (>10 min) restored to active

**Database changes**:
- Purchase: `reminder_flags`, `transfer_status` (expired), `auto_review_flagged`, `auto_review_flagged_at`, `transfer_notes`
- Listing: `status` (active), `reservation_token` (cleared), `reservation_expires_at` (cleared), `reserved_by_email` (cleared)

**Notification outputs**: Seller reminders, buyer reminders, expiry notifications, admin email alerts

**Failure scenarios**: Stripe PI cancellation fails (logged, continues), notification delivery failure (fire-and-forget)

---

### 2. Transfer Alert Processor (Scheduled — every 5 minutes)

**Automation ID**: `6a18ecd7fa77c0b47415c9e3`  
**Function**: `processTransferAlerts`  
**Trigger**: Every 5 minutes (AWS EventBridge)  
**Status**: Active, last run: success

**Conditions**: All active listings, all pending purchases, all disputed purchases, recent community reports (last 2 hours)

**Actions performed**:
- **Listing verification warning** at 45 minutes: Email seller "⚠️ Your ticket listing verification expires soon"
- **Listing verification expiration** at 60 minutes: Hide listing (`status: hidden`, `hidden_reason: expired_verification`, `transfer_status: transfer_expired`), email seller, create AdminAlert, create BetaTransferLog
- **Low confidence listing alert** (score < 30): Create AdminAlert (priority: high)
- **Stalled transfer alert** (buyer waiting >30 min for seller): Create AdminAlert (priority: high at 30min, critical at 60min)
- **Dispute alert**: Create AdminAlert (priority: critical) for all disputed purchases
- **Conflicting community reports** (both sides ≥3 reports in 2 hours): Create AdminAlert (priority: high)

**Database changes**:
- Listing: `verification_warning_sent_at`, `verification_expired_sent_at`, `status`, `hidden_reason`, `transfer_status`
- AdminAlert: created for various alert types
- BetaTransferLog: created for expiration events

**Notification outputs**: Seller emails (verification warnings, expirations), admin alerts

**Failure scenarios**: Email delivery failure (fire-and-forget), admin alert creation failure (fire-and-forget)

---

### 3. Cleanup Stale Drawn Donations (Scheduled — every 10 minutes)

**Automation ID**: `6a176098d2f7e3ea74e7ada2`  
**Function**: `cleanupStaleDonations`  
**Trigger**: Every 10 minutes (AWS EventBridge)  
**Status**: Active, last run: success

**Conditions**: Donations in `drawn` state older than 3 minutes (grace buffer beyond 2-min UI timer)

**Actions performed**:
- Mark donation as `declined_rerolling`
- Reroll donation if `reroll_count < 3` (selects new winner using weighted draw)
- Expire donation if `reroll_count >= 3` or no eligible candidates
- Weighted draw uses `calcDrawWeight`: sqrt(peanut_points) * 0.6 + trust_score * 0.15 + live_activity_bonus - recent_win_penalty

**Database changes**:
- SeatDonation: `donation_status` (drawn → declined_rerolling → drawn or expired), `winner_email`, `winner_name`, `drawn_at`, `reroll_count`

**Notification outputs**: Winner notification (if rerolled, via `recordNotification`)

**Failure scenarios**: No eligible candidates → donation expired

---

### 4. Sync SeatInventory on Listing Change (Entity automation — Listing update)

**Automation ID**: `6a1b20a949ea1d4c4b01f764`  
**Function**: `syncInventoryOnListingChange`  
**Trigger**: Listing entity update  
**Status**: Active

**Conditions**: Listing status changed (compares `data.status` vs `old_data.status`)

**Actions performed**:
- `cancelled` or `expired` → SeatInventory: `available`, `intent: undecided`, `linked_listing_id: null`
- `sold` → SeatInventory: `transferred`, `linked_purchase_id` set
- `pending_transfer` → SeatInventory: `reserved_for_purchase`

**Database changes**: SeatInventory (`inventory_status`, `inventory_intent`, `linked_listing_id`, `linked_purchase_id`)

**Notification outputs**: None

**Failure scenarios**: No SeatInventory found (skipped), listing has no `seat_inventory_id` (fallback lookup by owner+event+section)

---

### 5. Record Transfer Outcome on Purchase Complete (Entity automation — Purchase update)

**Automation ID**: `6a18ed01fa77c0b47415c9f3`  
**Function**: `recordTransferOutcome`  
**Trigger**: Purchase entity update  
**Status**: Active

**Conditions**: `transfer_status` changed to `completed` or `disputed`

**Actions performed**:
- Creates TransferOutcome record (with `minutes_to_transfer` calculated from `seller_confirmed_at` - `created_date`)
- Creates BetaTransferLog (`transfer_complete` or `transfer_failed`)
- Updates seller reliability score:
  - `transfer_success_count` or `transfer_fail_count` incremented
  - `seller_transfer_reliability` recalculated (success_count / total * 100, with penalties)
  - `transfer_false_claim_count` incremented if disputed and not already recorded
- If disputed → creates AdminAlert (`failed_transfer_after_payment`, priority: critical)

**Database changes**:
- TransferOutcome: created
- BetaTransferLog: created
- User (seller): `transfer_success_count`, `transfer_fail_count`, `seller_transfer_reliability`, `transfer_false_claim_count`
- Purchase: `false_claim_recorded` (set to true)
- AdminAlert: created if disputed

**Notification outputs**: None (notifications handled by capturePayment)

**Failure scenarios**: Seller not found (skipped), alert creation failure (fire-and-forget)

---

## Notable Absent Automations

The following automations do NOT exist but would be valuable:

1. **Orphaned draft listing cleanup** — No automation cleans up `pending_payout_setup` listings that are never completed
2. **Instant listing custody verification notification** — No automation notifies admin when instant listing is created with `pending_verification` status
3. **Stale Flash Drop delivery cleanup** — No automation resolves SeatInventory stuck in `claimed_by_winner` state
4. **Event status auto-update** — No automation updates Event `status` from `upcoming` to `live` to `ended` based on event time
5. **Transfer window auto-check** — No automation checks TM or other platforms for transfer window status
6. **Daily analytics report** — No automation generates daily summary reports for the founder

---

# SECTION 8: STRIPE & PAYMENTS AUDIT

## Every Stripe Dependency

### Secrets (5 total)
| Secret Name | Purpose | Production Check |
|-------------|---------|-------------------|
| `STRIPELIVESECRETKEY` | Primary secret key for Stripe API | Must start with `sk_live_` |
| `STRIPELIVEPUBLISHABLEKEY` | Publishable key for Stripe.js | Must start with `pk_live_` |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification | Must match Stripe dashboard webhook signing secret |
| `STRIPE_SECRET_KEY` | Legacy secret key | May be unused — verify and remove |
| `STRIPE_PUBLISHABLE_KEY` | Legacy publishable key | May be unused — verify and remove |

### Backend Functions Using Stripe (9 total)

| Function | Stripe Usage | Admin Gate |
|----------|-------------|------------|
| `createPaymentIntent` | PI creation with manual capture, transfer_data, application_fee | Auth required |
| `capturePayment` | PI capture with idempotency key | Auth required |
| `cancelPurchase` | PI cancel or refund | Buyer or admin |
| `stripeWebhook` | Webhook handler (no auth, signature verified) | Public (signature verified) |
| `onboardSeller` | Express account creation, onboarding links | Auth required |
| `checkSellerOnboarding` | Account retrieval (charges_enabled) | Auth required |
| `diagnoseSeller` | Account retrieval (full diagnostic) | **NO ADMIN CHECK — security issue** |
| `getStripeKey` | Returns publishable key | Auth required |
| `getStripeMode` | Key mode consistency check | Admin only |

### Frontend Stripe References
- `components/events/PurchaseDialog` — Uses `@stripe/react-stripe-js` (Elements, CardElement, useStripe, useElements)
- `loadStripe()` called with publishable key from `getStripeKey`

## Connected Account Requirements

- **Account Type**: Stripe Express
- **Capabilities**: transfers (requested)
- **Onboarding**: Account onboarding link with `refresh_url` and `return_url`
- **Validation**: `charges_enabled` must be `true` for listing to be purchasable
- **Stale account cleanup**: Invalid accounts auto-cleared in `checkSellerOnboarding` and `createPaymentIntent`
- **Mode validation**: In live mode, seller accounts are validated via `stripe.accounts.retrieve()` before use

## Payment Flows

### Standard Purchase Flow
1. **`createPaymentIntent`**: PI created with `capture_method: 'manual'`, `transfer_data: { destination: seller_account_id }`, `application_fee_amount: platform_fee_cents`
2. **Frontend**: `stripe.confirmCardPayment(clientSecret)` — authorizes card (no capture yet)
3. **`capturePayment` (seller confirms)**: Sets `seller_confirmed = true`, sends buyer "tickets_sent" notification
4. **`capturePayment` (buyer confirms)**: `stripe.paymentIntents.capture(pi_id, { idempotencyKey: 'capture-${purchase.id}' })` — captures payment
5. **Stripe**: Transfers funds to seller's connected account (minus application fee)

### Fee Calculation

- **Active Model**: `buyer_5_min_1` — Buyer pays 5% (min $1), seller pays nothing
- **Platform Fee**: `Math.max(1.00, Math.round(subtotal * 0.05 * 100) / 100)`
- **Seller Payout**: `subtotal` (no seller fee in current model)
- **Stripe Processing Fee**: 2.9% + $0.30 (deducted from platform fee for analytics only)
- **Minimum Listing Price**: $10.00 (enforced in UI)
- **Fee Engine Source**: `lib/feeEngine.js` (single source of truth)

### Seller Payout Process
1. Payment captured by `capturePayment`
2. Stripe transfers funds to seller's Express account
3. Stripe payout to seller's bank account (2-7 business days, up to 14 for first payout)
4. Seller notified: "Sale complete 💸 — Your payout is processing. Stripe deposits typically take 2–7 business days. First-time payouts may take up to 14 days."

### Refund Process
1. **Buyer cancels via `cancelPurchase`** (before capture): PI cancelled, no charge
2. **Buyer cancels after capture** (if succeeded): `stripe.refunds.create({ payment_intent: pi_id })`
3. **Stripe webhook `charge.refunded`**: Admin notified via email
4. **Dispute/chargeback**: Stripe webhook `charge.dispute.created` → Purchase marked `disputed`, admin alerted

### Failure States

| Failure | Detection | Response |
|---------|-----------|----------|
| PI creation fails | `createPaymentIntent` catch | Reservation released, error to buyer |
| Card declined | `stripe.confirmCardPayment` error | Listing restored, error to buyer |
| Capture fails | `capturePayment` catch | `payment_capture_failed = true`, admin emailed, manual retry |
| Payout fails | Stripe webhook `payout.failed` | Seller notified, admin alerted |
| Transfer fails | Stripe webhook `transfer.failed` | Seller notified, admin alerted |
| Payment fails | Stripe webhook `payment_intent.payment_failed` | Purchase expired, listing restored, buyer notified |
| Dispute created | Stripe webhook `charge.dispute.created` | Purchase marked disputed, admin alerted |
| PI expires (7 days) | `processTransferReminders` warns at 6 days | Admin must capture or cancel manually |

## Missing Implementation

- **Venue payout**: No venue payout flow exists
- **Partial refunds**: Not implemented (only full cancel/refund)
- **Refund approval workflow**: No admin approval for refunds (buyer can cancel directly via `cancelPurchase`)
- **Instant Transfer fulfillment payment**: No payment flow for Instant Transfer custody (seller transfers to PG, but no payment for custody verification)
- **Seller fee**: Currently 0% (all fees on buyer). Fee models exist for seller fees but are not active.

## Places Stripe Is Referenced in Code

### Backend Functions
- `functions/createPaymentIntent.js` — Lines 2, 20-25, 119-130, 156-190
- `functions/capturePayment.js` — Lines 2, 43-48, 122-144
- `functions/cancelPurchase.js` — Lines 2, 11-16, 44-49
- `functions/stripeWebhook.js` — Lines 3, 16-17, 21-28, 38, 50-136
- `functions/onboardSeller.js` — Lines 2, 11-17, 25-52, 55-60
- `functions/checkSellerOnboarding.js` — Lines 2, 11-20, 23-31
- `functions/diagnoseSeller.js` — Lines 2, 11, 54-56
- `functions/getStripeKey.js` — Line 9
- `functions/getStripeMode.js` — Lines 14-15, 17-23
- `functions/processTransferReminders.js` — Lines 2, 47-48, 152-159

### Frontend
- `components/events/PurchaseDialog` — `loadStripe`, `Elements`, `CardElement`, `useStripe`, `useElements`
- `lib/feeEngine.js` — `STRIPE_ASSUMPTIONS` (2.9% + $0.30)

### Secrets
- `STRIPELIVESECRETKEY`
- `STRIPELIVEPUBLISHABLEKEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_SECRET_KEY` (legacy)
- `STRIPE_PUBLISHABLE_KEY` (legacy)