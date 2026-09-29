# Listing-earned benefits — in-house recommendation

September 28, 2026, America/Phoenix. Status: product recommendation and source audit, not implemented or offered to users. Source baseline f4172e4578c1cd92610ffc932c39529d4418aed3. This supersedes the partner-funded pilot: Miles wants rewards delivered by PG until the app is launch-ready. No business was contacted.

## Decision

Make an independently verified native listing earn something the seller can use as a fan, plus tools for reaching their own buyers. The listing need not sell. The primary benefit is a functional entitlement; the larger point award supports it rather than pretending points are money.

Recommended first package: 90 days of advanced event/upgrade watches, a listing sharing kit, and a proposed 200-point first-listing award. These are proposed new capabilities. Existing ordinary search, follows, alerts, ticket access, support and listing controls stay available without earning a perk.

This is a testable acquisition proposition, not evidence that incentives alone solve a market with few buyers. PG can guarantee working software access. It cannot guarantee an upgrade, a sale, attention, or money saved on an external checkout.

## Benefits ranked by practical value

| Benefit | Actual advantage | Value before PG has buyers | Implementation/status |
| --- | --- | --- | --- |
| Advanced watches | Up to five saved combinations of artist/team or venue, city, dates, and—on native listings—quantity, price ceiling and seat tier. Show new matches together instead of repeatedly searching. Optional digest notifications after consent. | Event discovery can use seeded events even when native inventory is small. Seat/price matching needs native listings. | Recommended main perk. Search/follows exist; saved rules, matching, change tracking, entitlement and verified delivery do not. |
| Seller sharing kit | Generate a PG ticket-stub image in story and square formats with public seat/event details and a link/QR targeting the specific listing. Seller can share with their own audience. | Immediately useful once implemented; does not depend on PG supplying traffic. | Recommended first, smaller implementation slice. Export and reliable listing-specific landing behavior need building. No automatic posting or messages. |
| Banked PG buyer-fee credit | Earn a credit from listing; later use it against PG's own fee when buying a different ticket or upgrade. Earning never depends on the original ticket selling. | Real monetary utility later, but depends on eligible native checkout and inventory. No Ticketmaster/affiliate redemption. | Stronger financial follow-up. No credit ledger/redemption exists. Amount, campaign cap and funding/margin limits are deliberately unset pending fee and payment review. |
| Founding contributor styling | A tasteful profile/ticket-wallet mark for the first verified contributors. | Immediate identity/status only. | Optional extra, not the headline. Do not call it a verification or reliability badge. |

Do not present five saved rules as five chances to buy, priority reservations, live external seat availability, or a guarantee of real-time notifications. Everyone can still see and buy eligible inventory as soon as it is public. No inventory withholding or artificial notification delay for ordinary users.

## Earn and retain rules

- First qualifying listing: proposed **100 listing points + 100 first-listing points = 200**, one first bonus per verified seller identity, plus access to the useful package.
- Later qualifying listings: proposed **100 points**, at most three rewarded distinct contributions in any rolling 30 days including the first. Seat splitting, reposting and relisting the same underlying ticket never create another award. The campaign total is also capped before activation.
- Watch access lasts 90 days from the seller choosing to activate the working feature. Do not start the clock while the feature is unavailable. Later qualified listings during access do not stack unlimited years of access; renewal policy can be evaluated after the initial pilot.
- The sharing kit is usable for the qualifying live listing. A withdrawn/sold/expired listing is not advertised as available; exported links must show its current state. Previously earned points/watch access survive an ordinary unsold expiry or honest withdrawal.
- Existing genuine sellers qualify directly; do not force them to delete and repost.
- Approval means authoritative ownership and genuine transferable inventory have been independently checked. A saved form or the current auto-approved proof flag alone does not qualify. Draft, demo, duplicate and pending-custody inventory do not qualify.
- Enrollment requires no purchase, completed sale, successful payout or outside partner. Do not promise cash, funded ticket discounts or free seats.
- Seller identity, deduplication, bounded award count and a durable award/entitlement receipt are required. Do not bolt a valuable reward onto the current separate lookup/update/create points sequence and call it atomic.

The caps are provisional product choices, not proven optimal fraud controls or growth results. Test whether people value the tools before expanding them.

## How listing compares with other actions

| Action | Inspected point value / state | Proposed treatment |
| --- | --- | --- |
| First genuine native listing | Instant listing +40 and first-instant +100 are defined but not wired to submission/review; no ordinary-listing earning flow found. | **200 total + functional package**, regardless of sale. Use a new contribution action rather than the Instant-specific counter. |
| Later genuine native listing | Same gap. | **100**, bounded as above. |
| Completed purchase | +25, production call found. | Keep +25. A listing award is 4 times this; the first is 8 times. |
| Completed sale | +50, production call found. | Keep +50 as an additional fulfillment reward. Listing does not consume the sale reward. |
| Fast transfer / confirmation | Existing timed transaction awards. | Preserve behavior and values; do not reward a mere claim of transfer. |
| Fan Zone post / feedback | +3 / +5 definitions exist; no earning caller found in the inspected paths. | Small recognition when actually implemented. Neither can substitute for a verified listing to earn the package. |
| Profile / payout setup | +40 / +100 definitions; do not assume they currently issue. | Onboarding support, not recurring supply rewards. No valuable entitlement for repeatedly editing a profile. |
| Donation | +150 at creation, first-donor achievement +100, +75 on acceptance, with other milestones/caps. | Preserve greater recognition for actually giving away a ticket. First donation can total 250 before acceptance; do not demote it to make listings look superior. |
| Referral | Defined but explicitly disabled in the backend. | Do not advertise as working or activate during this work. |

These numbers are recommendations, not balance changes. Existing balances affect donation-draw weights, and the Instant-listing action affects trust counters. Before adding listing points, explicitly decide their effect on draws and keep contribution entitlement separate from trust/verification. No draw odds or trust policy is silently changed by this proposal. No retroactive balance reduction.

## Options rejected as the main reward

- **Seller-fee waiver:** source currently computes sellerPayout = subtotal, with a buyer fee of 5% (minimum $1). There is no seller fee to waive in that path. Some seller guides say 95%, a copy/code inconsistency that must be reconciled separately before advertising fees.
- **Boosts alone:** visibility in an empty marketplace is not a meaningful guaranteed benefit. Existing detail pages sort listings by price; promotion enforcement and impression measurement are not present.
- **More chances at donated seats:** conditional inventory and a random outcome cannot supply the promised guaranteed reward. Do not increase odds as an unreviewed side effect of this change.
- **Trusted/Verified Seller rank for uploading:** inventory contribution is not proof of reliable fulfillment. Safety checks and support remain independent of rewards.
- **Exclusive buying windows:** withholding seats makes buyers and sellers wait. Personal matching can improve convenience without locking public inventory.
- **Unbacked priority support or faster review:** requires a staffed service commitment, not just a rank description.

## Minimum implementation order

1. Build and verify the share kit on the current ticket design and a reliable listing-specific destination. Keep proofs, barcodes, seller contact details and identity data out of images/URLs. Use only artwork whose use/export is permitted. Add no global popup or main navigation tab.
2. Deliver advanced saved event watches over the existing discovery sources, then native upgrade rules. Use stable attraction/venue/event IDs, cache/deduplicate searches, respect source availability and timezone-aware event times. No external price-drop claims from broad event price ranges. Match/cancel transitions must avoid stale offers and duplicate notifications.
3. Wire independent qualifying-listing evidence to a bounded durable entitlement. Put status/activation under Me → rewards and the sharing action under My sales. Show one compact Sell explanation. Failure must not claim the benefit was earned or active.
4. Add the proposed listing point actions only after balance, donation-weight and trust boundaries are explicit and the current award consistency gaps are addressed. Compare results with a prior/no-offer cohort where feasible.
5. If monetary value is still needed, hand a precise buyer-fee-credit contract to the separate purchase-security effort. Checkout and capture both recalculate fee expectations; credit is not a safe UI-only patch. Seller payout, external-provider terms, processing costs, refunds and credit restoration need coordinated treatment.

No feature is advertised until its useful behavior works through the actual app, including mobile. For watch notifications, browser SDK presence does not prove delivery in TestFlight. A working in-app matches view can be the first truthful delivery surface; do not claim push before testing it.

## Evidence map

- Rewards: `base44/shared/points.ts`, `src/lib/peanutPoints.js`, `src/components/points/PeanutPointsCard.jsx`, `base44/functions/capturePayment/entry.ts`, `base44/functions/seatDonation/entry.ts`, `base44/functions/cleanupStaleDonations/entry.ts`.
- Fees: `src/lib/feeEngine.js`, `base44/shared/checkoutOrchestrator.js`, `base44/shared/captureOrchestrator.js`. Conflicting copy: `src/pages/SellerPayoutGuide.jsx`, `src/pages/WhyPeanutGallery.jsx`.
- Discovery: `src/components/fanzone/BucketListSheet.jsx`, `BucketListSearch.jsx`, `src/lib/eventSearchRequest.js`, `src/pages/Events.jsx`, `src/lib/upgradeDiscovery.js`.
- Alerts: `src/components/account/NotificationsSection.jsx` contains preference switches; no corresponding discovery matcher/producer found. `base44/shared/notifications.ts` provides transactional/review infrastructure. `src/lib/oneSignal.js` is a web SDK wrapper.
- Sharing/destinations: `src/pages/MySales.jsx`, `src/components/events/ListingCard.jsx`, `src/App.jsx`. No complete listing share/export/QR path found.
- Market cross-check: SeatGeek describes Smart Pricing as a seller utility and explicitly does not guarantee a sale: https://support.seatgeek.com/hc/en-us/articles/50928255187603-What-is-Smart-Pricing . This supports the distinction between useful tooling and guaranteed outcomes; it does not establish PG's proposed package as unique or effective.

## Session result and next action

Completed: moved the proposal fully in-house, compared actual earning/fee/discovery code, selected practical perks, designed a stronger listing hierarchy, and documented implementation boundaries. Partner outreach remains unsent and on hold. No application source, balances, credentials, payment logic, production data, deployment or publishing changed. No tests were run for this documentation-only task.

Next building step: implement the seller sharing kit and its accurate listing destination, then the advanced watches. The existing rebrand follow-up remains separately preserved; this research does not certify all screens or purchase security, and adds no launch-readiness percentage.
