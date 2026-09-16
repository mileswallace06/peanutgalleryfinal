# Peanut Gallery launch-readiness audit — 2026-09-16

## Executive verdict

Peanut Gallery is **not launch-ready yet**. This audit found and repaired a meaningful set of source-level safety and dead-end defects, but four release gates remain open:

1. The purchase-protection authority layer is not fully installed or attached to the application.
2. The provider-neutral listing flow is designed and implemented behind a hard-off flag, but proof custody, migration, and recovery prerequisites are not complete.
3. Nationwide event/location behavior has been corrected in source, but existing data still needs a timezone/location backfill and the deployed app needs multi-market runtime verification.
4. Authenticated flows have not yet been exercised end-to-end in the installed TestFlight build.

Maintenance should remain on until the purchase-protection gates in this report are closed.

## What was actually audited

| Evidence layer | Coverage | Result / limit |
| --- | --- | --- |
| Source routes | Every explicit route, shared navigation, major sheet/modal, and backend action referenced by the routed UI | Complete static inventory |
| Controls | Buttons, links, form submits, nested click targets, loading/error branches, and obvious route targets | Complete static pass; several defects repaired |
| Automated behavior | Existing suites plus focused checkout, event-time, Ticketmaster, location, public-route, and journey contracts | Focused suites pass on the repair branch; final combined result recorded before delivery |
| Live guest app | Login, signup, reset, and direct public/legal URLs | Guest shell checked; Base44 currently intercepts all direct URLs with login |
| Authenticated web app | Source and contract coverage only | No safe authenticated browser session was available for a complete runtime walk-through |
| Installed TestFlight app | Not yet tested with this branch | Required after merge and Base44 publication; a local preview is not accepted as phone verification |
| Payments and provider transfers | No real purchase, payout, refund, dispute, or third-party transfer was executed | Production/customer money and tickets were intentionally untouched |

This is therefore a full **source/control landscape audit plus live guest audit**, not a claim that every authenticated action has already worked on a physical phone.

### Route inventory (32 declared paths plus wildcard fallback)

| Surface | Routes | Audit disposition |
| --- | --- | --- |
| Root / fallback | `/`, wildcard | Root redirects to Events for authenticated users; unknown authenticated routes render a real not-found screen |
| Public/legal | `/terms`, `/privacy`, `/cookies`, `/our-story` | React branches and Privacy retry are repaired; Base44 server interception still blocks a true logged-out guarantee |
| Discovery | `/events`, `/events/:id`, `/events/tm/:tmId` | Card target, ended-state, provider refetch, time/venue, and listing error paths repaired; phone/runtime test still required |
| Purchase | `/purchase/:id` | Cancel/dispute recovery repaired; participant-safe read coverage still needs full authority deployment proof |
| Seller | `/sell`, `/create-listing`, `/my-sales` | Loading/error/draft destinations repaired; provider-neutral intake remains hard-disabled pending prerequisites |
| Buyer inventory | `/my-tickets` | Terminal records excluded and transfer upload recovery repaired; physical transfer journey still untested |
| Live upgrade | `/upgrades`, `/upgrades/:id`, `/event-mode/:id` | Incorrect promises removed; server geofence and Flash Drop atomicity remain open |
| Community | `/fan-zone`, `/leaderboard` | Fresh-location denial now fails closed; remaining notification/community destinations covered by focused repairs |
| Account | `/me`, `/account-settings`, `/edit-persona`, `/notifications` | Trust labels and email handoffs repaired; account/notification safety is reviewed separately below |
| Education | `/instant-listings`, `/seller-payout-guide`, `/why-peanut-gallery` | Unsupported worldwide, zero-risk, guaranteed-delivery, and escrow claims removed |
| Admin/beta | `/admin`, `/admin-legacy`, `/beta-qa`, `/founder`, `/beta-checklist`, `/beta-testers`, `/beta-dashboard` | Hardcoded password and storage bypass removed; UI now fails closed on unresolved/errored auth, while backend RLS remains authoritative |

The route count does not mean 32 independent products are complete. It means every explicit destination is accounted for and its remaining gate is named.

## Delivery ladder

The states below must not be collapsed into one another:

| State | Meaning |
| --- | --- |
| Source repaired | Code and tests exist locally |
| GitHub branch | Work is durable and reviewable remotely |
| Main merged | Base44 can synchronize the change |
| Base44 published | The published web app serves the synchronized revision |
| TestFlight verified | The installed wrapper shows and exercises that published revision on the phone |

None of today’s repairs should be described as “on the app” until the last two states are confirmed.

## Landscape audit

### Repaired in the launch-readiness branch

- Checkout now fails closed for disabled, unknown, or low-confidence transfer methods. A buyer acknowledgment is required in both UI and backend, preserved in private purchase evidence, and rechecked after payment authorization.
- Checkout initialization failures expose retry instead of spinning forever, and post-authorization confirmation is awaited before navigation.
- Seller listing, ticket attestation, Ticketmaster listing setup, purchase cancellation/dispute, and Stripe onboarding actions recover from errors instead of leaving permanent loading states.
- Draft-listing success now returns to the screen that actually displays drafts.
- Current-ticket selection excludes cancelled, expired, refunded, transfer-expired, and disputed records.
- Nested upgrade controls no longer cause duplicate navigation.
- Flash Drops now require an authoritative active listing or completed purchase, approved public/private proof, confirmed safe electronic transfer, matching owner/event/section, and no quarantine or reservation. Raw proof URLs and caller-supplied delivery roles are rejected. Only the donor or a verified admin can close a drop; entrants only poll for the result.
- Donation, transfer-proof, dispute, and Stripe-onboarding sheets recover from failures, fit short phone viewports, and expose reachable close/retry/success states.
- Account removal now reads a complete fail-closed snapshot, blocks unresolved payment/transfer/listing/dispute/custody obligations, retains and pseudonymizes transaction evidence, and no longer falsely claims that the Base44 login identity is deleted.
- Notification actions allow only known internal routes and deduplicate read writes; the Community Impact destination now opens the real Leaderboard route.
- The hardcoded client admin password and session-storage bypass were removed. Admin/beta screens wait for successful, completed Base44 authentication with the exact admin role before rendering or fetching records.
- Customer and operator copy no longer calls Stripe authorization a bank escrow account or promises zero risk, worldwide availability, guaranteed delivery, instant payout, or absolute fraud prevention.
- Public/legal React routing and a visible Privacy Policy failure/retry state were added. Base44’s server-side authentication interception still requires a platform-level decision.
- Near Me now asks for current location instead of silently reusing an old market after travel. Fan Zone fails closed when current location cannot be obtained.
- Ticketmaster synchronization now accepts only a bounded provider ID from the phone and refetches authoritative event data on the backend.
- Provider cancellations, reschedules, canonical UTC start/end, IANA timezone, coordinates, address, postal code, and country fields are preserved.
- Event formatting rejects ambiguous legacy local timestamps instead of interpreting them in the viewer’s device timezone.

### Open product blockers

These are not all equal. The first group blocks a safe marketplace launch; the second group blocks the requested “every button/no dead ends” assurance.

#### Marketplace safety blockers

- The authority database bootstrap committed 9 of 17 migrations, then stopped with SQLSTATE `42501`. The migration ledger must identify the next statement; the package must not be replayed blindly.
- Application runtime identities/secrets, protected stored-function deployment, exclusive-writer proof, Stripe end-to-end evidence, monitoring, and a production canary are still missing.
- Some legacy payment, cleanup, webhook, fulfillment, dispute, and reconciliation writers are not yet proven to use the authority boundary.
- The capture-versus-dispute race and the ten-minute authorization/fulfillment timing contract remain unproven in the deployed system.
- Upgrade eligibility/geofencing is still largely client-enforced and needs a server-side location/eligibility decision.
- Native TestFlight push delivery is not established; the existing implementation is web push.

#### Remaining journey/runtime blockers

- Authenticated buyer, seller, admin, donation, upgrade, dispute, notification, and account-deletion journeys still need a physical-phone matrix after publication.
- Public/legal routes may still be intercepted before React by Base44.
- Nationwide coordinate queries and event pagination require deployed-scale tests; the current implementation is bounded but not yet load-certified.
- Legacy events need canonical timezone/location backfill or explicit manual review.
- ZIP/rural-market search and ambiguous same-name city handling need product-level runtime validation.
- Some actions depend on provider email, transfer links, or delayed ticket release; these cannot be certified with UI-only tests.
- Flash Drop listing-pause/inventory/drop writes and winner locking remain non-transactional under the current Base44 entity model. The new order is fail-closed and leaves partial failures paused for owner review, but it is not atomic.
- Account removal has the same cross-entity transaction/lock limitation. Completed seller accounts remain intentionally blocked until a durable payout-settled fact exists, and the underlying Base44 authentication identity still requires platform support.
- The former client admin password remains in Git history and must be rotated anywhere it was reused; deleting history is not a substitute for rotation.

## Purchase protection: how close are we?

Two percentages are useful because “code exists” and “customer money is protected in production” are different milestones.

| Layer | Estimated completion | Basis |
| --- | ---: | --- |
| Architecture and local implementation | about 80% | Reservation/quarantine logic, transfer-risk gate, private sidecars, authority schema/functions, and extensive simulated concurrency tests exist |
| Operational closure | about 31% | Only the probe identity is provisioned; 9/17 migrations are installed; application roles, deployment, writer attachment, live Stripe proof, monitoring, and canary are outstanding |

### Closure sequence

1. Read the development migration ledger and isolate the exact failed statement after migration 9.
2. Correct the ownership/grant issue without replaying committed migrations.
3. Complete migrations 10–17 and verify independent readback.
4. Provision the three restricted runtime identities and secrets for executor, Stripe recorder, and worker.
5. Deploy the protected functions and attach every money/state writer to them.
6. Prove authorization, cancellation, capture, refund, dispute, expiry, relist prevention, and concurrency against Stripe test mode.
7. Add alerting/operator visibility and run a controlled canary.
8. Only then remove maintenance containment and run a production-readiness decision.

The concept is technically coherent, but the remaining work is the most consequential portion: integration and operational proof.

## Nationwide readiness

The intended scope should currently be described as **United States nationwide**, not worldwide.

### Source contract now in place

- Canonical UTC start and end times plus IANA venue timezone.
- Provider time flags for date/time TBA and provider status/cancellation.
- Venue latitude, longitude, address, city, state, postal code, and country code.
- Device-timezone-independent formatting, including DST transitions.
- Fresh location for explicit Near Me actions.
- National artist search without an implicit Arizona/city radius.
- Bounded coordinate prefilter before client distance calculation.
- Ticketmaster data is refetched by the backend rather than trusted from the phone.

### What prevents an assurance today

- Existing records need a backfill and quarantine/manual review for missing or ambiguous timezones.
- Multi-market fixtures and physical tests are still needed for Pacific, Mountain (including Arizona), Central, Eastern, Alaska, and Hawaii, including DST boundaries.
- Venue geofence enforcement must move to a server decision for security-sensitive upgrades.
- Search scaling, delayed provider ticket release, GPS denial, stale permissions, and cross-state same-name cities require deployed tests.
- The app does not yet claim or implement global regulatory, currency, provider, or location support.

## Provider-neutral listing flow

The critical modeling rule is that **where a ticket was bought** and **where it currently lives** are separate questions. A StubHub, Vivid Seats, SeatGeek, or Gametime purchase may ultimately live in Ticketmaster, AXS, a team/venue account, or another primary ticketing system.

### Intended intake

1. Seller selects the acquisition marketplace.
2. Seller selects the current custodian/app and confirms the ticket is already owned.
3. PG classifies the delivery format and asks for private ownership evidence.
4. Policy produces one of four states:
   - `READY`: official account-to-account transfer is available.
   - `WAITING_FOR_TRANSFER`: owned, but the provider has not enabled Transfer/Share yet; never purchasable.
   - `MANUAL_REVIEW`: supported PDF or unusual provider flow needs human approval.
   - `BLOCKED`: rotating-barcode screenshot, wallet screenshot, scan/photo, password/OTP request, speculative/unowned inventory, physical/will-call/ID-bound ticket, or known nontransferable restriction.
5. Only reviewed `READY` inventory may become `ACTIVE` and reservable.
6. After sale: `RESERVED` → `SOLD_AWAITING_TRANSFER` → `TRANSFER_SENT` → `TRANSFER_ACCEPTED` → `EVENT_PENDING` → `POST_EVENT_HOLD` → `PAID_OUT`, with dispute/cancellation branches that fail closed.

### Provider facts that shape the flow

- Ticketmaster transfer invalidates the sender’s ticket after acceptance; SafeTix uses rotating/device-bound tickets, so screenshots are not a delivery method.
- AXS Transfer/Share can be unavailable until later and an accepted Mobile ID transfer invalidates the sender’s original.
- SeatGeek, Vivid Seats, StubHub, and Gametime often broker a transfer that must be accepted in the original primary-market or venue app.
- Sellers must own the tickets and be able to transfer them. Tickets listed elsewhere at the same time create double-sale risk.

Official references:

- [Ticketmaster Ticket Transfer](https://help.ticketmaster.com/hc/en-us/articles/9786975926673-How-does-Ticket-Transfer-work)
- [Ticketmaster SafeTix](https://business.ticketmaster.com/safetix-encrypted-digital-ticketing/)
- [AXS Transfer / Share](https://support.axs.com/hc/en-us/articles/360031482794-What-is-Transfer-Share)
- [SeatGeek mobile transfer delivery](https://support.seatgeek.com/hc/en-us/articles/360018039394-What-is-mobile-transfer-ticket-delivery)
- [SeatGeek third-party seller responsibilities](https://support.seatgeek.com/hc/en-us/articles/50923330975891-Selling-third-party-tickets-on-SeatGeek-Marketplace-Policies-and-responsibilities)
- [Vivid Seats electronic transfer](https://support.vividseats.com/support/solutions/articles/11000005313-what-is-electronic-transfer-)
- [Vivid Seats listing requirements](https://support.vividseats.com/support/solutions/articles/1000212783-what-are-the-requirements-to-list-my-tickets-for-sale-)

### Scaffold status

A separate provider-neutral scaffold supports Ticketmaster, AXS, SeatGeek, StubHub, Vivid Seats, Gametime, team/venue apps, and an explicit Other path. It is intentionally **hard-disabled** and must not be merged or enabled until:

- private proof scanning/custody is available;
- admin approval cannot create active but undeliverable inventory;
- schema migration and legacy-record classification are defined;
- proof upload and listing submission have durable idempotent recovery;
- Stripe onboarding returns sellers to the suspended draft;
- cross-entity approval has a compensating/fail-closed transaction strategy; and
- deployed provider-policy tests pass.

This establishes the flow without pretending that PG has direct APIs or automated verification partnerships with every marketplace.

## Release gate for today’s repair branch

Before anything reaches the phone:

1. Combined build and focused tests pass after all repair commits are integrated.
2. Branch is pushed and reviewed as a normal PR.
3. Exact merged main SHA is recorded.
4. Base44 synchronization is allowed and the exact synchronized SHA is verified.
5. That exact revision is published to Peanut Gallery Final.
6. The installed TestFlight app is force-closed/reopened and the authenticated phone matrix is run.
7. Any failed money, ticket, or transfer test returns the app to maintenance rather than being waived.

No local preview substitutes for steps 4–6.

## Verification record

| Check | Result |
| --- | --- |
| Production build | Passed |
| Aggregate security runner | 23 of 27 suites passed |
| Supplemental focused runner | 58/58 Node test cases passed |
| Checkout concurrency | 61/61 checks passed |
| Flash Drop policy | 17/17 checks passed |
| Account removal + notification routing | 14/14 checks passed |
| Ticketmaster/time/location/search contracts | Passed, including DST and device-timezone independence |
| Full lint comparison | 39 existing errors on the branch versus 75 on unchanged baseline; no new lint-error class introduced |
| Physical TestFlight matrix | Not run; requires merge, exact-SHA Base44 publication, and the installed phone app |

The aggregate nonzero exit is intentional and remains release-blocking:

1. `freeze-completeness` has a stale maximum of 50 while the repository contains 51 nonempty functions.
2. `listing-status-ownership` references the already-removed `migrateSensitiveData/entry.ts` registry path.
3. `launch-gate` correctly reports that production authority integration is not implemented and concurrent alert uniqueness is unresolved.
4. `concurrent-alert-deduplication` remains the documented datastore limitation.

Payment reconciliation, webhook fail-closed behavior, checkout concurrency, authority adversarial tests, event-time contracts, public/legal routing contracts, and all new hardening tests pass. The red launch gate must not be relabeled green merely to obtain a clean command exit.
