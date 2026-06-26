# ADMIN

## Admin Alerts

**Escalation:** Varies by alert priority

**What happened:** The system generated an alert for something that needs attention.

**How to recognize it:** AdminAlert records exist. The Admin Alert Center in the Command Center shows them.

**Where to go:** Admin Command Center → Admin Alert Center (`/admin`).

**What to check:**
1. **alert_type** — what type of alert?
   - `failed_transfer_after_payment` — 🔴 Critical
   - `new_dispute` — 🔴 Critical
   - `expired_verification` — 🟠 High
   - `low_confidence_listing` — 🟡 Medium
   - `conflicting_community_reports` — 🟡 Medium
   - `transfer_disabled_active_listing` — 🟠 High
   - `buyer_waiting_for_transfer` — 🟠 High
   - `seller_missed_deadline` — 🔴 Critical
   - `seller_reliability_drop` — 🟡 Medium
   - `admin_action_required` — varies
2. **priority** — `critical`, `high`, `medium`, `low`?
3. **resolved** — has it been addressed?
4. **reference_id** and **reference_type** — what entity does it point to?

**Actions to take:**
1. Triage by priority — Critical first.
2. Click through to the referenced entity (purchase, listing, event, user).
3. Resolve the underlying issue (see the relevant section in this runbook).
4. Mark the alert as `resolved: true`, fill in `resolved_by`, `resolved_at`, and `resolution_notes`.

**What NOT to do:**
- Don't ignore Critical/High alerts.
- Don't mark alerts resolved without fixing the underlying issue.

**Verify resolution:** Alert is `resolved: true` with notes. Underlying issue is fixed.

---

## Review Queue

**Escalation:** 🟡 Medium (batch daily)

**What happened:** Listings are awaiting proof review.

**How to recognize it:** Listings with `proof_status: pending_review` or `custody_status: pending_pg_verification`.

**Where to go:** Admin Command Center → Review Queue (PendingReviewQueue component).

**What to check:**
1. Listing **proof_url** or **ticket_file_url** — the uploaded proof.
2. Listing details — section, row, seats, event.
3. Seller history — are they verified? Prior rejections?

**Actions to take:**
- If proof is valid: `approveListingReview` — listing becomes active.
- If proof is invalid or missing: `rejectListingReview` with a reason.
- If uncertain: hold and request more info from the seller.

**What NOT to do:**
- Don't approve without reviewing the proof.
- Don't reject without a clear reason.

**Verify resolution:** Listing moves to `active` or is rejected with feedback.

---

## AI Verification Queue

**Escalation:** 🟡 Medium

**What happened:** Transfer proofs need AI verification or human review of AI decisions.

**How to recognize it:** Purchases with `ai_proof_status` in `pending`, `processing`, `needs_human_review`, or `failed_processing`.

**Where to go:** Admin Command Center → AI Verification Queue (AIVerificationPanel).

**What to check:**
1. **ai_proof_status** — what's the AI's current verdict?
2. **ai_confidence_score** — how confident?
3. **ai_flags** — what flags were raised?
4. **ai_review_notes** — AI's explanation.
5. The actual proof image.
6. **fraud_risk_score** — overall risk.

**Actions to take:**
- For `needs_human_review`: review the proof yourself, then approve/reject/escalate.
- For `rejected_suspicious`: review — if the AI was wrong, override with `adminOverrideAIVerification`.
- For `failed_processing`: retry the `verifyTransferProof` function.
- For high fraud risk: investigate before proceeding.

**What NOT to do:**
- Don't blindly trust AI — always review `needs_human_review` items.
- Don't override without documenting your reason.

**Verify resolution:** Purchase AI verification reaches a terminal state with documented reasoning.

---

## Transfer Intelligence

**Escalation:** 🟡 Medium

**What happened:** You need to monitor transfer outcomes and patterns across the platform.

**How to recognize it:** Routine monitoring. Also when transfer issues spike.

**Where to go:** Admin Command Center → Transfer Intelligence Panel.

**What to check:**
1. **TransferOutcome** records — `transfer_successful` rates, `minutes_to_transfer` averages.
2. **TransferVerificationLog** — verification patterns by platform, timing relative to event start.
3. **BetaTransferLog** — audit trail of all transfer-related events.
4. Platform breakdown — which ticketing platforms have the most issues?
5. Admin intervention rates — how often do admins need to step in?

**Actions to take:**
- If transfer success rates drop: investigate which platform/event is problematic.
- If admin intervention is frequent: consider process improvements.
- If disputes spike: see Purchases → "Purchase disputed."

**What NOT to do:**
- Don't ignore trending data — it reveals systemic issues early.

**Verify resolution:** Transfer metrics are healthy and stable.

---

## Market Health

**Escalation:** 🟡 Medium (check daily)

**What happened:** Routine marketplace health monitoring.

**How to recognize it:** Part of the daily checklist.

**Where to go:** Admin Command Center → Marketplace Health.

**What to check:**
1. Active listings count — is inventory healthy?
2. Stuck listings — any in intermediate states?
3. Listings with `transfer_disabled` — are transfer windows closing?
4. Listings with expired reservations — are they being released?
5. Duplicate listing detection.
6. Pricing health — are listings priced reasonably?

**Actions to take:**
- Address any stuck or duplicate listings.
- Release stale reservations.
- Surface transfer window issues to sellers.

**What NOT to do:**
- Don't let stale inventory accumulate.

**Verify resolution:** Marketplace is clean, no stuck/duplicate/stale listings.

---

## Instant Ops

**Escalation:** 🟠 High

**What happened:** Instant listings require PG (Peanut Gallery) to fulfill the transfer to the buyer.

**How to recognize it:** Purchases with instant listings where `fulfillment_status` is `awaiting_pg_transfer` or `transfer_in_progress`.

**Where to go:** Admin Command Center → Instant Ops Panel (InstantOpsPanel). Also the Fulfillment Queue.

**What to check:**
1. Purchase **fulfillment_status** — `awaiting_pg_transfer`, `transfer_in_progress`, `fulfilled`, `buyer_confirmed`, `issue_reported`?
2. **fulfillment_started_at** — how long has it been waiting?
3. **listing_mode** on the listing — `instant`?
4. **custody_status** — is the ticket in PG custody?
5. **pg_transfer_proof_url** — has PG uploaded transfer proof?

**Actions to take:**
1. For `awaiting_pg_transfer`: fulfill the transfer to the buyer ASAP.
2. Upload transfer proof (`fulfillment_proof_url`).
3. Set `fulfillment_status: transfer_in_progress`, then `fulfilled`.
4. Notify the buyer.
5. If there's an issue: set `fulfillment_status: issue_reported` and document.

**What NOT to do:**
- Don't leave instant purchases in `awaiting_pg_transfer` — the buyer paid for instant fulfillment.
- Don't mark fulfilled without uploading proof.

**Verify resolution:** Instant purchase reaches `fulfillment_status: fulfilled` or `buyer_confirmed`.

---

## Donations

**Escalation:** 🟡 Medium

**What happened:** Monitoring seat donations and flash drops.

**How to recognize it:** Part of routine monitoring, or when a donation issue is reported.

**Where to go:** Admin Command Center → Donation Ops Panel. Flash Drop Metrics Panel.

**What to check:**
1. Active SeatDonation records — `donation_status` = `active`, `drawn`, `accepted`?
2. FlashDrop records — `status` = `active`, `closed`, `winner_selected`?
3. Expired/stale donations — are they being cleaned up?
4. DonationOptIn records — are users opting in?
5. FlashDropEntry records — are users entering drops?
6. Metrics — views, entries, loser_upgrade_clicks, loser_purchases (conversion tracking).

**Actions to take:**
- Clean up stale donations via `cleanupStaleDonations`.
- Ensure winners are selected and notified.
- Monitor loser conversion — are non-winners upgrading?

**What NOT to do:**
- Don't let donations expire without attempting winner selection.

**Verify resolution:** Donations and flash drops are functioning, winners are selected, metrics are tracked.

---

## Fee Simulator

**Escalation:** 🟢 Low

**What happened:** You need to model fee scenarios or verify pricing.

**How to recognize it:** Part of pricing strategy or when investigating a pricing dispute.

**Where to go:** Admin Command Center → Fee Simulator (FeeSimulatorV2). Also Fee Comparison Report.

**What to check:**
1. Current fee structure (from `lib/feeEngine.js`).
2. Simulated fees at different price points.
3. Buyer total, seller payout, platform fee for each scenario.

**Actions to take:**
- Use the simulator to model pricing changes before implementing them.
- Compare fee structures with the Fee Comparison Report.

**What NOT to do:**
- Don't change the fee engine without modeling the impact first.

**Verify resolution:** Fee scenarios are understood and documented.

---

## Live Upgrade Controls

**Escalation:** 🟠 High (during live events)

**What happened:** Managing demo/venue upgrade listings during live events.

**How to recognize it:** During a live event, you need to orchestrate upgrade listings.

**Where to go:** Admin Command Center → Live Upgrade Control Panel.

**What to check:**
1. Event status — is it `live`?
2. Active upgrade listings — `listing_type` = `live_upgrade` or `venue_upgrade`?
3. **upgrade_window_opens_at** / **upgrade_window_closes_at** — are windows set correctly?
4. Demo listings — `is_demo_listing: true`? Are they being released on time?
5. **requires_existing_ticket** / **requires_location** — eligibility gates.
6. SeatInventory linked to upgrade listings.

**Actions to take:**
- Release demo upgrades on schedule via `releaseDemoUpgrades`.
- Ensure upgrade windows open and close at the right times.
- Monitor purchase activity on upgrades.
- Release SeatInventory when listings are hidden.

**What NOT to do:**
- Don't leave demo upgrades active after the event.
- Don't open upgrade windows before the event is live (unless intentionally early).

**Verify resolution:** Live upgrades are orchestrated correctly during the event.

---

# EVENTS

## Event Missing

**Escalation:** 🟡 Medium

**What happened:** An event that should be in the app isn't showing up.

**How to recognize it:** User or you can't find an event that exists on Ticketmaster.

**Where to go:** Admin panel → Event entity. Also `/events` page.

**What to check:**
1. Does an Event record exist? Search by title or `tm_id`.
2. Event **status** — `upcoming`, `live`, `ended`? Ended events don't show.
3. **is_beta_live** — is it hidden from non-admins?
4. Does it have a valid **date** / **event_start_utc**?
5. If it doesn't exist in the DB: it needs to be synced from Ticketmaster.

**Actions to take:**
- If the event exists but is `ended`: it won't show — this is expected.
- If `is_beta_live: true` and the user isn't an admin: it's hidden — this is expected.
- If the event doesn't exist in the DB: trigger a Ticketmaster sync via `syncTMEvent` or `getTicketmasterEvents`.
- If the event exists but has no date: fix the date field.

**What NOT to do:**
- Don't manually create event records if they can be synced from Ticketmaster.

**Verify resolution:** Event appears in the app.

---

## Duplicate Event

**Escalation:** 🟠 High

**What happened:** The same event appears twice in the app.

**How to recognize it:** Two Event records with the same title/venue/date, or the same `tm_id`.

**Where to go:** Admin panel → Event entity → search by title or tm_id.

**What to check:**
1. Both events' **tm_id** — are they the same?
2. **title**, **venue**, **date** — are they duplicates?
3. **updated_date** — which was updated most recently?
4. Are there listings attached to both? Which one has the listings?

**Actions to take:**
1. Keep the event with the most listings / most recent updates.
2. Move any listings from the duplicate to the canonical event (update `event_id`).
3. Delete or mark the duplicate as `ended`.
4. Check the `syncTMEvent` function — it should be an upsert (prevent duplicates).

**What NOT to do:**
- Don't delete an event that has listings/purchases attached — migrate them first.

**Verify resolution:** Only one event record exists for that event.

**Preventative measures:** The `syncTMEvent` function is an upsert. The Events page also dedupes by `tm_id`.

---

## Wrong Venue

**Escalation:** 🟡 Medium

**What happened:** An event shows the wrong venue.

**How to recognize it:** User or you notice the venue name is incorrect.

**Where to go:** Admin panel → Event entity → find the event.

**What to check:**
1. Event **venue** field.
2. **venue_lat** / **venue_lng** — do they match the venue?
3. **city** / **state** — do they match?
4. Source — was this synced from Ticketmaster, or manually created?

**Actions to take:**
- Correct the venue name, city, state, and coordinates.
- If the data came from Ticketmaster incorrectly: the sync may need adjustment.
- Re-sync if needed.

**What NOT to do:**
- Don't leave wrong venue info — it affects location-based features.

**Verify resolution:** Event shows the correct venue.

---

## Wrong Date

**Escalation:** 🟠 High

**What happened:** An event shows the wrong date or time.

**How to recognize it:** User reports the event time is wrong, or you notice a mismatch.

**Where to go:** Admin panel → Event entity → find the event.

**What to check:**
1. **date** (legacy field, UTC ISO string).
2. **event_start_local** — local time at venue (ISO without timezone).
3. **event_start_utc** — canonical UTC time.
4. **venue_timezone** — IANA timezone (e.g., `America/Phoenix`).
5. **duration_hours** — how long is the event considered "live"?

**Actions to take:**
- Correct the date fields. Ensure `event_start_utc` matches `event_start_local` + `venue_timezone`.
- If the data came from Ticketmaster: re-sync.
- Verify the event's live status timing is correct (`getEventLiveStatus`).

**What NOT to do:**
- Don't set dates without timezone awareness — this affects "live" detection.

**Verify resolution:** Event shows the correct date and time, live status works.

---

## Transfer Window Incorrect

**Escalation:** 🟠 High

**What happened:** The event's transfer window status is wrong (showing "open" when it's closed, or vice versa).

**How to recognize it:** Listings can't be transferred, or buyers report transfer issues. Event `transfer_window_status` is incorrect.

**Where to go:** Admin Command Center → Transfer Window Admin Panel. Event entity.

**What to check:**
1. Event **transfer_window_status** — `unknown`, `open`, `closing_soon`, `closed`, `manually_verified_open`, `manually_verified_closed`?
2. **transfer_window_closes_at** — when does it close?
3. **transfer_window_source** — `ticketmaster`, `seatgeek`, `axs`, `mlb`, `manual_admin`, `user_reported`, `inferred`?
4. **transfer_window_confidence** — how confident?
5. **upgrade_eligibility_status** — derived from transfer window.
6. **last_transfer_check_at** — when was it last checked?

**Actions to take:**
- If the status is wrong: manually verify, then set `transfer_window_status` to `manually_verified_open` or `manually_verified_closed`.
- Update `admin_transfer_notes` with what you found.
- If the auto-detection is failing: check the `processTransferAlerts` function and Ticketmaster API.
- Surface the correct status to users.

**What NOT to do:**
- Don't leave the status as `unknown` when you can verify it.
- Don't mark `open` without confirming transfers actually work.

**Verify resolution:** Transfer window status is accurate, users see correct information.

---

## Upgrade Window Incorrect

**Escalation:** 🟠 High

**What happened:** Upgrade listings are available at the wrong time (too early or too late).

**How to recognize it:** Upgrades showing before the event is live, or not showing when they should.

**Where to go:** Admin Command Center → Live Upgrade Control Panel. Check listing fields.

**What to check:**
1. Listing **upgrade_window_opens_at** / **upgrade_window_closes_at**.
2. Event **status** — is it `live`?
3. **listing_type** — `live_upgrade` or `venue_upgrade`?
4. Is the listing `is_demo_listing`? Demo listings are released on a schedule.

**Actions to take:**
- Correct the upgrade window timestamps.
- Use `releaseDemoUpgrades` to release demo upgrades on schedule.
- Ensure windows align with event live timing.

**What NOT to do:**
- Don't open upgrade windows before the event starts (unless intentionally early access).

**Verify resolution:** Upgrade listings appear at the correct time.

---

## Location Coordinates Missing

**Escalation:** 🟡 Medium

**What happened:** An event has no venue coordinates, breaking location-based features.

**How to recognize it:** Event `venue_lat` or `venue_lng` is null/undefined. "Near Me" features don't work for this event.

**Where to go:** Admin panel → Event entity → find the event.

**What to check:**
1. **venue_lat** / **venue_lng** — are they set?
2. **geo_radius_meters** — default is 500m, is it reasonable?
3. **venue** / **city** — can you look up coordinates?

**Actions to take:**
- Look up the venue's coordinates (Google Maps, etc.).
- Set `venue_lat` and `venue_lng`.
- Verify `geo_radius_meters` is appropriate.
- If the venue was synced from Ticketmaster without coordinates: manually add them.

**What NOT to do:**
- Don't leave coordinates missing — location-gated features will fail silently.

**Verify resolution:** Event has valid coordinates, "Near Me" and location features work.

---

## Ticketmaster Sync Issues

**Escalation:** 🟡 Medium

**What happened:** Events from Ticketmaster aren't syncing correctly.

**How to recognize it:** Events missing, duplicate events, or wrong data from Ticketmaster.

**Where to go:** Admin panel. Check the `syncTMEvent`, `getTicketmasterEvents`, and `tmSuggest` functions.

**What to check:**
1. Are the Ticketmaster API keys (`Ticketmaster_consumer_key`, `ticketmaster_consumer_secret`) valid?
2. Is the `getTicketmasterEvents` function returning data?
3. Is `syncTMEvent` creating/updating events correctly (upsert)?
4. Are you hitting Ticketmaster rate limits (429 errors)?
5. Check the tmCache (`lib/tmCache.js`) — is stale data being served?

**Actions to take:**
- If rate-limited: wait and retry. The app has caching and rate limit handling.
- If keys are invalid: update them in app secrets.
- If sync is creating duplicates: check the upsert logic in `syncTMEvent`.
- If data is wrong: verify the Ticketmaster API response and adjust mapping.
- Run `tmSuggest` or `suggestCities` to test connectivity.

**What NOT to do:**
- Don't hammer the Ticketmaster API if rate-limited — wait.

**Verify resolution:** Events sync correctly from Ticketmaster.

---

# USERS

## Account Issue

**Escalation:** 🟡 Medium

**What happened:** A user can't access their account or has a profile problem.

**How to recognize it:** User reports login issues, missing data, or profile errors.

**Where to go:** Admin panel → User entity. The user's profile page `/me`.

**What to check:**
1. Does the user exist in the User entity?
2. **email** verified?
3. **role** — `admin` or `user`?
4. Are they trying to access admin features without admin role?

**Actions to take:**
- If the user doesn't exist: they may need to be invited via `base44.users.inviteUser(email, role)`.
- If their profile data is incomplete: direct them to `/me` to complete it.
- If they're locked out: check auth settings in the Base44 dashboard.

**What NOT to do:**
- Don't create User records directly — users join via invites.
- Don't change roles without authorization.

**Verify resolution:** User can access their account.

---

## Email Verification

**Escalation:** 🟡 Medium

**What happened:** A user can't verify their email or isn't receiving verification emails.

**How to recognize it:** User reports not receiving verification email, or can't complete signup.

**Where to go:** Base44 dashboard → Auth settings. Check the `SendEmail` integration.

**What to check:**
1. Is the user's email correct?
2. Are verification emails being sent? (Platform handles this — check Base44 dashboard.)
3. Check spam folder.
4. Is the email domain correct? (Production domain: peanutgallery.store)

**Actions to take:**
- Have the user check spam/junk.
- Resend verification from the Base44 dashboard if possible.
- If emails aren't sending at all: check the `SendEmail` integration and email configuration.

**What NOT to do:**
- Don't manually mark emails as verified without confirming identity.

**Verify resolution:** User verifies their email and can access the app.

---

## Push Notifications Not Working

**Escalation:** 🟡 Medium

**What happened:** Users aren't receiving push notifications.

**How to recognize it:** Users report not getting notifications, or notification open rates are zero.

**Where to go:** OneSignal dashboard (onesignal.com). Check the `sendUserNotification` and `sendNotificationEmail` functions.

**What to check:**
1. Is `ONESIGNAL_REST_API_KEY` set and valid?
2. OneSignal dashboard — are notifications being sent? Delivered? Opened?
3. Are users subscribed to push? (Check the OneSignal player list.)
4. Are the notification payloads correct? (Check `sendUserNotification` function.)
5. Have users granted notification permissions on their device?

**Actions to take:**
- If the API key is invalid: update `ONESIGNAL_REST_API_KEY` in app secrets.
- If notifications are sending but not delivered: check OneSignal subscription status.
- If users haven't granted permissions: prompt them (the app has a NotificationPermissionPrompt component).
- Test by sending a test notification from OneSignal.

**What NOT to do:**
- Don't spam users with test notifications.

**Verify resolution:** Users receive push notifications.

---

## Profile Issue

**Escalation:** 🟢 Low

**What happened:** A user's profile has incorrect or missing information.

**How to recognize it:** User reports profile data issues (name, avatar, banner, etc.).

**Where to go:** The user's profile page `/me`. Admin panel → User entity.

**What to check:**
1. User **full_name**, **email**.
2. Profile fields — avatar, banner, bio, social links (check via `/edit-persona`).
3. Is the user authenticated?

**Actions to take:**
- Direct the user to `/me` → Edit Profile to update their info.
- If data is corrupted: check the User entity record.

**What NOT to do:**
- Don't edit user profiles from the admin panel unless there's a system issue.

**Verify resolution:** User's profile is correct.

---

## Points Issue

**Escalation:** 🟢 Low

**What happened:** A user's Peanut Points are incorrect or missing.

**How to recognize it:** User reports wrong points balance.

**Where to go:** Admin panel → PointsActivity entity → filter by user_email. Also check `lib/peanutPoints.js`.

**What to check:**
1. PointsActivity records for the user — are points being awarded correctly?
2. **action** types — do they match the expected points values?
3. **is_reversal** — were any points reversed?
4. Are there duplicate awards?
5. Check the `awardPoints` function — is it working?

**Actions to take:**
- If points are missing: run `awardPoints` for the missing action.
- If points are duplicated: create a reversal entry.
- If the `awardPoints` function failed: retry it.

**What NOT to do:**
- Don't manually edit points balances without a PointsActivity record.

**Verify resolution:** User's points balance is correct with a clear activity history.

---

## Trust Score Issue

**Escalation:** 🟡 Medium

**What happened:** A user's trust score seems wrong.

**How to recognize it:** Trust badges or scores don't reflect the user's actual reliability.

**Where to go:** Admin panel → check TransferOutcome, BetaTransferLog for the user. Check `lib/transferConfidence.js`.

**What to check:**
1. **TransferOutcome** records — `transfer_successful` rate.
2. **TransferVerificationLog** — verification history.
3. **BetaTransferLog** — any `transfer_failed`, `dispute_opened`, `confirmed_fraud` events?
4. Listing **transfer_confidence_score**.
5. FlashDrop **trust_score** and **trust_breakdown**.

**Actions to take:**
- If the score is genuinely wrong: investigate the underlying data.
- If the user had a false negative: correct the underlying records.
- If the user is genuinely untrustworthy: the score is correct — don't override.

**What NOT to do:**
- Don't inflate trust scores without cause.

**Verify resolution:** Trust score accurately reflects the user's history.

---

## Seller Reliability Issue

**Escalation:** 🟠 High

**What happened:** A seller has a pattern of failed transfers, missed deadlines, or disputes.

**How to recognize it:** AdminAlert of type `seller_reliability_drop` or `seller_missed_deadline`. Multiple failed TransferOutcomes for one seller.

**Where to go:** Admin Command Center → Issue Feed. Admin panel → filter Listing, Purchase, TransferOutcome by seller_email.

**What to check:**
1. Seller's TransferOutcome history — success rate.
2. **reminder_flags** — do they frequently need R2 reminders?
3. **auto_review_flagged** purchases — frequency.
4. Disputes against this seller.
5. AdminAlerts referencing this seller.

**Actions to take:**
1. Review the seller's full history.
2. If reliability is genuinely poor: consider suspending their listings (set to `hidden`, `admin_disabled`).
3. Contact the seller with specific concerns.
4. If fraud is suspected: see "Ban user."
5. Document in an AdminAlert.

**What NOT to do:**
- Don't let a chronically unreliable seller keep listing without intervention.
- Don't ban without evidence.

**Verify resolution:** Seller is either improved, suspended, or banned based on evidence.

---

## Ban User

**Escalation:** 🔴 Critical

**What happened:** A user needs to be banned for fraud, harassment, or severe violations.

**How to recognize it:** Fraud detected, harassment confirmed, or severe TOS violation.

**Where to go:** Admin panel → User entity. Base44 dashboard → Auth.

**What to check:**
1. Evidence of the violation — is it documented?
2. The user's history — is this a first offense or repeat?
3. Are there active listings/purchases that need to be handled first?

**Actions to take:**
1. Handle any active transactions first — cancel/refund as needed.
2. Hide all the user's active listings.
3. In the Base44 dashboard, revoke the user's access (or change their role/status).
4. Document the ban in an AdminAlert.
5. If fraud: set relevant `false_claim_recorded` and `admin_override_status: marked_fraudulent` on purchases.
6. The `deleteAccount` function can fully remove a user's data if needed (GDPR/compliance).

**What NOT to do:**
- Don't ban without documented evidence.
- Don't leave active transactions unresolved when banning.

**Verify resolution:** User can no longer access the app. Their active transactions are resolved.

---

## Restore User

**Escalation:** 🟡 Medium

**What happened:** A previously banned/suspended user needs to be restored.

**How to recognize it:** A ban was reversed or a suspension period ended.

**Where to go:** Admin panel → User entity. Base44 dashboard → Auth.

**What to check:**
1. Was the ban justified? Review the original evidence.
2. Has the user appealed or resolved the issue?

**Actions to take:**
1. Restore the user's access in the Base44 dashboard.
2. Unhide their listings if appropriate.
3. Document the restoration in an AdminAlert.
4. Monitor the user's activity after restoration.

**What NOT to do:**
- Don't restore a user who committed fraud without strong justification.
- Don't restore without documenting the reason.

**Verify resolution:** User can access the app again and behaves appropriately.