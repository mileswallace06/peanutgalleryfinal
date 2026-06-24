# PART 8: FOUNDER RESPONSIBILITY CHECKLIST

---

# SECTION 12: FOUNDER RESPONSIBILITY CHECKLIST

## Before Launch

### Stripe & Payments
- [ ] Verify `STRIPELIVESECRETKEY` is a live key (starts with `sk_live_`)
- [ ] Verify `STRIPELIVEPUBLISHABLEKEY` is a live key (starts with `pk_live_`)
- [ ] Register Stripe webhook URL in Stripe dashboard: `https://[app-domain]/api/functions/stripeWebhook`
- [ ] Verify `STRIPE_WEBHOOK_SECRET` matches the webhook signing secret from Stripe dashboard
- [ ] Test end-to-end purchase with real credit card (small amount, e.g. $10 listing)
- [ ] Test seller Stripe onboarding flow end-to-end
- [ ] Test refund/cancellation flow (cancel before capture and after capture)
- [ ] Verify Stripe Connect Express accounts are enabled in Stripe dashboard
- [ ] Remove or disable legacy Stripe secrets (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`) if unused
- [ ] Verify Stripe account is not in test mode

### Domain & Email
- [ ] Standardize on ONE domain (currently mixing `.store`, `.com`, `app.peanutgallery.app`)
- [ ] Verify `experience@peanutgallery.store` inbox exists and is monitored (admin alerts go here)
- [ ] Verify email deliverability (SPF/DKIM records configured)
- [ ] Update all hardcoded URLs to correct, consistent domain
- [ ] Verify `app.peanutgallery.app` and `app.peanutgallery.store` — pick one
- [ ] Test email delivery (send test email from backend function)

### OneSignal (Push Notifications)
- [ ] Verify OneSignal app is production (not test)
- [ ] Verify `ONESIGNAL_REST_API_KEY` is valid and not expired
- [ ] Configure correct domain in OneSignal dashboard as allowed origin
- [ ] Test push notification delivery to a real device
- [ ] Verify push works on both iOS and Android

### Ticketmaster API
- [ ] Verify `Ticketmaster_consumer_key` is valid
- [ ] Monitor TM API rate limits (Ticketmaster enforces limits)
- [ ] Test event search and sync

### Legal
- [ ] Legal review of Terms of Service (`/terms`)
- [ ] Legal review of Privacy Policy (`/privacy`)
- [ ] Verify GDPR/CCPA compliance
- [ ] Verify state ticket resale law compliance (price caps, disclosure requirements)
- [ ] Establish content moderation policy for Fan Zone
- [ ] Review data retention policies

### Data & Security
- [ ] Add RLS to entities missing it:
  - [ ] SeatDonation (add owner + admin RLS)
  - [ ] DonationOptIn (add owner + admin RLS)
  - [ ] TransferReport (add owner + admin RLS)
  - [ ] BetaFeedback (add admin-only RLS)
  - [ ] Follow (add owner + admin RLS)
  - [ ] BucketListItem (add owner + admin RLS)
  - [ ] QAChecklistItem (add admin-only RLS)
  - [ ] BugReport (add admin-only RLS)
- [ ] Add admin role check to routes without it:
  - [ ] `/founder`
  - [ ] `/beta-dashboard`
  - [ ] `/beta-testers`
  - [ ] `/beta-checklist`
- [ ] Add admin check to `diagnoseSeller` function (currently no admin gate — security issue)
- [ ] Verify User notification preference fields (`notif_listing_sold`, `notif_transfer_updates`) are in schema
- [ ] Clean up all demo data before launch
- [ ] Set `ALLOW_UNVERIFIED_BETA = false` in `flashDrop` function for production

### Content
- [ ] Verify all educational pages are accurate
- [ ] Review FAQ content
- [ ] Verify fee information is correct (5% buyer, $1 min, $10 min listing price)
- [ ] Verify seller payout information is accurate ("keep 95% of every sale")

### Cleanup
- [ ] Remove deprecated pages (`EventMode`, potentially `AdminMode`)
- [ ] Remove unused components (fulfillment directory, old fee simulator, etc.)
- [ ] Remove markdown documentation files from repo
- [ ] Standardize Base44 SDK version across all backend functions
- [ ] Verify all `npm:stripe` imports use consistent version

---

## Launch Week

### Daily Tasks (Every Day)

- [ ] Monitor admin alerts in Admin Command Center → Alert Center:
  - [ ] Disputes (critical priority — must respond immediately)
  - [ ] Stalled transfers (buyer waiting >30 min for seller)
  - [ ] Expired verifications (listings auto-hidden)
  - [ ] Low confidence listings (score < 30)
  - [ ] Conflicting community reports
- [ ] Review pending listings in Admin Command Center → Review Queue
- [ ] Handle `auto_review_flagged` purchases (buyer inactive 24h after seller confirms):
  - [ ] Investigate: Did the buyer receive tickets?
  - [ ] If yes: Capture payment via admin panel
  - [ ] If no: Open dispute or wait longer
- [ ] Check for stale PaymentIntents (purchases >6 days old — Stripe PI expires at 7 days)
  - [ ] Capture or cancel before expiry
- [ ] Review AI-flagged suspicious proofs (email alerts sent to admin)
  - [ ] Override AI decision if wrong (approve/reject/escalate/mark fraudulent)
- [ ] Monitor Stripe dashboard for:
  - [ ] Failed captures (`payment_capture_failed` flag)
  - [ ] Disputes/chargebacks
  - [ ] Payout failures
- [ ] Check OneSignal delivery rates
- [ ] Monitor email delivery
- [ ] Check for orphaned draft listings (`pending_payout_setup` status)

### As-Needed Tasks

- [ ] Approve/reject pending listings in Review Queue
- [ ] Override AI verification decisions (when AI is wrong)
- [ ] Handle disputes manually (no auto-resolution exists)
- [ ] Capture or cancel stale PaymentIntents before 7-day Stripe expiry
- [ ] Verify Instant Transfer custody proof (manual email-based process — no admin UI exists)
  - [ ] Check database for `status: 'pending_verification'` listings
  - [ ] Verify seller transferred to `experience@peanutgallery.com`
  - [ ] Update listing to `status: 'active'`, `custody_status: 'verified'`
- [ ] Respond to user support emails at `experience@peanutgallery.store`
- [ ] Handle Flash Drop delivery issues (SeatInventory stuck in `claimed_by_winner`)
- [ ] Handle stale donations (check `cleanupStaleDonations` logs)
- [ ] Resolve duplicate event records (check EventNavigationLog)

---

## Monthly Operations

### Recurring Monthly Tasks

- [ ] Review seller reliability scores and trust scores:
  - [ ] Identify sellers with declining reliability
  - [ ] Identify sellers with high false claim counts
  - [ ] Take action on problematic sellers (strike, ban, contact)
- [ ] Audit for point farming or abuse patterns:
  - [ ] Review PointsActivity for unusual patterns
  - [ ] Check for coordinated multi-account transactions
  - [ ] Verify self-purchase blocking is working
- [ ] Review Peanut Points economy balance:
  - [ ] Check if point inflation is occurring
  - [ ] Verify achievement distribution
  - [ ] Consider rank adjustments
- [ ] Clean up orphaned draft listings (`pending_payout_setup` that are >30 days old)
- [ ] Review EventNavigationLog for recurring lookup failures
- [ ] Audit AdminAlert resolution rates:
  - [ ] How many alerts resolved vs unresolved?
  - [ ] Average time to resolution?
  - [ ] Recurring alert types?
- [ ] Review beta feedback and bug reports
- [ ] Update FAQ and educational content if needed
- [ ] Review TM API usage and rate limits
- [ ] Audit Stripe Connect account health:
  - [ ] Check for sellers with restricted accounts
  - [ ] Verify onboarding completion rates
- [ ] Monitor integration credit usage (AI verification uses Claude Sonnet — higher cost)
- [ ] Review database for data integrity issues:
  - [ ] Duplicate events
  - [ ] Orphaned SeatInventory records
  - [ ] Stuck FlashDrop/SeatDonation records
- [ ] Backup critical data (purchases, listings, user accounts)

---

## Venue Acquisition

### Currently Non-Existent — Everything Needs to Be Built

- [ ] Build venue partner onboarding flow (authentication, profile, agreement)
- [ ] Create venue dashboard (inventory management, metrics, notifications)
- [ ] Implement venue payout flow (revenue split, Stripe Connect for venues)
- [ ] Build real geofencing enforcement (server-side validation, venue beacons)
- [ ] Create venue seat maps (interactive diagrams with section-level availability)
- [ ] Implement real venue ticket release (not demo — actual ticket transfer from venue inventory)
- [ ] Build venue notification system (event-specific alerts to venue staff)
- [ ] Create venue analytics (sales metrics, attendance tracking, upgrade conversion rates)
- [ ] Build venue API integration (real-time inventory sync with venue ticketing systems)
- [ ] Create venue partner agreements/contracts (legal)
- [ ] Define venue revenue split model (negotiate percentages)
- [ ] Build venue staff roles and permissions (venue_admin, venue_staff)

---

## Legal & Compliance

### Required Founder Actions

- [ ] Legal review of Terms of Service — ensure enforceable
- [ ] Legal review of Privacy Policy — ensure GDPR/CCPA compliant
- [ ] Verify GDPR compliance (right to access, right to deletion, data portability)
- [ ] Verify CCPA compliance (right to know, right to delete, right to opt-out)
- [ ] Ensure PCI compliance (handled by Stripe, but verify scope)
- [ ] Review state ticket resale laws:
  - [ ] Price caps (some states limit resale markup)
  - [ ] Disclosure requirements (seller identity, seat details)
  - [ ] Licensing requirements (some states require marketplace licenses)
- [ ] Establish dispute resolution policy (timeline, escalation, arbitration)
- [ ] Create content moderation policy for Fan Zone
- [ ] Verify data retention policies (how long to keep purchase records, etc.)
- [ ] Create refund policy (when refunds are issued, timeline)
- [ ] Review AI verification compliance (are AI decisions fair? can sellers appeal?)
- [ ] Verify terms cover Stripe Connect obligations
- [ ] Create vendor agreements (Ticketmaster API terms, OneSignal terms, etc.)
- [ ] Register business entity (if not already done)
- [ ] Obtain necessary business licenses
- [ ] Set up tax collection framework (sales tax on marketplace fees)

---

## Customer Support

### Required Founder Actions

- [ ] Monitor `experience@peanutgallery.store` inbox daily
- [ ] Handle user disputes within 24 hours of alert
- [ ] Process account deletion requests (verify the flow works end-to-end)
- [ ] Handle Stripe capture failure retries (manual Stripe dashboard action)
- [ ] Respond to bug reports (from BetaFeedbackEvent and BugReport entities)
- [ ] Handle refund requests (may need to manually process via Stripe dashboard)
- [ ] Monitor for fraud patterns (review flagged users, suspicious listings)
- [ ] Handle seller onboarding issues (stale accounts, incomplete onboarding)
- [ ] Assist with stuck transfers (buyer/seller not responding)
- [ ] Handle Instant Transfer custody verification (manual email-based process)
- [ ] Resolve duplicate event issues
- [ ] Handle orphaned draft listings
- [ ] Resolve Flash Drop delivery disputes
- [ ] Handle donation winner non-response
- [ ] Answer questions about fees, payouts, and transfer process
- [ ] Create support documentation/knowledge base
- [ ] Set up support ticketing system (currently just email)