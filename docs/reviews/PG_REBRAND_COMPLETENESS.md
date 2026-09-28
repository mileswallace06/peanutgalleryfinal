# PG complete route and state audit — September 27–28, 2026

## Delivery status

The approved Fan Zone/Upgrades/accessibility branch **merged successfully after a delayed Base44 operation**. Main is `4c0856fdef8a2dc41cbd63df1b1e767dd1826de7` with parents `dee12087` and `2d3adeab`; its complete tree exactly matches the approved source. GitHub independently confirmed the merge. Base44 subsequently confirmed “Your app is published and live online!” at approximately 03:21 UTC on September 28 (20:21 Arizona on September 27), targeting `peanutgallery.store`. The live login page rendered normally. Its version-history Live link still points to older commit `e3c77b08ea585ecc9743163473807c5028b2b6f8`; therefore the served Main SHA is not independently established by that history link. Direct inspection of the public script asset was blocked by the browser. Physical TestFlight verification remains open.

Earlier Base44 error/stuck states and the failed GitHub fallback (HTTP 403) did not represent the final merge result. No third merge attempt was issued.

Approved source: `2d3adeab9601c9f64fbc2f7bc8a0f14958c1dbcb`, branch `codex/pg-fanzone-posting-20260927`.

This additional audit/correction is isolated on `codex/pg-rebrand-completeness-20260927`, based on that approved source. It is not in Base44, Main or TestFlight.

## Scope and findings

All **37 route patterns**, including the redirect and not-found route, were reviewed from source along with their reachable imported panels. This is complete source coverage, **not certification that every conditional state has been rendered on a phone**. Nested surfaces are enumerated in the four focused reports linked below.

Confirmed gaps corrected: legacy guide/leaderboard shell; mismatched account/dispute/deletion/donation surfaces; legacy listing/checkout/Fan Gifts/bucket-list chrome; standalone public/auth/legal/fallback shells; all seven admin/founder/beta route families. The five main-page layouts, event photography, copy, timing/query behavior and purchase-security implementation are preserved.

## Route matrix

“Baseline opened” refers to the existing reviewed branch or published app, before these additional local corrections. Updated-source visual rendering remains pending.

| Route | Source entry | Baseline browser coverage this pass | Updated source |
| --- | --- | --- | --- |
| `/` | `Home` | Public landing opened | Reviewed |
| `/login` | `BrandedAuth` | Opened | Reviewed |
| `/register` | `BrandedAuth` | Opened | Reviewed |
| `/forgot-password` | `BrandedAuth` | Opened | Reviewed |
| `/reset-password` | `ResetPasswordRoute` | Opened; reset without token | Reviewed |
| `/terms` | `TermsOfService` | Opened | Reviewed |
| `/privacy` | `PrivacyPolicy` | Opened | Reviewed |
| `/cookies` | `CookiePolicy` | Opened | Reviewed |
| `/our-story` | `OurStory` | Opened | Reviewed |
| `/events` | `Events` | Reviewed branch/earlier phone-preview evidence; not re-certified here | Reviewed |
| `/events/:id` | `EventDetail` | Source only; requires data/state or isolated fixture | Reviewed |
| `/purchase/:id` | `PurchaseSuccess` | Source only; requires data/state or isolated fixture | Reviewed |
| `/admin` | `AdminCommandCenter` | Source only; administrative actions not exercised | Reviewed |
| `/admin-legacy` | `AdminMode` | Source only; administrative actions not exercised | Reviewed |
| `/my-sales` | `MySales` | Opened; wallet/sales/notifications empty states | Reviewed |
| `/my-tickets` | `MyTickets` | Opened; wallet/sales/notifications empty states | Reviewed |
| `/create-listing` | `CreateListing` | Opened; listing only step 1 | Reviewed |
| `/fan-zone` | `FanZone` | Reviewed branch/earlier phone-preview evidence; not re-certified here | Reviewed |
| `/me` | `Me` | Reviewed branch/earlier phone-preview evidence; not re-certified here | Reviewed |
| `/upgrades` | `Upgrades` | Reviewed branch/earlier phone-preview evidence; not re-certified here | Reviewed |
| `/upgrades/:id` | `EventDetailUpgrade` | Source only; requires data/state or isolated fixture | Reviewed |
| `/sell` | `Sell` | Reviewed branch/earlier phone-preview evidence; not re-certified here | Reviewed |
| `/events/tm/:tmId` | `EventDetailTM` | Source only; requires data/state or isolated fixture | Reviewed |
| `/account-settings` | `AccountSettingsPage` | Earlier reviewed dark/light appearance evidence; later preview stalled | Reviewed |
| `/edit-persona` | `EditPersona` | Opened | Reviewed |
| `/beta-qa` | `BetaQA` | Source only; administrative actions not exercised | Reviewed |
| `/instant-listings` | `InstantListingsGuide` | Opened | Reviewed |
| `/seller-payout-guide` | `SellerPayoutGuide` | Opened | Reviewed |
| `/why-peanut-gallery` | `WhyPeanutGallery` | Opened | Reviewed |
| `/leaderboard` | `Leaderboard` | Opened | Reviewed |
| `/founder` | `FounderDashboard` | Source only; administrative actions not exercised | Reviewed |
| `/beta-checklist` | `FounderBetaChecklist` | Source only; administrative actions not exercised | Reviewed |
| `/beta-testers` | `BetaRecruitment` | Source only; administrative actions not exercised | Reviewed |
| `/beta-dashboard` | `BetaDashboard` | Source only; administrative actions not exercised | Reviewed |
| `/notifications` | `Notifications` | Opened; wallet/sales/notifications empty states | Reviewed |
| `/event-mode/:id` | `EventMode` | Source only; redirects, no enduring screen | Reviewed |
| `*` | `PageNotFound` | Source only; requires data/state or isolated fixture | Reviewed |

## Nested-screen inventories

- [Member/account/purchase/donation](pg-rebrand-member-20260927.md)
- [Public/auth/legal/onboarding/fallback](pg-rebrand-public-20260927.md)
- [Event/detail/checkout/Fan Gifts/community](pg-rebrand-details-20260927.md)
- [Operations/admin/founder/beta](pg-rebrand-operations-20260927.md)

These distinguish reachable surfaces from unused files. Orphan components were not made into new app screens.

## Verification

Validation results are recorded in `rebrand-evidence/verification.json` and `rebrand-evidence/behavior-preservation.json`. The behavior comparison checks the syntax of every existing JSX event handler and base44/Stripe/fetch call in changed files against the approved baseline. It does not prove end-to-end functionality or replace phone rendering. The only field/link-attribute differences found during the pass were presentation refactors to PageIntro’s equivalent backTo link and explicit type=button on onboarding progress controls.

No auth guards, backend code, secrets, payment execution, data mutations, worker settings, schema, maintenance settings, or production deployment are changed by this correction.

## Remaining verification before claiming “no mismatches”

1. Confirm the newly published Fan Zone composer and compact Upgrades intro on the phone; the merge and publication action are complete, while the stale version-history link leaves exact live-code attribution unresolved.
2. Import/push the separate completeness branch and review its new appearance in a usable browser preview at narrow and standard phone widths, both themes and with the keyboard open.
3. Render the source-only states with isolated fixtures: populated purchase/sale/wallet states, transfer/dispute outcomes, donation outcomes, auth/approval errors, Fan Gifts eligibility/create/winner states, and all admin panels. Do not create real purchases or records to generate screenshots.
4. Recheck the five main pages for regressions and then review/merge/publish the completeness branch. Confirm the resulting app on the physical TestFlight build.

The Base44 preview intermittently stalled and returned 502 errors. A fresh Main page followed by in-app navigation recovered it: the merged New post composer was opened and verified without submitting, after publication. The separate completeness branch is not yet uploaded/rendered. The earlier local cloud-browser preview was unavailable. These limitations are kept open rather than reported as visual passes. The `/founder` route is specifically unsafe to mount for a read-only audit because an existing health panel can create an AdminAlert from an effect; source/fixture verification is required.

## Session record

- Date: September 27 Arizona / September 28 UTC.
- Goal: publish the reviewed fixes, then cover every reachable PG screen with the approved ticket/neon identity.
- Accomplished: full route and nested-source inventory, isolated presentation corrections, safe baseline inspections, preservation verification and saved delivery package.
- Merge/publication: completed; Base44 acknowledged publication. Main exactly matches the approved tree. Exact served-code and physical-phone confirmation remain open.
- Not accomplished: updated completeness-source full visual sign-off.
- Next session: confirm the phone received the approved fixes; import the completeness branch and visually verify its affected secondary screens. Purchase-security work remains owned by the separate session.
