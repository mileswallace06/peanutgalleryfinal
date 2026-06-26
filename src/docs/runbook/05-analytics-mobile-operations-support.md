# ANALYTICS

## Sales Dropped

**Escalation:** 🟡 Medium

**What happened:** A sudden drop in sales volume.

**How to recognize it:** Fewer purchases than usual. Command Summary Bar shows lower numbers.

**Where to go:** Admin Command Center → Command Summary Bar. Transaction Analytics.

**What to check:**
1. Is there a Stripe issue? (Check Stripe dashboard + webhook deliveries.)
2. Are there fewer active listings? (Check Marketplace Health.)
3. Are events missing or ended? (Check Event entity.)
4. Are listings stuck in `pending_verification`? (Check Review Queue.)
5. Are transfer windows closed for key events?
6. Is there a broader market issue (e.g., no popular events this week)?

**Actions to take:**
- Fix any Stripe/webhook issues first.
- Clear the Review Queue (approve/reject pending listings).
- Ensure events are syncing from Ticketmaster.
- Check if transfer window issues are hiding listings.

**What NOT to do:**
- Don't panic — investigate systematically.

**Verify resolution:** Sales return to expected levels.

---

## No Listings

**Escalation:** 🟡 Medium

**What happened:** The marketplace has no or very few listings.

**How to recognize it:** Marketplace Health shows low active listing count. Events have no listings.

**Where to go:** Admin Command Center → Marketplace Health.

**What to check:**
1. Are sellers creating listings? (Check recent Listing creates.)
2. Are listings stuck in `pending_payout_setup`? (Stripe onboarding issue.)
3. Are listings stuck in `pending_verification`? (Review Queue backlog.)
4. Are listings being hidden by `transfer_disabled`?
5. Is the `submitListing` function working?

**Actions to take:**
- Clear the Review Queue.
- Diagnose and fix seller onboarding issues.
- Encourage sellers to list (outreach).
- Check if transfer window detection is hiding listings incorrectly.

**What NOT to do:**
- Don't create fake listings to fill the marketplace.
- Don't bypass verification to get listings live.

**Verify resolution:** Healthy listing volume returns.

---

## Low Inventory

**Escalation:** 🟡 Medium

**What happened:** Not enough seats listed across the platform.

**How to recognize it:** Few listings, few SeatInventory records marked `listed_for_sale`.

**Where to go:** Admin Command Center → Marketplace Health. SeatInventory entity.

**What to check:**
1. SeatInventory records — how many are `available` vs `listed_for_sale`?
2. Are sellers listing their inventory? (Check Sell dashboard adoption.)
3. Are there upcoming events with zero listings?

**Actions to take:**
- Encourage users to list their seats (the Sell tab and education pages exist).
- Seed demo listings for testing/liquidity via `seedDemoListings` (admin only).
- Ensure the listing creation flow (`submitListing`) works smoothly.

**What NOT to do:**
- Don't over-rely on demo listings — they're for testing.

**Verify resolution:** Inventory levels increase as sellers list.

---

## High Disputes

**Escalation:** 🔴 Critical

**What happened:** A spike in purchase disputes.

**How to recognize it:** Multiple Purchase records with `transfer_status: disputed`. AdminAlerts of type `new_dispute`.

**Where to go:** Admin Command Center → Issue Feed / Admin Alert Center.

**What to check:**
1. Are disputes concentrated on one seller? (Seller reliability issue.)
2. Are disputes concentrated on one event? (Transfer window issue.)
3. Are disputes concentrated on one ticketing platform? (Platform-specific issue.)
4. Is there a fraud pattern? (Check `fraud_risk_score` and AI flags.)
5. Is the AI verification failing to catch bad proofs?

**Actions to take:**
1. Identify the common factor (seller, event, platform).
2. If one seller: suspend their listings, investigate.
3. If one event/platform: check transfer window status, communicate to users.
4. If fraud: ban offending users, strengthen verification.
5. If AI is failing: review and adjust the `verifyTransferProof` function.
6. Respond to all Stripe disputes before deadlines.

**What NOT to do:**
- Don't ignore a dispute spike — it indicates a systemic problem.
- Don't fight all disputes — some may be legitimate.

**Verify resolution:** Dispute rate returns to normal.

---

## Low Conversion

**Escalation:** 🟡 Medium

**What happened:** Users are browsing but not purchasing.

**How to recognize it:** High event views, low purchase count. Flash Drop metrics show high views, low entries.

**Where to go:** Admin Command Center → Flash Drop Metrics Panel. Transaction Analytics.

**What to check:**
1. Are listings priced too high? (Check Pricing Strategy Analyzer.)
2. Is the transfer window closed, discouraging buyers?
3. Are listings showing `transfer_unconfirmed`?
4. Is the checkout flow working? (Test it yourself.)
5. Are there eligibility gates blocking purchases (location, existing ticket)?
6. Flash Drop metrics — `loser_upgrade_clicks` and `loser_purchases` — are non-winners converting?

**Actions to take:**
- Suggest price adjustments to sellers.
- Surface transfer confidence (verified badges).
- Remove unnecessary eligibility gates if possible.
- Improve the buyer UX if checkout is confusing.

**What NOT to do:**
- Don't lower prices for sellers without their consent.

**Verify resolution:** Conversion rate improves.

---

## High Cancellation Rate

**Escalation:** 🟠 High

**What happened:** Many purchases are being cancelled.

**How to recognize it:** High count of cancelled purchases. `repeated_cancellation` in PointsActivity (negative points).

**Where to go:** Admin Command Center → Transaction Analytics. Purchase entity.

**What to check:**
1. Who is cancelling — buyers or sellers?
2. Common reasons — are they payment failures, transfer failures, or buyer's remorse?
3. Is there a pattern with specific events, sellers, or ticketing platforms?
4. Are cancellations happening after payment capture (critical) or before?

**Actions to take:**
- If sellers are cancelling after payment: this is critical — investigate for fraud or reliability issues.
- If buyers are cancelling: check if the checkout flow is misleading.
- If payment capture failures are causing cancellations: fix the Stripe issue.
- Penalize repeat cancellers via the points system (`repeated_cancellation` action).

**What NOT to do:**
- Don't allow sellers to cancel post-payment without consequences.
- Don't let cancellations happen without seller notification.

**Verify resolution:** Cancellation rate drops to normal levels.

---

# MOBILE

## App Won't Load

**Escalation:** 🔴 Critical

**What happened:** The app shows a blank screen or fails to load.

**How to recognize it:** Users report a white screen, or the preview shows nothing.

**Where to go:** Base44 dashboard → check app status and deployment. Browser console for errors.

**What to check:**
1. Is the Base44 platform up? (Check app.base44.com status.)
2. Are there JavaScript errors in the console?
3. Is the auth provider loading indefinitely? (Check AuthContext.)
4. Are there missing imports or build errors?
5. Is the database accessible?

**Actions to take:**
1. Check the Base44 dashboard for deployment issues.
2. If there's a build error: fix the code and redeploy.
3. If the database is down: contact Base44 support.
4. If auth is hanging: check the AuthContext and login flow.
5. Communicate to users if the outage is prolonged.

**What NOT to do:**
- Don't make code changes in a panic without understanding the error.

**Verify resolution:** App loads normally for all users.

---

## Light Mode Issue

**Escalation:** 🟢 Low

**What happened:** Something looks wrong in light mode.

**How to recognize it:** Visual bugs only in light mode (colors, contrast, backgrounds).

**Where to go:** Toggle to light mode in the app (theme toggle in profile/settings).

**What to check:**
1. Are CSS tokens (`:root` values in `index.css`) correct for light mode?
2. Are components using hardcoded colors instead of tokens?
3. Are the light-mode utility overrides in `index.css` applied correctly?
4. Is `prefers-color-scheme` being respected?

**Actions to take:**
- Identify the affected component.
- Replace hardcoded colors with token-based classes (`bg-background`, `text-foreground`, etc.).
- Test in both light and dark mode.
- Ensure frosted/glass elements use the light-mode overrides (white overlays, not colored tints).

**What NOT to do:**
- Don't use neon/glow effects in light mode — they should be subdued.
- Don't use radial gradients in light mode backgrounds.

**Verify resolution:** Light mode looks clean and premium.

---

## Dark Mode Issue

**Escalation:** 🟢 Low

**What happened:** Something looks wrong in dark mode.

**How to recognize it:** Visual bugs only in dark mode.

**Where to go:** Toggle to dark mode.

**What to check:**
1. Are the `.dark` CSS tokens correct?
2. Are neon colors and glows rendering correctly?
3. Is the `rave-bg` background applied?

**Actions to take:**
- Identify the affected component.
- Ensure dark-mode-specific styles are in the dark scope.
- Test.

**What NOT to do:**
- Don't break dark mode to fix a light mode issue (or vice versa).

**Verify resolution:** Dark mode looks correct.

---

## Navigation Issue

**Escalation:** 🟡 Medium

**What happened:** Users can't navigate to a page, or the wrong page loads.

**How to recognize it:** 404 errors, broken links, or tabs not working.

**Where to go:** Check `App.jsx` for route definitions. Check the Layout component for nav links.

**What to check:**
1. Is the route defined in `App.jsx`?
2. Is the component imported correctly?
3. Are lazy-loaded routes failing? (Check the Suspense fallback / RouteFallback.)
4. Are bottom nav links pointing to the right paths?
5. Is the page transition (AnimatePresence) causing issues?

**Actions to take:**
- If a route is missing: add it to `App.jsx`.
- If a lazy import fails: check the file path and export.
- If transitions are causing issues: check the `pageTransitions.js` logic.
- For "Event not found" errors: ensure the `syncTMEvent` fallback works (check EventNavigationLog entity for diagnostics).

**What NOT to do:**
- Don't remove routes without checking for broken links.

**Verify resolution:** All navigation works smoothly.

---

## Notifications Not Arriving

**Escalation:** 🟡 Medium

**What happened:** In-app or push notifications aren't being delivered.

**How to recognize it:** Users report not seeing notifications, or the bell icon shows no unread items.

**Where to go:** Admin panel → Notification entity. OneSignal dashboard. Check `sendUserNotification` and `sendNotificationEmail` functions.

**What to check:**
1. Are Notification records being created? (Check the entity.)
2. Are they marked `read: false`?
3. Is the `user_email` matching the user's auth email?
4. For push: is OneSignal working? (See "Push notifications not working.")
5. Is the notification bell in the Layout showing the count?

**Actions to take:**
- If notifications aren't being created: check the `sendUserNotification` and `recordNotification` functions.
- If they're created but not showing: check the Layout's notification polling (every 60s).
- If push isn't working: check OneSignal.
- For email notifications: check `sendNotificationEmail` and the `SendEmail` integration.

**What NOT to do:**
- Don't create notifications without going through the proper functions.

**Verify resolution:** Users receive and see notifications.

---

## Location Permissions

**Escalation:** 🟡 Medium

**What happened:** The app can't access the user's location.

**How to recognize it:** "Location access blocked" or "Couldn't detect location" messages. Events/Upgrades "Near Me" doesn't work.

**Where to go:** Check the `useLocationDetect` hook and `LocationAutocomplete` component.

**What to check:**
1. Did the user deny location permission?
2. Is the browser/OS location service enabled?
3. Is the page served over HTTPS? (Geolocation requires HTTPS.)
4. Is the `useLocationDetect` hook handling errors correctly?

**Actions to take:**
- If denied: tell the user to enable location in device settings, or use "Enter City" as a fallback.
- If not HTTPS: ensure the app is served over HTTPS.
- If the hook is erroring: check the error handling.

**What NOT to do:**
- Don't force location — always provide a city search fallback.

**Verify resolution:** Users can use "Near Me" or fall back to city search.

---

## Camera Permissions

**Escalation:** 🟢 Low

**What happened:** The app can't access the camera (for photo uploads in Fan Zone or proof uploads).

**How to recognize it:** Photo upload fails, or the camera doesn't open.

**Where to go:** Check the file upload components in Fan Zone and CreateListing.

**What to check:**
1. Did the user deny camera permission?
2. Is the upload using `<input type="file" accept="image/*">`? (This should work on mobile.)
3. Is the `UploadFile` integration working?

**Actions to take:**
- If denied: tell the user to enable camera access in settings.
- If the upload flow is broken: check the file input and `UploadFile` call.

**What NOT to do:**
- Don't request camera access unnecessarily.

**Verify resolution:** Users can upload photos.

---

# LAUNCH OPERATIONS

## Daily Founder Checklist

**Run every morning:**

- [ ] **Admin Command Center** (`/admin`): Check the Command Summary Bar for anomalies.
- [ ] **Admin Alert Center**: Review all unresolved alerts. Triage Critical/High first.
- [ ] **Issue Feed**: Check for new issues (failed transfers, disputes, stuck listings).
- [ ] **Stripe Panel**: Verify Stripe is in `live` mode. Check for failed captures, failed webhooks.
- [ ] **Marketplace Health**: Check for stuck/duplicate/stale listings. Clear stale reservations.
- [ ] **Review Queue**: Approve or reject all pending listing reviews.
- [ ] **AI Verification Queue**: Review any `needs_human_review` items.
- [ ] **Instant Ops**: Fulfill any `awaiting_pg_transfer` purchases ASAP.
- [ ] **Transfer Intelligence**: Check for transfer failures or patterns.
- [ ] **Stripe Dashboard**: Check for new disputes — respond within deadline.
- [ ] **OneSignal**: Verify push notifications are being delivered.
- [ ] **Fan Zone**: Quick check for spam or inappropriate content.
- [ ] **Events**: Ensure upcoming events are syncing and have correct data.

---

## Weekly Founder Checklist

**Run every week:**

- [ ] **Transfer Intelligence**: Review transfer success rates by platform. Identify trends.
- [ ] **Donation Ops**: Review flash drop metrics. Are non-winners converting to upgrades?
- [ ] **Seller Reliability**: Identify sellers with declining reliability. Take action.
- [ ] **Pricing Strategy**: Review the Pricing Strategy Analyzer. Are listings priced competitively?
- [ ] **Fee Simulator**: Model fee scenarios if considering pricing changes.
- [ ] **Analytics Review**: Check sales, conversion, cancellation rates for trends.
- [ ] **Beta Feedback**: Review BetaFeedbackEvent and BetaFeedback records. Address common complaints.
- [ ] **Bug Reports**: Review BugReport and QAChecklistItem records. Prioritize fixes.
- [ ] **Stale Data Cleanup**: Run `cleanupStaleDonations`. Check for expired listings/donations.
- [ ] **User Issues**: Review any unresolved user complaints from the week.
- [ ] **Stripe Reconciliation**: Verify all payouts were successful. Check for failed transfers.
- [ ] **Event Data Quality**: Spot-check events for wrong venues, dates, or missing coordinates.

---

## Monthly Founder Checklist

**Run every month:**

- [ ] **Full Platform Audit**: Walk through every user flow as a buyer and seller.
- [ ] **Revenue Review**: Compare monthly revenue, fees collected, payouts made.
- [ ] **Dispute Analysis**: Review all disputes from the month. Identify root causes.
- [ ] **Fraud Review**: Review all `confirmed_fraud` and `rejected_suspicious` cases.
- [ ] **AI Verification Review**: Assess AI accuracy. Are false positives/negatives common?
- [ ] **User Growth**: Track user signups, active users, retention.
- [ ] **Inventory Health**: Track listing volume, SeatInventory utilization.
- [ ] **Community Health**: Review Fan Zone engagement, follow activity, bucket list usage.
- [ ] **External Service Review**: Review Stripe, OneSignal, Ticketmaster API usage and costs.
- [ ] **Automation Review**: Verify all scheduled automations are active and running correctly.
- [ ] **Documentation Update**: Update this runbook with any new scenarios encountered.
- [ ] **Security Review**: Review admin access, user bans, suspicious activity.

---

## Launch Day Checklist

**Before launch:**

- [ ] **Stripe**: Verify LIVE mode. Verify webhook endpoint. Verify `STRIPE_WEBHOOK_SECRET`.
- [ ] **Secrets**: Verify all secrets are set (Stripe live keys, OneSignal, Ticketmaster).
- [ ] **Events**: Seed key launch events. Verify dates, venues, coordinates, transfer windows.
- [ ] **Listings**: Seed demo listings for liquidity if needed (`seedDemoListings`).
- [ ] **Automations**: Verify all scheduled automations are active (transfer reminders, alerts, stale donation cleanup).
- [ ] **Admin Access**: Verify your admin account works. Verify the Command Center loads.
- [ ] **Test Purchase**: Complete a test purchase end-to-end (in test mode if pre-launch, or a small live purchase).
- [ ] **Test Payout**: Verify seller onboarding and payout flow.
- [ ] **Notifications**: Send a test push notification.
- [ ] **Mobile**: Test on iOS and Android, light and dark mode.
- [ ] **Fan Zone**: Seed a few posts so it's not empty on day one.
- [ ] **Monitoring**: Have the Admin Command Center open on a second screen.

**During launch:**

- [ ] Monitor the Admin Command Center continuously.
- [ ] Watch for Critical alerts — respond immediately.
- [ ] Watch for Stripe webhook failures.
- [ ] Watch for transfer failures — intervene quickly.
- [ ] Be ready to fulfill instant purchases.
- [ ] Watch for disputes — respond within Stripe deadlines.
- [ ] Monitor Fan Zone for spam/inappropriate content.

**After launch (first 24 hours):**

- [ ] Review all purchases for correctness.
- [ ] Verify all payouts are processing.
- [ ] Address all open alerts.
- [ ] Collect and categorize user feedback.
- [ ] Document any issues encountered for the runbook.

---

## Live Event Checklist

**Before the event goes live:**

- [ ] Verify event `status` transitions to `live` at the right time.
- [ ] Verify `transfer_window_status` is correct.
- [ ] Prepare demo/venue upgrade listings.
- [ ] Set `upgrade_window_opens_at` and `upgrade_window_closes_at`.
- [ ] Verify location coordinates are set for the venue.
- [ ] Notify eligible users about upgrades (if applicable).
- [ ] Have the Live Upgrade Control Panel ready.
- [ ] Have the Instant Ops panel ready for fulfillment.

**During the live event:**

- [ ] Monitor the Live Upgrade Control Panel.
- [ ] Release demo upgrades on schedule (`releaseDemoUpgrades`).
- [ ] Monitor upgrade purchases — fulfill instantly.
- [ ] Monitor Flash Drops — ensure winners are selected.
- [ ] Watch for location verification issues.
- [ ] Monitor Fan Zone for live event posts.
- [ ] Be ready to handle disputes quickly.

---

## End-of-Event Checklist

**After the event ends:**

- [ ] Verify event `status` transitions to `ended`.
- [ ] Close upgrade windows (`upgrade_window_closes_at`).
- [ ] Hide all remaining upgrade listings. Release SeatInventory.
- [ ] Ensure all instant purchases are fulfilled.
- [ ] Run `cleanupStaleDonations` to clean up any remaining donations.
- [ ] Review TransferOutcome data for the event — how did transfers go?
- [ ] Award points for completed transactions (`awardPoints`).
- [ ] Collect Fan Zone posts from the event for social proof.
- [ ] Document any issues for future events.

---

# SUPPORT

## When Should the Founder Personally Intervene?

**Intervene immediately (Founder handles directly):**

- 🔴 Any Critical escalation (revenue loss, payment failures, security, duplicate sales, data corruption).
- 🔴 Stripe outage or webhook failure.
- 🔴 Fraud attack or large influx of disputes.
- 🔴 Major bug after launch that blocks core flows.
- 🔴 Database or platform outage.
- 🔴 Ban/restore user decisions.

**Intervene within 1 hour (Founder oversees):**

- 🟠 Transfer failures that the automation can't resolve.
- 🟠 Seller onboarding failures for key sellers.
- 🟠 Disputes requiring evidence submission to Stripe.
- 🟠 High-priority user complaints (e.g., "I paid but got no tickets").

**Delegate to support (Founder reviews later):**

- 🟡 Fan Zone moderation (spam, inappropriate content).
- 🟡 Listing review queue (batch daily).
- 🟡 AI verification queue (batch daily).
- 🟡 Notification issues.
- 🟡 UI bugs (non-blocking).

**Can wait (address in next sprint):**

- 🟢 Cosmetic issues.
- 🟢 Feature requests.
- 🟢 Low-priority bug reports.

---

## When Should Support Respond?

**Respond immediately:**

- Any user reporting payment issues ("I was charged twice," "payment failed," "I didn't get tickets").
- Any user reporting a listing vanished mid-purchase.
- Any harassment or safety report.

**Respond within 24 hours:**

- Listing questions (how to edit, why is mine hidden).
- Fan Zone questions.
- Profile/account questions.
- General "how do I..." questions.

**Respond within 48 hours:**

- Feature requests.
- Bug reports (non-critical).
- Feedback/suggestions.

---

## What Issues Can Wait?

- Cosmetic/UI issues (unless they block a core flow).
- Feature requests.
- Non-critical bug reports.
- Analytics trends (review weekly, don't need real-time response).
- Documentation updates.

---

## What Issues Require Immediate Action?

- Any payment or money-related issue (charges, refunds, payouts, disputes).
- Any security issue (fraud, unauthorized access, data breach).
- Any issue affecting multiple users (outage, broken core flow).
- Any Stripe webhook failure.
- Any duplicate sale or data corruption.
- Any legal/compliance issue (harassment, banned user appeal).