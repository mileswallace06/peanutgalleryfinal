# PG first-listing pilot — review proposal, September 28, 2026

**SUPERSEDED / ON HOLD:** Miles directed on September 28 that incentives remain in-house until the app is launch-ready. No outreach was sent. The current recommendation is [IN_APP_REWARDS.md](IN_APP_REWARDS.md); the historical proposal below is retained for context and is not an active next action.

Status: PREPARATION ONLY. No offer activated, partner agreement, credit balance, reward grant, code issuance, outreach, app change or publication. Branch: codex/listing-incentive-pilot-20260928. Source inspected: f4172e4578c1cd92610ffc932c39529d4418aed3.

## Outcome

A seller receives a guaranteed, usable benefit for a genuine approved listing even if nobody buys the ticket. The reward must have value before PG develops a large buyer audience. More Peanut Points alone does not currently meet that standard.

## Recommended first offer

Propose a capped 25-person local pilot with one merchant-funded item per eligible seller. Example for negotiation: one standard scoop or one specified nonalcoholic drink, with no additional purchase. This is an ask, not an existing offer. The merchant must confirm the exact item, locations, total available redemptions, expiry and any restrictions before it is advertised.

PG has no upfront spend, reimbursement obligation, retainer, minimum sales commitment or inventory purchase. A merchant asking for those terms is outside this proposal. The merchant's benefit is limited, trackable customer visits and clearly disclosed placement in the offer; PG must not promise audience size, purchases or traffic it cannot prove. Partner willingness is untested.

Existing affiliate/Ticketmaster pages can remain useful event discovery. The qualifying listing is native PG inventory. A saved event or external purchase link is not a ticket listing.

## Pilot rules

1. One reward per eligible existing verified seller identity for this campaign, rather than one per ticket, seat, event, listing ID or email alias. The identity mapping must be implemented and checked before launch.
2. A native listing is reward-eligible only after independent ticket/ownership review, supported transfer eligibility, accurate event/seat details, and genuine availability are established. Existing `proof_status=approved` alone is insufficient: ordinary submission can set it automatically.
3. Include standard resale and upgrades only where their respective delivery and venue requirements are verified. Drafts, pending custody, rejected, ended, test/demo, fabricated and duplicate inventory do not qualify. A seller must be able to receive payout through the existing supported flow.
4. No purchase, buyer, sale or completed payout is required to earn the reward. A legitimate listing that remains unsold qualifies. Once earned, ordinary expiry or honest withdrawal does not revoke the benefit. Suspected fraud gets a documented review rather than silent balance changes.
5. No arbitrary public claim of 'unreasonable price' as an eligibility rule. Publish any price constraint before enrollment, or use targeted human review of evidently non-genuine offers.
6. When the listing is approved and published, reserve and issue one already-funded partner redemption using an atomic once-per-seller claim. Only advertise available stock. The partner's funding and redeemable supply must exist before the campaign opens.
7. Existing sellers with a currently qualifying listing should be reviewed directly; do not require deletion/relisting to join. Relisting and splitting seats never produce a second reward.
8. After issue, the benefit is independent of ticket sale. Display the actual partner restrictions and expiry before listing. Do not call a purchase-required discount a free item.

## Small UI footprint

- Sell: one compact entry below the main listing action, visible only for an active funded campaign with inventory. State the exact benefit, conditions and no-sale requirement. No additional navigation tab or popup on every page.
- Listing confirmation: distinguish submitted/draft, verification pending and reward earned. Never display 'earned' merely because a form saved.
- My sales: show the existing listing's reward review status and a clear reason/action if more evidence is needed.
- Me: a small My rewards disclosure containing the issued benefit, partner, eligible location, expiry and redemption instructions. Keep this separate from Peanut Points and donation draws.
- Campaign full: remove new-enrollment promises without hiding already-earned rewards.

Offer-copy structure for later use, only after a partner agrees: List your first eligible ticket and receive [confirmed item] at [confirmed partner]. Your listing must be verified and available on PG. Your ticket does not need to sell. [Actual campaign limit, participating locations and expiry.]

## Fulfillment and data

Use the simplest auditable private one-use code process the merchant can support for 25 redemptions. The app must not expose the full code pool. Codes must not depend on sharing ticket barcodes, identity documents, account credentials or private seller data with the merchant. Share only aggregate campaign results unless separately authorized.

A future financial-credit alternative needs a real redemption mechanism, margin analysis and funded liability cap. The current points system does not implement those. Do not advertise a $5 credit, cash value or fee discount from a points balance today, and do not assume PG can discount an affiliate's external checkout.

## Acceptance checks before activation

- Eligible listing + zero sales earns exactly one funded reward.
- Successful sale is not consulted as an earning requirement; a legitimate sale before review must not penalize the seller.
- Concurrent submissions, retry, replay, split seats, alternative listing IDs and republishing cannot earn twice.
- Draft, self-approved/unreviewed proof, demo, expired or duplicate inventory cannot consume campaign stock.
- A crash between claim and code issue can resume without losing a benefit or assigning a second code.
- Stock cannot go negative; capacity changes do not invalidate issued rewards.
- Ordinary unsold expiry leaves the earned reward intact.
- Seller cannot read another seller's code or the merchant's pool.
- Redemption works once and produces a usable confirmation; earned/redemption failure states are understandable.
- Mobile card/disclosure fits PG's current design at 320px and 390px, both themes.

These checks are requirements, NOT passing test results. No runtime integration was implemented in this preparation pass.

## Pilot measurement

Track invitations, completed submissions, independently approved unique listings, issued rewards, redemption rate, withdrawal/duplicate/fraud rate and founder minutes per approved listing. Native ticket sales are a secondary outcome, not an eligibility condition. Compare results with a clearly labeled prior/no-offer cohort if feasible; a 25-person result is directional, not proof of causation or scale.

## Next action

Secure one concrete benefit and its redemption terms. Partner outreach is drafted separately and has NOT been sent. Once the reward is funded, implement the independent listing-reward claim/fulfillment flow; do not route this through the existing non-atomic points helper or purchase checkout.

The visual branch remains separately preserved. Its payout-guide and Upgrades-dialog repairs are rendered verified; populated isolated states, narrow/light theme and physical TestFlight remain open. No further broad visual redesign is needed to prepare this pilot.
