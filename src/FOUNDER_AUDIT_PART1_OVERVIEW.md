# PART 1: EXECUTIVE OVERVIEW + COMPLETE FEATURE INVENTORY

---

# SECTION 1: EXECUTIVE OVERVIEW

## Current Application Purpose

Peanut Gallery is a peer-to-peer ticket marketplace with escrow-protected payments, AI-verified ticket transfers, seat upgrade features for live events, community seat donations, and a gamified fan loyalty system (Peanut Points). The core value proposition is buyer protection: payment is held in escrow until the buyer confirms ticket receipt, and sellers only get paid after successful transfer confirmation.

## Current Production Readiness Score: 62/100

### What Works (Strengths)
- **Payment escrow flow is complete and battle-tested**: Stripe Connect integration with manual capture, reservation token locking, race condition prevention, and webhook handling for disputes/refunds/failures.
- **Transfer confirmation lifecycle works end-to-end**: Seller confirms → buyer confirms → payment captures → listing marks sold → points awarded → notifications sent.
- **Listing creation and approval pipeline is functional**: Auto-approval for clean listings, manual review queue for flagged/duplicate-proof listings.
- **AI transfer proof verification is operational**: Vision LLM analyzes seller screenshots, extracts OCR data, scores confidence, flags fraud.
- **Notification system is multi-channel**: In-app, push (OneSignal), and email (Core.SendEmail) with user preference controls.
- **Scheduled automations are running**: Transfer reminders, alert processing, stale donation cleanup, and inventory sync are all active.

### What's Broken or Incomplete (Weaknesses)
- **No in-app digital ticket display / wallet**: Buyers have no way to view their purchased tickets inside the app. They must rely on the original ticketing platform (Ticketmaster, SeatGeek, etc.) for entry.
- **Listing management is incomplete**: Sellers cannot edit, pause, or delete listings from MySales (known open todo).
- **Seat upgrade system is demo-only**: Live upgrades and venue upgrades use simulated purchases with no real payment, no real geofencing, and no real ticket transfer. The "Instant Transfer" custody system has no backend fulfillment workflow.
- **Stripe webhook is not verified as connected**: The webhook endpoint exists but there's no confirmation the Stripe webhook URL is registered in the Stripe dashboard pointing to the production function URL.
- **Multiple email domains in use inconsistently**: Code references `experience@peanutgallery.store`, `experience@peanutgallery.com`, and `app.peanutgallery.app` — domain inconsistency may cause email delivery issues.
- **No venue partner system exists**: Despite entity fields and UI references, there is no venue onboarding, venue dashboard, or venue payout flow.
- **Referral system is disabled**: Code exists but is explicitly disabled (`referral_system_not_yet_live`).

## Major Systems Currently Active

1. **Ticket Marketplace** — Events discovery (Ticketmaster API + local DB), listing creation, purchase flow, escrow payments
2. **Transfer Verification** — Seller attestation, screenshot proof, AI vision analysis, community reports
3. **Peanut Points Economy** — Points, ranks, achievements, trust scores, badges
4. **Flash Drops** — Timed free-seat giveaways with weighted random winner selection
5. **Seat Donations** — Weighted lottery system for donating seats to attending fans
6. **Admin Command Center** — 13-section admin dashboard for operations
7. **Notification System** — In-app, push, email with user preferences
8. **Scheduled Automations** — 4 active cron jobs running every 5-10 minutes

## Major Systems Currently Disabled

1. **Referral System** — Code exists, explicitly returns `referral_system_not_yet_live`
2. **Flash Drop unverified ownership blocking** — `ALLOW_UNVERIFIED_BETA = true` allows unverified drops
3. **Auto-capture for stalled transfers** — Disabled per CRITICAL-B fix; replaced with admin review flagging
4. **Event Mode route** — Deprecated, redirects to `/upgrades/:id`

## Major Systems Currently Incomplete

1. **Digital Wallet / Ticket Display** — No in-app ticket view for buyers
2. **Listing Management** — No edit/pause/delete from MySales
3. **Instant Transfer Fulfillment** — Custody verification has no admin fulfillment workflow
4. **Venue Partner System** — No venue onboarding, dashboard, or payout
5. **Real Geofencing** — Upgrade location checks use browser geolocation but no real geofencing enforcement
6. **Seller Verification Badges** — Count/rate display not surfaced on listings
7. **Per-event Waitlist/Notification Subscription** — No event-level notification opt-in

## Launch Blockers

1. **Stripe Webhook Registration**: Must confirm the Stripe webhook URL is registered in Stripe dashboard pointing to the production function endpoint. Without this, disputes, refunds, and payment failures won't be processed automatically.
2. **Domain Consistency**: Must standardize on a single email domain and app URL. Currently mixing `.store`, `.com`, and `app.peanutgallery.app`.
3. **Admin Email Address**: `experience@peanutgallery.store` is hardcoded in multiple backend functions as the admin notification recipient. Must verify this inbox exists and is monitored.
4. **OneSignal Configuration**: App ID `8c9896d6-d4d6-4cdf-a094-3ba25bdd4585` is hardcoded. Must verify this is a production OneSignal app (not a test app).
5. **Stripe Live Mode Verification**: Must confirm `STRIPELIVESECRETKEY` and `STRIPELIVEPUBLISHABLEKEY` are set to live keys (not test keys) in production secrets.
6. **Terms of Service & Privacy Policy**: Pages exist but must be legally reviewed before accepting real payments.
7. **Digital Ticket Gap**: Buyers have no way to view tickets in-app. This is a major UX gap for a ticket marketplace.

## Recommended Founder Priorities (Ranked)

1. **Verify Stripe webhook registration** — Without this, disputes and failures go unhandled
2. **Standardize email domain and verify inbox** — Admin notifications must reach a real inbox
3. **Build in-app ticket display** — Buyers need to see their purchases
4. **Add listing management** — Sellers need edit/pause/delete
5. **Test end-to-end purchase flow with real Stripe** — Verify live payment capture works
6. **Review and test admin escalation workflows** — Buyer-inactive-24h cases require manual intervention
7. **Clean up dead code** — Remove deprecated pages, unused entities, demo leftovers

---

# SECTION 2: COMPLETE FEATURE INVENTORY

---

## Feature 1: Event Discovery & Browsing

### Purpose
Users browse upcoming events from both the local database (PG-created events) and the Ticketmaster Discovery API. Events are filtered by location (geolocation or city search) and keyword search.

### User Types
- All users (authenticated and unauthenticated)

### Current Status
**Complete** — Core browsing works; TM API integration is functional.

### Frontend Components
- `pages/Events` — Main event list page with location detection, city autocomplete, keyword search, pull-to-refresh
- `components/LocationAutocomplete` — City search with TM venue API fallback
- `components/events/EventThumbnail` — Event card rendering
- `components/events/EventsEmptyState` — Empty state
- `hooks/useLocationDetect` — Geolocation hook
- `hooks/usePullToRefresh` — Pull-to-refresh hook
- `pages/Landing` — Public landing page for unauthenticated users

### Backend Components
- `functions/getTicketmasterEvents` — Fetches events from TM Discovery API by keyword, latlong, or city
- `functions/syncTMEvent` — Upserts TM events into local Event entity (dedupes by tm_id)
- `functions/suggestCities` — City autocomplete (local list + TM venue API)
- `functions/tmSuggest` — Attraction/venue search for bucket list and event creation
- `lib/tmCache` — Frontend TM event caching layer

### Database Dependencies
- **Event** entity — Stores local + synced TM events
- TM API responses are merged with local events, deduped by `tm_id`

### External Dependencies
- **Ticketmaster Discovery API** — `Ticketmaster_consumer_key` secret required
- **Browser Geolocation API** — For "near me" functionality

### Founder Responsibilities
- Ensure TM API key is valid and not rate-limited
- Monitor TM API quota (Ticketmaster enforces rate limits)
- Periodically verify events are syncing correctly

### Launch Requirements
- TM API key must be set and valid
- Geolocation must work on mobile browsers

### Failure Points
- TM API rate limiting (429 errors) — handled with rate-limit UI messaging
- TM API key expiry — events page would show only local events
- Geolocation denial — falls back to city search

---

## Feature 2: Event Detail & Ticket Listings

### Purpose
Shows full event details with available ticket listings from sellers. Provides a link to the Live Hub (upgrades) for each event.

### User Types
- All users

### Current Status
**Complete** — Listing display, purchase dialog, and transfer status badges all work.

### Frontend Components
- `pages/EventDetail` — Event hero, listings list, purchase dialog trigger, live hub CTA
- `pages/EventDetailTM` — TM-specific event detail (redirects to Ticketmaster for purchase)
- `components/events/ListingCard` — Individual listing card with pricing, badges, buyer protection
- `components/events/PurchaseDialog` — Full checkout modal with Stripe Elements
- `components/listings/TransferStatusBadge` — Transfer verification status display
- `components/listings/TransferAcknowledgment` — Low-confidence listing acknowledgment
- `components/listings/CommunityTransferReport` — Community report transfer status
- `components/events/TransferWindowBadge` — Event-level transfer window status
- `components/events/ValuePropCard` — Buyer protection messaging
- `components/debug/EventLookupDebugPanel` — Admin-only diagnostic panel

### Backend Components
- No dedicated backend function — uses direct entity SDK calls from frontend
- `lib/eventUrl` — Event URL resolution helper
- `lib/navLogger` — Navigation event logging
- `lib/transferConfidence` — Transfer confidence scoring
- `lib/transferWindow` — Transfer window status logic
- `lib/eventTiming` — Event live status calculation

### Database Dependencies
- **Event** — Event details, transfer window status
- **Listing** — Ticket listings for the event
- **EventNavigationLog** — Admin-only navigation diagnostics

### External Dependencies
- None (browsing is local DB only)

### Founder Responsibilities
- Monitor for "Event not found" errors (check EventNavigationLog entity)
- Ensure TM event sync is working (events should persist after TM stops returning them)

### Launch Requirements
- Event data must be populated (either via TM sync or manual creation)
- Listing filter must only show `status: 'active'` and `proof_status: 'approved'`

### Failure Points
- Duplicate event records (dedup logic exists but edge cases remain)
- TM events not synced to local DB before TM removes them
- Listings with stale verification (60-min expiration hides them automatically)

---

## Feature 3: Ticket Purchase & Escrow Payment

### Purpose
Buyer selects a listing, enters payment info, and authorizes payment. Payment is held in escrow (manual capture) until both parties confirm transfer.

### User Types
- Authenticated users only
- Self-purchase blocked (buyer email ≠ seller email)

### Current Status
**Complete** — Full Stripe Connect escrow flow with reservation locking, race condition prevention, and fraud checks.

### Frontend Components
- `components/events/PurchaseDialog` — Checkout modal with Stripe Elements, fee breakdown, trust messaging
- `pages/PurchaseSuccess` — Post-purchase transaction tracking page
- `components/purchase/TransferAssistant` — Seller transfer workflow
- `components/purchase/AIVerificationStatus` — AI proof verification display
- `components/purchase/DisputeModal` — Dispute initiation
- `lib/feeEngine` — Fee calculation (5% buyer, $1 min)
- `lib/optimisticUI` — Optimistic UI updates for confirmations

### Backend Components
- `functions/createPaymentIntent` — Creates Stripe PI with reservation token, seller validation, fee calculation
- `functions/capturePayment` — Captures payment when both parties confirm, awards points, sends notifications
- `functions/cancelPurchase` — Cancels PI and restores listing
- `functions/stripeWebhook` — Handles Stripe webhooks (disputes, refunds, failures, successes)

### Database Dependencies
- **Listing** — Reservation token, status changes (active → pending_transfer → sold)
- **Purchase** — Full transaction record with payment_intent_id, confirmation flags, AI verification data
- **User** — Seller's stripe_account_id, stripe_onboarding_complete
- **Notification** — Sale-created notification to seller
- **PointsActivity** — Purchase/sale points
- **TransferOutcome** — Transfer result record
- **BetaTransferLog** — Audit trail
- **SeatInventory** — Inventory status sync

### External Dependencies
- **Stripe Connect** — Payment Intents with manual capture, Express accounts for sellers
- **Stripe Webhooks** — Dispute, refund, failure, success events

### Founder Responsibilities
- Verify Stripe webhook URL is registered in Stripe dashboard
- Monitor `payment_capture_failed` purchases in admin panel
- Handle `auto_review_flagged` purchases (buyer inactive 24h after seller confirms)
- Monitor stale PaymentIntents (>6 days old, expiring in <24h)
- Ensure Stripe live keys are set (not test keys)

### Launch Requirements
- `STRIPELIVESECRETKEY` and `STRIPELIVEPUBLISHABLEKEY` must be live keys
- `STRIPE_WEBHOOK_SECRET` must match the webhook signing secret from Stripe dashboard
- Stripe webhook endpoint must be registered: `https://[app-domain]/api/functions/stripeWebhook`
- Seller onboarding must work end-to-end (Stripe Express account creation)

### Failure Points
- Stripe webhook not registered → disputes/refunds not processed automatically
- Stripe keys in test mode → real cards rejected
- Seller Stripe account invalid/stale → purchase blocked with "Seller has not completed payout onboarding"
- Reservation token race condition (mitigated but theoretically possible)
- PaymentIntent expires after 7 days if neither party acts (admin gets warning at 6 days)

---

## Feature 4: Ticket Listing Creation

### Purpose
Sellers create listings for their tickets. Listings require transfer attestation, price, and optionally proof screenshots.

### User Types
- Authenticated users with completed Stripe onboarding (admins bypass)
- Non-onboarded users can save as draft (`pending_payout_setup`)

### Current Status
**Complete** — Standard and Instant listing modes both supported, with suspicious listing auto-flagging.

### Frontend Components
- `pages/Sell` — Seller dashboard with Stripe onboarding gate, nearby events, listing summary
- `pages/CreateListing` — 3-step wizard: Event → Seats → Price & Proof
- `components/Onboarding` — First-time user onboarding overlay
- `components/events/SellerTransferAttestation` — Transfer capability attestation with screenshot upload
- `components/NotificationPermissionPrompt` — Post-listing push notification prompt

### Backend Components
- `functions/submitListing` — Creates listing with fraud checks, SeatInventory sync, TransferVerificationLog
- `functions/onboardSeller` — Creates Stripe Express account and onboarding link
- `functions/checkSellerOnboarding` — Verifies Stripe account charges_enabled status
- `functions/diagnoseSeller` — Admin diagnostic for seller Stripe state

### Database Dependencies
- **Listing** — The listing itself
- **SeatInventory** — Created/updated when listing is created
- **TransferVerificationLog** — Records verification timestamp and method
- **User** — `stripe_onboarding_complete` flag gates listing
- **Event** — Event must not be ended

### External Dependencies
- **Stripe Connect** — Express account onboarding for payouts
- **Ticketmaster API** — Event search for listing creation

### Founder Responsibilities
- Monitor flagged listings in admin Review Queue
- Approve/reject pending review listings
- Verify Instant Transfer custody proof (manual process, no automated workflow)

### Launch Requirements
- Stripe Connect must be configured for Express accounts
- Minimum listing price ($10) enforced
- Transfer attestation required before listing

### Failure Points
- Seller Stripe onboarding incomplete → listing saved as draft, not visible to buyers
- Duplicate proof image detection may flag legitimate sellers
- Suspicious seller flags (strikes, disputes, high listing count, high price) may require manual review
- Instant listing custody verification has no admin workflow (manual email-based process)

---

## Feature 5: Transfer Confirmation Lifecycle

### Purpose
After purchase, seller confirms they sent tickets, buyer confirms receipt, then payment is captured.

### User Types
- Buyer (confirms receipt)
- Seller (confirms transfer sent, requires proof)
- Admin (can force-capture or override)

### Current Status
**Complete** — Full lifecycle with reminders, auto-expiry, admin review flagging, and AI proof verification.

### Frontend Components
- `pages/PurchaseSuccess` — Transaction timeline, role-specific panels, dispute modal
- `components/purchase/TransferAssistant` — Seller upload proof and confirm
- `components/purchase/AIVerificationStatus` — AI analysis results display
- `components/purchase/DisputeModal` — Buyer dispute initiation

### Backend Components
- `functions/capturePayment` — Server-side confirmation with proof validation, atomic capture guard
- `functions/verifyTransferProof` — AI vision LLM analysis (Claude Sonnet) with confidence scoring
- `functions/processTransferReminders` — Scheduled: seller reminders (5min, 15min), buyer reminders (5min, 15min), 48h expiry, 24h admin review flagging, 6-day stale PI warning
- `functions/processTransferAlerts` — Scheduled: expired verification, low confidence, stalled transfers, disputes, conflicting community reports
- `functions/recordTransferOutcome` — Entity automation: records outcome, updates seller reliability
- `functions/adminOverrideAIVerification` — Admin override of AI decisions

### Database Dependencies
- **Purchase** — transfer_status, buyer_confirmed, seller_confirmed, seller_confirmed_at, ai_* fields, auto_review_flagged, false_claim_recorded
- **Listing** — status (pending_transfer → sold)
- **User** — transfer_success_count, transfer_fail_count, seller_transfer_reliability, transfer_false_claim_count
- **TransferOutcome** — Canonical transfer result record
- **BetaTransferLog** — Audit trail
- **AdminAlert** — Created for stalled transfers, disputes, expired verifications
- **Notification** — Reminders sent to buyers and sellers

### External Dependencies
- **Stripe** — Payment capture on completion
- **AI Vision LLM** (Claude Sonnet 4.6) — Transfer proof screenshot analysis (uses integration credits)
- **OneSignal** — Push notification delivery
- **Email** (Core.SendEmail) — Email notification delivery

### Founder Responsibilities
- Review `auto_review_flagged` purchases daily (buyer inactive 24h after seller confirms)
- Review AI-flagged suspicious proofs immediately (email alert sent to admin)
- Handle disputes manually (no auto-resolution)
- Capture or cancel stale PaymentIntents before 7-day Stripe expiry
- Verify Instant Transfer custody proof manually (no admin workflow exists)

### Launch Requirements
- All 4 scheduled automations must be active and running
- AI verification function must have integration credits available
- Admin email inbox (`experience@peanutgallery.store`) must be monitored

### Failure Points
- Seller never confirms → 48h auto-expire, listing restored, buyer notified
- Buyer never confirms → 24h admin review flag, no auto-capture
- AI verification fails → marked `failed_processing`, requires human review
- Stripe capture fails → `payment_capture_failed` flag set, admin notified, manual retry needed
- AI false positive → seller gets false claim strike (deduped per purchase)

---

## Feature 6: AI Transfer Proof Verification

### Purpose
When a seller uploads a transfer screenshot, an AI vision model analyzes it for authenticity, extracts text, and scores confidence.

### User Types
- Seller (triggers by uploading proof)
- Buyer (can view result)
- Admin (can override)

### Current Status
**Complete** — Vision LLM analysis with confidence scoring, fraud detection, and admin override.

### Frontend Components
- `components/purchase/AIVerificationStatus` — Display AI results
- `components/admin/cc/AIVerificationPanel` — Admin AI verification queue
- `components/admin/AIVerificationQueue` — Legacy admin queue

### Backend Components
- `functions/verifyTransferProof` — Calls Claude Sonnet 4.6 vision model with detailed analysis prompt
- `functions/adminOverrideAIVerification` — Admin override (approved/rejected/escalated/marked_fraudulent)

### Database Dependencies
- **Purchase** — ai_proof_status, ai_confidence_score, ai_review_notes, ai_detected_platform, ai_extracted_*, ai_flags, fraud_risk_score, admin_override_*
- **User** — transfer_false_claim_count (incremented on rejection)

### External Dependencies
- **Base44 Core.InvokeLLM** — Claude Sonnet 4.6 vision model (costs integration credits)
- Requires `file_urls` parameter for image analysis

### Founder Responsibilities
- Review AI-flagged suspicious proofs (email alerts sent to admin)
- Override AI decisions when wrong (approved/rejected/escalated/marked_fraudulent)
- Monitor integration credit usage (Claude Sonnet is a non-default, higher-cost model)

### Launch Requirements
- Integration credits must be available for AI calls
- AI prompt and scoring logic tested with real transfer screenshots

### Failure Points
- LLM API failure → marked `failed_processing`, requires human review
- Duplicate proof image detection (penalty: -35 points)
- Image editing detection → rejected_suspicious (score capped at 35)
- Blank/unrelated image → rejected_suspicious (score capped at 10)
- False positive → seller gets false claim strike (deduped per purchase via `false_claim_recorded`)

---

## Feature 7: Seat Upgrades (Live Hub)

### Purpose
During live events, attendees can purchase seat upgrades to better seats. Requires existing admission and optionally location verification.

### User Types
- Authenticated users with existing tickets
- Admin (can create demo upgrade listings)

### Current Status
**Partial** — Demo mode only. Real geofencing not implemented. Real payment not processed for demo upgrades. Instant Transfer custody has no fulfillment workflow.

### Frontend Components
- `pages/Upgrades` — Upgrades landing page (event selection)
- `pages/EventDetailUpgrade` — Live Hub for specific event with 3 tabs: Upgrades, Fan Gifts, Fan Karma
- `components/eventmode/LiveHubHero` — Event hero
- `components/eventmode/UpgradeFeed` — Upgrade listing feed
- `components/eventmode/FlashDropCenter` — Flash drop display
- `components/eventmode/FanKarmaCard` — Fan karma display
- `components/eventmode/LiveHubEmptyState` — Empty state
- `components/upgrades/UpgradeEligibilityGate` — Location/ticket eligibility checks
- `components/admin/cc/LiveUpgradeControlPanel` — Admin demo listing management

### Backend Components
- `functions/releaseDemoUpgrades` — Admin: create/pause/reset demo venue upgrade listings
- `functions/seedDemoListings` — Admin: seed demo events and listings

### Database Dependencies
- **Listing** — `listing_type: 'live_upgrade'` or `'venue_upgrade'`, `requires_existing_ticket`, `requires_location`, `location_requirement`, `upgrade_window_opens_at`, `upgrade_window_closes_at`, `upgrade_instructions`, `is_demo_listing`
- **Event** — `is_beta_live`, `upgrade_eligibility_status`
- **Purchase** — Upgrade purchases (demo mode creates $0 purchases)

### External Dependencies
- **Browser Geolocation API** — For location checks (simulated in demo mode)

### Founder Responsibilities
- Create demo upgrade listings for live events (via admin panel)
- Monitor demo upgrade engagement metrics
- Build real venue partner integration (does not exist)
- Implement real geofencing (currently simulated)

### Launch Requirements
- Real venue partner agreements (none exist)
- Real geofencing enforcement (not implemented)
- Real ticket transfer for upgrades (not implemented)
- Instant Transfer custody fulfillment workflow (not implemented)

### Failure Points
- Demo mode may confuse users into thinking real upgrades are happening
- No real payment processing for demo upgrades
- No real geofencing — users could "simulate" location from anywhere
- Instant listing custody has no admin verification workflow

---

## Feature 8: Flash Drops (Free Seat Giveaways)

### Purpose
Fans can donate seats as timed "Flash Drops" — other fans enter for a chance to win them for free. Winner is randomly selected with trust-score weighting.

### User Types
- Any authenticated user (can create or enter)
- Donor cannot enter own drop

### Current Status
**Complete** — Full lifecycle: create, enter, close_and_pick (race-safe), poll_result, confirm_delivery, activate_scheduled, track_loser_action, track_view.

### Frontend Components
- `components/eventmode/FlashDropCenter` — Flash drop display and entry
- `components/flashdrops/CreateFlashDropSheet` — Creation form
- `components/flashdrops/FlashDropCard` — Drop card
- `components/flashdrops/FlashDropCountdown` — Entry window countdown
- `components/flashdrops/FlashDropAlertBanner` — Alert banner
- `components/flashdrops/FlashDropExplainer` — Education

### Backend Components
- `functions/flashDrop` — Multi-action: create, enter, close_and_pick, poll_result, confirm_delivery, activate_scheduled, track_loser_action, track_view

### Database Dependencies
- **FlashDrop** — Drop records with trust score, entry count, winner
- **FlashDropEntry** — Individual entries
- **SeatInventory** — Linked to drops, status changes
- **Notification** — Winner notification

### External Dependencies
- None (fully self-contained)

### Founder Responsibilities
- Monitor for abuse (unverified ownership drops allowed in beta)
- Verify winner delivery confirmation
- Consider enabling `ALLOW_UNVERIFIED_BETA = false` for production

### Launch Requirements
- Set `ALLOW_UNVERIFIED_BETA = false` to require ownership verification for production
- Flash drop entry window (60s default, 30-90s range)

### Failure Points
- Unverified ownership (beta flag allows it) — donors could drop seats they don't own
- Winner doesn't confirm delivery — seat stays in `claimed_by_winner` state
- Race condition in winner selection (mitigated with lock + re-fetch)

---

## Feature 9: Seat Donations (Weighted Lottery)

### Purpose
Fans can donate old seats to a pool. Attending fans opt in, and a weighted draw selects a winner based on Peanut Points, trust score, and activity.

### User Types
- Donor (must have ticket for event)
- Recipient (must have active ticket and be opted in)
- Admin (can run draws manually)

### Current Status
**Complete** — Full lifecycle: opt_in, create_donation, run_draw, respond (accept/decline with reroll).

### Frontend Components
- `components/donations/DonateSeatSheet` — Donation creation
- `components/donations/DonationOptInBanner` — Opt-in prompt
- `components/donations/DonationWinNotification` — Winner notification popup
- `components/donations/CommunityImpactCard` — Community impact display
- `components/admin/cc/DonationOpsPanel` — Admin donation management

### Backend Components
- `functions/seatDonation` — Multi-action: opt_in, create_donation, run_draw, respond
- `functions/cleanupStaleDonations` — Scheduled (every 10 min): rerolls/expired stale drawn donations

### Database Dependencies
- **SeatDonation** — Donation records with draw state
- **DonationOptIn** — Fan opt-in records with draw weight
- **User** — Peanut Points, trust score, confirmed_fraud_count (excluded)
- **PointsActivity** — Donation points (seat_donation_created: +150, donation_accepted: +75, donation_received: +10)
- **Notification** — Winner notification

### External Dependencies
- **Browser Geolocation API** — For location verification (optional, fraud-checked)
- **Email/Push** — Winner notification

### Founder Responsibilities
- Monitor for geo-spoofing (suspicious precision flags)
- Handle stale drawn donations (automated, but check logs)
- Verify donation delivery (no automated delivery confirmation beyond donor/winner mutual confirm)

### Launch Requirements
- Set `ALLOW_UNVERIFIED_BETA` appropriately for Flash Drops (separate from donations)
- Donation opt-in requires active purchase for event

### Failure Points
- No eligible opt-ins → donation expires
- Winner doesn't respond → reroll (up to 3 times) or expire
- Geo-spoofing (mitigated with precision checks, but not foolproof)
- Donor cannot win own donation (enforced)

---

## Feature 10: Peanut Points & Gamification

### Purpose
Loyalty point system rewarding marketplace activity, community engagement, and reliability. Includes ranks, achievements, trust scores, and badges.

### User Types
- All authenticated users
- Admin (can award penalty points)

### Current Status
**Complete** — Full points economy with anti-abuse protections, duplicate guards, daily caps, ownership validation, and trust score calculation.

### Frontend Components
- `components/points/PeanutPointsCard` — Points and rank display
- `components/points/RecentPointsActivity` — Activity feed
- `pages/Leaderboard` — Community leaderboard
- `pages/Me` — Profile with points/rank/badges

### Backend Components
- `functions/awardPoints` — Full points engine with anti-abuse: duplicate guard, daily caps, ownership validation, self-purchase blocking, referral disabling

### Database Dependencies
- **User** — peanut_points, lifetime_points, peanut_level, peanut_rank, trust_score, trust_badges, achievements, seller_streak, total_purchases, total_sales, total_instant_listings, total_live_upgrades, total_fast_transfers, total_disputes, total_failed_transfers, total_cancelled_sales, confirmed_fraud_count, total_donations_made, false_dispute_count, is_founding_fan, points_last_updated
- **PointsActivity** — Point transaction log

### External Dependencies
- None (fully self-contained)

### Founder Responsibilities
- Monitor for point farming attempts (self-purchase blocking, duplicate guards, daily caps exist)
- Award penalty points for confirmed fraud, disputes, abusive behavior (admin-only actions)
- Referral system is disabled — do not enable until referral flow is built

### Launch Requirements
- Points system is active and ready
- Referral system must remain disabled

### Failure Points
- Point farming via alt accounts (mitigated: self-purchase blocked, ownership validation)
- Duplicate point awards (mitigated: duplicate guard by action+reference_id)
- Daily cap overflow (mitigated: capped per action type)
- Referral farming (mitigated: referrals disabled)

---

## Feature 11: Fan Zone (Social)

### Purpose
Social feed where fans can post about events, share seat upgrade photos ("seat flex"), follow other fans, and maintain a bucket list of artists/teams.

### User Types
- All authenticated users

### Current Status
**Complete** — Posts, seat flex, reactions, follows, bucket list all functional.

### Frontend Components
- `pages/FanZone` — Social feed
- `components/fanzone/BucketListSheet` — Bucket list management
- `components/fanzone/BucketListSearch` — Artist/venue search
- `components/fanzone/TMSearchAutocomplete` — TM search for bucket list
- `components/fanzone/SeatFlexSheet` — Seat upgrade photo posting

### Backend Components
- Uses direct entity SDK calls (no dedicated backend function)
- `functions/tmSuggest` — Artist/venue search for bucket list

### Database Dependencies
- **FanPost** — Social posts (text, photos, seat flex with before/after)
- **Follow** — User follow relationships
- **BucketListItem** — User's followed artists/venues

### External Dependencies
- **Ticketmaster API** — For bucket list artist/venue search

### Founder Responsibilities
- Monitor for inappropriate content (no moderation tools exist)
- No content moderation workflow — posts are not reviewed before publishing

### Launch Requirements
- Content moderation policy must be established
- Consider adding report/flag functionality for posts

### Failure Points
- No content moderation — inappropriate posts could be published
- No profanity filter
- No reporting mechanism for abusive content

---

## Feature 12: Stripe Connect Seller Onboarding

### Purpose
Sellers connect a Stripe Express account to receive payouts. Required before listing tickets publicly.

### User Types
- All authenticated users (sellers)
- Admins bypass onboarding

### Current Status
**Complete** — Full Express account creation, onboarding link generation, charges_enabled verification, stale account cleanup.

### Frontend Components
- `pages/Sell` — Onboarding gate, onboarding CTA
- `pages/CreateListing` — Draft saving for non-onboarded users
- `components/account/StripePayoutSection` — Account settings Stripe management
- `pages/SellerPayoutGuide` — Educational page
- `pages/InstantListingsGuide` — Instant listing education

### Backend Components
- `functions/onboardSeller` — Creates/reuses Stripe Express account, generates onboarding link
- `functions/checkSellerOnboarding` — Verifies charges_enabled, clears stale accounts
- `functions/diagnoseSeller` — Admin diagnostic for seller Stripe state
- `functions/getStripeKey` — Returns publishable key for Stripe.js
- `functions/getStripeMode` — Admin: verifies key mode consistency

### Database Dependencies
- **User** — stripe_account_id, stripe_onboarding_complete
- **Listing** — `pending_payout_setup` status for drafts

### External Dependencies
- **Stripe Connect** — Express account creation, onboarding links, account retrieval

### Founder Responsibilities
- Verify Stripe Connect is in production mode (not test)
- Monitor for sellers with stale/invalid Stripe accounts (auto-cleared but check logs)
- Handle sellers who start but don't complete onboarding (drafts exist)

### Launch Requirements
- `STRIPELIVESECRETKEY` must be a live key
- Stripe Connect Express accounts must be enabled in Stripe dashboard
- Onboarding redirect URLs must be correct (`/sell?onboarding=complete` and `/sell?onboarding=refresh`)

### Failure Points
- Stale test-mode Stripe account (auto-cleared on checkSellerOnboarding)
- Seller doesn't complete onboarding → listing saved as draft
- Stripe account invalid in live mode (auto-cleared, but listing blocked)

---

## Feature 13: Admin Command Center

### Purpose
Centralized admin dashboard with 13 sections for monitoring marketplace health, managing operations, and overseeing financial workflows.

### User Types
- Admin only (role check enforced, redirects non-admins to /events)

### Current Status
**Complete** — All 13 sections are functional.

### Frontend Components
- `pages/AdminCommandCenter` — Main dashboard with 13 sections
- `components/admin/cc/CommandSummaryBar` — Top-level metrics
- `components/admin/cc/IssueFeed` — Live issues
- `components/admin/cc/MarketplaceHealth` — Market health metrics
- `components/admin/cc/StripePanel` — Stripe/payments panel
- `components/admin/cc/InstantOpsPanel` — Instant listing operations
- `components/admin/cc/AIVerificationPanel` — AI verification queue
- `components/admin/cc/DonationOpsPanel` — Donation operations
- `components/admin/cc/AdminAlertCenter` — Alert center
- `components/admin/cc/TransferIntelligencePanel` — Transfer intelligence
- `components/admin/cc/FlashDropMetricsPanel` — Flash drop metrics
- `components/admin/cc/LiveUpgradeControlPanel` — Live upgrade control
- `components/admin/PendingReviewQueue` — Listing review queue
- `components/admin/FeeSimulatorV2` — Fee simulator
- `components/admin/PricingStrategyAnalyzer` — Pricing strategy
- `components/admin/TransferWindowAdminPanel` — Transfer window management
- `pages/AdminMode` — Legacy admin page (still accessible at /admin-legacy)

### Backend Components
- `functions/approveListingReview` — Admin: approve pending listing
- `functions/rejectListingReview` — Admin: reject pending listing (requires reason)
- `functions/adminOverrideAIVerification` — Admin: override AI verification
- `functions/releaseDemoUpgrades` — Admin: manage demo upgrade listings
- `functions/seedDemoListings` — Admin: seed demo data
- `functions/getStripeMode` — Admin: Stripe mode diagnostic
- `functions/diagnoseSeller` — Admin: seller diagnostic

### Database Dependencies
- **All entities** — Admin has full read access via service role
- **AdminAlert** — Alert management
- **BetaTransferLog** — Audit trail
- **Listing** — Listing approval/rejection
- **Purchase** — AI override, payment capture

### External Dependencies
- **Stripe** — For payment diagnostics

### Founder Responsibilities
- Review pending listings in Review Queue
- Handle auto_review_flagged purchases (buyer inactive 24h)
- Override AI verification decisions when wrong
- Monitor admin alerts (disputes, stalled transfers, expired verifications)
- Capture or cancel stale PaymentIntents before 7-day expiry
- Manage demo upgrade listings for live events

### Launch Requirements
- Admin user must have `role: 'admin'` set in User entity
- Admin email must be monitored for automated alerts

### Failure Points
- Non-admin access blocked (role check + redirect)
- No confirmation dialogs for destructive admin actions (known issue)
- Legacy admin page still accessible at /admin-legacy

---

## Feature 14: Notifications System

### Purpose
Multi-channel notification system: in-app, push (OneSignal), and email (Core.SendEmail) with user preference controls.

### User Types
- All authenticated users
- Admin (receives system alerts via email)

### Current Status
**Complete** — Full notification pipeline with preference controls and security model.

### Frontend Components
- `pages/Notifications` — Notification list with mark-as-read
- `components/NotificationPermissionPrompt` — Post-action push permission prompt
- `components/account/NotificationsSection` — Notification preference settings
- `components/donations/DonationWinNotification` — Donation win popup
- `lib/oneSignal.js` — OneSignal SDK wrapper

### Backend Components
- `functions/recordNotification` — Creates in-app notification + sends push + email
- `functions/sendUserNotification` — OneSignal push + email fallback
- `functions/sendNotificationEmail` — Internal email utility

### Database Dependencies
- **Notification** — In-app notification records with type, title, body, read status, reference, action_url
- **User** — Notification preference fields (notif_listing_sold, notif_transfer_updates)

### External Dependencies
- **OneSignal** — Push notifications (App ID: `8c9896d6-d4d6-4cdf-a094-3ba25bdd4585`, `ONESIGNAL_REST_API_KEY` secret)
- **Core.SendEmail** — Email delivery (Base44 built-in integration)

### Founder Responsibilities
- Verify OneSignal app is production (not test)
- Verify `ONESIGNAL_REST_API_KEY` is valid
- Monitor email delivery (from_name: "Peanut Gallery")
- Admin alerts sent to `experience@peanutgallery.store` — must be monitored

### Launch Requirements
- OneSignal app configured with correct domain
- `ONESIGNAL_REST_API_KEY` secret set
- Email delivery verified (test email sent)

### Failure Points
- OneSignal API key invalid → push fails silently, email still sent
- User denies push permission → in-app notification still created, email still sent
- User disables notification preference → notification skipped entirely
- Email delivery failure → never blocks push or in-app (fire-and-forget)

---

## Feature 15: Account & Profile Management

### Purpose
Users manage their profile, persona, notification preferences, Stripe payout, verification status, transaction history, security, and account deletion.

### User Types
- All authenticated users

### Current Status
**Complete** — Full account settings with profile, persona, notifications, Stripe, verification, transactions, security, and deletion.

### Frontend Components
- `pages/Me` — Profile page with points, badges, trust score
- `pages/AccountSettingsPage` — Account settings hub
- `pages/EditPersona` — Persona editor
- `components/account/ProfileIdentitySection` — Profile identity
- `components/account/SessionSection` — Session management
- `components/account/NotificationsSection` — Notification preferences
- `components/account/SupportLegalSection` — Support and legal links
- `components/account/VerificationStatusSection` — Verification status
- `components/account/TransactionHistorySection` — Transaction history
- `components/account/StripePayoutSection` — Stripe payout management
- `components/account/SecuritySection` — Security settings
- `components/DeleteAccountModal` — Account deletion confirmation

### Backend Components
- Uses `base44.auth.updateMe()` for profile updates
- Uses `base44.auth.me()` for profile reads
- No dedicated backend function

### Database Dependencies
- **User** — All profile fields, preferences, Stripe fields

### External Dependencies
- **OneSignal** — For notification preference management

### Founder Responsibilities
- Handle account deletion requests (modal exists, verify deletion flow works)
- Monitor for users requesting data export

### Launch Requirements
- Terms of Service and Privacy Policy must be legally reviewed
- Account deletion must work end-to-end

### Failure Points
- Account deletion may leave orphaned data (listings, purchases, notifications)
- No data export functionality

---

## Feature 16: Beta Testing & QA Infrastructure

### Purpose
Beta tester management, QA checklists, bug reporting, and feedback collection for pre-launch testing.

### User Types
- Beta testers (invited users)
- Admin (manages testers, reviews feedback)

### Current Status
**Complete** — Full beta infrastructure with testers, feedback, checklists, bug tracker.

### Frontend Components
- `pages/BetaQA` — Beta QA page
- `pages/BetaDashboard` — Beta dashboard
- `pages/BetaRecruitment` — Beta tester recruitment
- `pages/FounderBetaChecklist` — Founder beta checklist
- `pages/FounderDashboard` — Founder dashboard
- `components/beta/BetaFeedbackForm` — Feedback form
- `components/beta/BugTracker` — Bug tracker
- `components/beta/LiveEventChecklist` — Live event checklist
- `components/beta/OperationalRiskChecklist` — Operational risk checklist
- `components/beta/QAChecklist` — QA checklist
- `components/beta/FeedbackWidget` — Floating feedback widget

### Backend Components
- No dedicated function — uses direct entity SDK calls

### Database Dependencies
- **BetaTester** — Tester registration and tracking
- **BetaFeedback** — Structured feedback
- **BetaFeedbackEvent** — Feedback events (bug, confused, love, idea)
- **QAChecklistItem** — QA checklist items
- **BugReport** — Bug reports
- **PointsActivity** — `beta_bug_report` and `critical_bug_report` point awards (admin-only)

### External Dependencies
- None

### Founder Responsibilities
- Invite beta testers
- Review feedback and bug reports
- Award bug report points (admin action)
- Track beta tester retention (day1_returned, day3_returned, day7_returned)

### Launch Requirements
- Beta infrastructure can remain active post-launch for ongoing feedback

### Failure Points
- No automated bug-to-admin-alert pipeline (manual review required)

---

## Feature 17: Education & Static Pages

### Purpose
Educational and legal pages for user onboarding and compliance.

### User Types
- All users

### Current Status
**Complete** — All pages exist and are functional.

### Frontend Components
- `pages/WhyPeanutGallery` — Value proposition
- `pages/InstantListingsGuide` — Instant listing education
- `pages/SellerPayoutGuide` — Seller payout education
- `pages/TermsOfService` — Terms of service
- `pages/PrivacyPolicy` — Privacy policy
- `components/education/FaqAccordion` — FAQ
- `components/WhatIsPGOverlay` — "What is PG?" overlay

### Backend Components
- None

### Database Dependencies
- None

### External Dependencies
- None

### Founder Responsibilities
- Legal review of Terms of Service and Privacy Policy
- Keep FAQ updated
- Verify all educational content is accurate

### Launch Requirements
- Terms of Service must be legally binding
- Privacy Policy must be GDPR/CCPA compliant

### Failure Points
- Outdated legal content
- Inaccurate fee or payout information

---

## Feature 18: Navigation & Event Lookup Diagnostics

### Purpose
Robust event lookup with multi-step fallback (direct ID → tm_ prefix strip → tm_id field) and admin-only diagnostic panel.

### User Types
- All users (lookup)
- Admin only (diagnostic panel)

### Current Status
**Complete** — Multi-step lookup with dedup, admin diagnostic panel gated behind role check.

### Frontend Components
- `components/debug/EventLookupDebugPanel` — Admin-only diagnostic (gated behind `user?.role === 'admin'`)
- `components/founder/EventNavHealthPanel` — Founder event navigation health

### Backend Components
- `lib/navLogger` — Navigation event logging
- `functions/syncTMEvent` — Event dedup on sync

### Database Dependencies
- **EventNavigationLog** — Admin-only navigation diagnostics

### External Dependencies
- None

### Founder Responsibilities
- Monitor EventNavigationLog for lookup failures
- Handle duplicate event records (dedup logic exists in syncTMEvent)

### Launch Requirements
- Diagnostic panel must remain admin-only (verified)

### Failure Points
- Duplicate events (mitigated by dedup in syncTMEvent and sort-by-updated_date)
- TM events not synced before TM removes them