# STRIPE

## Seller Onboarding Failed

**Escalation:** 🟠 High

**What happened:** A seller tried to set up Stripe Connect (for payouts) but it failed.

**How to recognize it:** Seller can't list tickets actively (listing stuck in `pending_payout_setup`), or they report the Stripe onboarding flow errored.

**Where to go:** Admin Command Center → Stripe Panel. Also run `checkSellerOnboarding` or `diagnoseSeller` for the seller's email.

**What to check:**
1. Seller's Stripe Connect account status.
2. Run `diagnoseSeller` with the seller's email — it returns detailed diagnostics.
3. Run `checkSellerOnboarding` — returns the current onboarding state.
4. Listing status — is it `pending_payout_setup`?

**Actions to take:**
1. Share the `diagnoseSeller` output with the seller.
2. Direct the seller to retry onboarding from `/sell`.
3. Common issues: incomplete business info, bank account not verified, identity verification pending.
4. If the `onboardSeller` function errored: retry it.
5. If Stripe rejected the account: the seller may need to resolve issues in their Stripe dashboard.

**What NOT to do:**
- Don't activate listings for sellers who haven't completed onboarding — payouts would fail.
- Don't manually bypass Stripe requirements.

**Verify resolution:** Seller's Stripe account is active, listings move from `pending_payout_setup` to `active`.

---

## Seller Cannot Receive Payouts

**Escalation:** 🟠 High

**What happened:** A seller's payout is stuck or failed.

**How to recognize it:** Seller reports they haven't been paid. Completed purchase but no payout.

**Where to go:** Admin Command Center → Stripe Panel. Stripe dashboard → Connect → Payouts.

**What to check:**
1. Seller's Stripe Connect account — is it fully verified?
2. Bank account on file — valid?
3. Stripe → Transfers/Payouts — did the transfer fail?
4. Purchase `seller_payout` amount — is it correct?
5. Run `checkSellerOnboarding` for current status.

**Actions to take:**
- If the bank account is invalid: seller needs to update it in Stripe.
- If Stripe is holding funds: check for compliance/review holds in Stripe.
- If the transfer failed in Stripe: retry after the seller resolves the issue.
- If it's a Peanut Gallery issue: check the `stripeWebhook` function logs.

**What NOT to do:**
- Don't manually send payouts outside of Stripe Connect.
- Don't promise a payout date until the issue is diagnosed.

**Verify resolution:** Seller receives their payout in their bank account.

---

## Webhook Failure

**Escalation:** 🔴 Critical

**What happened:** Stripe webhooks aren't being received or processed correctly.

**How to recognize it:** Purchases show inconsistent states (e.g., payment captured in Stripe but not reflected in the app), or Stripe's webhook dashboard shows failed deliveries.

**Where to go:** Stripe dashboard → Developers → Webhooks. Admin Command Center → Stripe Panel.

**What to check:**
1. Stripe webhook endpoint URL — is it correct? Should point to the `stripeWebhook` function.
2. Stripe → Webhooks → Recent deliveries — are they failing?
3. Are the correct events subscribed? (At minimum: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.dispute.created`).
4. Run `checkStripeWebhook` to verify the webhook configuration.
5. Check the `stripeWebhook` function logs for errors.

**Actions to take:**
1. If the endpoint URL is wrong: update it in Stripe.
2. If events are missing: add them in Stripe's webhook settings.
3. If deliveries are failing: check the function logs, fix the code, and replay the failed webhooks from Stripe.
4. If the `STRIPE_WEBHOOK_SECRET` is wrong or rotated: update it in app secrets.

**What NOT to do:**
- Don't ignore failed webhooks — they drive the payment state machine.
- Don't manually update purchase states to "fix" things without understanding the root cause.

**Verify resolution:** Stripe webhook deliveries succeed, purchase states sync correctly.

**Preventative measures:** Regularly check `checkStripeWebhook`. Monitor Stripe's webhook dashboard.

---

## Refund Failed

**Escalation:** 🟠 High

**What happened:** A refund was attempted but failed in Stripe.

**How to recognize it:** Stripe shows a failed refund, or the buyer hasn't received their money.

**Where to go:** Stripe dashboard → Payments → find the charge → Refunds.

**What to check:**
1. The original charge — is it still valid/refundable?
2. Stripe refund status — `failed`, `canceled`, or `pending`?
3. Is the buyer's bank account still valid?

**Actions to take:**
- Retry the refund in Stripe.
- If the original charge was disputed/charged back: the refund may need to go through the dispute process.
- Contact Stripe support if the refund keeps failing.

**What NOT to do:**
- Don't issue refunds outside of Stripe.

**Verify resolution:** Buyer receives the refund.

---

## Dispute Received

**Escalation:** 🔴 Critical

**What happened:** A buyer filed a chargeback/dispute through their bank via Stripe.

**How to recognize it:** Stripe shows a dispute. An AdminAlert of type `new_dispute` may be created.

**Where to go:** Stripe dashboard → Disputes. Admin Command Center → Issue Feed / Admin Alert Center.

**What to check:**
1. The disputed charge in Stripe — amount, reason, deadline.
2. Related Purchase record — `transfer_status`, `transfer_proof_url`.
3. AI verification status and proof.
4. **TransferOutcome** — was the transfer successful?

**Actions to take:**
1. Gather evidence: transfer proof, AI analysis, timestamps, communication.
2. Submit evidence to Stripe before the deadline (typically 7-10 days).
3. If the seller is at fault: accept the dispute, don't fight it.
4. If the buyer is making a false claim: fight it with evidence.
5. Update the Purchase record (`transfer_status: disputed`).
6. Set `false_claim_recorded` if applicable.

**What NOT to do:**
- Don't miss the Stripe dispute response deadline.
- Don't fight a dispute without solid evidence.

**Verify resolution:** Dispute is resolved (won or lost) in Stripe. Purchase reflects the outcome.

---

## Transfer Failed

**Escalation:** 🟠 High

**What happened:** A Stripe transfer to the seller's bank failed.

**How to recognize it:** Stripe shows a failed transfer. Seller reports no payout.

**Where to go:** Stripe dashboard → Connect → Transfers. Admin Command Center → Stripe Panel.

**What to check:**
1. Transfer status in Stripe — `failed`, `canceled`?
2. Seller's bank account — valid?
3. Seller's Stripe account — active and verified?

**Actions to take:**
- Resolve the underlying issue (bank account, verification).
- Retry the transfer after the issue is fixed.
- Contact the seller to update their bank info if needed.

**What NOT to do:**
- Don't send money outside of Stripe.

**Verify resolution:** Seller receives the transfer.

---

## Capture Failed

**Escalation:** 🔴 Critical

**What happened:** Same as "Payment Capture Failed" in Purchases. The Stripe capture step failed.

**How to recognize it:** Purchase `payment_capture_failed: true`.

**Where to go:** Admin Command Center → Issue Feed. Stripe dashboard.

**What to check & Actions:** See Purchases → "Payment Capture Failed."

---

## Payout Failed

**Escalation:** 🟠 High

**What happened:** Same as "Transfer Failed" / "Seller Cannot Receive Payouts" above.

**How to recognize it:** Stripe payout shows failed. Seller reports no money.

**Where to go:** Stripe dashboard → Payouts. Admin Command Center → Stripe Panel.

**What to check & Actions:** See "Seller Cannot Receive Payouts" above.

---

## Live/Test Mode Confusion

**Escalation:** 🔴 Critical

**What happened:** Stripe is in test mode but the app expects live mode, or vice versa. Real charges aren't being processed, or test cards are being used in production.

**How to recognize it:** Payments behaving strangely. Test cards working in production, or real cards failing. Stripe dashboard shows test data when you expect live data.

**Where to go:** Admin Command Center → Stripe Panel (shows current mode). Also run `getStripeMode` to verify.

**What to check:**
1. Run `getStripeMode` — what mode does the app think it's in?
2. Run `getStripeKey` — which key is being used?
3. Check the secrets: `STRIPE_SECRET_KEY` vs `STRIPELIVESECRETKEY`, `STRIPE_PUBLISHABLE_KEY` vs `STRIPELIVEPUBLISHABLEKEY`.
4. Stripe dashboard — are you logged into the live or test dashboard?

**Actions to take:**
1. Verify the app is using LIVE keys in production: `STRIPELIVESECRETKEY` and `STRIPELIVEPUBLISHABLEKEY`.
2. Verify `STRIPE_WEBHOOK_SECRET` matches the live webhook endpoint.
3. If the app was running in test mode in production: this is critical — no real money was captured. Switch to live keys immediately.
4. If test data polluted the live database: clean up test purchases/listings.

**What NOT to do:**
- Don't use test keys in production.
- Don't use live keys in development/testing.

**Verify resolution:** App uses live Stripe keys in production. `getStripeMode` returns `live`.

**Preventative measures:** The `getStripeMode` function and Stripe Panel exist to catch this. Check before and after every deploy.

---

## Stripe Outage

**Escalation:** 🔴 Critical

**What happened:** Stripe is down or experiencing issues.

**How to recognize it:** Multiple payment failures, webhook failures, or Stripe status page shows an incident.

**Where to go:** status.stripe.com. Admin Command Center → Stripe Panel.

**What to check:**
1. Stripe status page — is there an active incident?
2. Are payments failing broadly or just for one user?

**Actions to take:**
1. If Stripe is down: pause new purchases if possible (or let them fail gracefully).
2. Communicate to users that payments are temporarily unavailable.
3. Do NOT manually process any payments.
4. Once Stripe recovers: retry failed captures, replay failed webhooks.
5. Check all pending purchases for inconsistent states.

**What NOT to do:**
- Don't try alternative payment methods unless you have a backup system.
- Don't manually mark purchases as paid.

**Verify resolution:** Stripe status returns to operational. Pending payments process correctly.

---

# FAN ZONE

## Posts Won't Load

**Escalation:** 🟡 Medium

**What happened:** The Fan Zone feed shows an error or won't load posts.

**How to recognize it:** "Couldn't load posts" message on `/fan-zone`, or the feed is stuck on loading.

**Where to go:** `/fan-zone` page. Browser console for error logs.

**What to check:**
1. Is the user authenticated? (FanPost reads work for authenticated users)
2. Is the loading skeleton showing, or is there an actual error message?
3. Check browser console for `[FanZone]` warnings — they log: failed entity, query, filter, auth state, environment, error message.
4. Is it an empty state (no posts) vs. a real error?
5. Try switching tabs (Trending, Near Me, Friends, Bucket List) — does it work on some but not others?

**Actions to take:**
- If it's an empty state (no posts): this is normal — encourage users to create the first post.
- If it's a real error: check the console log for the entity and error.
- If auth is still resolving: the skeleton should show — wait a moment.
- If the FanPost entity has a permissions issue: check the entity schema in the admin panel.
- Retry button on the error state re-runs the query and preserves the selected tab.

**What NOT to do:**
- Don't assume "no posts" is an error — it's an empty state.
- Don't show the scary error message for empty results.

**Verify resolution:** Fan Zone loads posts or shows the appropriate empty state.

---

## Images Won't Upload

**Escalation:** 🟡 Medium

**What happened:** A user tries to add a photo to a Fan Zone post but the upload fails.

**How to recognize it:** "Uploading…" spinner stuck, or an error when posting.

**Where to go:** `/fan-zone` → create post → add photo.

**What to check:**
1. Is the user authenticated?
2. File size — is it too large?
3. Is the `UploadFile` integration working? (It's a core integration, should always be available.)
4. Network connection.

**Actions to take:**
- Have the user try a smaller image.
- If the UploadFile integration is down: check Base44 platform status.
- If it's a one-off: the user can retry.

**What NOT to do:**
- Don't store images directly in entity fields (base64) — always use UploadFile.

**Verify resolution:** User successfully uploads and posts with a photo.

---

## Post Moderation

**Escalation:** 🟡 Medium

**What happened:** A post may need to be reviewed for inappropriate content.

**How to recognize it:** You notice a post, or a user reports it.

**Where to go:** Admin Command Center → Issue Feed. Fan Zone page.

**What to check:**
1. The post content — text, photo, seat flex info.
2. Community reports (check **TransferReport** or **BetaTransferLog** for reports).
3. Author history — is this a repeat offender?

**Actions to take:**
- If inappropriate: delete the FanPost record from the admin panel.
- If the user is violating guidelines: consider banning (see Users → "Ban user").
- Document the action in an AdminAlert.

**What NOT to do:**
- Don't edit post content — delete it if it violates guidelines.

**Verify resolution:** Post is removed, user is warned or banned if needed.

---

## Delete Inappropriate Content

**Escalation:** 🟡 Medium

**What happened:** A post, comment, or image needs to be removed.

**How to recognize it:** Content violates community guidelines.

**Where to go:** Admin panel → FanPost entity → find the record → delete.

**What to check:**
1. Is this the right post? Verify ID.
2. Should the user also be warned/banned?

**Actions to take:**
- Delete the FanPost record.
- If the user is a repeat offender: ban them.
- Document in an AdminAlert.

**What NOT to do:**
- Don't delete without verifying it's the correct post.

**Verify resolution:** Content is gone from the Fan Zone feed.

---

## User Reports Harassment

**Escalation:** 🟠 High

**What happened:** A user reports being harassed by another user in Fan Zone.

**How to recognize it:** User submits feedback or contacts support about harassment.

**Where to go:** Admin Command Center → Issue Feed. Check the reported user's FanPost history.

**What to check:**
1. The reported user's posts and activity.
2. Any community reports against them.
3. The reporting user's evidence (screenshots, messages).

**Actions to take:**
1. Review the evidence.
2. If harassment is confirmed: delete offensive posts, warn or ban the offender.
3. Contact the reporting user to confirm action taken.
4. Document in an AdminAlert.

**What NOT to do:**
- Don't ignore harassment reports — take them seriously.
- Don't ban without evidence.

**Verify resolution:** Offending content is removed, user is warned/banned, reporting user is informed.

---

## Spam Account

**Escalation:** 🟡 Medium

**What happened:** A user is posting spam in Fan Zone.

**How to recognize it:** Multiple low-quality posts, repeated content, or promotional spam.

**Where to go:** Admin panel → FanPost entity → filter by author email.

**What to check:**
1. The user's post history — how many posts, what content?
2. Are there community reports?

**Actions to take:**
- Delete spam posts.
- Warn or ban the spam account.
- If it's a bot: ban immediately.

**What NOT to do:**
- Don't let spam accumulate — it degrades the community.

**Verify resolution:** Spam is removed, account is warned/banned.

---

## Community Reports

**Escalation:** 🟡 Medium

**What happened:** Users have submitted transfer reports (transfer available/unavailable) for listings.

**How to recognize it:** TransferReport records exist, or conflicting reports appear.

**Where to go:** Admin Command Center → Transfer Intelligence Panel.

**What to check:**
1. **TransferReport** records — `report_type` (transfer_available / transfer_unavailable).
2. Are reports conflicting? (Some say available, some say not.)
3. **verified_by_admin** — have you reviewed them?
4. Screenshots provided as proof.

**Actions to take:**
- Review the reports and screenshots.
- If conflicting: manually verify the transfer status.
- Mark reports as `verified_by_admin: true` after review.
- Update the listing's `transfer_status` based on verified reports.

**What NOT to do:**
- Don't act on unverified community reports without checking.

**Verify resolution:** Transfer status reflects reality, verified reports are marked.

---

## Bucket List Issue

**Escalation:** 🟢 Low

**What happened:** A user's Bucket List isn't working correctly (can't add items, items not filtering posts).

**How to recognize it:** User reports Bucket List problems on Fan Zone.

**Where to go:** Admin panel → BucketListItem entity → filter by user email.

**What to check:**
1. Are there BucketListItem records for the user?
2. Do the items have valid `tm_id` and `name`?
3. Is the Fan Zone "Bucket List" tab returning results?

**Actions to take:**
- If items are missing: the user may need to re-add them.
- If the filter isn't working: check that post titles match bucket list names.

**What NOT to do:**
- Don't manually add bucket list items for users.

**Verify resolution:** User can add items and the Bucket List tab filters correctly.

---

## Follow System Issue

**Escalation:** 🟢 Low

**What happened:** A user can't follow another user, or the "Friends" tab shows no posts despite following people.

**How to recognize it:** User reports follow/friends issues.

**Where to go:** Admin panel → Follow entity → filter by follower_email.

**What to check:**
1. Are there Follow records for the user?
2. Do the `following_email` values match actual users?
3. Are there FanPost records from the followed users?

**Actions to take:**
- If follows are missing: the user may need to re-follow.
- If followed users have no posts: the "Friends" tab will be empty — this is expected.

**What NOT to do:**
- Don't create Follow records manually.

**Verify resolution:** User can follow and see friends' posts (if they exist).

---

# FLASH DROPS

## Winner Not Selected

**Escalation:** 🟠 High

**What happened:** A Flash Drop's entry window closed but no winner was selected.

**How to recognize it:** FlashDrop `status` = `closed` or `winner_selected` but `winner_email` is null.

**Where to go:** Admin Command Center → Flash Drop Metrics Panel. Also check the `flashDrop` function.

**What to check:**
1. FlashDrop **status** — `active`, `closed`, `winner_selected`?
2. **entry_closes_at** — has the window passed?
3. **entry_count** — were there any entries?
4. **winner_selection_request_id** — was a selection attempted?
5. **selection_completed_at** — did it complete?
6. Run/test the `flashDrop` function to see if selection works.

**Actions to take:**
1. If no entries were made: the drop expires with no winner (expected).
2. If entries exist but selection didn't run: manually trigger winner selection via the `flashDrop` function.
3. If selection failed: check the function logs for errors.
4. Once a winner is selected: verify they were notified.

**What NOT to do:**
- Don't manually set a winner_email without going through the selection function (fairness/integrity).

**Verify resolution:** Winner is selected and notified, FlashDrop status reflects completion.

---

## Winner Never Accepted

**Escalation:** 🟠 High

**What happened:** A Flash Drop winner was selected but didn't accept the donated seat within the time limit.

**How to recognize it:** FlashDrop `status` = `winner_selected` but `winner_email` hasn't confirmed, or the donation expired.

**Where to go:** Admin Command Center → Donation Ops Panel. FlashDrop record.

**What to check:**
1. **winner_selected_at** — how long ago?
2. **winner_selection_locked_at** — is the selection locked?
3. SeatDonation record — is `donation_status` `drawn` but not `accepted`?
4. **expires_at** on the SeatDonation — has it passed?

**Actions to take:**
1. If the time window hasn't passed: the system is waiting. Ensure the winner was notified.
2. If the window expired: the donation should auto-expire (`donation_status: expired`).
3. A reroll should occur — see "Reroll occurred."
4. If no reroll: manually trigger the next selection via the `seatDonation` function.

**What NOT to do:**
- Don't manually assign the seat to someone else without going through the reroll process.

**Verify resolution:** Seat is either accepted by the winner or rerolled to the next recipient.

---

## Donation Expired

**Escalation:** 🟡 Medium

**What happened:** A seat donation expired because no one claimed it in time.

**How to recognize it:** SeatDonation `donation_status` = `expired`.

**Where to go:** Admin Command Center → Donation Ops Panel.

**What to check:**
1. **expires_at** — when did it expire?
2. **drawn_at** — was a winner ever drawn?
3. **reroll_count** — how many rerolls occurred?
4. FlashDrop linked record — what's its status?

**Actions to take:**
1. If no winner was drawn: the donation expired from inactivity. The `cleanupStaleDonations` function should handle this.
2. If rerolls are exhausted: the donation is permanently expired. Release the SeatInventory.
3. Run `cleanupStaleDonations` if stale donations are piling up.

**What NOT to do:**
- Don't leave expired donations locking SeatInventory records.

**Verify resolution:** Expired donations are cleaned up, SeatInventory is released.

**Preventative measures:** The `cleanupStaleDonations` automation should run on a schedule. Ensure it's active.

---

## Reroll Occurred

**Escalation:** 🟡 Medium

**What happened:** A donation winner declined, and the system rerolled to select a new winner.

**How to recognize it:** SeatDonation `reroll_count` > 0, or `donation_status` = `declined_rerolling`.

**Where to go:** Admin Command Center → Donation Ops Panel.

**What to check:**
1. **reroll_count** — how many rerolls so far?
2. **winner_email** — has a new winner been selected?
3. **drawn_at** — when was the new winner drawn?
4. Is the new winner notified?

**Actions to take:**
- This is normal behavior — the system handles rerolls automatically.
- If rerolls are excessive (many declines): investigate why winners are declining.
- Ensure the new winner is notified.

**What NOT to do:**
- Don't manually override reroll selections.

**Verify resolution:** A winner accepts, or the donation expires after all rerolls.

---

## No Eligible Users

**Escalation:** 🟡 Medium

**What happened:** A Flash Drop or donation had no eligible users to select from.

**How to recognize it:** FlashDrop `entry_count` = 0, or DonationOptIn records are empty for the event.

**Where to go:** Admin Command Center → Donation Ops Panel. Check DonationOptIn entity.

**What to check:**
1. **DonationOptIn** records for the event — are there any?
2. **entry_count** on the FlashDrop — zero?
3. Were users notified about the drop/donation?
4. Is the event's location/eligibility too restrictive?

**Actions to take:**
- If no one opted in: the drop/donation expires with no winner (expected).
- If users should have been eligible: check the opt-in and location verification logic.
- Consider broadening eligibility or improving notifications.

**What NOT to do:**
- Don't force-select an ineligible user.

**Verify resolution:** Either eligible users participate, or the drop/donation expires gracefully.

---

## Location Verification Failed

**Escalation:** 🟡 Medium

**What happened:** A user's location couldn't be verified for a location-gated listing or donation.

**How to recognize it:** Purchase `location_verified: false`, or a user reports being blocked.

**Where to go:** Purchase detail page. The listing's `location_requirement` field.

**What to check:**
1. Listing **requires_location** — is it `true`?
2. Listing **location_requirement** — `venue_proximity`, `inside_venue`, or `city_only`?
3. Event **venue_lat** / **venue_lng** — are they set?
4. Event **geo_radius_meters** — what's the radius?
5. Purchase **buyer_lat** / **buyer_lng** — were they captured?
6. Purchase **location_verified** — `false`?

**Actions to take:**
- If the event has no coordinates: see Events → "Location coordinates missing."
- If the user was genuinely outside the radius: explain the requirement.
- If the user was inside but verification failed: check if GPS was denied or inaccurate.
- For city-only requirements: verify by city name, not coordinates.

**What NOT to do:**
- Don't bypass location requirements without cause — they protect against fraud.

**Verify resolution:** User's location is verified or they understand the requirement.

---

## SeatInventory Issue

**Escalation:** 🟠 High

**What happened:** A SeatInventory record is in the wrong state — locked when it shouldn't be, or available when it should be locked.

**How to recognize it:** Listings can't be created (seat is "locked"), or duplicate seat issues arise.

**Where to go:** Admin panel → SeatInventory entity → filter by event_id or section.

**What to check:**
1. **inventory_status** — `available`, `listed_for_sale`, `reserved_for_purchase`, `in_flash_drop`, `claimed_by_winner`, `transferred`, `cancelled`?
2. **linked_listing_id** / **linked_flash_drop_id** / **linked_purchase_id** — what's it linked to?
3. Is the linked listing/purchase/drop still active?

**Actions to take:**
- If a SeatInventory is locked (`listed_for_sale` or `reserved_for_purchase`) but the listing/purchase is gone: update `inventory_status` to `available`.
- If a SeatInventory shows `available` but there's an active listing: this is a data integrity issue — investigate the `syncInventoryOnListingChange` function.
- Don't delete SeatInventory records — update their status.

**What NOT to do:**
- Don't delete SeatInventory records — they are the canonical ownership record.
- Don't manually flip status without understanding the linked entities.

**Verify resolution:** SeatInventory status accurately reflects the linked listing/purchase/drop state.

**Preventative measures:** The `syncInventoryOnListingChange` automation keeps SeatInventory in sync. Ensure it's active.