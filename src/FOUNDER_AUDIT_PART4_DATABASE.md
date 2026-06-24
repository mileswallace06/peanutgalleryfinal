# PART 4: DATABASE AUDIT

---

# SECTION 6: DATABASE AUDIT

## Complete Schema Overview — 25 Entities

---

### 1. User (Built-in)

**Purpose**: User accounts with Stripe Connect, Peanut Points, trust scores, achievements, and marketplace stats.

**Fields**:
- `role` (enum: admin/user, default: user)
- `stripe_account_id` (string) — Stripe Connect account ID
- `stripe_onboarding_complete` (boolean, default: false)
- `strike_count` (number, default: 0)
- `bio`, `avatar_url`, `banner_url` — Profile fields
- `persona_name`, `persona_style` — Persona fields
- `verified_fan` (boolean, default: false)
- `peanut_points` (number, default: 0) — Current spendable balance
- `lifetime_points` (number, default: 0) — Lifetime total (never decrements)
- `peanut_level` (number, default: 1) — Rank level 1-10
- `peanut_rank` (string, default: "Rookie Fan")
- `trust_score` (number, default: 50) — Computed 0-100
- `trust_badges` (array of strings)
- `achievements` (array of strings)
- `seller_streak` (number, default: 0)
- `total_purchases`, `total_sales`, `total_instant_listings`, `total_live_upgrades`, `total_fast_transfers` (numbers)
- `total_disputes`, `total_failed_transfers`, `total_cancelled_sales`, `confirmed_fraud_count` (numbers)
- `total_donations_made` (number, default: 0)
- `false_dispute_count` (number, default: 0)
- `is_founding_fan` (boolean, default: false)
- `has_seen_onboarding` (boolean, default: false)
- `points_last_updated` (string)
- `referral_code`, `referred_by` (strings) — **UNUSED (referral system disabled)**
- `seller_transfer_reliability` (number, default: 70)
- `transfer_success_count`, `transfer_fail_count`, `transfer_expired_count`, `transfer_false_claim_count` (numbers)
- `last_pi_attempt_at` (string) — Rate limiting
- `pi_attempt_count` (number, default: 0) — Fraud signal

**Relationships**: Referenced by virtually all other entities via email field.

**Used by**: All features.

**Unused fields**: `referral_code`, `referred_by` (referral system disabled).

**Potential issues**: Cannot create User records directly (must invite via `base44.users.inviteUser`). Notification preference fields (`notif_listing_sold`, `notif_transfer_updates`) are used in `sendUserNotification` but not declared in schema — may need to be added.

---

### 2. Event

**Purpose**: Event listings from TM API and manual creation.

**Fields**:
- `title` (required), `artist`, `venue` (required), `city`, `state`
- `date` (required, legacy UTC ISO string)
- `event_start_local` (local ISO without timezone)
- `event_start_utc` (canonical UTC ISO)
- `venue_timezone` (IANA timezone, e.g. America/Phoenix)
- `duration_hours` (number)
- `category` (enum: concert/sports/theater/comedy/other)
- `image_url`, `status` (enum: upcoming/live/ended, default: upcoming)
- `is_beta_live` (boolean, default: false)
- `venue_lat`, `venue_lng` (numbers) — Geo coordinates
- `geo_radius_meters` (number, default: 500)
- `tm_id`, `tm_url` — Ticketmaster reference
- `transfer_window_status` (enum: unknown/open/closing_soon/closed/manually_verified_open/manually_verified_closed)
- `transfer_window_closes_at`, `transfer_window_source`, `transfer_window_confidence`
- `upgrade_eligibility_status` (enum: eligible/limited/unknown/not_eligible)
- `last_transfer_check_at`, `admin_transfer_notes`

**Relationships**: Referenced by Listing, Purchase, FlashDrop, SeatInventory, SeatDonation, DonationOptIn, FlashDropEntry, TransferVerificationLog, TransferReport, AdminAlert, BetaTransferLog, TransferOutcome.

**Used by**: Events, EventDetail, EventDetailTM, EventDetailUpgrade, CreateListing, Sell, AdminCommandCenter.

**Unused fields**: `artist` (rarely populated), `transfer_window_*` (partially implemented — mostly `unknown`).

**Potential issues**: Duplicate events possible (dedup logic exists but edge cases remain). `date` field is legacy, `event_start_utc` preferred but both used. TM sync does NOT populate `venue_lat`/`venue_lng` — must be manually set.

---

### 3. Listing

**Purpose**: Ticket listings from sellers.

**Fields**:
- `event_id` (required, FK to Event), `seller_email`
- `section` (required), `row` (required), `seats`, `quantity` (default: 1)
- `tier` (enum: floor/lower/mid/upper)
- `asking_price` (required, per seat USD), `original_price`
- `transfer_method` (enum: platform_transfer/email_transfer/in_person)
- `proof_url`, `proof_status` (enum: pending_review/approved/rejected), `proof_rejection_reason`
- `ticket_file_url` — **UNUSED** (not referenced in any code)
- `notes`
- `status` (enum: active/pending_transfer/sold/cancelled/expired/pending_verification/hidden/pending_payout_setup)
- `hidden_reason` (enum: transfer_disabled/admin_disabled/expired_verification/sold/other)
- `listing_mode` (enum: standard/instant, default: standard)
- `custody_status` (enum: none/pending_pg_verification/verified/rejected)
- `pg_transfer_proof_url`, `pg_transfer_notes`, `pg_fulfilled_at`, `pg_fulfilled_by` — **NO FULFILLMENT WORKFLOW**
- `reservation_token`, `reservation_expires_at`, `reserved_by_email`
- `transfer_status` (enum: transfer_confirmed/transfer_unconfirmed/transfer_disabled/transfer_expired)
- `transfer_confidence_score`, `last_transfer_verification`
- `transfer_verification_method` (enum: seller_attestation/screenshot_verified/admin_verified/buyer_confirmed/community_verified)
- `transfer_verification_proof_url`, `transfer_verified_by`, `transfer_verified_notes`
- `transfer_platform` (enum: ticketmaster/seatgeek/axs/stubhub/apple_wallet/other)
- `verification_warning_sent_at`, `verification_expired_sent_at`
- `seat_inventory_id` (FK to SeatInventory)
- `listing_type` (enum: resale_ticket/venue_ticket/live_upgrade/venue_upgrade, default: resale_ticket)
- `inventory_source` (enum: fan/broker/venue_partner/pg_inventory/pg_demo/other, default: fan)
- `requires_existing_ticket` (boolean, default: false)
- `requires_location` (boolean, default: false)
- `location_requirement` (enum: none/venue_proximity/inside_venue/city_only, default: none)
- `upgrade_window_opens_at`, `upgrade_window_closes_at` — **NOT ENFORCED**
- `upgrade_instructions`
- `is_demo_listing` (boolean, default: false)

**Relationships**: FK to Event, SeatInventory. Referenced by Purchase.

**Used by**: EventDetail, PurchaseDialog, CreateListing, MySales, AdminCommandCenter, EventDetailUpgrade.

**Unused fields**: `ticket_file_url` (not used), `pg_fulfilled_at`/`pg_fulfilled_by` (no fulfillment workflow).

**Potential issues**: `pending_payout_setup` status creates draft listings that may be orphaned if seller never completes onboarding.

---

### 4. Purchase

**Purpose**: Transaction records for ticket purchases.

**Fields**:
- `listing_id` (required), `event_id` (required), `buyer_email`, `buyer_name`, `buyer_phone`
- `seller_email`, `amount` (required), `subtotal`, `platform_fee`, `seller_payout`, `quantity`
- `payment_intent_id` (custom RLS: read buyer/seller/admin, write admin only)
- `payment_captured` (boolean), `payment_capture_failed` (boolean)
- `transfer_status` (enum: pending_transfer/completed/expired/disputed)
- `buyer_confirmed`, `seller_confirmed`, `seller_confirmed_at`
- `transfer_notes`, `transfer_proof_url`, `dispute_reason`
- `buyer_lat`, `buyer_lng`, `location_verified`
- `reminder_flags` (object: seller_r1, seller_r2, buyer_r1, buyer_r2, stale_pi_warned)
- `auto_review_flagged`, `auto_review_flagged_at`, `false_claim_recorded`
- `fulfillment_status` (enum: awaiting_pg_transfer/transfer_in_progress/fulfilled/buyer_confirmed/issue_reported) — **NO FULFILLMENT WORKFLOW**
- `fulfillment_proof_url`, `fulfillment_notes`, `fulfillment_started_at`, `fulfillment_completed_at` — **UNUSED**
- AI verification fields: `ai_proof_status`, `ai_confidence_score`, `ai_review_notes`, `ai_detected_platform`, `ai_extracted_*` (event_name, recipient, transfer_time, section, row, seats), `ai_flags`, `ai_processed_at`, `ai_processed_by_model`
- `fraud_risk_score`
- Admin override fields: `admin_override_status`, `admin_override_reason`, `admin_override_by`, `admin_override_at`

**Relationships**: FK to Listing, Event. Referenced by TransferOutcome, AdminAlert.

**Used by**: PurchaseSuccess, MyTickets, MySales, AdminCommandCenter.

**RLS**: Buyer, seller, or admin can read/update; only admin can delete.

**Unused fields**: `fulfillment_*` fields (no fulfillment workflow), `buyer_lat`/`buyer_lng` (only used for donations, not purchases).

---

### 5. Notification

**Purpose**: In-app notifications.

**Fields**: `user_email` (required), `type` (enum), `title` (required), `body`, `read` (boolean), `reference_id`, `reference_type` (enum: purchase/listing/donation/event/dispute), `action_url`, `icon`.

**Relationships**: Referenced by user_email.

**Used by**: Notifications, Layout (unread count), DonationWinNotification.

**RLS**: User can read own + admin; user can update own + admin; only admin can create/delete.

**Potential issues**: Polling every 60s for unread count (could use realtime subscriptions instead).

---

### 6. SeatInventory

**Purpose**: Canonical ownership record for seats.

**Fields**: `event_id` (required), `event_title`, `owner_email` (required), `owner_name`, `section` (required), `row`, `seats`, `quantity`, `inventory_status` (enum: available/listed_for_sale/reserved_for_purchase/in_flash_drop/claimed_by_winner/transferred/cancelled), `inventory_intent` (enum: sell/flash_drop/undecided), `source_type` (enum: manual_entry/listing/flash_drop/purchase/future_custody), `ownership_verified`, `ownership_verification_method`, `ownership_verified_at`, `ownership_proof_url`, `transfer_verified`, `transfer_status`, `last_transfer_verification`, `linked_listing_id`, `linked_flash_drop_id`, `linked_purchase_id`, `winner_delivery_confirmed`, `winner_delivery_confirmed_at`, `donor_delivery_confirmed`, `donor_delivery_confirmed_at`.

**Relationships**: FK to Listing, FlashDrop, Purchase.

**Used by**: submitListing, flashDrop, syncInventoryOnListingChange.

**RLS**: Owner or admin can read/update; only admin can delete.

**Potential issues**: Complex state machine — may get stuck in intermediate states.

---

### 7. FlashDrop

**Purpose**: Timed free-seat giveaways.

**Fields**: `event_id` (required), `event_title`, `donor_email` (required), `donor_name`, `is_anonymous`, `section` (required), `row`, `seats`, `quantity`, `donor_message`, `drop_type` (enum: immediate/scheduled), `scheduled_label`, `scheduled_at`, `status` (enum: pending/active/closed/winner_selected/expired/cancelled), `entry_opens_at`, `entry_closes_at`, `entry_window_seconds` (default: 60), `winner_email`, `winner_name`, `winner_selected_at`, `winner_selection_locked_at`, `winner_selection_request_id`, `selection_completed_at`, `entry_count`, `source_purchase_id`, `source_donation_id` — **UNUSED**, `seat_inventory_id`, `ownership_verified`, `ownership_verification_method`, `ownership_verified_at`, `ownership_listing_id`, `ownership_delivery_method`, `trust_score`, `trust_breakdown` (object), `abuse_flags` (array), `metrics` (object: views, entries, loser_upgrade_clicks, loser_purchases, notification_sent, notification_opened).

**Relationships**: FK to Event, SeatInventory, User (donor).

**Used by**: flashDrop function, EventDetailUpgrade, FlashDropCenter.

**RLS**: Public read; donor or admin can update; only admin can delete.

**Potential issues**: `ALLOW_UNVERIFIED_BETA = true` allows unverified drops.

---

### 8. FlashDropEntry

**Purpose**: Individual flash drop entries.

**Fields**: `flash_drop_id` (required), `event_id` (required), `entrant_email` (required), `entrant_name`, `entered_at`, `is_winner`, `loser_action` (enum: none/viewed_upgrades/clicked_listing/purchased).

**Relationships**: FK to FlashDrop, Event, User.

**RLS**: Entrant or admin can read; only admin can update/delete.

---

### 9. SeatDonation

**Purpose**: Seat donation lottery.

**Fields**: `event_id` (required), `event_title`, `event_venue`, `event_city`, `donor_email` (required), `donor_name`, `is_anonymous`, `donor_message`, `section` (required), `row`, `seats`, `quantity`, `donation_status` (enum: active/drawn/accepted/declined_rerolling/expired/completed), `winner_email`, `winner_name`, `drawn_at`, `accepted_at`, `expires_at`, `reroll_count`, `source_purchase_id`, `source_listing_id` — **UNUSED**.

**Relationships**: FK to Event, User (donor, winner), Purchase, Listing.

**RLS**: **No RLS specified** — publicly readable.

**Potential issues**: No RLS — donation data is publicly visible.

---

### 10. DonationOptIn

**Purpose**: Fan opt-in for donation draws.

**Fields**: `event_id` (required), `user_email` (required), `opted_in_at`, `location_verified`, `purchase_id`, `draw_weight`, `recent_win_count`, `last_win_at`.

**RLS**: **No RLS specified** — publicly readable.

**Potential issues**: No RLS — opt-in data is publicly visible.

---

### 11. TransferOutcome

**Purpose**: Canonical transfer result records.

**Fields**: `listing_id` (required), `event_id` (required), `purchase_id`, `seller_email` (required), `buyer_email`, `platform` (enum), `transfer_successful`, `transfer_completed_at`, `minutes_to_transfer`, `buyer_confirmed`, `seller_confirmed`, `admin_intervention_required`, `dispute_created`, `notes`.

**RLS**: Buyer, seller, or admin can read; only admin can update/delete.

---

### 12. AdminAlert

**Purpose**: Admin alert queue.

**Fields**: `alert_type` (enum: 10 types), `priority` (enum: critical/high/medium/low), `title` (required), `description`, `reference_id`, `reference_type` (enum: purchase/listing/event/user), `seller_email`, `buyer_email`, `event_id`, `resolved`, `resolved_by`, `resolved_at`, `resolution_notes`.

**RLS**: Admin only (all operations).

---

### 13. BetaTransferLog

**Purpose**: Audit trail for transfer events.

**Fields**: `log_type` (enum: 16 types), `actor_email`, `actor_role` (enum: seller/buyer/admin/system), `listing_id`, `purchase_id`, `event_id`, `before_state` (object), `after_state` (object), `metadata` (object), `notes`.

**RLS**: Admin only (all operations).

---

### 14. TransferVerificationLog

**Purpose**: Records transfer verification timestamps.

**Fields**: `listing_id` (required), `event_id` (required), `seller_email`, `platform` (enum), `verification_timestamp` (required), `transfer_available` (required), `verification_method` (required, enum), `event_start_utc`, `minutes_since_event_start`, `venue`, `city`, `event_title`, `has_screenshot`, `confidence_score`.

**RLS**: Admin only (all operations).

---

### 15. TransferReport

**Purpose**: Community transfer status reports.

**Fields**: `event_id` (required), `listing_id`, `reporter_email` (required), `report_type` (required, enum: transfer_available/transfer_unavailable), `screenshot_url`, `platform` (enum), `notes`, `verified_by_admin`.

**RLS**: **No RLS specified** — publicly readable.

---

### 16. BetaTester

**Purpose**: Beta tester registration.

**Fields**: `name` (required), `email` (required), `user_email`, `fan_type` (enum: sports/concert/both), `favorite_teams`, `favorite_venues`, `device`, `beta_phase` (enum: phase_1/phase_2/phase_3), `status` (enum: invited/active/completed/dropped), `sessions_completed`, `feedback_count`, `last_active_at`, `day1_returned`, `day3_returned`, `day7_returned`, `what_user_thinks_pg_is`, `notes`.

**RLS**: User or admin can read; user or admin can update; admin can delete.

---

### 17. BetaFeedbackEvent

**Purpose**: Feedback events (bug, confused, love, idea).

**Fields**: `user_email`, `user_name`, `feedback_type` (required, enum: bug/confused/love/idea), `page`, `message`, `screenshot_url`.

**RLS**: User can create; admin only can read/update/delete.

---

### 18. BetaFeedback

**Purpose**: Structured feedback forms.

**Fields**: `tester_name` (required), `device`, `confusing`, `trust`, `blocker`, `coolest`, `overall_rating`, `extra`.

**RLS**: **No RLS specified** — publicly readable.

**Potential issues**: Overlaps with BetaFeedbackEvent — should consolidate.

---

### 19. FanPost

**Purpose**: Social posts and seat flex.

**Fields**: `author_email`, `author_name`, `text` (required), `post_type` (enum: post/seat_flex), `event_id`, `event_title`, `event_city`, `photo_url`, `before_photo_url`, `after_photo_url`, `from_section`, `from_row`, `to_section`, `to_row`, `reactions` (object: fire/eyes/peanut → array of emails).

**RLS**: **No RLS specified** — publicly readable.

**Potential issues**: No RLS — all posts publicly visible; no content moderation.

---

### 20. Follow

**Purpose**: User follow relationships.

**Fields**: `follower_email` (required), `following_email` (required), `following_name`, `following_avatar_url`.

**RLS**: **No RLS specified** — publicly readable.

---

### 21. BucketListItem

**Purpose**: User's followed artists/venues.

**Fields**: `user_email` (required), `tm_id` (required), `name` (required), `type` (required, enum: attraction/venue), `image_url`, `genre`.

**RLS**: **No RLS specified** — publicly readable.

---

### 22. PointsActivity

**Purpose**: Point transaction log.

**Fields**: `user_email` (required), `action` (required, enum: 35 actions), `points` (required), `description`, `reference_id`, `reference_type` (enum: purchase/listing/event/referral/profile/feedback/post/bug_report/donation), `source`, `is_reversal`, `metadata` (object).

**RLS**: User or admin can read; admin only can update/delete.

---

### 23. QAChecklistItem

**Purpose**: QA checklist items.

**Fields**: `category` (required), `title` (required), `result` (enum: untested/pass/fail), `notes`, `tester_name`, `device`, `session_id`.

**RLS**: **No RLS specified** — publicly readable.

---

### 24. BugReport

**Purpose**: Bug reports.

**Fields**: `title` (required), `description`, `severity` (enum: critical/high/medium/low), `status` (enum: open/investigating/fixed/verified), `affected_page`, `reporter_name`, `device`, `screenshot_url`, `notes`.

**RLS**: **No RLS specified** — publicly readable.

---

### 25. EventNavigationLog

**Purpose**: Admin-only navigation diagnostics.

**Fields**: `timestamp` (required), `user_email`, `event_title`, `event_id`, `tm_id`, `source`, `source_page`, `generated_href`, `lookup_method`, `result` (required, enum: 7 types), `failure_reason`, `user_agent`, `is_admin`, `session_id`.

**RLS**: User can create; admin only can read/update/delete.

---

## RLS Summary — Entities Missing RLS

The following entities have **no RLS specified**, meaning their data is publicly readable by any user:

| Entity | Risk Level | Recommendation |
|--------|------------|----------------|
| SeatDonation | Medium — exposes donor/winner emails | Add owner + admin RLS |
| DonationOptIn | Medium — exposes user emails and weights | Add owner + admin RLS |
| TransferReport | Low — exposes reporter emails | Add owner + admin RLS |
| BetaFeedback | Low — exposes tester names | Add admin-only RLS |
| FanPost | Low — intended public | Keep public but add moderation |
| Follow | Medium — exposes follow relationships | Add owner + admin RLS |
| BucketListItem | Medium — exposes user preferences | Add owner + admin RLS |
| QAChecklistItem | Low — internal QA data | Add admin-only RLS |
| BugReport | Medium — may expose sensitive info | Add admin-only RLS |
| Listing | None — RLS via seller_email pattern | Verify RLS is properly configured |