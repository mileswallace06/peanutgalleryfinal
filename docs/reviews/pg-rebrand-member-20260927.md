# PG member secondary UI completeness — 2026-09-27

Scope: presentation of member secondary routes and nested account/purchase/donation components. Source audit followed by a focused implementation pass. Root owns the shared Layout/PG token changes; public/auth/legal/onboarding work has a separate report. No backend, purchase-security, data access, mutation handlers, auth logic, legal copy, or commercial text changed. Existing event photography and the approved main-five page designs were retained.

## Route and state inventory

| Route | Component | Presentation result / states requiring live review |
| --- | --- | --- |
| `/me` | `Me` | Existing account ticket retained. Points/impact leaderboard and unlock controls have 44px targets. Check expanded points, community impact, followers/following, long names. |
| `/account-settings` | `AccountSettingsPage` | Existing intro/disclosures retained. Nested account sections use PG surfaces/lines, readable theme accents and 44px actions. Check every disclosure, payout expanded/collapsed, transaction tabs, preferences, theme switch and deletion steps. |
| `/edit-persona` | `EditPersona` | Existing redesigned photo/field/action presentation audited and retained. Check long bio, uploads/busy, saved state. |
| `/notifications` | `Notifications` | Existing redesigned rows/toolbar/filter states retained. Check empty/loading/error/populated and unread filter. |
| `/my-sales` | `MySales` | Existing activity/ticket presentation retained. Check pending/completed sales, listing-status branches and seller-performance disclosure. |
| `/my-tickets` | `MyTickets` | Existing wallet tickets retained. DonateSeatSheet now has tokenized surfaces, larger close/input targets, compact action corners and scrollable short-viewport content. Check empty/error/populated, donation confirm/details/done. |
| `/create-listing` | `CreateListing` | Existing transaction shell retained. Shared notification prompt updated; agreement/attestation actions already receive transaction sizing. Check location/search states, all three steps and result states. |
| `/sell` | `Sell` | Existing designed tickets retained. Linked guides now match its shell. |
| `/purchase/:id` | `PurchaseSuccess` | Existing transaction shell retained. Dispute, transfer assistant and push prompt updated. Check buyer/seller pending, complete, expired/disputed, missing/access states, selected/unselected dispute categories and busy controls. |
| `/instant-listings` | `InstantListingsGuide` | PageIntro/back rhythm, cyan identity, PG surfaces and compact CTA shapes. Check each FAQ and long-scroll layout in both themes. |
| `/seller-payout-guide` | `SellerPayoutGuide` | PageIntro/back rhythm, orange identity, PG surfaces and compact CTA shapes. Check each FAQ and content tables in both themes. |
| `/why-peanut-gallery` | `WhyPeanutGallery` | PageIntro/back rhythm, violet identity, PG surfaces and compact CTA shapes. Check comparison grid and each FAQ. |
| `/leaderboard` | `Leaderboard` | PageIntro/back rhythm, yellow identity, 44px tabs and PG row surfaces. Check all four tabs, empty/loading/populated states and long fan names. |
| `/event-mode/:id` | `EventMode` | Deprecated null-render redirect to `/upgrades/:id`; no independent persistent surface. |
| Any member page | `DonationWinNotification` | Token sheet, flat violet action and readable secondary action. Existing countdown/accept/decline flow retained; drawn/accepted/declined states need suitable data for live review. |

## Changes

- Added `src/components/member-surfaces.css`: narrowly scoped guide/account/sheet/action styles; shared PG surface/text/line tokens, per-page accent ink, 44px targets, 16px sheet inputs and bounded scrollable sheets. No event card selectors.
- Converted the four legacy member guides/leaderboard to the existing `PageIntro` and secondary-page rhythm. Removed duplicate old safe-area top spacing, tiny back links and full rounded action chrome. Existing headline fonts, informational copy, FAQ behavior, tab handlers and colors remain.
- Removed the fixed white dispute panel/selected rows and fixed dark deletion panel that conflicted with the active theme. Warning/danger accent roles remain orange/pink.
- Enlarged nested account controls and points/impact links. Notification preferences retain their visual 24px track within a 44px target, and expose a name/checked switch state as requested by root. Handlers and preference keys remain unchanged.
- Removed glow from donation and transfer primary controls; kept mint/violet/pink roles. Added accessible close labels to existing icon controls. Existing form types, validation and submit behavior remain unchanged.
- Theme-aware FAQ surfaces retain the guide's supplied accent. Existing dynamic ranks and provider brand colors remain intact.

## Changed files

- `src/components/member-surfaces.css`
- `src/pages/InstantListingsGuide.jsx`
- `src/pages/SellerPayoutGuide.jsx`
- `src/pages/WhyPeanutGallery.jsx`
- `src/pages/Leaderboard.jsx`
- `src/components/account/NotificationsSection.jsx`
- `src/components/account/ProfileIdentitySection.jsx`
- `src/components/account/SecuritySection.jsx`
- `src/components/account/SessionSection.jsx`
- `src/components/account/StripePayoutSection.jsx`
- `src/components/account/SupportLegalSection.jsx`
- `src/components/account/TransactionHistorySection.jsx`
- `src/components/account/VerificationStatusSection.jsx`
- `src/components/points/PeanutPointsCard.jsx`
- `src/components/donations/CommunityImpactCard.jsx`
- `src/components/donations/DonateSeatSheet.jsx`
- `src/components/donations/DonationWinNotification.jsx`
- `src/components/purchase/DisputeModal.jsx`
- `src/components/purchase/TransferAssistant.jsx`
- `src/components/DeleteAccountModal.jsx`
- `src/components/NotificationPermissionPrompt.jsx`
- `src/components/education/FaqAccordion.jsx`

## Verification and limits

Targeted ESLint passed for all 21 changed JSX files. Existing unused imports in touched files were removed. Source diff inspection confirmed no data/query/effect/mutation/redirect/submit handler changes. A scoped whitespace check passed. No broad tests or backend checks were run for these styling-only changes.

This pass did not execute a browser or live account transactions. The route/state matrix is the browser review inventory, not a claim that every data-dependent state was displayed. Review at 320px and a normal mobile width in both themes, including a short viewport/visible keyboard for sheets. Do not complete account deletion or create purchases/donations merely to obtain screenshots; use existing authorized states or a separate non-production fixture where available.

Public/auth/legal/not-found/onboarding: see `pg-rebrand-public-20260927.md`. Admin/founder/beta surfaces are covered by the separate operational pass.
