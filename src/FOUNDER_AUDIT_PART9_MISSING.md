# PART 9: WHAT I AM MOST LIKELY MISSING

---

# SECTION 13: WHAT I AM MOST LIKELY MISSING

## Features That Appear Finished But Are Not

### 1. Instant Transfer / Custody Verification

**Appears finished**: The UI for Instant Transfer listing mode exists in `CreateListing`. Sellers can upload proof screenshots. Listings show "pending verification" status. The PurchaseDialog shows "Instant Transfer" badges and messaging.

**Actually not**: 
- **No admin workflow exists to verify custody.** When a seller creates an instant listing, it gets `status: 'pending_verification'` and `custody_status: 'pending_pg_verification'`. There is no admin UI, no notification to admin, and no queue in the Admin Command Center to review these listings.
- The "Instant Ops" panel in the Admin Command Center shows purchases, not pending custody listings.
- **The founder must manually query the database** for `status: 'pending_verification'` listings, verify the seller transferred tickets to `experience@peanutgallery.com`, and then manually update the listing to `status: 'active'` and `custody_status: 'verified'`.
- Sellers will wait indefinitely unless the founder manually checks. There is no SLA communicated to sellers, and no way for sellers to know the status of their verification.

### 2. MyTickets Page

**Appears finished**: The MyTickets page shows purchased tickets with status badges (pending, completed, disputed). It has links to purchase detail pages and upgrade options.

**Actually not**:
- **No in-app digital ticket display.** Buyers cannot view their actual tickets (barcodes, QR codes, seat details for venue entry) inside the app.
- Buyers must rely on the original ticketing platform (Ticketmaster, SeatGeek, etc.) for entry to the venue.
- This is a **critical gap** for a ticket marketplace. Users will expect to see their tickets in the app after purchase. The app functions as a transaction tracker, not a ticket wallet.
- MyTickets also does not auto-refresh (no realtime subscriptions, no polling). Status changes require manual page refresh.

### 3. MySales Listing Management

**Appears finished**: The MySales page shows seller's listings with status badges (active, pending transfer, sold, draft). It shows metrics and stats.

**Actually not**:
- **Sellers cannot edit, pause, or delete listings** from MySales. This is a known open todo in the codebase.
- Sellers who want to remove a listing must contact support or wait for it to expire/be sold.
- Sellers cannot edit price, seat details, or transfer method after creation.
- Sellers cannot pause a listing temporarily (hide it from buyers without cancelling).

### 4. Real Geofencing for Upgrades

**Appears finished**: The `UpgradeEligibilityGate` component checks location. It shows "Must be inside the venue" / "Must be near the venue" messaging. It has a "Check" button that calls `navigator.geolocation.getCurrentPosition`.

**Actually not**:
- Uses browser `navigator.geolocation` which can be **easily spoofed** (browser devtools, VPN, mock location apps).
- **No server-side location validation.** The location check happens entirely in the frontend. The `seatDonation` function does server-side geo-checking with precision checks, but upgrade purchases do not.
- In demo mode, location is **entirely simulated** — the `UpgradeEligibilityGate` just waits 1.2 seconds and returns "pass" without checking anything.
- No venue beacon integration, no GPS accuracy enforcement, no IP-based location verification.

### 5. Transfer Window Status

**Appears finished**: The Event entity has `transfer_window_status`, `transfer_window_closes_at`, `transfer_window_source`, `transfer_window_confidence`, and `upgrade_eligibility_status` fields. `TransferWindowBadge` component displays this. Admin can update it via `TransferWindowAdminPanel`.

**Actually not**:
- Transfer window status is **mostly `unknown`** — no automated system checks TM or other platforms for transfer availability.
- Relies entirely on:
  1. Manual admin updates (via `TransferWindowAdminPanel`)
  2. Community reports (via `CommunityTransferReport` component)
  3. Seller attestations (at listing creation)
- No automated checking of Ticketmaster, SeatGeek, AXS, or other platforms.
- The `transfer_window_source` field supports `ticketmaster`, `seatgeek`, `axs`, `mlb`, `manual_admin`, `user_reported`, `inferred` — but no code actually checks these sources automatically.

### 6. Real-time Purchase Status Updates

**Appears finished**: The PurchaseSuccess page auto-refreshes every 15 seconds for buyers while the purchase is pending. The UI shows a transaction timeline that updates.

**Actually not**:
- Uses **polling** (15-second interval), not realtime subscriptions.
- The Base44 SDK supports realtime subscriptions (`base44.entities.Purchase.subscribe`), but they are **not used** anywhere in the app.
- MyTickets page **does not auto-refresh at all** — status changes require manual page refresh.
- Notification polling in Layout runs every 60 seconds (not realtime).
- This means buyers/sellers may wait up to 15-60 seconds to see status updates, which can feel broken during time-sensitive transfer flows.

---

## Systems That Require Configuration

### 1. Stripe Webhook Registration (CRITICAL)

**Not obvious from UI**: The `stripeWebhook` function exists and handles disputes, refunds, failures, and successes. However, **there is no code or verification that the webhook URL is registered in the Stripe dashboard**.

If the webhook is not registered:
- Stripe chargeback disputes won't update Purchase status automatically
- Payment failures won't restore listings automatically
- Payout failures won't notify sellers
- Refunds won't notify admins

**This is a silent failure.** The app will appear to work (payments will process, transfers will complete normally), but critical edge-case payment events will be missed entirely. The founder won't know until a dispute occurs and isn't handled.

**Action required**: Register webhook URL `https://[app-domain]/api/functions/stripeWebhook` in Stripe dashboard → Developers → Webhooks. Events to subscribe: `payment_intent.payment_failed`, `payment_intent.succeeded`, `payout.failed`, `transfer.failed`, `charge.dispute.created`, `charge.refunded`.

### 2. Email Domain Verification

**Not obvious**: The app sends emails via `Core.SendEmail` with `from_name: "Peanut Gallery"`. There is no verification that the sending domain has proper SPF/DKIM records.

If not configured:
- Emails may go to spam
- Users may not receive critical notifications (sale alerts, transfer reminders, dispute notifications)
- Admin alerts may be missed

**Action required**: Verify email domain DNS records (SPF, DKIM, DMARC) with Base44 support.

### 3. OneSignal Domain Configuration

**Not obvious**: OneSignal must have the app domain configured as an allowed origin. If not, push notifications will fail silently.

If not configured:
- Push notifications fail silently
- `sendUserNotification` returns `{ sent: false, reason: 'no_api_key' }` or push delivery failure
- Email fallback still works (fire-and-forget pattern)
- Users won't know they're missing push notifications

**Action required**: Configure allowed origin in OneSignal dashboard → Settings → Site Setup.

### 4. Admin Email Inbox

**Not obvious**: `experience@peanutgallery.store` is **hardcoded** in multiple backend functions:
- `capturePayment` (Stripe capture failure alert)
- `stripeWebhook` (dispute, refund, payout failure alerts)
- `verifyTransferProof` (suspicious proof alert)
- `processTransferReminders` (auto-review flag, stale PI warning)

If this inbox doesn't exist or isn't monitored:
- Stripe capture failures won't be noticed
- Disputes won't be handled
- AI-flagged fraud won't be reviewed
- Buyer-inactive-24h cases won't be resolved
- Stale PaymentIntents will expire without intervention

**Action required**: Verify inbox exists, set up forwarding/monitoring, check daily.

---

## Hidden Launch Blockers

### 1. Multiple Email Domains (CRITICAL)

The codebase references **three different domains** inconsistently:

| Domain | Used In | Purpose |
|--------|---------|---------|
| `experience@peanutgallery.store` | `capturePayment`, `stripeWebhook`, `verifyTransferProof`, `processTransferReminders` | Admin notification recipient |
| `experience@peanutgallery.com` | `sendNotificationEmail` (SUPPORT_EMAIL constant), `CreateListing` (instant transfer instructions) | Support email / Instant transfer recipient |
| `app.peanutgallery.app` | `sendUserNotification` (buildEmail URLs) | Email link URLs |
| `app.peanutgallery.store` | `recordNotification` (email body links) | Email link URLs |
| `peanutgallery.store` | Various | General domain |

This inconsistency could cause:
- Email delivery issues (different domains may have different SPF/DKIM)
- Broken links in emails (mismatched domains)
- Confused users (which domain is the real one?)
- Stripe webhook issues (origin mismatch)
- OneSignal origin issues

**Action required**: Standardize on ONE domain for everything. Update all hardcoded references.

### 2. Missing RLS on Multiple Entities (SECURITY)

Several entities have **no RLS specified**, meaning their data is publicly readable by any authenticated user:

| Entity | What's Exposed |
|--------|----------------|
| SeatDonation | Donor emails, winner emails, seat details |
| DonationOptIn | User emails, draw weights, purchase IDs |
| TransferReport | Reporter emails, screenshots |
| BetaFeedback | Tester names, feedback content |
| FanPost | Author emails, photos, seat details |
| Follow | Follower/following emails |
| BucketListItem | User emails, preferences |
| QAChecklistItem | Internal QA data |
| BugReport | Bug details, reporter names, screenshots |

**Any authenticated user can read all of this data** by making direct API calls to the Base44 SDK.

**Action required**: Add RLS to all listed entities.

### 3. Admin Routes Without Role Checks (SECURITY)

Several admin-adjacent routes have **no explicit admin gate**:

| Route | Risk |
|-------|------|
| `/founder` | Exposes founder dashboard, metrics, beta data |
| `/beta-dashboard` | Exposes beta tester management |
| `/beta-testers` | Exposes beta recruitment |
| `/beta-checklist` | Exposes founder checklist |

Any authenticated user can access these pages by typing the URL directly. They use admin backend functions that DO have role checks, so data writes are protected, but read access is not.

**Action required**: Add `user.role === 'admin'` checks to all four routes.

### 4. `diagnoseSeller` Function Has No Admin Check (SECURITY)

The `diagnoseSeller` function requires authentication but **does not verify admin role**. It returns:
- User email and role
- Stripe account ID
- Stripe onboarding status
- Stripe account charges_enabled, payouts_enabled, details_submitted
- Stripe error details

Any authenticated user can diagnose any seller's Stripe account state by passing their email.

**Action required**: Add `if (user.role !== 'admin') return 403` to `diagnoseSeller`.

### 5. Flash Drop Unverified Ownership (FRAUD RISK)

`ALLOW_UNVERIFIED_BETA = true` in the `flashDrop` function allows users to create Flash Drops **without verifying seat ownership**. This means:
- Users could create Flash Drops for seats they don't own
- Winners could receive fake/non-existent seats
- Trust in the Flash Drop system would be undermined

**Action required**: Set `ALLOW_UNVERIFIED_BETA = false` before production launch.

### 6. No Content Moderation (REPUTATION RISK)

FanPost, FanZone has **no content moderation**:
- No profanity filter
- No image moderation
- No report/flag mechanism
- No admin review queue for posts
- No automated content scanning

Inappropriate content could be published without any oversight, creating legal and reputational risks.

**Action required**: Add content moderation (profanity filter, report mechanism, admin review queue).

### 7. No Notification on Listing Cancellation (UX GAP)

When a buyer cancels a purchase via `cancelPurchase`, **no notification is sent to the seller**. The seller may have already initiated a ticket transfer and won't know the purchase was cancelled. The listing is restored to active, but the seller is unaware.

**Action required**: Add seller notification in `cancelPurchase` function.

### 8. No Notification on Instant Listing Creation (OPERATIONAL GAP)

When a seller creates an Instant Transfer listing, **no notification is sent to admin**. The founder must manually check the database for `status: 'pending_verification'` listings to verify custody. There is no admin alert, no email, no dashboard indicator.

**Action required**: Add admin notification when instant listing is created, or add pending custody listings to the Admin Command Center.

---

## Operational Requirements Not Obvious From the UI

### 1. Manual Custody Verification (Daily Operational Burden)

The Instant Transfer feature requires the founder to **manually verify** that the seller transferred the ticket to `experience@peanutgallery.com`. 

- There is **no admin UI** for this
- There is **no notification** when a listing is created
- There is **no queue** in the Admin Command Center
- The founder must **query the database directly**: `base44.entities.Listing.filter({ status: 'pending_verification' })`
- Then manually verify by checking the email inbox for the transfer
- Then manually update: `status: 'active'`, `custody_status: 'verified'`
- Sellers will wait **indefinitely** if the founder doesn't check

**This is a significant daily operational burden** that is entirely invisible from the UI.

### 2. Manual Dispute Resolution (High-Stakes Manual Process)

All disputes require **manual founder intervention**. There is no automated resolution.

- When a buyer opens a dispute, the Purchase is marked `disputed`
- An AdminAlert is created (critical priority)
- An email is sent to `experience@peanutgallery.store`
- The founder must:
  1. Review the transfer proof (screenshot, notes)
  2. Review AI verification results (if available)
  3. Contact both parties if needed
  4. Decide: capture payment (seller wins) or refund buyer
  5. If refund: manually process via Stripe dashboard
  6. Update Purchase status
  7. Resolve AdminAlert

**This is time-sensitive** — Stripe chargebacks have deadlines (usually 7-10 days to respond).

### 3. Manual Stale PI Management (Time-Sensitive)

PaymentIntents expire after **7 days**. The system warns at 6 days, but the founder must manually act.

- The `processTransferReminders` function sends an email alert at 6 days
- The founder must:
  1. Check the purchase status
  2. If transfer confirmed: capture payment via admin panel
  3. If transfer failed: cancel purchase and refund
  4. If unsure: contact parties and investigate

**If the founder misses this window**, Stripe auto-cancels the PI. The buyer gets refunded automatically, but the listing may need to be manually restored, and both parties may be confused.

### 4. Manual Seller Onboarding Issue Resolution

If a seller's Stripe account becomes invalid (e.g., they close it, or it gets restricted), the system auto-clears the stale account. But:

- There is **no proactive notification to the seller** — they'll only discover the issue when:
  - Trying to create a new listing (blocked)
  - A buyer tries to purchase their existing listing (blocked with "Seller has not completed payout onboarding")
- The seller may have active listings that become unpurchasable
- The founder may need to contact sellers proactively if their account is cleared

### 5. Community Transfer Reports Require Manual Review

When community reports conflict (both "open" and "closed" with ≥3 reports each in 2 hours), an admin alert is created. But:

- **Resolution is entirely manual**
- The founder must review screenshots, check the ticketing platform, and manually update the Event's transfer window status
- No automated checking exists
- The community report system depends on users actively reporting, which may not happen

---

## Founder Tasks That Would Surprise You Later

### 1. You Will Need to Manually Verify Instant Transfer Custody

Every Instant Transfer listing requires **manual email verification**. The seller transfers to `experience@peanutgallery.com`, uploads proof, and waits.

- There is **no admin queue** for this
- There is **no notification** when an instant listing is created
- There is **no workflow** in the Admin Command Center
- You will discover pending listings **only by querying the database directly**

**You will likely forget to check this regularly**, and sellers will complain about slow verification. Consider building an admin notification or queue before launch.

### 2. You Will Need to Handle Buyer-Inactive-24h Cases

When a buyer doesn't confirm receipt 24 hours after the seller confirms transfer, the purchase is flagged for admin review (`auto_review_flagged = true`).

- You receive an email alert
- You must **manually decide**: capture payment (if transfer is legitimate) or open dispute
- This requires **investigating each case individually** — reviewing transfer proof, AI verification, contacting parties
- There is **no auto-capture** (intentionally disabled per CRITICAL-B fix)

**You will need to check for these flags daily** and resolve them within 48 hours (before Stripe PI expires at 7 days, minus the 24h already elapsed = ~48h window).

### 3. You Will Need to Monitor for Point Farming

While anti-abuse measures exist (self-purchase blocking, duplicate guards, daily caps), **sophisticated farming is not detected automatically**:
- Multiple accounts coordinating transactions
- Alt accounts buying from each other
- Exploiting daily caps across multiple action types

You will need to **audit PointsActivity periodically** for unusual patterns. Look for:
- Clusters of transactions between the same small group of users
- Unusually high point accumulation rates
- Many small transactions (just above minimum price)

### 4. You Will Need to Handle Stripe Capture Failures

When `stripe.paymentIntents.capture()` fails:
- The system marks `payment_capture_failed = true`
- An email is sent to `experience@peanutgallery.store`
- The Purchase is stuck in `pending_transfer` state

You must:
1. Check the Stripe dashboard for the error reason
2. Fix the issue (e.g., seller account restriction, PI expired)
3. Manually retry the capture in Stripe dashboard
4. Update the Purchase: `payment_captured = true`, `transfer_status = completed`
5. Or cancel the purchase and refund

### 5. You Will Need to Manually Resolve Duplicate Events

Despite dedup logic in `syncTMEvent`, duplicate events can still occur:
- If events are created manually (not via TM sync)
- If TM event IDs change
- If dedup fails due to timing issues

You will discover these via:
- EventNavigationLog entries with `result: 'lookup_fallback_success'` or duplicate warnings
- User reports of "which event is the real one?"

You must manually delete duplicates and ensure listings/purchases point to the correct event.

### 6. You Will Need to Handle Orphaned Draft Listings

When sellers save listings without completing Stripe onboarding, drafts accumulate with `status: 'pending_payout_setup'`.

- There is **no cleanup automation**
- These drafts are never visible to buyers
- They accumulate indefinitely in the database
- They may confuse sellers who think their listing is "live"

You will need to **periodically query and clean these up**:
- Delete drafts older than 30 days
- Email sellers reminding them to complete onboarding
- Consider adding an automation for this

### 7. You Will Need to Monitor Integration Credit Usage

AI verification uses **Claude Sonnet 4.6** (a non-default, higher-cost model). Each verification call costs integration credits.

- If credits run out, `verifyTransferProof` will fail
- All proofs will be marked `failed_processing`
- All proof verification becomes manual

You will need to:
- Monitor integration credit balance in the Base44 dashboard
- Budget for AI verification costs (each call processes an image with a detailed prompt)
- Consider rate limiting AI calls if volume is high

### 8. You Will Need to Handle Flash Drop Delivery

Flash Drop winners and donors must **mutually confirm delivery**. If either party doesn't confirm:
- The SeatInventory gets stuck in `claimed_by_winner` state
- There is **no automation** to resolve this
- The seat is effectively locked — can't be re-dropped, sold, or used

You will need to:
- Periodically check for stuck SeatInventory records
- Manually update status to `transferred` or `available`
- Contact parties to confirm delivery happened

### 9. You Will Need to Handle Stale Donations

While `cleanupStaleDonations` handles rerolls (every 10 minutes), if all candidates are exhausted, donations **expire silently**:
- Donors may not know their donation wasn't claimed
- The seat may have already been transferred away by the donor
- There is **no notification to the donor** when a donation expires

You will need to:
- Check `cleanupStaleDonations` logs for expired donations
- Consider adding donor notifications for expired donations

### 10. You Will Discover That "Live" Features Are Demo-Only

The entire Live Hub (upgrades, flash drops, fan karma) for **venue upgrades is demo mode**:
- `releaseDemoUpgrades` creates demo listings with `is_demo_listing: true`
- Demo upgrades use **simulated purchases** (no real payment, no real transfer)
- **No real venue partner integration exists**
- **No real geofencing** (simulated in demo mode)
- **No real ticket transfer** for upgrades

If you launch expecting real venue upgrades, you will be disappointed. The system is architecturally ready (entity fields, listing types, UI components) but has:
- No real venue data
- No real geofencing enforcement
- No real ticket transfer for upgrades
- No admin fulfillment workflow for Instant Transfer

**The "Live" features are a proof of concept, not a production system.**

---

**END OF AUDIT**

*This document represents a complete audit of the Peanut Gallery codebase as of June 24, 2026. All findings are based on actual code review of backend functions, frontend components, entity schemas, automations, and integrations. No marketing claims or assumptions have been made — every statement is backed by code.*