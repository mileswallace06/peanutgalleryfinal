# Peanut Gallery — Founder Runbook

**Version 1.0 | Last updated: June 2026**

This is the operational manual for running Peanut Gallery day-to-day. It tells you exactly what to do when real situations occur. No technical knowledge required — just follow the steps.

---

## How to Use This Runbook

1. Find the section that matches your situation.
2. Follow the steps in order.
3. Check the **Escalation Level** at the top of each scenario.
4. If you can't resolve it, go to the **Founder Emergency Playbook**.

### Document Index

| Section | File | Scenarios |
|---------|------|-----------|
| Marketplace | [01-marketplace.md](./docs/runbook/01-marketplace.md) | Listings: won't appear, disappeared, sold, won't sell, stuck, expired, rejected, AI rejected, edit, remove, duplicate, wrong seats, pricing |
| Purchases | [02-purchases.md](./docs/runbook/02-purchases.md) | Payment failed, charged twice, can't purchase, listing vanished, abandoned, stuck transfer, completed, disputed, refunded, no tickets, false confirm, seller no transfer, capture failed, PI expired |
| Stripe + Fan Zone + Flash Drops | [03-stripe-fanzone-flashdrops.md](./docs/runbook/03-stripe-fanzone-flashdrops.md) | Onboarding, payouts, webhooks, refunds, disputes, transfers, capture, payout, live/test, outage. Fan Zone posts, images, moderation, harassment, spam, reports, bucket list, follow. Flash Drops: winner, acceptance, expiry, reroll, eligibility, location, SeatInventory |
| Admin + Events + Users | [04-admin-events-users.md](./docs/runbook/04-admin-events-users.md) | Admin alerts, review queue, AI queue, transfer intel, market health, instant ops, donations, fee sim, live upgrades. Events: missing, duplicate, venue, date, transfer window, upgrade window, coordinates, TM sync. Users: account, email, push, profile, points, trust, reliability, ban, restore |
| Analytics + Mobile + Operations + Support | [05-analytics-mobile-operations-support.md](./docs/runbook/05-analytics-mobile-operations-support.md) | Sales drop, no listings, low inventory, disputes, conversion, cancellation. App won't load, light/dark mode, navigation, notifications, location/camera. Daily/weekly/monthly/launch/live event checklists. Support guidelines |
| Escalation Matrix + Decision Trees + Emergency Playbook | [06-emergency-playbook.md](./docs/runbook/06-emergency-playbook.md) | Full escalation matrix, decision trees for all major workflows, emergency response for Stripe/TM/DB/OneSignal outages, fraud, viral spikes, venue issues, major bugs |

---

### Escalation Levels

| Level | Meaning | Response Time |
|-------|---------|---------------|
| 🔴 **Critical** | Revenue loss, payment failures, security issues, duplicate sales, data corruption | Immediate |
| 🟠 **High** | Transfer failures, disputes, seller onboarding failures | Within 1 hour |
| 🟡 **Medium** | Fan Zone, notifications, UI bugs | Within 24 hours |
| 🟢 **Low** | Cosmetic issues, feature requests | Next sprint |

### Key Locations

| Location | URL / Path |
|----------|------------|
| Admin Command Center | `/admin` |
| Admin (Legacy) | `/admin-legacy` |
| Events | `/events` |
| Upgrades | `/upgrades` |
| Sell Dashboard | `/sell` |
| Fan Zone | `/fan-zone` |
| My Profile | `/me` |
| My Tickets | `/my-tickets` |
| My Sales | `/my-sales` |
| Notifications | `/notifications` |
| Purchase Detail | `/purchase/:id` |
| Event Detail | `/events/:id` |
| Upgrade Hub | `/upgrades/:id` |

### External Services

| Service | What It Does | Where to Check |
|---------|-------------|----------------|
| Stripe | Payments, payouts, webhooks | dashboard.stripe.com |
| OneSignal | Push notifications | onesignal.com |
| Ticketmaster API | Event data, ticket syncing | developer.ticketmaster.com |
| Base44 Platform | Hosting, database, auth | app.base44.com |

---

## QUICK REFERENCE: KEY FUNCTIONS & THEIR PURPOSE

| Function | Purpose | When to Use |
|----------|---------|-------------|
| `capturePayment` | Capture a Stripe payment | When payment capture failed and needs retry |
| `cancelPurchase` | Cancel a purchase and refund | When seller can't fulfill or buyer needs refund |
| `checkSellerOnboarding` | Check Stripe Connect status | When diagnosing seller onboarding issues |
| `diagnoseSeller` | Full seller diagnostics | When onboarding fails or payouts are stuck |
| `onboardSeller` | Create Stripe Connect account | When a seller needs to set up payouts |
| `releaseReservation` | Release a locked listing | When a reservation is stuck or expired |
| `reserveListing` | Reserve a listing for purchase | Handled automatically by checkout |
| `submitListing` | Create a new listing | When a seller creates a listing |
| `approveListingReview` | Approve a listing's proof | When reviewing the queue |
| `rejectListingReview` | Reject a listing's proof | When reviewing the queue |
| `verifyTransferProof` | AI-verify transfer proof | When reviewing transfer screenshots |
| `adminOverrideAIVerification` | Override AI decision | When AI was wrong |
| `processTransferReminders` | Send transfer reminders | Automated — check it's running |
| `processTransferAlerts` | Process transfer-related alerts | Automated — check it's running |
| `recordTransferOutcome` | Record transfer result | Automated after transfers |
| `awardPoints` | Award Peanut Points | When points need manual award |
| `sendUserNotification` | Send in-app + push notification | When notifying users |
| `sendNotificationEmail` | Send email notification | When emailing users |
| `recordNotification` | Create a Notification record | When logging notifications |
| `syncTMEvent` | Sync event from Ticketmaster | When an event is missing |
| `getTicketmasterEvents` | Fetch events from TM API | When syncing events |
| `tmSuggest` / `suggestCities` | Search TM events/cities | When testing TM connectivity |
| `seedDemoListings` | Create demo listings | When seeding marketplace liquidity |
| `releaseDemoUpgrades` | Release demo upgrade listings | During live events |
| `flashDrop` | Manage flash drops | When winner selection fails |
| `seatDonation` | Manage seat donations | When donation issues occur |
| `cleanupStaleDonations` | Clean up expired donations | Automated — check it's running |
| `syncInventoryOnListingChange` | Sync SeatInventory with listings | Automated — check it's running |
| `getStripeKey` / `getStripeMode` | Check Stripe configuration | When diagnosing Stripe issues |
| `checkStripeWebhook` | Verify webhook config | When webhooks fail |
| `deleteAccount` | Delete a user's data | When banning/GDPR compliance |

---

## QUICK REFERENCE: ADMIN PANEL MODULES

| Module | Location | Purpose |
|--------|----------|---------|
| Command Summary Bar | Admin Command Center top | High-level metrics at a glance |
| Admin Alert Center | Admin Command Center | All system-generated alerts |
| Issue Feed | Admin Command Center | Active issues requiring attention |
| Marketplace Health | Admin Command Center | Listing/inventory health |
| Stripe Panel | Admin Command Center | Stripe mode, payments, webhooks |
| Review Queue (PendingReviewQueue) | Admin Command Center | Listings awaiting proof review |
| AI Verification Queue (AIVerificationPanel) | Admin Command Center | AI verification review |
| Transfer Intelligence Panel | Admin Command Center | Transfer analytics and patterns |
| Instant Ops Panel (InstantOpsPanel) | Admin Command Center | Instant listing fulfillment |
| Donation Ops Panel | Admin Command Center | Donations and flash drops |
| Flash Drop Metrics Panel | Admin Command Center | Flash drop performance |
| Fee Simulator (FeeSimulatorV2) | Admin Command Center | Fee modeling |
| Live Upgrade Control Panel | Admin Command Center | Live event upgrade orchestration |
| Transfer Window Admin Panel | Admin Command Center | Manual transfer window overrides |
| Pricing Strategy Analyzer | Admin Command Center | Pricing recommendations |
| Fulfillment Queue | Admin Command Center | Instant fulfillment queue |

---

*This runbook is a living document. Update it every time you encounter a new situation or learn a better way to handle an existing one. Another employee should be able to run Peanut Gallery for a week using only this guide.*