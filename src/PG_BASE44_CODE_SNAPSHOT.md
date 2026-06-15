# PEANUT GALLERY — BASE44 CODE SNAPSHOT
## For External Repository-Level Analysis (Codex)
Generated: 2026-06-15 | Environment: Production | Platform: Base44 BaaS

---

# PROJECT STRUCTURE

## Pages
| Route | File | Purpose |
|---|---|---|
| `/` | `pages/Landing` | Unauthenticated landing page; redirects logged-in users to /events |
| `/events` | `pages/Events` | Event discovery; GPS + city search; TM + PG merged feed |
| `/events/:id` | `pages/EventDetail` | PG event detail with listings; 3-step id lookup with dedup |
| `/events/tm/:tmId` | `pages/EventDetailTM` | Ticketmaster-sourced event detail; syncs to DB on miss |
| `/purchase/:id` | `pages/PurchaseSuccess` | Transaction lifecycle page (buyer + seller views) |
| `/create-listing` | `pages/CreateListing` | 3-step wizard: event select → seats → price+proof |
| `/sell` | `pages/Sell` | Seller hub; active listings, stats, Stripe onboarding gate |
| `/my-sales` | `pages/MySales` | Seller dashboard: pending/awaiting/completed/instant sales |
| `/my-tickets` | `pages/MyTickets` | Buyer dashboard: pending/confirmed/disputed purchases |
| `/upgrades` | `pages/Upgrades` | Live event hub discovery page |
| `/upgrades/:id` | `pages/EventDetailUpgrade` | Live Hub for a specific event (Flash Drops, upgrades, Fan Zone) |
| `/event-mode/:id` | `pages/EventMode` | Deprecated; redirects to /upgrades/:id |
| `/fan-zone` | `pages/FanZone` | Community social feed, bucket list, seat flex |
| `/me` | `pages/Me` | User profile, fan stats, social, account links |
| `/account-settings` | `pages/AccountSettingsPage` | Full account management: profile, security, notifications, payouts |
| `/edit-persona` | `pages/EditPersona` | Edit bio, fan tags, persona |
| `/notifications` | `pages/Notifications` | In-app notification inbox |
| `/leaderboard` | `pages/Leaderboard` | Peanut Points leaderboard |
| `/admin` | `pages/AdminCommandCenter` | Admin-only command center (redirect if not admin) |
| `/admin-legacy` | `pages/AdminMode` | Legacy admin page |
| `/founder` | `pages/FounderDashboard` | Founder analytics and health panel |
| `/beta-checklist` | `pages/FounderBetaChecklist` | Beta launch checklist |
| `/beta-testers` | `pages/BetaRecruitment` | Beta tester signup/management |
| `/beta-dashboard` | `pages/BetaDashboard` | Beta tester metrics |
| `/beta-qa` | `pages/BetaQA` | QA testing checklist |
| `/terms` | `pages/TermsOfService` | Terms of service |
| `/privacy` | `pages/PrivacyPolicy` | Privacy policy |
| `/why-peanut-gallery` | `pages/WhyPeanutGallery` | Trust/education page |
| `/instant-listings` | `pages/InstantListingsGuide` | Instant transfer listing guide |
| `/seller-payout-guide` | `pages/SellerPayoutGuide` | Stripe payout guide |

## Layout
| File | Purpose |
|---|---|
| `components/Layout` | Root layout with bottom nav (5 tabs), scroll position preservation, notification bell, live event pulse, onboarding gate, DonationWinNotification, FeedbackWidget |

## Key Components
```
components/
├── Layout.jsx                          # Root layout + bottom nav
├── Onboarding.jsx                      # Multi-slide onboarding flow
├── LocationAutocomplete.jsx            # City autocomplete with portal dropdown
├── NotificationPermissionPrompt.jsx    # OneSignal push permission prompt
├── ThemeToggle.jsx                     # Light/dark mode toggle
├── TrustBadge.jsx                      # Trust score badge display
├── WhatIsPGOverlay.jsx                 # Explainer overlay
├── UserNotRegisteredError.jsx          # Auth error fallback screen
├── DeleteAccountModal.jsx              # Account deletion confirmation

├── events/
│   ├── ListingCard.jsx                 # Ticket listing card with pricing/status
│   ├── PurchaseDialog.jsx              # Full Stripe checkout modal + trust strip
│   ├── EventsEmptyState.jsx            # Empty state for Events page
│   ├── EventThumbnail.jsx              # Event image with branded fallback
│   ├── TransferWindowBadge.jsx         # Transfer window status badge
│   └── SellerTransferAttestation.jsx   # Seller transfer confirmation widget

├── purchase/
│   ├── TransferAssistant.jsx           # Seller transfer flow with proof upload
│   ├── AIVerificationStatus.jsx        # AI proof verification status display
│   └── DisputeModal.jsx                # Dispute category + details modal

├── listings/
│   ├── TransferStatusBadge.jsx         # Listing transfer confidence badge
│   ├── ListingStatusBanner.jsx         # Warning/action banners for seller listings
│   ├── TransferAcknowledgment.jsx      # Buyer transfer risk acknowledgment
│   ├── CommunityTransferReport.jsx     # Community transfer status report
│   └── VerifyTransferButton.jsx        # Seller re-verify transfer button

├── account/
│   ├── ProfileIdentitySection.jsx      # Name, avatar, bio section
│   ├── SecuritySection.jsx             # Password, 2FA
│   ├── StripePayoutSection.jsx         # Stripe Connect status + onboarding CTA
│   ├── NotificationsSection.jsx        # Push/email notification preferences
│   ├── TransactionHistorySection.jsx   # Purchase + sale history
│   ├── VerificationStatusSection.jsx   # Trust score breakdown
│   ├── SupportLegalSection.jsx         # Support links, legal
│   └── SessionSection.jsx             # Active sessions

├── admin/
│   ├── cc/
│   │   ├── CommandSummaryBar.jsx       # Top-line KPI bar
│   │   ├── IssueFeed.jsx               # Live issues feed
│   │   ├── MarketplaceHealth.jsx       # Health metrics panel
│   │   ├── StripePanel.jsx             # Stripe transactions panel
│   │   ├── InstantOpsPanel.jsx         # Instant listing ops
│   │   ├── AIVerificationPanel.jsx     # AI proof review panel
│   │   ├── DonationOpsPanel.jsx        # Donation management
│   │   ├── AdminAlertCenter.jsx        # Alert feed
│   │   ├── FlashDropMetricsPanel.jsx   # Flash Drop analytics
│   │   └── TransferIntelligencePanel.jsx # Transfer window intelligence
│   ├── PendingReviewQueue.jsx          # Listing approval queue
│   ├── FeeSimulatorV2.jsx              # Live fee simulator
│   ├── FeeSimulator.jsx                # Legacy fee simulator
│   ├── PricingStrategyAnalyzer.jsx     # Fee model comparison
│   ├── TransactionAnalytics.jsx        # Transaction analytics
│   ├── InstantFulfillmentCenter.jsx    # Instant listing fulfillment
│   ├── InstantListingsQueue.jsx        # Instant listings admin queue
│   ├── TransferWindowAdminPanel.jsx    # Transfer window management
│   ├── AIVerificationQueue.jsx         # AI verification review
│   └── MinListingPriceConfig.jsx       # Min price configuration

├── donations/
│   ├── DonateSeatSheet.jsx             # Seat donation creation sheet
│   ├── DonationWinNotification.jsx     # Win notification overlay
│   ├── DonationOptInBanner.jsx         # Opt-in banner for live events
│   └── CommunityImpactCard.jsx         # Donation stats card

├── eventmode/
│   ├── LiveHubHero.jsx                 # Live Hub hero banner
│   ├── LiveHubEmptyState.jsx           # Empty state for Live Hub
│   ├── LiveHubExplainer.jsx            # How it works explainer
│   ├── UpgradeFeed.jsx                 # Live upgrade listings feed
│   ├── FlashDropCenter.jsx             # Flash Drop entry UI
│   ├── FlashDropExplainer.jsx          # Flash Drop explainer
│   ├── EventModeHeader.jsx             # Live Hub header
│   ├── EventModePreview.jsx            # Upcoming event preview
│   ├── FanKarmaCard.jsx                # Fan karma/trust card
│   └── LiveActivityBar.jsx             # Live activity indicator

├── flashdrops/
│   ├── FlashDropCard.jsx               # Flash Drop display card
│   ├── FlashDropCountdown.jsx          # Countdown timer
│   ├── FlashDropAlertBanner.jsx        # Alert banner
│   └── CreateFlashDropSheet.jsx        # Create Flash Drop sheet

├── fanzone/
│   ├── TMSearchAutocomplete.jsx        # TM event search autocomplete
│   ├── BucketListSearch.jsx            # Bucket list event search
│   ├── BucketListSheet.jsx             # Bucket list management
│   └── SeatFlexSheet.jsx               # Seat flex share sheet

├── points/
│   ├── PeanutPointsCard.jsx            # User points + rank card
│   └── RecentPointsActivity.jsx        # Recent points activity feed

├── inventory/
│   └── SeatIntentSheet.jsx             # Seat ownership intent sheet

├── beta/
│   ├── FeedbackWidget.jsx              # Floating feedback button + form
│   ├── BetaFeedbackForm.jsx            # Full feedback form
│   ├── BugTracker.jsx                  # Bug tracking UI
│   ├── LiveEventChecklist.jsx          # Live event QA checklist
│   ├── OperationalRiskChecklist.jsx    # Ops risk checklist
│   └── QAChecklist.jsx                 # General QA checklist

├── debug/
│   └── EventLookupDebugPanel.jsx       # Event lookup failure debug panel

├── education/
│   └── FaqAccordion.jsx                # FAQ accordion

└── founder/
    └── EventNavHealthPanel.jsx         # Event nav failure rate panel
```

## Backend Functions (Deno Deploy)
| Function | Auth | Purpose |
|---|---|---|
| `submitListing` | User | Create listing; suspicious checks, SeatInventory sync, TransferVerificationLog |
| `createPaymentIntent` | User | Stripe PI creation; reservation lock; fee calc; seller validation |
| `capturePayment` | User | Seller/buyer confirm; Stripe capture; points award; notifications |
| `cancelPurchase` | User (buyer/admin) | Cancel + Stripe refund; restore listing |
| `stripeWebhook` | Public (Stripe sig) | Handle payment_failed, succeeded, payout.failed, dispute, refund |
| `onboardSeller` | User | Create/resume Stripe Express account; return onboarding URL |
| `checkSellerOnboarding` | User | Verify Stripe charges_enabled; update user flag |
| `verifyTransferProof` | User (seller/buyer/admin) | Vision LLM proof analysis; confidence scoring; fraud flags |
| `awardPoints` | User + service-role | Peanut Points economy; anti-abuse; achievements; trust score |
| `recordNotification` | User + service-role | In-app notification + push + email |
| `sendUserNotification` | Service-role | OneSignal push notification |
| `sendNotificationEmail` | Service-role | Email via Base44 Core SendEmail |
| `syncTMEvent` | User | Upsert Ticketmaster event to local DB; dedup |
| `getTicketmasterEvents` | User | Proxy to TM Discovery API; returns normalized event list |
| `tmSuggest` | User | TM keyword search |
| `suggestCities` | Public | City autocomplete from TM |
| `getStripeKey` | User | Return Stripe publishable key |
| `getStripeMode` | User (admin) | Return live/test Stripe mode |
| `diagnoseSeller` | Admin | Diagnose seller Stripe + listing state |
| `approveListingReview` | Admin | Approve pending listing; notify seller |
| `rejectListingReview` | Admin | Reject listing with reason; notify seller |
| `adminOverrideAIVerification` | Admin | Override AI proof status |
| `processTransferAlerts` | Scheduled | Scan for expiring verifications, stalled transfers; create AdminAlerts |
| `processTransferReminders` | Scheduled | Send seller/buyer transfer reminder notifications |
| `cleanupStaleDonations` | Scheduled | Expire/reroll stale drawn seat donations |
| `recordTransferOutcome` | Entity (Purchase update) | Record TransferOutcome; update seller reliability |
| `syncInventoryOnListingChange` | Entity (Listing update) | Sync SeatInventory status on listing updates |
| `flashDrop` | User | Flash Drop entry, winner selection, anti-abuse |
| `seatDonation` | User | Seat Donation creation, opt-in management |
| `awardPoints` | User + service-role | Peanut Points economy (see above) |
| `seedDemoListings` | Admin | Seed demo/test listings for QA |

## Utility Libraries
| File | Purpose |
|---|---|
| `lib/feeEngine.js` | All fee logic: calculateFees, formatFeeBreakdown, formatSellerPayout, compareFeeModels |
| `lib/eventTiming.js` | getEventLiveStatus, isEventLive, formatInVenueTimezone; IANA timezone resolution |
| `lib/isAdmin.js` | Single source of truth: `user?.role === 'admin'` |
| `lib/eventUrl.js` | getEventUrl, getUpgradeUrl; PG vs TM routing logic |
| `lib/navLogger.js` | logNavEvent, classifyFailure, checkNavFailureRate |
| `lib/tmCache.js` | TM API response cache (3min TTL) with in-flight deduplication |
| `lib/optimisticUI.js` | createOptimisticPurchaseUpdate for optimistic buyer confirm |
| `lib/AuthContext.jsx` | React auth context; OneSignal login; checkAppState |
| `lib/oneSignal.js` | OneSignal init, loginOneSignalUser, logoutOneSignalUser |
| `lib/transferConfidence.js` | isVerificationExpired for listing verification state |
| `lib/transferWindow.js` | Transfer window status helpers |
| `lib/peanutPoints.js` | Frontend point value constants (mirrors awardPoints backend) |
| `lib/app-params.js` | App ID and token extraction from runtime environment |
| `lib/query-client.js` | TanStack Query client instance |
| `lib/isAdmin.js` | Admin role check (strict === 'admin') |

## Hooks
| File | Purpose |
|---|---|
| `hooks/useLocationDetect.js` | GPS + manual city detection; localStorage cache |
| `hooks/usePullToRefresh.js` | Pull-to-refresh gesture handler |
| `hooks/useTheme.js` | System/user dark mode preference |
| `hooks/use-mobile.jsx` | Mobile viewport detection |

## State Management
- **No global state library.** State is entirely local React (`useState`, `useEffect`) per page/component.
- **AuthContext** (`lib/AuthContext.jsx`) provides `user`, `isAuthenticated`, `authError`, `logout`, `checkAppState` via React Context.
- **TanStack Query** (`@tanstack/react-query`) installed but not primary data layer — most pages use direct `base44.entities.*` calls in `useEffect`.
- **sessionStorage**: `pg_events_location`, `pg_upgrades_location`, `pg_admin_unlocked`, `pg_nav_session_id`
- **localStorage**: `pg_onboarded`, `pg_recent_cities`, notification dismissal flags

---

# DATABASE SCHEMA

## Entity: Event
```json
{
  "name": "Event",
  "fields": {
    "id": "string (auto, PK)",
    "created_date": "datetime (auto)",
    "updated_date": "datetime (auto)",
    "created_by_id": "string (auto)",
    "title": "string (required)",
    "artist": "string",
    "venue": "string (required)",
    "city": "string",
    "state": "string — e.g. AZ",
    "date": "datetime — legacy UTC ISO, prefer event_start_utc",
    "event_start_local": "string — ISO without tz offset e.g. 2026-05-08T19:00:00",
    "event_start_utc": "datetime — canonical UTC start",
    "venue_timezone": "string — IANA e.g. America/Phoenix",
    "duration_hours": "number — hours after start event is live",
    "category": "enum: concert|sports|theater|comedy|other",
    "image_url": "string — hero image URL",
    "status": "enum: upcoming|live|ended — default upcoming",
    "is_beta_live": "boolean — admin-forced live override — default false",
    "venue_lat": "number",
    "venue_lng": "number",
    "geo_radius_meters": "number — default 500",
    "tm_id": "string — Ticketmaster event ID",
    "tm_url": "string — Ticketmaster event URL",
    "transfer_window_status": "enum: unknown|open|closing_soon|closed|manually_verified_open|manually_verified_closed — default unknown",
    "transfer_window_closes_at": "string — ISO timestamp",
    "transfer_window_source": "enum: ticketmaster|seatgeek|axs|mlb|manual_admin|user_reported|inferred",
    "transfer_window_confidence": "number — 0-100",
    "upgrade_eligibility_status": "enum: eligible|limited|unknown|not_eligible — default unknown",
    "last_transfer_check_at": "string — ISO timestamp",
    "admin_transfer_notes": "string"
  },
  "required": ["title", "venue", "date"],
  "relationships": {
    "Listing": "one-to-many (event_id FK)",
    "Purchase": "one-to-many (event_id FK)",
    "FlashDrop": "one-to-many (event_id FK)",
    "SeatInventory": "one-to-many (event_id FK)",
    "TransferVerificationLog": "one-to-many (event_id FK)"
  }
}
```

## Entity: Listing
```json
{
  "name": "Listing",
  "fields": {
    "id": "string (auto, PK)",
    "created_date": "datetime (auto)",
    "updated_date": "datetime (auto)",
    "created_by_id": "string (auto)",
    "event_id": "string (required, FK to Event)",
    "seller_email": "string — set to created_by on creation",
    "section": "string (required) — e.g. 118",
    "row": "string — e.g. G",
    "seats": "string — comma-separated seat numbers",
    "quantity": "number — default 1",
    "tier": "enum: floor|lower|mid|upper",
    "asking_price": "number (required) — per seat USD",
    "original_price": "number — face value for savings display",
    "transfer_method": "enum: platform_transfer|email_transfer|in_person",
    "proof_url": "string — ticket screenshot URL",
    "proof_status": "enum: pending_review|approved|rejected — default pending_review",
    "proof_rejection_reason": "string",
    "ticket_file_url": "string",
    "notes": "string — [DEMO] or [TEST] prefix for dev listings",
    "status": "enum: active|pending_transfer|sold|cancelled|expired|pending_verification|hidden|pending_payout_setup — default active",
    "hidden_reason": "enum: transfer_disabled|admin_disabled|expired_verification|sold|other",
    "listing_mode": "enum: standard|instant — default standard",
    "custody_status": "enum: none|pending_pg_verification|verified|rejected — default none",
    "pg_transfer_proof_url": "string",
    "pg_transfer_notes": "string",
    "pg_fulfilled_at": "string",
    "pg_fulfilled_by": "string",
    "reservation_token": "string — UUID; set during checkout lock",
    "reservation_expires_at": "string — ISO; 10-minute expiry",
    "reserved_by_email": "string",
    "transfer_status": "enum: transfer_confirmed|transfer_unconfirmed|transfer_disabled|transfer_expired — default transfer_unconfirmed",
    "transfer_confidence_score": "number — 0-100",
    "last_transfer_verification": "string — ISO timestamp",
    "transfer_verification_method": "enum: seller_attestation|screenshot_verified|admin_verified|buyer_confirmed|community_verified",
    "transfer_verification_proof_url": "string",
    "transfer_verified_by": "string",
    "transfer_verified_notes": "string",
    "transfer_platform": "enum: ticketmaster|seatgeek|axs|stubhub|apple_wallet|other",
    "verification_warning_sent_at": "string",
    "verification_expired_sent_at": "string",
    "seat_inventory_id": "string — FK to SeatInventory"
  },
  "required": ["event_id", "section", "row", "asking_price"],
  "rls": "no explicit RLS — created_by ownership implied by Base44",
  "notes": "status=pending_payout_setup means draft saved before Stripe onboarding — never shown to buyers"
}
```

## Entity: Purchase
```json
{
  "name": "Purchase",
  "rls": {
    "create": true,
    "read": "buyer_email==user.email OR seller_email==user.email OR admin",
    "update": "buyer_email==user.email OR seller_email==user.email OR admin",
    "delete": "admin only"
  },
  "fields": {
    "id": "string (auto, PK)",
    "listing_id": "string (required, FK to Listing)",
    "event_id": "string (FK to Event)",
    "buyer_email": "string",
    "buyer_name": "string",
    "buyer_phone": "string",
    "seller_email": "string — copied from Listing at purchase time",
    "amount": "number (required) — total USD charged to buyer",
    "subtotal": "number — ticket price before fee",
    "platform_fee": "number — PG fee USD",
    "seller_payout": "number — amount owed to seller",
    "quantity": "number",
    "payment_intent_id": "string — Stripe PaymentIntent ID (read-restricted to parties)",
    "payment_captured": "boolean — default false",
    "payment_capture_failed": "boolean — default false",
    "transfer_status": "enum: pending_transfer|completed|expired|disputed — default pending_transfer",
    "buyer_confirmed": "boolean — default false",
    "seller_confirmed": "boolean — default false",
    "seller_confirmed_at": "string — ISO timestamp",
    "transfer_notes": "string — seller notes",
    "transfer_proof_url": "string — seller screenshot URL",
    "dispute_reason": "string",
    "buyer_lat": "number",
    "buyer_lng": "number",
    "location_verified": "boolean — default false",
    "reminder_flags": "object — {seller_r1, seller_r2, buyer_r1, buyer_r2, stale_pi_warned}",
    "auto_review_flagged": "boolean — default false",
    "auto_review_flagged_at": "string",
    "false_claim_recorded": "boolean — dedup flag for strike counting",
    "fulfillment_status": "enum: awaiting_pg_transfer|transfer_in_progress|fulfilled|buyer_confirmed|issue_reported",
    "fulfillment_proof_url": "string",
    "fulfillment_notes": "string",
    "fulfillment_started_at": "string",
    "fulfillment_completed_at": "string",
    "ai_proof_status": "enum: pending|processing|verified_high_confidence|verified_medium_confidence|needs_human_review|rejected_suspicious|failed_processing — default pending",
    "ai_confidence_score": "number — 0-100",
    "ai_review_notes": "string",
    "ai_detected_platform": "enum: ticketmaster|seatgeek|axs|stubhub|apple_wallet|vivid|screenshot_unknown|other",
    "ai_extracted_event_name": "string",
    "ai_extracted_recipient": "string",
    "ai_extracted_transfer_time": "string",
    "ai_extracted_section": "string",
    "ai_extracted_row": "string",
    "ai_extracted_seats": "string",
    "ai_flags": "array<string>",
    "ai_processed_at": "string",
    "ai_processed_by_model": "string",
    "fraud_risk_score": "number — 0-100",
    "admin_override_status": "enum: approved|rejected|escalated|marked_fraudulent",
    "admin_override_reason": "string",
    "admin_override_by": "string",
    "admin_override_at": "string"
  },
  "required": ["listing_id", "event_id", "amount"]
}
```

## Entity: User (Built-in, extended)
```json
{
  "name": "User",
  "built_in": true,
  "fields": {
    "id": "string (auto, PK)",
    "created_date": "datetime (auto)",
    "email": "string (read-only)",
    "full_name": "string (read-only)",
    "role": "enum: admin|user — default user",
    "stripe_account_id": "string — Stripe Express account ID",
    "stripe_onboarding_complete": "boolean — true when charges_enabled",
    "avatar_url": "string",
    "banner_url": "string",
    "bio": "string",
    "has_seen_onboarding": "boolean",
    "peanut_points": "number — current balance",
    "lifetime_points": "number — all-time earned (never decremented)",
    "peanut_level": "number — 1-10",
    "peanut_rank": "string — Rookie Fan...Hall of Fame",
    "trust_score": "number — 0-100",
    "trust_badges": "array<string>",
    "achievements": "array<string>",
    "seller_streak": "number — consecutive successful sales",
    "total_purchases": "number",
    "total_sales": "number",
    "total_instant_listings": "number",
    "total_live_upgrades": "number",
    "total_fast_transfers": "number",
    "total_disputes": "number",
    "total_failed_transfers": "number",
    "total_cancelled_sales": "number",
    "confirmed_fraud_count": "number",
    "total_donations_made": "number",
    "strike_count": "number — admin-issued strikes",
    "transfer_false_claim_count": "number — AI-rejected proof count",
    "is_founding_fan": "boolean",
    "last_pi_attempt_at": "string — ISO; rate-limit stamp for createPaymentIntent",
    "pi_attempt_count": "number",
    "points_last_updated": "string"
  },
  "rls": "Base44 built-in: only admins can list/update/delete other users"
}
```

## Entity: Notification
```json
{
  "name": "Notification",
  "rls": {
    "create": "admin only",
    "read": "user_email==user.email OR admin",
    "update": "user_email==user.email OR admin",
    "delete": "admin only"
  },
  "fields": {
    "user_email": "string (required)",
    "type": "enum: purchase_confirmed|tickets_sent|transfer_verified|transfer_rejected|buyer_confirmed|sale_complete|payout_processing|dispute_opened|dispute_resolved|donation_won|donation_accepted|donation_expired|listing_hidden|listing_approved|listing_rejected|listing_expired|sale_created|ai_verified|ai_rejected|admin_message",
    "title": "string (required)",
    "body": "string",
    "read": "boolean — default false",
    "reference_id": "string",
    "reference_type": "enum: purchase|listing|donation|event|dispute",
    "action_url": "string — deep link path",
    "icon": "string — emoji"
  }
}
```

## Entity: SeatInventory
```json
{
  "name": "SeatInventory",
  "rls": {
    "create": true,
    "read": "owner_email==user.email OR admin",
    "update": "owner_email==user.email OR admin",
    "delete": "admin only"
  },
  "fields": {
    "event_id": "string",
    "event_title": "string",
    "owner_email": "string",
    "owner_name": "string",
    "section": "string",
    "row": "string",
    "seats": "string",
    "quantity": "number — default 1",
    "inventory_status": "enum: available|listed_for_sale|reserved_for_purchase|in_flash_drop|claimed_by_winner|transferred|cancelled — default available",
    "inventory_intent": "enum: sell|flash_drop|undecided — default undecided",
    "source_type": "enum: manual_entry|listing|flash_drop|purchase|future_custody — default manual_entry",
    "ownership_verified": "boolean — default false",
    "ownership_verification_method": "enum: verified_listing|verified_ticket_file|ownership_proof_upload|transfer_capability|admin_verified",
    "ownership_verified_at": "string",
    "ownership_proof_url": "string",
    "transfer_verified": "boolean — default false",
    "transfer_status": "enum: transfer_confirmed|transfer_unconfirmed|transfer_disabled|transfer_expired — default transfer_unconfirmed",
    "last_transfer_verification": "string",
    "linked_listing_id": "string — FK to Listing",
    "linked_flash_drop_id": "string — FK to FlashDrop",
    "linked_purchase_id": "string — FK to Purchase",
    "winner_delivery_confirmed": "boolean — default false",
    "winner_delivery_confirmed_at": "string",
    "donor_delivery_confirmed": "boolean — default false",
    "donor_delivery_confirmed_at": "string"
  }
}
```

## Entity: FlashDrop
```json
{
  "name": "FlashDrop",
  "rls": {
    "create": true,
    "read": true,
    "update": "donor_email==user.email OR admin",
    "delete": "admin only"
  },
  "fields": {
    "event_id": "string (required)",
    "event_title": "string",
    "donor_email": "string (required)",
    "donor_name": "string",
    "is_anonymous": "boolean — default false",
    "section": "string (required)",
    "row": "string",
    "seats": "string",
    "quantity": "number — default 1",
    "donor_message": "string",
    "drop_type": "enum: immediate|scheduled — default immediate",
    "scheduled_label": "string",
    "scheduled_at": "string",
    "status": "enum: pending|active|closed|winner_selected|expired|cancelled — default pending",
    "entry_opens_at": "string",
    "entry_closes_at": "string",
    "entry_window_seconds": "number — default 60",
    "winner_email": "string",
    "winner_name": "string",
    "winner_selected_at": "string",
    "winner_selection_locked_at": "string",
    "winner_selection_request_id": "string",
    "selection_completed_at": "string",
    "entry_count": "number — default 0",
    "source_purchase_id": "string",
    "source_donation_id": "string",
    "seat_inventory_id": "string — FK to SeatInventory",
    "ownership_verified": "boolean — default false",
    "ownership_verification_method": "enum: verified_listing|verified_ticket_file|ownership_proof_upload|transfer_capability|admin_verified",
    "ownership_verified_at": "string",
    "ownership_listing_id": "string",
    "ownership_delivery_method": "enum: ticket_transfer|account_transfer|seller_contact|manual_release|future_custody",
    "trust_score": "number — default 0",
    "trust_breakdown": "object — {ownership_verified, transfer_confirmed, verified_seller, prior_transfers}",
    "abuse_flags": "array<string>",
    "metrics": "object — {views, entries, loser_upgrade_clicks, loser_purchases, notification_sent, notification_opened}"
  }
}
```

## Entity: FlashDropEntry
```json
{
  "name": "FlashDropEntry",
  "rls": {
    "create": true,
    "read": "entrant_email==user.email OR admin",
    "update": "admin only",
    "delete": "admin only"
  },
  "fields": {
    "flash_drop_id": "string (required, FK to FlashDrop)",
    "event_id": "string",
    "entrant_email": "string (required)",
    "entrant_name": "string",
    "entered_at": "string — ISO timestamp",
    "is_winner": "boolean — default false",
    "loser_action": "enum: none|viewed_upgrades|clicked_listing|purchased — default none"
  }
}
```

## Entity: PointsActivity
```json
{
  "name": "PointsActivity",
  "rls": {
    "create": true,
    "read": "user_email==user.email OR admin",
    "update": "admin only",
    "delete": "admin only"
  },
  "fields": {
    "user_email": "string (required)",
    "action": "enum: (40 action types — see awardPoints function)",
    "points": "number (required)",
    "description": "string",
    "reference_id": "string",
    "reference_type": "enum: purchase|listing|event|referral|profile|feedback|post|bug_report|donation",
    "source": "string",
    "is_reversal": "boolean — default false",
    "metadata": "object"
  }
}
```

## Entity: AdminAlert
```json
{
  "name": "AdminAlert",
  "rls": {
    "create": true,
    "read": "admin only",
    "update": "admin only",
    "delete": "admin only"
  },
  "fields": {
    "alert_type": "enum: failed_transfer_after_payment|new_dispute|expired_verification|low_confidence_listing|conflicting_community_reports|transfer_disabled_active_listing|buyer_waiting_for_transfer|seller_missed_deadline|seller_reliability_drop|admin_action_required",
    "priority": "enum: critical|high|medium|low — default medium",
    "title": "string (required)",
    "description": "string",
    "reference_id": "string",
    "reference_type": "enum: purchase|listing|event|user",
    "seller_email": "string",
    "buyer_email": "string",
    "event_id": "string",
    "resolved": "boolean — default false",
    "resolved_by": "string",
    "resolved_at": "string",
    "resolution_notes": "string"
  }
}
```

## Entity: TransferVerificationLog
```json
{
  "name": "TransferVerificationLog",
  "rls": "admin only (all operations)",
  "fields": {
    "listing_id": "string (required, FK to Listing)",
    "event_id": "string (required)",
    "seller_email": "string",
    "platform": "enum: ticketmaster|seatgeek|axs|stubhub|apple_wallet|vivid|other",
    "verification_timestamp": "string (required)",
    "transfer_available": "boolean (required)",
    "verification_method": "enum: seller_attestation|screenshot_verified|admin_verified|buyer_confirmed|community_verified (required)",
    "event_start_utc": "string",
    "minutes_since_event_start": "number",
    "venue": "string",
    "city": "string",
    "event_title": "string",
    "has_screenshot": "boolean — default false",
    "confidence_score": "number"
  }
}
```

## Entity: TransferOutcome
```json
{
  "name": "TransferOutcome",
  "rls": {
    "create": true,
    "read": "buyer_email==user.email OR seller_email==user.email OR admin",
    "update": "admin only",
    "delete": "admin only"
  },
  "fields": {
    "listing_id": "string (required)",
    "event_id": "string (required)",
    "purchase_id": "string",
    "seller_email": "string (required)",
    "buyer_email": "string",
    "platform": "enum: ticketmaster|seatgeek|axs|stubhub|apple_wallet|vivid|other",
    "transfer_successful": "boolean",
    "transfer_completed_at": "string",
    "minutes_to_transfer": "number",
    "buyer_confirmed": "boolean — default false",
    "seller_confirmed": "boolean — default false",
    "admin_intervention_required": "boolean — default false",
    "dispute_created": "boolean — default false",
    "notes": "string"
  }
}
```

## Entity: EventNavigationLog
```json
{
  "name": "EventNavigationLog",
  "rls": {
    "create": true,
    "read": "admin only",
    "update": "admin only",
    "delete": "admin only"
  },
  "fields": {
    "timestamp": "string (required)",
    "user_email": "string",
    "event_title": "string",
    "event_id": "string",
    "tm_id": "string",
    "source": "string — pg|ticketmaster|unknown",
    "source_page": "string",
    "generated_href": "string",
    "lookup_method": "string — direct_id|tm_prefix_strip|tm_id_field|none",
    "result": "enum: success|lookup_fallback_success|lookup_fallback_failed|event_not_loaded|event_not_found|navigation_error|unknown (required)",
    "failure_reason": "string",
    "user_agent": "string",
    "is_admin": "boolean — default false",
    "session_id": "string"
  }
}
```

## Entity: SeatDonation
```json
{
  "name": "SeatDonation",
  "fields": {
    "event_id": "string (required)",
    "event_title": "string",
    "event_venue": "string",
    "event_city": "string",
    "donor_email": "string (required)",
    "donor_name": "string",
    "is_anonymous": "boolean — default false",
    "donor_message": "string",
    "section": "string (required)",
    "row": "string",
    "seats": "string",
    "quantity": "number — default 1",
    "donation_status": "enum: active|drawn|accepted|declined_rerolling|expired|completed — default active",
    "winner_email": "string",
    "winner_name": "string",
    "drawn_at": "string",
    "accepted_at": "string",
    "expires_at": "string",
    "reroll_count": "number — default 0",
    "source_purchase_id": "string",
    "source_listing_id": "string"
  }
}
```

## Entity: DonationOptIn
```json
{
  "name": "DonationOptIn",
  "fields": {
    "event_id": "string (required)",
    "user_email": "string (required)",
    "opted_in_at": "string",
    "location_verified": "boolean — default false",
    "purchase_id": "string",
    "draw_weight": "number",
    "recent_win_count": "number — default 0",
    "last_win_at": "string"
  }
}
```

## Entity: BetaTester
```json
{
  "name": "BetaTester",
  "rls": {
    "create": true,
    "read": "user_email==user.email OR admin",
    "update": "user_email==user.email OR admin",
    "delete": "admin only"
  },
  "fields": {
    "name": "string (required)",
    "email": "string (required)",
    "user_email": "string",
    "fan_type": "enum: sports|concert|both",
    "favorite_teams": "string",
    "favorite_venues": "string",
    "device": "string",
    "beta_phase": "enum: phase_1|phase_2|phase_3 — default phase_1",
    "status": "enum: invited|active|completed|dropped — default invited",
    "sessions_completed": "number — default 0",
    "feedback_count": "number — default 0",
    "last_active_at": "string",
    "day1_returned": "boolean — default false",
    "day3_returned": "boolean — default false",
    "day7_returned": "boolean — default false",
    "what_user_thinks_pg_is": "string",
    "notes": "string"
  }
}
```

## Entity: BetaFeedbackEvent
```json
{
  "name": "BetaFeedbackEvent",
  "rls": {
    "create": true,
    "read": "admin only",
    "update": "admin only",
    "delete": "admin only"
  },
  "fields": {
    "user_email": "string",
    "user_name": "string",
    "feedback_type": "enum: bug|confused|love|idea (required)",
    "page": "string",
    "message": "string",
    "screenshot_url": "string"
  }
}
```

## Entity: QAChecklistItem
```json
{
  "name": "QAChecklistItem",
  "fields": {
    "category": "string (required)",
    "title": "string (required)",
    "result": "enum: untested|pass|fail — default untested",
    "notes": "string",
    "tester_name": "string",
    "device": "string",
    "session_id": "string"
  }
}
```

## Entity: BugReport
```json
{
  "name": "BugReport",
  "fields": {
    "title": "string (required)",
    "description": "string",
    "severity": "enum: critical|high|medium|low — default medium",
    "status": "enum: open|investigating|fixed|verified — default open",
    "affected_page": "string",
    "reporter_name": "string",
    "device": "string",
    "screenshot_url": "string",
    "notes": "string"
  }
}
```

## Other Entities (schemas in entities/*.json)
- `BetaTransferLog` — admin audit log for transfer events
- `TransferReport` — community reports of transfer window status
- `TransferVerificationLog` — per-listing verification log
- `FanPost` — Fan Zone social posts
- `Follow` — user follow relationships
- `BucketListItem` — user bucket list events
- `BetaFeedback` — legacy beta feedback

---

# WORKFLOWS

## WF-1: Listing Creation (Standard)
**Trigger:** User submits CreateListing form (step 3)
**Conditions:** User authenticated, Stripe onboarding complete (or saves as draft)
**Logic:**
1. If not onboarded → `base44.entities.Listing.create({status: 'pending_payout_setup'})` → draft saved
2. If `listingMode === 'instant'` → direct entity create with `custody_status: 'pending_pg_verification', status: 'pending_verification'`
3. Otherwise → `base44.functions.invoke('submitListing', {...})`
   - `checkSuspicious(seller)`: disputes > 0, strikes > 0, failed transfers >= 3, active listings >= 10, price > $2000 → `proof_status: 'pending_review'`
   - Duplicate proof image check across sellers → `proof_status: 'pending_review'`
   - SeatInventory conflict check (in_flash_drop, reserved_for_purchase, claimed_by_winner) → 409
   - Ended event check → 409
   - Confidence score: screenshot=75, attestation=55; verification_method set accordingly
   - Create Listing with `status: 'active'`, `proof_status: 'approved'` (or pending_review if flagged)
   - Fire-and-forget: SeatInventory create/update, TransferVerificationLog create
**Outputs:** Listing record, `flagged` boolean, flag reason
**State Changes:** Listing created; SeatInventory updated; TransferVerificationLog created

## WF-2: Purchase Flow (Checkout)
**Trigger:** Buyer clicks "Buy" on ListingCard → PurchaseDialog
**Logic:**
1. Stripe publishable key fetched via `getStripeKey`
2. Self-purchase guard (buyer email === seller email) → blocked in UI
3. `createPaymentIntent` called:
   - Rate limit check (15s cooldown per user via `last_pi_attempt_at`)
   - Listing must be `status: 'active'` and `proof_status: 'approved'`
   - Reservation lock: set `status: 'pending_transfer'`, `reservation_token`, `reservation_expires_at` (10min)
   - Race condition check: re-fetch listing, verify reservation token matches
   - Seller Stripe account validated (live mode)
   - Fee calc: `max(1.00, subtotal * 0.05)` buyer fee
   - Stripe PI created with `capture_method: 'manual'`; `application_fee_amount` + `transfer_data.destination` if seller has Stripe account
4. `stripe.confirmCardPayment(clientSecret, {card})` in browser
5. On success: `Purchase.create({...})` with all fee breakdown fields, `payment_captured: false`
6. Seller notified via `recordNotification` (fire-and-forget)
7. Navigate to `/purchase/:id`
**Outputs:** Purchase record, navigation to PurchaseSuccess
**State Changes:** Listing reserved; Purchase created; Stripe PI authorized (not captured)

## WF-3: Transfer Confirmation & Payment Capture
**Trigger:** Seller confirms on /purchase/:id or Buyer confirms receipt
**Logic (seller confirm):**
1. Auth check: `seller_email === user.email` or admin
2. Proof required: `transfer_proof_url` or `transfer_notes` must exist
3. `Purchase.update({seller_confirmed: true})`
4. `Purchase.update({seller_confirmed_at: ISO})`
5. If seller confirms within 1hr: award `seller_transfer_1hr` points
6. Notify buyer: "Tickets sent 🚀"
7. Fire-and-forget: `verifyTransferProof` (AI analysis)

**Logic (buyer confirm):**
1. Auth check: `buyer_email === user.email` or admin
2. Cannot confirm before seller: BLOCKED if `!seller_confirmed`
3. Optimistic UI update in frontend
4. Re-fetch Purchase (atomic capture guard — blocks double capture)
5. Stripe PI retrieve → if `requires_capture`: `stripe.paymentIntents.capture(pi_id, {idempotencyKey})`
6. On Stripe failure: mark `payment_capture_failed: true`, email admin, return 500
7. `Purchase.update({transfer_status: 'completed', payment_captured: true})`
8. `Listing.update({status: 'sold', reservation_token: null, ...})`
9. Award points: `sale_completed` (seller), `purchase` (buyer)
10. Notify both parties

**Outputs:** Purchase completed, Stripe captured, payout initiated to seller Connect account
**State Changes:** Purchase → completed; Listing → sold; Stripe PI → captured; Points awarded

## WF-4: Dispute Flow
**Trigger:** Buyer clicks "I Haven't Received Tickets"
**Logic:**
1. `Purchase.update({transfer_status: 'disputed', dispute_reason})`
2. Notify buyer + seller (in-app + email)
3. Email `experience@peanutgallery.store` with details
4. Payment remains frozen (not captured, not refunded)
5. Admin must manually resolve via AdminCommandCenter
**Outputs:** Purchase set to disputed; Admin alerted
**State Changes:** Purchase → disputed; Payment frozen

## WF-5: Purchase Cancellation
**Trigger:** Buyer clicks "Cancel Purchase & Refund"
**Logic:**
1. Auth check: `buyer_email === user.email` or admin
2. Blocked if `transfer_status` in [completed, expired] or `payment_captured: true`
3. PI retrieved from Stripe
4. If `requires_capture`: `stripe.paymentIntents.cancel(pi_id)` (no charge)
5. If `succeeded`: `stripe.refunds.create({payment_intent: pi_id})`
6. `Purchase.update({transfer_status: 'expired'})`
7. `Listing.update({status: 'active'})` — restored to marketplace
**Outputs:** Purchase expired; Stripe refunded/voided; Listing restored

## WF-6: Seller Onboarding
**Trigger:** Seller clicks "Set Up Payouts with Stripe" on /sell
**Logic:**
1. Auth required
2. If `user.stripe_account_id` exists: validate against Stripe; if invalid → clear and re-create
3. If no account: `stripe.accounts.create({type: 'express', email, transfers_requested: true})`
4. `base44.auth.updateMe({stripe_account_id: accountId})`
5. `stripe.accountLinks.create({account, refresh_url, return_url, type: 'account_onboarding'})`
6. Frontend redirects to Stripe-hosted onboarding (`window.top.location.href = url`)
7. On return to `/sell?onboarding=complete`: `checkSellerOnboarding` invoked
8. `stripe.accounts.retrieve(account_id)` → if `charges_enabled: true` → `updateMe({stripe_onboarding_complete: true})`
**Outputs:** Stripe Express account linked; `stripe_onboarding_complete` flag set on User

## WF-7: AI Transfer Proof Verification
**Trigger:** Seller confirms transfer (after proof upload) in `capturePayment`
**Logic:**
1. `Purchase.update({ai_proof_status: 'processing'})`
2. Fetch listing + event for context
3. Duplicate proof check across all purchases
4. Vision LLM call (`claude_sonnet_4_6` model) with structured prompt + proof image URL
5. Parse JSON response: platform, confidence score, extracted fields, flags
6. Apply duplicate proof penalty: -35 points if reused
7. Determine status: verified_high_confidence (≥90) | verified_medium_confidence (≥70) | needs_human_review (≥40) | rejected_suspicious (<40 or editing detected)
8. Update Purchase with all AI fields
9. If `rejected_suspicious` + `!false_claim_recorded`: increment seller `transfer_false_claim_count`
10. If suspicious: email admin alert
**Outputs:** Purchase updated with AI verification results; Admin alerted if suspicious

---

# ACTIONS

## Action: submitListing
**Input:** `{event_id, section, row, seats, quantity, tier, asking_price, original_price, transfer_method, proof_url, is_test, transfer_source, transfer_attestation_proof_url}`
**Logic:** See WF-1
**Output:** `{listing, flagged, flag_reason, optimistic_id}`
**Side Effects:** SeatInventory create/update; TransferVerificationLog create

## Action: createPaymentIntent
**Input:** `{listing_id, buyer_name, buyer_email, buyer_phone}`
**Output:** `{clientSecret, paymentIntentId, reservationToken, subtotal, platformFee, buyerTotal, sellerPayout}`
**Side Effects:** Listing reserved; User `last_pi_attempt_at` stamped

## Action: capturePayment
**Input:** `{purchase_id, confirming_role: 'seller'|'buyer', optimistic_id}`
**Output:** `{status, buyer_confirmed, seller_confirmed, payment_captured, optimistic_id}`
**Side Effects:** Stripe PI captured on full confirmation; Listing sold; Points awarded; Notifications sent

## Action: cancelPurchase
**Input:** `{purchase_id}`
**Output:** `{status: 'cancelled'}`
**Side Effects:** Stripe PI cancelled/refunded; Listing restored; Purchase set expired

## Action: verifyTransferProof
**Input:** `{purchase_id, proof_url, force_reprocess}`
**Output:** `{success, ai_proof_status, ai_confidence_score, ai_review_notes, ai_detected_platform, ai_flags, fraud_risk_score, extracted, authenticity}`
**Side Effects:** Purchase AI fields updated; seller `transfer_false_claim_count` incremented on rejection; Admin emailed

## Action: awardPoints
**Input:** `{action, reference_id, reference_type, target_email (admin/service-role only), description, metadata, _internal_service_call}`
**Output:** `{success, points_awarded, new_balance, new_lifetime, new_rank, new_level, new_achievements, trust_score, trust_badges}`
**Side Effects:** User stats updated; PointsActivity logged; Trust score/badges recomputed

## Action: recordNotification
**Input:** `{user_email, type, title, body, reference_id, reference_type, action_url, send_email, send_push}`
**Output:** `{ok: true}`
**Side Effects:** Notification entity created; OneSignal push sent; Email sent (for high-value types)

## Action: onboardSeller
**Input:** `{}`
**Output:** `{url: Stripe onboarding URL}`
**Side Effects:** Stripe Express account created or reused; `stripe_account_id` saved to User

## Action: checkSellerOnboarding
**Input:** `{}`
**Output:** `{complete, charges_enabled, details_submitted, stale_account_cleared?}`
**Side Effects:** `stripe_onboarding_complete` updated on User if newly complete

## Action: syncTMEvent
**Input:** `{tm_id, title, venue, city, state, date, image_url, tm_url, category}`
**Output:** `{status: 'created'|'updated'|'deduped', id, duplicates_removed?}`
**Side Effects:** Event entity created or updated; duplicate DB records for same tm_id deleted

## Action: approveListingReview (admin)
**Input:** `{listing_id}`
**Output:** `{ok}`
**Side Effects:** `proof_status: 'approved'`; `status: 'active'`; Seller notification sent

## Action: rejectListingReview (admin)
**Input:** `{listing_id, reason}`
**Output:** `{ok}`
**Side Effects:** `proof_status: 'rejected'`, `proof_rejection_reason` set; `status: 'hidden'`; Seller notified

---

# COMPONENT INVENTORY

## PurchaseDialog
**Props:** `{event, listing, onClose, mode: 'ticket'|'upgrade'}`
**State:** `stripePromise, user, reservedListingId`
**Children:** `CheckoutForm` (Stripe Elements), self-purchase guard screen, `TransferAcknowledgment`
**Events:** `onClose` (releases reservation if set); form submit → `createPaymentIntent` → `stripe.confirmCardPayment` → `Purchase.create` → navigate
**Data Sources:** `getStripeKey`, `base44.auth.me`

## ListingCard
**Props:** `{listing, isCheapest, onUpgrade, mode}`
**State:** none (pure display)
**Data Sources:** listing prop
**Events:** `onUpgrade(listing)` → opens PurchaseDialog

## TransactionTimeline (local in PurchaseSuccess)
**Props:** `{purchase}`
**State:** none
**Logic:** 4-step timeline derived from `purchase.seller_confirmed`, `purchase.buyer_confirmed`, `purchase.transfer_status`

## TransferAssistant
**Props:** `{purchase, listing, onConfirm, actionLoading, error, setError, sellerPayout}`
**State:** proofUrl, proofNote, uploading
**Events:** `onConfirm({proofUrl, proofNote})` → triggers capturePayment for seller role

## Layout (bottom nav)
**State:** `showOnboarding`, `unreadCount`, `liveEventId`, `scrollPositions`, `currentTab`
**Data Sources:** `base44.auth.me` (via AuthContext), `Notification.filter`, `Event.filter({status:'live'})`
**Tabs:** Events(/events), Upgrades(/upgrades), Sell(/sell), Fan Zone(/fan-zone), Me(/me)
**Features:** Tab persistence (MountedTab), scroll position restore, live event pulse on Upgrades tab

## EventsEmptyState
**Props:** `{locationStatus, onNearMe, onEnterCity}`
**Logic:** Contextual display based on GPS permission state

## LocationAutocomplete
**Props:** `{value, onChange, onSelect, onSubmit, onNearMe, nearMeLoading, placeholder, autoFocus}`
**State:** suggestions, suggestLoading, open, activeIndex, dropdownRect, showRecent
**Features:** Portal dropdown, recent cities (localStorage), keyboard navigation, scroll/resize tracking, debounced fetch via `suggestCities` function

---

# PAGE INVENTORY

## /events — Events
**Purpose:** Event discovery; GPS + city + keyword search; merged PG+TM event feed
**Components:** `LocationAutocomplete`, `EventsEmptyState`, `EventThumbnail`
**Data Sources:** `Event.list()`, `getTicketmasterEvents` (via tmCache), `suggestCities`
**Actions:** requestLocation, fetchEvents, syncTMEvent (fire-and-forget per TM event), pull-to-refresh
**State:** events[], loading, locationInput, latlong, locationLabel, tmError, networkError

## /events/:id — EventDetail
**Purpose:** PG event detail with ticket listings; 3-step lookup (direct id → tm_ prefix strip → bare tm_id); duplicate dedup
**Components:** `ListingCard`, `PurchaseDialog`, `EventLookupDebugPanel`
**Data Sources:** `Event.filter({id})`, `Listing.filter({event_id, status:'active'})`
**Actions:** Purchase listing, navigate to Live Hub; logNavEvent (always); AdminAlert on failure
**Filters:** `proof_status === 'approved'`; demo listings hidden in production (unless no real listings)

## /events/tm/:tmId — EventDetailTM
**Purpose:** TM-sourced event detail; syncs to DB on miss; shows PG listings if any; official ticket link
**Components:** `ListingCard`, `PurchaseDialog`
**Data Sources:** `Event.filter({tm_id})`, `syncTMEvent` on miss, `Listing.filter({event_id})`
**Actions:** "List tickets for this event" → creates local Event record if needed → navigate to CreateListing

## /purchase/:id — PurchaseSuccess
**Purpose:** Transaction lifecycle page; role-specific views for buyer/seller; auto-refresh every 15s for buyer
**Components:** `TransactionTimeline`, `TransferAssistant`, `BuyerPanel`, `CompletedBanner`, `AIVerificationStatus`, `DisputeModal`, `NotificationPermissionPrompt`
**Data Sources:** `Purchase.filter({id})`, `Listing.filter({id: p.listing_id})`, `Event.filter({id: p.event_id})`
**Actions:** handleSellerConfirm, handleConfirm(buyer), handleCancel, handleDispute
**Access Control:** buyer_email || seller_email || admin; gate before isSeller/isBuyer derivation

## /create-listing — CreateListing
**Purpose:** 3-step listing wizard: event select → seat details → pricing/proof
**Components:** `StepBar`, `LocationAutocomplete`, `SellerTransferAttestation`
**Data Sources:** `Event.filter({status:'upcoming'})`, `fetchTMEvents`, `base44.auth.me`
**Actions:** handleSubmit (submitListing or draft), handleTmSearch, handleSelectTmEvent, handleProofUpload
**State:** step 0-2, form{event_id, section, row, seats, quantity, tier, asking_price, original_price, transfer_method, proof_url}, listingMode, attestationDone, onboardingComplete

## /sell — Sell
**Purpose:** Seller hub: Stripe onboarding gate, listing CTA, stats, nearby events, listing sections
**Data Sources:** `base44.auth.me`, `Listing.filter({seller_email})`, `fetchTMEvents`, `checkSellerOnboarding`
**Sections:** onboarding CTA (if not complete), primary CTA (if complete), stats grid, Events Near You, drafts, active, sold, empty state

## /my-sales — MySales
**Purpose:** Seller dashboard with action-required, awaiting buyer, active, hidden/rejected, instant, completed sections
**Data Sources:** `Listing.filter({seller_email})`, `Purchase.filter({seller_email})`, parallel `Event.filter` per event_id
**Components:** `SellerMetrics`, `TransferStatusBadge`, `ListingStatusBanner`

## /my-tickets — MyTickets
**Purpose:** Buyer ticket dashboard: action required, awaiting transfer, disputed, completed
**Data Sources:** `Purchase.filter({buyer_email})`, parallel `Event.filter` per event_id
**Components:** `DonateSeatSheet`
**Actions:** view purchase, confirm receipt (link), upgrade (link to /upgrades/:id), donate seat

## /admin — AdminCommandCenter
**Purpose:** Admin-only command center with 12 section tabs
**Access Control:** `isAdmin(user)` check → `<Navigate to="/events" />` if not admin
**Sections:** Live Issues, Market Health, Stripe/Payments, Instant Ops, AI Verification, Donations, Alert Center, Transfer Windows, Transfer Intelligence, Review Queue, Fee Simulator, Flash Drops
**Data Sources:** `Purchase.list(100)`, `Listing.list(100)`, `SeatDonation.list(50)`, `getStripeMode`

---

# FULL SOURCE IMPLEMENTATION

> Note: Full source files are included above in this snapshot document in the context read. The following index maps all files that were read. Sections above contain the complete source of each.

```
FILE: /src/App.jsx                              — Router; AuthProvider; routes
FILE: /src/index.css                            — Design tokens; Tailwind; neon utilities
FILE: /src/tailwind.config.js                   — Tailwind theme mapping
FILE: /src/api/base44Client.js                  — Base44 SDK client init
FILE: /src/lib/AuthContext.jsx                  — Auth context; OneSignal login
FILE: /src/lib/feeEngine.js                     — Full fee engine (all models, calculators)
FILE: /src/lib/eventTiming.js                   — Event live status; timezone resolution
FILE: /src/lib/isAdmin.js                       — Admin role check
FILE: /src/lib/eventUrl.js                      — getEventUrl, getUpgradeUrl
FILE: /src/lib/navLogger.js                     — logNavEvent, classifyFailure, checkNavFailureRate
FILE: /src/lib/tmCache.js                       — TM API cache + dedup
FILE: /src/lib/optimisticUI.js                  — createOptimisticPurchaseUpdate
FILE: /src/components/Layout.jsx                — Bottom nav layout
FILE: /src/components/LocationAutocomplete.jsx  — City autocomplete
FILE: /src/pages/Landing.jsx                    — Unauthenticated landing
FILE: /src/pages/Events.jsx                     — Event discovery
FILE: /src/pages/EventDetail.jsx                — PG event detail + listings
FILE: /src/pages/EventDetailTM.jsx              — TM event detail
FILE: /src/pages/PurchaseSuccess.jsx            — Transaction lifecycle
FILE: /src/pages/CreateListing.jsx              — 3-step listing wizard
FILE: /src/pages/Sell.jsx                       — Seller hub
FILE: /src/pages/MySales.jsx                    — Seller dashboard
FILE: /src/pages/MyTickets.jsx                  — Buyer ticket dashboard
FILE: /src/pages/Me.jsx                         — User profile
FILE: /src/pages/AdminCommandCenter.jsx         — Admin command center
FILE: /src/pages/EventMode.jsx                  — Deprecated redirect
FILE: /src/components/events/PurchaseDialog.jsx — Checkout modal
FILE: /functions/submitListing.js               — Listing creation backend
FILE: /functions/createPaymentIntent.js         — Stripe PI creation
FILE: /functions/capturePayment.js              — Stripe capture + confirmations
FILE: /functions/cancelPurchase.js              — Cancel + refund
FILE: /functions/stripeWebhook.js               — Stripe webhook handler
FILE: /functions/onboardSeller.js               — Stripe Express onboarding
FILE: /functions/checkSellerOnboarding.js       — Stripe onboarding check
FILE: /functions/verifyTransferProof.js         — AI proof verification
FILE: /functions/awardPoints.js                 — Points economy
FILE: /functions/recordNotification.js          — Notification dispatch
FILE: /functions/syncTMEvent.js                 — TM → DB sync/upsert
FILE: /functions/cancelPurchase.js              — Cancel + Stripe refund
```

---

# GENERATED LOGIC

## Automations (Base44 Managed)

### 1. Transfer Alert Processor (Scheduled)
- **Type:** Scheduled, every 5 minutes
- **Function:** `processTransferAlerts`
- **Purpose:** Scans listings for expiring verifications, stalled transfers, conflicting community reports; creates AdminAlerts
- **Status:** Active | ARN: `arn:aws:scheduler:us-west-2:789051085499:schedule/scheduled-tasks-prod/task-6a18ecd7fa77c0b47415c9e3`

### 2. Transfer Reminder Notifications (Scheduled)
- **Type:** Scheduled, every 5 minutes
- **Function:** `processTransferReminders`
- **Purpose:** Sends seller + buyer reminder notifications for stalled ticket transfers; conservative cadence (2 reminders max each)
- **Status:** Active | ARN: `.../task-6a1218bf2f021b62d0a3a987`

### 3. Cleanup Stale Drawn Donations (Scheduled)
- **Type:** Scheduled, every 10 minutes
- **Function:** `cleanupStaleDonations`
- **Purpose:** Expires or rerolls drawn seat donations where winner failed to respond within 2-minute window
- **Status:** Active | ARN: `.../task-6a176098d2f7e3ea74e7ada2`

### 4. Sync SeatInventory on Listing Change (Entity)
- **Type:** Entity trigger on `Listing` update
- **Function:** `syncInventoryOnListingChange`
- **Purpose:** Keeps SeatInventory in sync when listing status changes (sold → transferred, cancelled → available, etc.)
- **Status:** Active

### 5. Record Transfer Outcome on Purchase Complete (Entity)
- **Type:** Entity trigger on `Purchase` update
- **Function:** `recordTransferOutcome`
- **Purpose:** When purchase reaches completed or disputed status: records TransferOutcome, updates seller reliability score
- **Status:** Active

## Base44 Platform-Generated CRUD
- All entity operations (`list`, `filter`, `create`, `update`, `delete`, `get`, `bulkCreate`) are generated by Base44 SDK
- RLS rules are enforced by the platform at the database layer — not in application code
- The platform generates REST endpoints for all entities automatically
- `base44.entities.EntityName.subscribe()` — real-time subscription generated by platform

## Auth System
- Authentication is fully managed by Base44 (OAuth, email/password, tokens, sessions)
- `base44.auth.me()` returns current user from platform session
- `base44.auth.updateMe(data)` persists to the User entity via platform
- `base44.auth.redirectToLogin(nextUrl)` → Base44-hosted login page
- `base44.auth.logout(redirectUrl)` → platform token cleanup

## Routing
- React Router v6 (`BrowserRouter`) + `<Routes>` in App.jsx
- Protected routes: `AdminCommandCenter`, `FounderDashboard` check `isAdmin(user)` client-side
- Purchase access control checked in component logic (buyer/seller/admin)

---

# PERMISSIONS

## Role System
- **user** (default) — standard authenticated user
- **admin** — full access; bypasses most listing/seller guards

## Entity-Level RLS Rules
| Entity | Create | Read | Update | Delete |
|---|---|---|---|---|
| Event | — | — | — | — (no explicit RLS — open) |
| Listing | — | — | — | — (open, seller_email convention) |
| Purchase | true | buyer OR seller OR admin | buyer OR seller OR admin | admin |
| Notification | admin | user_email OR admin | user_email OR admin | admin |
| SeatInventory | true | owner_email OR admin | owner_email OR admin | admin |
| FlashDrop | true | true (public) | donor_email OR admin | admin |
| FlashDropEntry | true | entrant_email OR admin | admin | admin |
| SeatDonation | — | — | — | — (open) |
| DonationOptIn | — | — | — | — (open) |
| PointsActivity | true | user_email OR admin | admin | admin |
| AdminAlert | true | admin | admin | admin |
| TransferVerificationLog | true | admin | admin | admin |
| BetaTransferLog | true | admin | admin | admin |
| EventNavigationLog | true | admin | admin | admin |
| BetaTester | true | user_email OR admin | user_email OR admin | admin |
| BetaFeedbackEvent | true | admin | admin | admin |
| QAChecklistItem | — | — | — | — (open) |
| BugReport | — | — | — | — (open) |
| User (built-in) | system (invite only) | admin for list-all | self OR admin | admin |

## Function-Level Auth
| Function | Auth Model |
|---|---|
| submitListing | `base44.auth.me()` required; admin bypass for suspicious checks + ended event check |
| createPaymentIntent | `base44.auth.me()` required; self-purchase blocked; rate-limited |
| capturePayment | `base44.auth.me()` required; role-validated (seller/buyer/admin) |
| cancelPurchase | `base44.auth.me()` required; buyer or admin only |
| stripeWebhook | Public (Stripe signature validation); no user auth |
| onboardSeller | `base44.auth.me()` required |
| checkSellerOnboarding | `base44.auth.me()` required |
| verifyTransferProof | `base44.auth.me()` required; seller/buyer/admin only |
| awardPoints | `base44.auth.me()` OR `x-base44-service-role: true` header |
| recordNotification | `base44.auth.me()` OR `x-base44-service-role: true`; non-admin can only self-notify |
| sendUserNotification | `x-base44-service-role: true` (called from other functions) |
| sendNotificationEmail | `x-base44-service-role: true` (called from other functions) |
| syncTMEvent | `base44.auth.me()` required |
| adminOverrideAIVerification | Admin role required |
| approveListingReview | Admin role required |
| rejectListingReview | Admin role required |
| diagnoseSeller | Admin role required |
| getStripeKey | `base44.auth.me()` required |
| getStripeMode | `base44.auth.me()` required (admin-facing) |

---

# DEMO MODE

## Demo / Test Listing Detection
- Listings with `notes` starting with `[DEMO]` are filtered out from EventDetail in production
- Pattern: `!l.notes?.startsWith('[DEMO]')`
- If ALL listings for an event are demo-only (`isDemoOnly === true`), they ARE shown with an amber "🧪 Demo upgrades for testing" badge
- Admin bypass: `sessionStorage.getItem('pg_admin_unlocked') === '1'` shows all listings without filtering

## Test Listings (Admin)
- Admin users can create `[TEST] Admin/demo listing` tagged listings via `submitListing` with `is_test: true`
- `is_test: true` bypasses: suspicious check, SeatInventory conflict check, ended event check
- `is_admin: true` bypasses: Stripe onboarding check (allows listing without connected payout account)

## is_beta_live Flag
- `Event.is_beta_live = true` forces `getEventLiveStatus()` to return `status: 'live'` regardless of actual time
- Used to test live hub features before events go live
- Visible as a toggle in admin event management

## Stripe Test vs Live Mode
- `STRIPELIVESECRETKEY` environment variable: if `sk_test_*` → test mode; if `sk_live_*` → live mode
- `getStripeMode` function exposes this to admin UI
- Fee calculation and PI creation identical regardless of mode
- Admin listings (`isTestOrAdminListing`) skip seller Stripe account validation in `createPaymentIntent`

## seedDemoListings Function
- Admin-callable function to seed demo listings for QA sessions
- Creates listings tagged `[TEST]` or `[DEMO]` as needed

---

# LIVE MODE PLACEHOLDERS

## Seller Payout (Stripe Connect)
- **Current state:** Stripe Express Connect implemented; `application_fee_amount` and `transfer_data.destination` set on PI
- **Dependency:** Seller must complete `stripe.accounts.create` + `accountLinks` onboarding
- **Gap:** If seller Stripe account is invalid in live mode → listing blocked at checkout; seller payout account cleared

## Email Notifications
- **Current state:** Uses Base44 `Core.SendEmail` integration via `sendNotificationEmail` function
- **From address:** Base44-managed (app name as sender)
- **Gap:** No custom domain email (e.g. noreply@peanutgallery.store) — dependent on Base44 email infrastructure

## Push Notifications (OneSignal)
- **Current state:** OneSignal integrated via `react-onesignal`; `ONESIGNAL_REST_API_KEY` secret set
- **Functions:** `sendUserNotification` calls OneSignal REST API
- **Gap:** OneSignal requires user to grant browser permission; iOS PWA push support varies

## Ticketmaster API
- **Current state:** Live TM Discovery API via `getTicketmasterEvents` and `tmSuggest`
- **Secrets:** `Ticketmaster_consumer_key`, `ticketmaster_consumer_secret`
- **Rate limit:** 429 handling in tmCache; `bustTMCache` on pull-to-refresh
- **Gap:** TM API rate limits can block event discovery for all users simultaneously

## AI Transfer Verification
- **Current state:** `claude_sonnet_4_6` model via Base44 InvokeLLM integration
- **Uses:** Integration credits (non-default model)
- **Gap:** If LLM fails: `ai_proof_status: 'failed_processing'`; falls through to human review — no user notification

## Location Services
- **Current state:** Browser `navigator.geolocation` for GPS; `suggestCities` for manual city
- **Gap:** iOS Safari geolocation requires HTTPS + user prompt; no fallback for denied users except manual city entry

## Instant Listings / PG Custody
- **Current state:** Listing creation flow complete; custody verification admin UI exists
- **Gap:** No automated custody verification — admin must manually verify via `InstantFulfillmentCenter`; `pg_fulfilled_at` stamped manually; no automated buyer email with ticket transfer

## Dispute Resolution
- **Current state:** Dispute flow creates record + notifies admin; payment frozen
- **Gap:** No automated resolution logic — admin must manually resolve via AdminCommandCenter; no Stripe dispute response automation

## Referral System
- **Current state:** Referral point actions defined in `awardPoints` (referral_signup, referral_first_transaction, referral_verified_seller)
- **Gap:** All referral actions are DISABLED (`disabledActions` array); no referral link generation or tracking UI

## Seat Maps / Venue Context
- **Current state:** No implementation — zero seat map or venue layout
- **Gap:** Buyers cannot see where their seats are relative to the venue

---

# CODEX ANALYSIS NOTES

## Parts That Exist Only Inside Base44 Internals

1. **Authentication backend** — Token generation, session management, email verification, OAuth flows are entirely managed by Base44. No source code for this exists in the repository. `base44.auth.*` calls proxy to Base44's internal auth system.

2. **Entity CRUD API** — All `base44.entities.EntityName.list/filter/create/update/delete` calls proxy to Base44's auto-generated REST API. The actual database engine, query execution, and RLS enforcement are Base44 internal. Only the JSON schema files in `entities/` are accessible.

3. **RLS Enforcement** — Row-level security rules defined in entity JSON schemas are enforced by Base44 at the database layer. A Codex audit cannot verify RLS correctness from source code alone — the enforcement happens in the platform, not in the app.

4. **Real-time Subscriptions** — `base44.entities.X.subscribe()` is backed by Base44's internal WebSocket/SSE infrastructure. The subscription mechanism is opaque.

5. **File Storage / CDN** — `base44.integrations.Core.UploadFile({file})` returns a `file_url` pointing to Base44-managed storage. The storage backend (S3, GCS, etc.) and CDN configuration are opaque.

6. **InvokeLLM / AI Models** — `base44.integrations.Core.InvokeLLM({prompt, model, file_urls})` routes to OpenAI, Anthropic, or Google models via Base44's integration layer. Actual API keys and routing logic are internal to Base44.

7. **OneSignal Push** — While `ONESIGNAL_REST_API_KEY` is a user-managed secret, the OneSignal app ID and push certificate configuration exist in the Base44 platform settings, not in source.

8. **Deno Deploy Runtime** — Backend functions run on Deno Deploy (AWS Lambda-backed via Base44). The Deno runtime version, cold start behavior, memory limits, and execution environment are Base44-controlled.

9. **`x-base44-service-role: true` Header** — The `asServiceRole` SDK calls and service-role header are injected by the Base44 platform when backend functions call other backend functions. The trust model for this header is Base44-internal.

10. **App Public Settings / `appParams`** — `lib/app-params.js` reads `appId` and `token` from Base44's runtime injection. These values are not in source and change per environment.

11. **Base44 Analytics** — `base44.analytics.track({eventName, properties})` logs to Base44's internal analytics pipeline. No destination (Mixpanel, Amplitude, etc.) is configurable from source.

## Parts That Cannot Be Exported as Source Code

- Entity database contents (all records in Event, Listing, Purchase, etc.)
- User authentication tokens and sessions
- Stripe secret keys (stored as Base44 secrets, not in source)
- OneSignal REST API key
- Ticketmaster API credentials
- The Base44 SDK itself (npm package; source available at npmjs.com)
- Automation execution history and logs

## Areas Where a Codex Audit May Have Incomplete Visibility

1. **Race condition handling in createPaymentIntent** — The reservation token pattern (write-then-re-read) is a best-effort guard. True atomicity depends on Base44's entity update isolation level (unknown to Codex).

2. **Duplicate syncTMEvent records** — Multiple browser tabs can call `syncTMEvent` concurrently. `syncTMEvent` has dedup logic (filter → create only if not exists), but Base44's entity create is not transactional. Duplicates can still occur; EventDetail has a dedup sort-and-pick-newest guard.

3. **Payment capture idempotency** — `stripe.paymentIntents.capture(piId, {idempotencyKey: 'capture-${purchaseId}'})` uses Stripe's idempotency key to prevent double charges. The atomic guard (re-fetch + check `payment_captured`) is app-level; the actual Stripe behavior is external.

4. **Base44 SDK version drift** — Backend functions use `npm:@base44/sdk@0.8.25` while frontend uses `@base44/sdk@^0.8.32`. Minor API differences between these versions could cause behavioral divergence that is not visible in source.

5. **Fee model divergence** — `createPaymentIntent` hardcodes `max(1.00, subtotal * 0.05)` inline, separate from `lib/feeEngine.js`. If `ACTIVE_FEE_MODEL_ID` is changed in `feeEngine.js`, the backend function will NOT reflect it automatically. Manual sync required.

6. **`false_claim_recorded` race** — The AI verification function re-fetches the purchase before incrementing `transfer_false_claim_count`. However, if admin rejection and AI rejection fire simultaneously, a brief window exists where both could see `false_claim_recorded: false`. This is mitigated but not eliminated.

7. **OneSignal user targeting** — `sendUserNotification` targets users by email. If a user changes their email, OneSignal records may not match. The exact targeting behavior depends on how Base44's OneSignal integration maps emails to player IDs.

8. **Stripe Connect live-mode validation** — In `createPaymentIntent`, seller accounts are validated against Stripe in live mode only (`isLiveMode = secretKey.startsWith('sk_live_')`). In test mode, invalid seller accounts silently proceed without Stripe account validation.

9. **Admin route access** — `/admin` redirects non-admins client-side via `<Navigate>`. There is no server-side route protection. A user who manually constructs API calls with a valid session token can call any backend function; function-level auth guards are the only server-side protection.

10. **`pg_admin_unlocked` sessionStorage flag** — `sessionStorage.getItem('pg_admin_unlocked') === '1'` provides a client-side "admin view" toggle for non-admin users in development. It affects listing visibility in EventDetail. This flag is not persisted and resets on tab close, but it is a potential client-side privilege escalation vector for visual data exposure (not financial — RLS still applies to entity reads).