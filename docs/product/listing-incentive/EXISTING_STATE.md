# Existing-source findings — listing incentive

Source f4172e4578c1cd92610ffc932c39529d4418aed3, read September 28, 2026. This is a repository audit, not a fresh production data inspection.

- `base44/shared/points.ts` defines instant_listing_verified (+40) and first_instant_listing (+100). Neither action has a production caller in the inspected repository's listing submission/review paths. The first-instant achievement has bonus 0, so invoking the +40 action does not automatically add +100.
- `base44/functions/submitListing/entry.ts` and `base44/functions/approveListingReview/entry.ts` have no listing-points call. Existing earning calls concern purchases/sales, quick transfer/confirmation, and donations.
- Points currently display balance, ranks, achievements and leaderboard and affect weighted donation-draw odds (`seatDonation` and `cleanupStaleDonations`). No reward-catalog, spend, fee-discount or redemption implementation was found. Points are not a guaranteed financial or partner benefit.
- Rank descriptions in `src/lib/peanutPoints.js`, displayed by `src/components/points/PeanutPointsCard.jsx`, promise review priority/support/visibility/recognition beyond the operational enforcement found. These promises need a separate truthfulness pass before promoting them as incentives.
- Reusing instant_listing_verified for ordinary resale would increment total_instant_listings, alter computed trust and unlock instant-specific milestones. Use a separate reward program instead of relabeling this action.
- Current points helper checks listing existence and legacy seller_email, not authoritative ListingPrivate ownership, independently reviewed proof or demo eligibility. Its dedup and balance/ledger writes are separate. It is not an atomic once-per-person reward claim system.
- `submitListing` can set proof_status=approved without independent ownership review. Therefore the incentive must not treat that flag by itself as verified reward eligibility.
- `src/pages/CreateListing.jsx` distinguishes payout drafts, pending Instant custody and ordinary submission. Reward copy must preserve those states; a saved form is not a reward-eligible live listing.

No code, role, secret, permission, reward balance, payment logic, grant or production data changed. These findings constrain the new incentive integration and do not claim a full security audit.
