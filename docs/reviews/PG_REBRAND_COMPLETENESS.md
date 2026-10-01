# PG complete route and state audit — September 27–28, 2026

## Delivery status

The approved Fan Zone/Upgrades/accessibility branch **merged successfully after a delayed Base44 operation**. Main is `4c0856fdef8a2dc41cbd63df1b1e767dd1826de7` with parents `dee12087` and `2d3adeab`; its complete tree exactly matches the approved source. GitHub independently confirmed the merge. Base44 subsequently confirmed “Your app is published and live online!” at approximately 03:21 UTC on September 28 (20:21 Arizona on September 27), targeting `peanutgallery.store`. The live login page rendered normally. Its version-history Live link still points to older commit `e3c77b08ea585ecc9743163473807c5028b2b6f8`; therefore the served Main SHA is not independently established by that history link. Direct inspection of the public script asset was blocked by the browser. Physical TestFlight verification remains open.

Earlier Base44 error/stuck states and the failed GitHub fallback (HTTP 403) did not represent the final merge result. No third merge attempt was issued.

Approved source: `2d3adeab9601c9f64fbc2f7bc8a0f14958c1dbcb`, branch `codex/pg-fanzone-posting-20260927`.

This additional audit/correction is isolated on `codex/pg-rebrand-completeness-20260927`, based on that approved source. The uploaded revision `6f3f505d6cf495e6e0bc469f13da6b1869d21d40` is now imported into Base44 as its own preview branch. It is not merged into Main or published to TestFlight. The September 28 follow-up fixes below are local until the next upload.

## Scope and findings

All **37 route patterns**, including the redirect and not-found route, were reviewed from source along with their reachable imported panels. This is complete source coverage, **not certification that every conditional state has been rendered on a phone**. Nested surfaces are enumerated in the four focused reports linked below.

Confirmed gaps corrected: legacy guide/leaderboard shell; mismatched account/dispute/deletion/donation surfaces; legacy listing/checkout/Fan Gifts/bucket-list chrome; standalone public/auth/legal/fallback shells; all seven admin/founder/beta route families. The five main-page layouts, event photography, copy, timing/query behavior and purchase-security implementation are preserved.

## Route matrix

“Baseline opened” refers to the existing reviewed branch or published app, before these additional local corrections. The historical baseline matrix below is retained; updated-source September 28 coverage and remaining gaps are recorded separately below.

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


## September 28 follow-up — rendered branch audit

Current preview: exact Final app `69ef9900cf3862dc0ea39734`, branch `codex/pg-rebrand-completeness-20260927`, uploaded revision `6f3f505d`. The browser import completed and the selected branch was visible in the toolbar. Main was not selected for these screenshots. This branch has not been merged or published.

36 screenshots are saved in `rebrand-evidence/mobile-20260928/`, with a browsable [contact sheet](rebrand-evidence/mobile-20260928/index.html). They show the uploaded revision before the two follow-up fixes. The phone preview measured 373×665 CSS pixels; these are browser observations, not physical TestFlight results.

### Observed route outcomes

| Group | New branch observation |
| --- | --- |
| Events, Upgrades, Sell, Fan Zone, Me | Rendered with live images/data or honest empty states. Events and Upcoming Upgrades fit three complete cards at this viewport. Event card opened its Ticketmaster detail. |
| Ticketmaster detail | Hero, event information, external purchase link, and empty PG-listings state rendered. External purchase was not opened. |
| Edit persona, notifications, create listing | Rendered; notifications All/Unread filters opened; listing stopped at event selection. No profile edits or listings submitted. |
| Instant listings, Why PG, leaderboard | Rendered. FAQ expanded-state timing is not fully evidenced by its screenshot. |
| Seller payout guide | Failed with `ReferenceError: ArrowLeft is not defined`; missing import corrected locally. Corrected render remains pending. |
| Login, register, forgot password, reset password | Branded forms rendered. Reset without a token showed a readable disabled/error state. No credentials entered or forms submitted. |
| Terms, privacy, cookies, Our Story | Rendered with readable contrast; founder photographs retained. Legal content was not audited for accuracy. |
| Admin command center, legacy admin, beta QA/checklist/testers/dashboard | Initial screens rendered. Legacy admin stayed locked; no administrative action or edit performed. |
| Not-found | Branded fallback rendered. Existing admin-only note retained. |
| `/` | Existing authenticated redirect reached Events. Public unauthenticated landing not rechecked this pass. |

Additional rendered surfaces: Me activity disclosure, New post, Seat Flex, bucket-list sheet/search, Upgrades Live Now empty state and its explanation dialog. Bucket-list first screenshot caught loading; search screenshot shows the stable search entry. No posts, uploads, purchases, transfers, or record-changing controls were submitted during this pass. Ordinary application mount effects were not asserted to be globally write-free.

### Follow-up corrections

1. `SellerPayoutGuide.jsx`: restore the `ArrowLeft` import used by its footer. This fixes an observed crash missed by the earlier build.
2. `WhatIsPGOverlay.jsx` plus `upgrades-explainer.css`: replace old black/gradient sheet chrome with shared PG surfaces, green accent, dashed divisions, readable footer, bounded scrolling and 44px close control. Copy, handlers, focus/Escape/swipe behavior and dismissal preference persistence are unchanged.

Verification: production build passed; scoped ESLint passed for both changed JSX files; a focused undefined-JSX scan across 98 changed JSX files found zero errors after the import fix. A separate isolated fixture build passed. `git diff --check` passed. Prior broad test evidence is retained, not rerun or relabeled as new live proof. Build warnings noted missing local Base44 environment configuration and stale Browserslist data; no application connectivity is claimed by compilation.

### Remaining visual coverage

Account settings, My Tickets, My Sales and Founder were not newly mounted against live data: their existing effects can create/update records. Extended the existing fail-closed local fixture for account settings, sales, founder, payout guide and the Upgrades intro, with additional wallet data. All writes are blocked and reads are explicit local fixtures. The cloud browser rejected localhost with `ERR_BLOCKED_BY_CLIENT`; rendered fixture QA is therefore NOT RUN. Fixture build success is not a visual pass.

Still open: corrected payout/intro renders; narrow 320px and light-theme review; keyboard and physical-device behavior; populated purchase/transfer/dispute/donation outcomes; PG-specific dynamic event and purchase routes; all conditional admin panels. The EventMode redirect remains source-reviewed only. Existing guide claims about fees/escrow and time-zone display consistency require their own product/behavior checks and were not changed by this presentation pass.

### Session checkpoint / next action

September 28, 2026: continued the secondary-screen rebrand mission, imported the uploaded branch, saved 36 mobile screenshots, found and repaired one crash and one visual mismatch, and preserved an isolated fixture for the remaining risky states. Work is saved locally; this follow-up is not yet uploaded. No new Base44 AI prompt, merge, publication, maintenance change, or purchase-security work was performed.

Next: upload the follow-up bundle to the same branch; refresh its Base44 preview and verify the two fixes; complete the isolated/phone checks before claiming no mismatches or publishing the full rebrand-completeness branch. The original merged Fan Zone update remains separate and already published.


### September 28 upload recovery

The follow-up push was safely rejected because Base44 added `9605fb640d63c066030ac2d27d74e3812167750e` (`Update base44 packages`) to the branch after the bundle's base. Its only changes are SDK 0.8.51 → 0.8.52 and Vite plugin 1.0.42 → 1.0.44 in package.json and package-lock.json.

Normal local merge `1c0c0e12956b529ce25f8222975b237008ea72f2` preserves both that commit and follow-up `d8813c8c`. Exact comparison confirms the only additions over the follow-up are those two package files, byte-identical to the remote. No source conflict, force-push, remote mutation, or publication occurred. Existing build evidence is not relabeled as testing the bumped dependency versions. A replacement incremental bundle contains both histories; normal push will reject safely if the remote advances again. Next step remains corrected-preview verification after upload.
