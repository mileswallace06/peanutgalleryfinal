# PART 6: NOTIFICATIONS AUDIT + ROUTE & PAGE INVENTORY

---

# SECTION 9: NOTIFICATIONS AUDIT

## Push Notifications (OneSignal)

**Configuration**:
- App ID: `8c9896d6-d4d6-4cdf-a094-3ba25bdd4585` (hardcoded in `lib/oneSignal.js` and `functions/sendUserNotification`)
- API Key Secret: `ONESIGNAL_REST_API_KEY`
- SDK: `react-onesignal` (frontend), direct REST API (backend)

**Trigger**: `recordNotification` → `sendUserNotification` → OneSignal REST API

**Audience**: Authenticated users (external_id = email, linked via `OneSignal.login(email)`)

**Delivery method**: OneSignal REST API (`include_aliases: { external_id: [email] }`, `target_channel: 'push'`)

**Current status**: Complete

**Missing setup requirements**:
- Verify OneSignal app is production (not test)
- Verify domain configured in OneSignal dashboard
- Verify `ONESIGNAL_REST_API_KEY` is valid and not expired

**Push notification types sent**:
- `sale_created` — "🎉 Your ticket sold!" (to seller)
- `seller_reminder` — "Transfer reminder" / "⚠️ Final transfer reminder" (to seller)
- `tickets_sent` — "Tickets sent 🚀" (to buyer)
- `buyer_reminder` — "Confirm your tickets" / "⏰ Please confirm your tickets" (to buyer)
- `sale_complete` — "Sale complete 💸" (to seller)
- `buyer_confirmed` — "Transfer confirmed ✅" (to buyer)
- `donation_won` — "🎁 You won a Flash Drop!" / "🎁 You won a seat donation!" (to winner)
- `purchase_expired` — "Purchase expired — refund issued" (to buyer)
- `listing_expired` — "Your listing expired" (to seller)
- `buyer_action_required` — "⚠️ Action required — confirm your tickets" (to buyer)
- `seller_info` — "Awaiting admin review" (to seller)
- `payment_failed` — "Payment failed" (to buyer)
- `payout_failed` — "Payout failed ⚠️" (to seller)

---

## Email Notifications (Core.SendEmail)

**Trigger**: `recordNotification` (for high-value types) → `sendNotificationEmail` or `sendUserNotification`

**Audience**: Users with email addresses

**Delivery method**: Base44 Core.SendEmail integration

**From name**: "Peanut Gallery"

**Current status**: Complete

**Missing setup requirements**:
- Verify email domain (SPF/DKIM records) for deliverability
- Verify sender email is not flagged as spam

**Email notification types (email enabled = true)**:
- `purchase_confirmed` (email: true)
- `tickets_sent` (email: true) — to buyer
- `transfer_rejected` (email: true)
- `sale_complete` (email: true) — to seller
- `payout_processing` (email: true)
- `dispute_opened` (email: true)
- `dispute_resolved` (email: true)
- `donation_won` (email: true)
- `donation_expired` (email: true)
- `listing_hidden` (email: true)
- `listing_approved` (email: true)
- `listing_rejected` (email: true)
- `sale_created` (email: true) — to seller
- `ai_rejected` (email: true)
- `admin_message` (email: true)

**Email types where email is disabled**:
- `transfer_verified` (email: false)
- `buyer_confirmed` (email: false)
- `donation_accepted` (email: false)
- `listing_expired` (email: false)
- `ai_verified` (email: false)

---

## In-App Notifications

**Trigger**: `recordNotification` → creates Notification entity

**Audience**: User (filtered by `user_email`)

**Delivery method**: Notification entity (polled every 60 seconds in Layout component)

**Current status**: Complete (but uses polling, not realtime subscriptions)

**Missing setup requirements**:
- Consider switching to realtime subscriptions (`base44.entities.Notification.subscribe`) for instant updates
- MyTickets page does not auto-refresh (known issue)

**Notification types** (20 total):
`purchase_confirmed`, `tickets_sent`, `transfer_verified`, `transfer_rejected`, `buyer_confirmed`, `sale_complete`, `payout_processing`, `dispute_opened`, `dispute_resolved`, `donation_won`, `donation_accepted`, `donation_expired`, `listing_hidden`, `listing_approved`, `listing_rejected`, `listing_expired`, `sale_created`, `ai_verified`, `ai_rejected`, `admin_message`

---

## Admin Alerts

**Trigger**: Multiple sources:
- `processTransferAlerts` (scheduled) — expired verifications, low confidence, stalled transfers, disputes, conflicting reports
- `recordTransferOutcome` (entity automation) — failed transfers after payment
- `verifyTransferProof` (AI function) — suspicious proofs flagged
- `capturePayment` (function) — Stripe capture failures
- `stripeWebhook` (webhook) — Stripe disputes, payout failures

**Audience**: Admin email (`experience@peanutgallery.store`) + AdminAlert entity (visible in Admin Command Center)

**Delivery method**:
- Email via `sendNotificationEmail` to `experience@peanutgallery.store`
- AdminAlert entity (polled in AdminAlertCenter)

**Current status**: Complete

**Missing setup requirements**:
- Verify `experience@peanutgallery.store` inbox exists and is monitored
- Verify email deliverability

**Admin Alert Types** (10 types):
1. `failed_transfer_after_payment` (critical)
2. `new_dispute` (critical)
3. `expired_verification` (medium)
4. `low_confidence_listing` (high)
5. `conflicting_community_reports` (high)
6. `transfer_disabled_active_listing`
7. `buyer_waiting_for_transfer` (high at 30min, critical at 60min)
8. `seller_missed_deadline`
9. `seller_reliability_drop`
10. `admin_action_required`

**Admin email alert triggers** (sent to `experience@peanutgallery.store`):
- Stripe capture failed
- Stripe dispute created (chargeback)
- Stripe refund issued
- Stripe payout/transfer failed
- AI flagged suspicious transfer proof
- Buyer inactive 24h (admin review required)
- Stripe PI expiring tomorrow (6-day warning)

---

## Venue Alerts

**Current status**: **None** — no venue notification system exists

**Missing setup requirements**: Entire venue notification system needs to be built, including:
- Venue-specific notification preferences
- Venue alert types (new listing, low inventory, transfer issues)
- Venue email/push delivery

---

## Security Model for Notifications

### `recordNotification` Security
- Authenticated users may only create notifications for THEMSELVES (user_email must match caller email)
- Admin users may target any user_email
- Service-role calls (from other backend functions with `x-base44-service-role: true` header) may target any user_email

### `sendUserNotification` Security
- Authenticated users may only send push/email to THEMSELVES
- Admin users may target any user_email
- Service-role calls may target any user_email

### User Preference Controls
- `notif_listing_sold` — Controls `sale_created` and `sale_complete` notifications
- `notif_transfer_updates` — Controls `seller_reminder`, `tickets_sent`, `buyer_reminder` notifications
- Preferences checked in `sendUserNotification` before sending

---

# SECTION 10: ROUTE & PAGE INVENTORY

## All Routes (30 total)

| Route | Purpose | Access Type | Connected Features | Completion Status |
|-------|---------|-------------|-------------------|-------------------|
| `/` | Redirect to `/events` | Authenticated | Navigation | Complete |
| `/events` | Event discovery | All users | Event Discovery | Complete |
| `/events/:id` | Event detail + listings | All users | Event Detail | Complete |
| `/events/tm/:tmId` | TM event detail | All users | Event Detail (TM) | Complete |
| `/purchase/:id` | Purchase tracking | Buyer/Seller/Admin | Purchase Success | Complete |
| `/admin` | Admin Command Center | Admin only | Admin (13 sections) | Complete |
| `/admin-legacy` | Legacy admin | Admin only | Admin (Legacy) | Complete (deprecated) |
| `/my-sales` | Seller dashboard | Authenticated | MySales | **Partial** (no edit/pause/delete) |
| `/my-tickets` | Buyer tickets | Authenticated | MyTickets | **Partial** (no digital ticket display) |
| `/create-listing` | Listing creation | Authenticated | Create Listing | Complete |
| `/fan-zone` | Social feed | Authenticated | Fan Zone | Complete |
| `/me` | Profile | Authenticated | Me | Complete |
| `/upgrades` | Upgrades landing | All users | Upgrades | **Partial** (demo only) |
| `/upgrades/:id` | Live Hub | All users | Event Detail Upgrade | **Partial** (demo only) |
| `/sell` | Seller dashboard | Authenticated | Sell | Complete |
| `/account-settings` | Account settings | Authenticated | Account Settings | Complete |
| `/edit-persona` | Persona editor | Authenticated | Edit Persona | Complete |
| `/beta-qa` | Beta QA | Authenticated | Beta QA | Complete |
| `/terms` | Terms of Service | All users | Legal | Complete (needs legal review) |
| `/privacy` | Privacy Policy | All users | Legal | Complete (needs legal review) |
| `/instant-listings` | Instant listing guide | All users | Education | Complete |
| `/seller-payout-guide` | Payout guide | All users | Education | Complete |
| `/why-peanut-gallery` | Value proposition | All users | Education | Complete |
| `/leaderboard` | Community leaderboard | All users | Leaderboard | Complete |
| `/founder` | Founder dashboard | **Admin (no explicit check)** | Founder | Complete |
| `/beta-checklist` | Beta checklist | **Admin (no explicit check)** | Beta | Complete |
| `/beta-testers` | Beta recruitment | **Admin (no explicit check)** | Beta | Complete |
| `/beta-dashboard` | Beta dashboard | **Admin (no explicit check)** | Beta | Complete |
| `/notifications` | Notifications | Authenticated | Notifications | Complete |
| `/event-mode/:id` | Deprecated | All users | Redirects to `/upgrades/:id` | **Deprecated** |

## Hidden Routes (Not in Bottom Navigation)

- `/admin` — Admin Command Center (linked from top bar in some pages)
- `/admin-legacy` — Legacy admin (linked from Command Center top bar)
- `/founder` — Founder dashboard (linked from Command Center top bar)
- `/beta-checklist`, `/beta-testers`, `/beta-dashboard` — Beta management (no nav link, accessible by URL)
- `/purchase/:id` — Purchase tracking (accessed via deep links from notifications)
- `/events/tm/:tmId` — TM event detail (accessed via event links)
- `/account-settings`, `/edit-persona` — Settings sub-pages (accessed from Me page)
- `/terms`, `/privacy` — Legal pages (accessed from footer/account settings)
- `/instant-listings`, `/seller-payout-guide`, `/why-peanut-gallery` — Education pages (accessed from various CTAs)

## Admin Routes (5 total)

| Route | Admin Gate | Notes |
|-------|-----------|-------|
| `/admin` | ✅ Role check in component | Redirects non-admins to `/events` |
| `/admin-legacy` | ✅ Same check as `/admin` | Deprecated |
| `/founder` | ❌ **No explicit check** | Accessible by URL to any authenticated user |
| `/beta-checklist` | ❌ **No explicit check** | Accessible by URL |
| `/beta-testers` | ❌ **No explicit check** | Accessible by URL |
| `/beta-dashboard` | ❌ **No explicit check** | Accessible by URL |

## Test Routes
- None explicitly — demo data is created via admin functions (`seedDemoListings`, `releaseDemoUpgrades`) rather than test routes

## Abandoned/Deprecated Routes

| Route | Status | Recommendation |
|-------|--------|----------------|
| `/event-mode/:id` | Deprecated — redirects to `/upgrades/:id` | Remove component and route |
| `/admin-legacy` | Superseded by `/admin` | Remove after migration verification |