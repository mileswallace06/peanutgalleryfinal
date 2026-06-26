# ESCALATION MATRIX + DECISION TREES + EMERGENCY PLAYBOOK

---

## ESCALATION MATRIX

### Critical (Immediate Response)

| Scenario | Section |
|----------|---------|
| Buyer was charged twice | PURCHASES |
| Duplicate listing reported | MARKETPLACE |
| Purchase disputed | PURCHASES |
| Payment capture failed | PURCHASES / STRIPE |
| Seller never transferred | PURCHASES |
| Webhook failure | STRIPE |
| Live/Test mode confusion | STRIPE |
| Stripe outage | STRIPE |
| Dispute received (Stripe) | STRIPE |
| High disputes (spike) | ANALYTICS |
| Ban user | USERS |
| Fraud attack | EMERGENCY PLAYBOOK |
| App won't load | MOBILE |
| Data corruption | EMERGENCY PLAYBOOK |

### High (Within 1 Hour)

| Scenario | Section |
|----------|---------|
| A listing disappeared | MARKETPLACE |
| A listing is stuck | MARKETPLACE |
| Incorrect seat information | MARKETPLACE |
| Buyer says payment failed | PURCHASES |
| Buyer cannot purchase | PURCHASES |
| Buyer says listing vanished | PURCHASES |
| Purchase stuck in pending transfer | PURCHASES |
| Purchase refunded | PURCHASES |
| Buyer says tickets never arrived | PURCHASES |
| Seller transferred but buyer won't confirm | PURCHASES |
| PaymentIntent expired | PURCHASES |
| Seller onboarding failed | STRIPE |
| Seller cannot receive payouts | STRIPE |
| Refund failed | STRIPE |
| Transfer failed | STRIPE |
| Payout failed | STRIPE |
| User reports harassment | FAN ZONE |
| Winner not selected | FLASH DROPS |
| Winner never accepted | FLASH DROPS |
| SeatInventory issue | FLASH DROPS |
| Seller reliability issue | USERS |
| High cancellation rate | ANALYTICS |
| Live Upgrade controls (during event) | ADMIN |
| Wrong date | EVENTS |
| Transfer window incorrect | EVENTS |
| Upgrade window incorrect | EVENTS |

### Medium (Within 24 Hours)

| Scenario | Section |
|----------|---------|
| A listing won't appear | MARKETPLACE |
| A listing won't sell | MARKETPLACE |
| A listing expired | MARKETPLACE |
| A listing was rejected | MARKETPLACE |
| AI rejected a listing | MARKETPLACE |
| Pricing dispute | MARKETPLACE |
| Buyer abandoned checkout | PURCHASES |
| Buyer confirmed incorrectly | PURCHASES |
| Posts won't load | FAN ZONE |
| Images won't upload | FAN ZONE |
| Post moderation | FAN ZONE |
| Delete inappropriate content | FAN ZONE |
| Spam account | FAN ZONE |
| Community reports | FAN ZONE |
| Donation expired | FLASH DROPS |
| Reroll occurred | FLASH DROPS |
| No eligible users | FLASH DROPS |
| Location verification failed | FLASH DROPS |
| Admin alerts (medium priority) | ADMIN |
| Review queue | ADMIN |
| AI verification queue | ADMIN |
| Transfer Intelligence | ADMIN |
| Market Health | ADMIN |
| Donations | ADMIN |
| Event missing | EVENTS |
| Wrong venue | EVENTS |
| Location coordinates missing | EVENTS |
| Ticketmaster sync issues | EVENTS |
| Account issue | USERS |
| Email verification | USERS |
| Push notifications not working | USERS |
| Trust score issue | USERS |
| Sales dropped | ANALYTICS |
| No listings | ANALYTICS |
| Low inventory | ANALYTICS |
| Low conversion | ANALYTICS |
| Navigation issue | MOBILE |
| Notifications not arriving | MOBILE |
| Location permissions | MOBILE |
| Restore user | USERS |

### Low (Next Sprint)

| Scenario | Section |
|----------|---------|
| A listing sold (normal flow) | MARKETPLACE |
| A listing was rejected (communication) | MARKETPLACE |
| A seller wants to edit a listing | MARKETPLACE |
| A seller wants to remove a listing | MARKETPLACE |
| A listing expired (normal) | MARKETPLACE |
| Purchase completed (normal flow) | PURCHASES |
| Bucket List issue | FAN ZONE |
| Follow system issue | FAN ZONE |
| Fee Simulator | ADMIN |
| Profile issue | USERS |
| Points issue | USERS |
| Light mode issue | MOBILE |
| Dark mode issue | MOBILE |
| Camera permissions | MOBILE |

---

## DECISION TREES

### Buyer Says They Never Received Tickets

```
Buyer says tickets never arrived
↓
Was seller_confirmed = true?
├── NO → Has seller_r2 reminder been sent?
│        ├── NO → Wait for reminder automation / trigger processTransferReminders
│        └── YES → Contact seller directly. Set 24h deadline.
│                  ↓
│                  Seller responds within 24h?
│                  ├── YES → Seller confirms transfer → Ask buyer to check email/spam
│                  │         ↓
│                  │         Buyer finds tickets?
│                  │         ├── YES → Buyer confirms receipt → Purchase complete
│                  │         └── NO → Request transfer_proof_url from seller
│                  └── NO → Cancel purchase, refund buyer, notify seller
│                           → Flag seller reliability → Create AdminAlert
└── YES → Is there transfer_proof_url?
         ├── NO → Request proof from seller. Set 48h deadline.
         │        ↓
         │        Proof provided?
         │        ├── YES → Run verifyTransferProof (AI)
         │        └── NO → Cancel purchase, refund buyer, flag seller
         └── YES → Run verifyTransferProof (AI) / review manually
                   ↓
                   AI verdict?
                   ├── verified_high/medium_confidence → Ask buyer to recheck email/spam
                   │   ↓
                   │   Buyer finds tickets?
                   │   ├── YES → Buyer confirms → Purchase complete
                   │   └── NO → Admin reviews proof manually
                   │       ↓
                   │       Proof valid?
                   │       ├── YES → Admin completes purchase → Notify buyer
                   │       └── NO → Refund buyer, flag seller for fraud
                   ├── needs_human_review → Admin reviews proof
                   │   ↓
                   │   (same branch as above)
                   └── rejected_suspicious → Flag for fraud investigation
                       ↓
                       Fraud confirmed?
                       ├── YES → Ban seller, refund buyer, create AdminAlert
                       └── NO → Override AI (adminOverrideAIVerification: approved)
```

### Listing Won't Appear

```
Listing won't appear in marketplace
↓
What is the listing status?
├── pending_payout_setup → Seller hasn't completed Stripe onboarding
│   → Direct seller to /sell to complete onboarding
├── pending_verification → Proof is awaiting review
│   → Go to Review Queue → Approve or reject
├── hidden → Check hidden_reason
│   ├── transfer_disabled → Transfer was reported unavailable
│   │   → Ask seller to re-verify transfer capability
│   ├── admin_disabled → Another admin disabled it
│   │   → Check who and why
│   ├── expired_verification → 45-min window passed
│   │   → Seller needs to re-verify
│   └── sold → It was sold (expected)
├── sold → It was sold (expected)
├── cancelled → It was cancelled
├── expired → It expired
├── active but not showing → Check reservation_expires_at
│   ├── Reservation active → Someone is mid-purchase (wait 10 min)
│   └── No reservation → Check SeatInventory lock
│       ├── Locked → Release via syncInventoryOnListingChange or manually
│       └── Not locked → Check transfer_status
│           ├── transfer_disabled/transfer_expired → Listing is hidden (correct)
│           └── transfer_unconfirmed/confirmed → Investigate data issue
└── active and showing → Issue resolved / not reproducible
```

### Payment Failed at Checkout

```
Buyer says payment failed at checkout
↓
Does a Purchase record exist?
├── NO → Payment was never initiated. Buyer can retry.
│   → Check if listing is still available / reserved
└── YES → Check payment_captured
    ├── NO → Check payment_capture_failed
    │   ├── TRUE → Payment capture failed
    │   │   → Check Stripe PaymentIntent status
    │   │   ├── requires_capture → Retry capturePayment function
    │   │   ├── canceled/expired → See "PaymentIntent expired"
    │   │   └── failed → Card declined / fraud block
    │   │       → Contact buyer to use different card
    │   │       → Release reservation via releaseReservation
    │   └── FALSE → Payment is still processing
    │       → Wait and recheck
    └── YES → Payment was actually captured
        → Buyer may not have received confirmation
        → Check if notification was sent
        → Direct buyer to /my-tickets
```

### Stripe Webhook Failure

```
Stripe webhook failure detected
↓
Check Stripe dashboard → Developers → Webhooks → Recent deliveries
↓
Are deliveries failing?
├── NO → Webhook may be working. Check function logs for processing errors.
│   → Fix code if needed → Replay any missed events
└── YES → What's the failure reason?
    ├── 404 / Endpoint not found → Webhook URL is wrong
    │   → Update endpoint URL in Stripe to point to stripeWebhook function
    ├── 401 / Signature mismatch → STRIPE_WEBHOOK_SECRET is wrong
    │   → Update secret in app secrets → Update in Stripe
    ├── 500 / Server error → Function code is erroring
    │   → Check function logs → Fix code → Redeploy → Replay events
    └── Timeout → Function is too slow
        → Optimize function → Redeploy → Replay events

After fixing:
→ Replay all failed deliveries from Stripe dashboard
→ Check all pending purchases for state inconsistencies
→ Verify purchase states match Stripe payment states
```

### Seller Onboarding Failed

```
Seller can't complete Stripe Connect onboarding
↓
Run diagnoseSeller(seller_email)
↓
What does the diagnosis show?
├── No Stripe account → onboardSeller function didn't create one
│   → Retry onboardSeller function
├── Account exists but incomplete → Seller didn't finish onboarding
│   ├── Missing bank account → Direct seller to Stripe dashboard
│   ├── Identity not verified → Seller needs to complete KYC
│   └── Business info incomplete → Seller needs to fill in details
├── Account is restricted → Stripe flagged it
│   → Check Stripe dashboard for restriction reason
│   → Seller may need to provide additional documentation
├── Account is rejected → Stripe rejected the account
│   → Seller cannot use Stripe (may be in a restricted industry/country)
│   → Explore alternative or remove seller
└── Function error → onboardSeller or checkSellerOnboarding is failing
    → Check function logs → Fix → Retry

After resolution:
→ Verify account is active via checkSellerOnboarding
→ Move listings from pending_payout_setup to active
→ Notify seller they can now list and sell
```

### Dispute Received from Stripe

```
Stripe dispute received
↓
Create AdminAlert (type: new_dispute, priority: critical) if not auto-created
↓
Review evidence:
- Purchase transfer_proof_url
- Purchase ai_proof_status / ai_confidence_score / ai_flags
- TransferOutcome.transfer_successful
- BetaTransferLog audit trail
- Communication between buyer and seller
↓
Who is at fault?
├── Seller (no transfer / fake proof) → Accept the dispute
│   → Refund buyer via Stripe (if not auto-refunded)
│   → Flag seller for reliability/fraud
│   → Do NOT fight the dispute
├── Buyer (false claim, tickets received) → Fight the dispute
│   → Submit evidence to Stripe (proof, AI analysis, timestamps)
│   → Set false_claim_recorded: true on purchase
│   → Set admin_override_status if needed
├── Unclear → Request more info
│   → Contact both parties
│   → Set admin_override_status: escalated
│   → Make a decision before Stripe deadline
└── System error → Investigate
    → Fix the underlying issue
    → Handle based on findings

Before Stripe deadline (7-10 days):
→ Submit evidence or accept dispute
→ Update Purchase record with outcome
→ Mark AdminAlert as resolved
```

---

## FOUNDER EMERGENCY PLAYBOOK

This section covers worst-case scenarios. If any of these happen, follow these steps exactly.

---

### Stripe Outage

**Escalation:** 🔴 Critical

**What happened:** Stripe is down — payments, webhooks, or payouts are failing broadly.

**Step-by-step response:**

1. **Confirm:** Check status.stripe.com for an active incident.
2. **Assess scope:** Are all payments failing, or just some? Check the Stripe Panel in the Admin Command Center.
3. **Stop new transactions:** If possible, communicate to users that payments are temporarily unavailable. The app should fail gracefully (show errors, not crash).
4. **Do NOT:**
   - Manually process any payments.
   - Mark purchases as paid.
   - Promise users their payment will go through.
5. **Preserve state:** Do not change any Purchase records. Let them stay in their current state.
6. **Monitor:** Watch the Stripe status page and the webhook delivery queue.
7. **When Stripe recovers:**
   - Replay any failed webhook deliveries from the Stripe dashboard.
   - Retry any failed captures via the `capturePayment` function.
   - Check all pending purchases for state inconsistencies.
   - Verify payouts resume for completed transactions.
8. **Communicate:** Notify users once payments are restored. Offer support for anyone affected.
9. **Document:** Record the incident, timeline, and impact for post-mortem.

---

### Ticketmaster Outage

**Escalation:** 🟡 Medium (🟠 High during live events)

**What happened:** The Ticketmaster API is down — events can't be synced, TM links may not work.

**Step-by-step response:**

1. **Confirm:** Check if the Ticketmaster API is responding. Run `getTicketmasterEvents` or `tmSuggest` to test.
2. **Assess impact:** Are events missing? Are TM links broken? Can users still find events that are already in the DB?
3. **Existing data:** Events already synced to the DB will still appear. The outage only affects new event discovery and TM link resolution.
4. **Do NOT:**
   - Hammer the Ticketmaster API with retries (you'll get rate-limited even after recovery).
   - Manually create event records unless absolutely necessary.
5. **Communicate:** If users report missing events, explain that event discovery is temporarily limited.
6. **When Ticketmaster recovers:**
   - Trigger a sync for any events that were missed.
   - Verify TM links are working.
   - Check for any events that were synced incorrectly during the outage.
7. **Monitor:** Watch for 429 (rate limit) errors after recovery — stagger your syncs.

---

### Database Outage

**Escalation:** 🔴 Critical

**What happened:** The Base44 database is down — nothing loads, all entity calls fail.

**Step-by-step response:**

1. **Confirm:** Check if the Base44 platform is up (app.base44.com). Try loading the app and the Admin Command Center.
2. **Assess scope:** Is it all entities or specific ones? Are reads failing, writes failing, or both?
3. **Do NOT:**
   - Make code changes in a panic.
   - Tell users their data is lost (it's likely not).
4. **Check Base44 status:** Look for platform status updates. Contact Base44 support if needed.
5. **Communicate:** If the outage is prolonged, communicate to users that the app is temporarily unavailable.
6. **Preserve state:** Don't attempt workarounds. Wait for the database to recover.
7. **When the database recovers:**
   - Verify all data is intact.
   - Check for any partially-written records (especially Purchases and Listings in intermediate states).
   - Re-run any automations that may have missed their schedule (transfer reminders, stale donation cleanup).
   - Check for any reservations that expired during the outage — release them.
   - Verify Stripe webhooks were processed (replay any missed ones).
8. **Post-mortem:** Document the incident and any data inconsistencies found.

---

### OneSignal Outage

**Escalation:** 🟡 Medium

**What happened:** OneSignal is down — push notifications aren't being delivered.

**Step-by-step response:**

1. **Confirm:** Check onesignal.com status. Try sending a test notification.
2. **Assess scope:** Are all notifications failing, or just push? (Email notifications use the `SendEmail` integration, which is separate.)
3. **Impact:** Users won't receive push notifications (purchase confirmations, transfer reminders, donation wins). In-app notifications (the bell icon) will still work since they're database-driven.
4. **Do NOT:**
   - Spam users with notifications once OneSignal recovers.
   - Switch to email-only notifications without cause.
5. **Workaround:** Critical notifications (like donation win accept/decline) have in-app UI components that will still work. Ensure users check the app.
6. **When OneSignal recovers:**
   - Do NOT replay all missed notifications — only send critical ones that are still relevant.
   - Verify new notifications are delivering.
7. **Monitor:** Watch notification open rates after recovery.

---

### Large Influx of Disputes

**Escalation:** 🔴 Critical

**What happened:** A sudden spike in disputes — could indicate fraud, a systemic issue, or a coordinated attack.

**Step-by-step response:**

1. **Assess the scale:** How many disputes? Over what time period? Check the Admin Alert Center and Stripe dashboard.
2. **Identify the common factor:**
   - Same seller? → Likely a fraudulent seller. Suspend all their listings immediately.
   - Same event? → Transfer window or event-specific issue. Check transfer status.
   - Same ticketing platform? → Platform-specific transfer issue.
   - Different sellers/events? → Could be a broader issue or coordinated attack.
3. **Stop the bleeding:**
   - If one seller: hide all their listings, ban if fraud is confirmed.
   - If one event: check transfer window status, hide affected listings.
   - If systemic: consider pausing new purchases temporarily.
4. **Review evidence:** For each dispute, check transfer proof, AI verification, and communication logs.
5. **Respond to Stripe:** Submit evidence or accept disputes before deadlines. Prioritize by deadline order.
6. **Communicate:** If many users are affected, post a status update. Offer support.
7. **Investigate root cause:** Was it an AI verification failure? A transfer window detection failure? A fraud ring?
8. **Fix the root cause:** Once identified, fix the underlying issue (improve AI, fix transfer detection, add fraud checks).
9. **Document:** Record the incident, all affected purchases, and actions taken.

---

### Fraud Attack

**Escalation:** 🔴 Critical

**What happened:** Coordinated fraud — fake listings, stolen tickets, chargeback fraud, or account takeover.

**Step-by-step response:**

1. **Identify the pattern:**
   - Multiple listings from one seller with similar characteristics?
   - Listings with high `fraud_risk_score` or AI flags?
   - Purchases where `ai_proof_status` = `rejected_suspicious`?
   - Users with multiple `false_claim_recorded` flags?
2. **Contain immediately:**
   - Hide all suspicious listings (status: `hidden`, hidden_reason: `admin_disabled`).
   - Freeze affected purchases (don't release payouts).
   - Ban confirmed fraudulent users.
3. **Investigate:**
   - Review all AI flags and fraud risk scores.
   - Check TransferOutcome records — were transfers actually successful?
   - Check BetaTransferLog for the audit trail.
   - Look for connections between accounts (same IP, same device, similar emails).
4. **Protect users:**
   - Refund any buyers who were defrauded.
   - Notify affected buyers and sellers.
   - Set `admin_override_status: marked_fraudulent` on confirmed fraud purchases.
5. **Strengthen defenses:**
   - Review the `verifyTransferProof` AI function — did it miss something?
   - Add additional fraud checks if needed.
   - Improve the `fraud_risk_score` calculation if it was too lenient.
6. **Report:** If significant, consider reporting to authorities or Stripe's fraud team.
7. **Document:** Record all fraudulent accounts, listings, purchases, and actions taken.

---

### Viral Traffic Spike

**Escalation:** 🟠 High (🟡 if app handles it gracefully)

**What happened:** A sudden large increase in traffic — could be from a viral post, press coverage, or a major event announcement.

**Step-by-step response:**

1. **Confirm the source:** Where is the traffic coming from? (Check analytics/referrers.)
2. **Assess app health:** Is the app still loading? Are API calls succeeding? Check the Base44 dashboard for performance issues.
3. **Monitor critical flows:** Can users still browse events, view listings, and complete purchases? Watch for rate limiting (Ticketmaster 429s, Stripe rate limits).
4. **Ticketmaster rate limits:** If you're hitting Ticketmaster API limits, the app has caching (`tmCache.js`) that should help. Don't add additional API calls.
5. **Stripe:** Ensure payments are still processing. Watch for webhook delivery delays.
6. **Database:** Watch for slow queries or timeouts. If the Base44 database is struggling, consider contact Base44 support.
7. **Communicate:** If the app is slow, don't panic — users understand viral traffic. If the app is down, communicate.
8. **Capitalize:** Ensure the onboarding flow is smooth for new users. Check that the Sell tab and Fan Zone are welcoming.
9. **After the spike:** Review what worked and what didn't. Consider scaling improvements if spikes are likely to recur.

---

### Venue Issue

**Escalation:** 🟠 High

**What happened:** A venue-specific problem — wrong coordinates, wrong transfer window, or a venue dispute.

**Step-by-step response:**

1. **Identify the venue and affected events:** Search the Event entity by venue name.
2. **Assess the issue:**
   - Wrong coordinates? → Fix `venue_lat` / `venue_lng`.
   - Wrong transfer window? → Manually verify and set `transfer_window_status`.
   - Wrong timezone? → Fix `venue_timezone`.
   - Wrong city/state? → Fix the fields.
3. **Fix all affected events:** If multiple events share the venue, fix them all.
4. **Check downstream impact:**
   - Location-gated listings — do they work now?
   - "Near Me" event discovery — does it find the events?
   - Upgrade listings — do location checks pass?
5. **Communicate:** If users were affected (e.g., couldn't purchase due to location gate), reach out.
6. **Document:** Record the venue and what was wrong for future reference.

---

### Major Bug After Launch

**Escalation:** 🔴 Critical (if it blocks core flows) / 🟠 High (if it's a significant but non-blocking issue)

**Step-by-step response:**

1. **Reproduce:** Can you reproduce the bug? What are the exact steps?
2. **Assess impact:**
   - How many users are affected?
   - Is it blocking purchases, listings, or transfers (Critical)?
   - Is it a broken but non-critical feature (Medium)?
3. **Check for data impact:** Did the bug corrupt any data? Check Purchase, Listing, and SeatInventory records for inconsistencies.
4. **Immediate containment:**
   - If it's causing duplicate charges: pause new purchases immediately.
   - If it's causing data corruption: stop the affected flow.
   - If it's a display issue: it can likely wait for a fix.
5. **Fix:**
   - Identify the root cause in the code.
   - Fix it with a targeted change (don't rewrite large sections in a panic).
   - Test the fix.
   - Deploy.
6. **Verify:** After deploying, verify the fix works in both preview and live.
7. **Clean up:** Fix any data that was corrupted by the bug.
8. **Communicate:** If users were affected, notify them. Offer support or compensation if appropriate.
9. **Post-mortem:** Document the bug, root cause, fix, and how to prevent it in the future. Update this runbook.

---

*This runbook is a living document. Update it every time you encounter a new situation or learn a better way to handle an existing one. Another employee should be able to run Peanut Gallery for a week using only this guide.*

*End of Founder Runbook.*