# PG operations rebrand consistency review — 2026-09-27

Scope: all seven reachable admin/founder/beta routes, their nested operational panels and forms, the feedback detail portal, and the shared feedback widget. This is a presentation-only pass on `codex/pg-rebrand-completeness-20260927`. The accompanying route shell/global token changes belong to the parent review.

## Changes

- Added semantic `pg-operations-*` page, header, card, tabs, status, dialog and widget hooks. Shared CSS gives operations the warm light/dark PG canvas, solid surfaces, restrained corners, typography, clear separators, and visible focus treatment.
- Replaced translucent neutral whites and near-black headers with shared `--pg-*` surface, border and text tokens. Admin/founder tinted status surfaces use opaque color mixes over the shared surface while retaining their original hue/tint strength. Beta status fills retain their original category/status hues.
- Retained existing status palette values and all status conditions. Admin/founder status text is exposed through `--pg-status-ink`; light mode darkens that hue against the light canvas. Beta direct status text uses existing theme-aware neon inks; dynamic palette labels use the same status hook.
- Replaced decorative rainbow action gradients with a single PG violet, mint or orange fill; kept action labels and state conditions unchanged.
- Gave buttons and non-checkbox/radio fields a 44px minimum target. Preserved the minimum-price switch's 24px visual track inside a 44px target. Native checkbox/radio geometry is untouched.
- Added mobile wrapping/min-width fixes to beta forms and headers; removed duplicate safe-area/top spacing now owned by the shared shell.
- Explicitly scoped the portaled feedback details and shared feedback sheet, so they receive PG tokens outside an operations page.

No backend, authorization, payment, data-loading, persistence, notification, workflow, business-rule, text-content or event-handler changes were made. No remote actions or live route mounts were performed.

## Reachable route and panel inventory

| Route | UI entry point | Nested coverage |
| --- | --- | --- |
| `/admin` | Me → Admin tools | Live Issues, Market Health, Stripe/Payments, Instant Ops, AI Verification, Donations, Alert Center, Transfer Windows, Transfer Intelligence, Confidence Calibration, Review Queue, Fee Simulator, Flash Drops, Live Upgrades, Instant Transfer Ready |
| `/admin-legacy` | Admin header, visible at `sm` and wider | Unlock/error state, Stripe configuration, onboarding reset, demo seeding, fulfillment metrics/queues/items, AI review, proof review, capture/dispute actions, fee comparison, minimum price config, fee simulator, analytics, event timing |
| `/founder` | Admin header (`sm+`), beta metrics back link | Attention summary, alert pulse, market health, marketplace/transfer/operations metrics, Event Navigation Health, quick links |
| `/beta-qa` | Legacy Admin, Founder | QA Checklist, Bugs, Live Event, Feedback, Risks; category disclosures, bug form/upload/status/details, feedback form/success/history, risk notes |
| `/beta-checklist` | Founder, Beta Dashboard | Add session, session disclosure, task result/notes, aggregate scores, audit report/section disclosures |
| `/beta-testers` | Beta Checklist, Beta Dashboard | Add tester, tester details/editing, status/retention controls, descriptions, empty state |
| `/beta-dashboard` | Me → Feedback inbox, Beta Checklist | Feedback/metrics tabs; category filters, note cards, hide/show details, pagination, detail portal; retention/category/description metrics |

Additional admin subpanels included: issue priority filters/evidence/inline confirmations; AI status filters/extracted-data/override-reason forms; transfer listing filters/overrides and nested Event Confidence Overview; transfer-window editing; review rejection/message forms; simulator comparison/validation tabs and pricing-strategy competitor assumptions; Flash Drop overview/funnel/per-event/anti-abuse and expanded event rows; ITR custody/details/actions; legacy fulfillment sorting/disclosures/detail/action forms.

`src/components/admin/InstantListingsQueue.jsx` is an orphan (no import/render reference; replaced by InstantFulfillmentCenter) and is deliberately untouched. FounderFeature and FounderStoryCard are reachable public/member components handled by the separate member audit.

## Verification and limits

- Targeted ESLint comparison against the worktree's HEAD covered all 45 changed JSX files: baseline 56 errors, updated 56 errors, **zero new errors**. All 56 are unchanged `unused-imports/no-unused-imports` findings. Targeted lint with that pre-existing rule suppressed passes.
- Scoped `git diff --check` passes.
- A structural AST comparison across the 33 admin/founder files found no differences after excluding presentation attributes, CSS imports, visual style properties and equivalent muted-color tokens. Beta changes were separately reviewed for unchanged handlers, calls, guards, text and persistence.
- No tests were added or broad test suites run for this visual pass.
- **Source-only coverage:** every panel listed above has been source-reviewed and styled; role-restricted rendering, real records, populated review queues, proof images, network error states, local-session history, active operational warnings, and browser/light-dark screenshots remain visually unverified in this subtask. Empty/loading/error markup was included where present, but no fixture or remote action was executed to force it.
- Parent review may supply additional build/render evidence. This note does not claim that a role-limited panel was mounted or exercised.

## Mount and interaction caveats for subsequent visual review

- `/founder` mounts EventNavHealthPanel. Its unchanged effect creates an AdminAlert when navigation failure rate exceeds 1% and at least three failures exist, once per component session. Use a mocked environment for visual inspection; do not mount it against live data solely for screenshots.
- `/beta-qa` initializes a local sessionStorage QA session ID. Tester identity/device edits write local storage. `/admin-legacy` may clear its local unlock flag for a non-admin.
- Beta checklist sessions, live-event/risk checklists and minimum-price preview configuration write local state when controls are used.
- Reviewed operations page/panel mounts otherwise load data. `/admin` and unlocked `/admin-legacy` invoke getStripeMode. This styling task did not verify server function internals.
- Operational action buttons can update listings/purchases/testers, charge/refund, seed inventory, upload files, notify users or send email. Disclosures/filter tabs can be inspected with mocks without submitting those actions.
- Shared Layout may show onboarding or donation notifications. Completing onboarding updates the user profile. Their behavior is outside this presentation-only pass.

## Files changed in this subtask

- `src/components/admin/AIVerificationQueue.jsx`
- `src/components/admin/EventTimingDebug.jsx`
- `src/components/admin/FeeComparisonReport.jsx`
- `src/components/admin/FeeSimulator.jsx`
- `src/components/admin/FeeSimulatorV2.jsx`
- `src/components/admin/InstantFulfillmentCenter.jsx`
- `src/components/admin/InstantTransferReadyPanel.jsx`
- `src/components/admin/MinListingPriceConfig.jsx`
- `src/components/admin/PendingReviewQueue.jsx`
- `src/components/admin/PricingStrategyAnalyzer.jsx`
- `src/components/admin/TransactionAnalytics.jsx`
- `src/components/admin/TransferWindowAdminPanel.jsx`
- `src/components/admin/cc/AIVerificationPanel.jsx`
- `src/components/admin/cc/AdminAlertCenter.jsx`
- `src/components/admin/cc/CommandSummaryBar.jsx`
- `src/components/admin/cc/ConfidenceCalibrationPanel.jsx`
- `src/components/admin/cc/DonationOpsPanel.jsx`
- `src/components/admin/cc/EventConfidenceOverview.jsx`
- `src/components/admin/cc/FlashDropMetricsPanel.jsx`
- `src/components/admin/cc/InstantOpsPanel.jsx`
- `src/components/admin/cc/IssueFeed.jsx`
- `src/components/admin/cc/LiveUpgradeControlPanel.jsx`
- `src/components/admin/cc/MarketplaceHealth.jsx`
- `src/components/admin/cc/StripePanel.jsx`
- `src/components/admin/cc/TransferIntelligencePanel.jsx`
- `src/components/admin/fulfillment/FulfillmentItem.jsx`
- `src/components/admin/fulfillment/FulfillmentMetrics.jsx`
- `src/components/admin/fulfillment/FulfillmentQueue.jsx`
- `src/components/admin/fulfillment/useUrgency.jsx`
- `src/components/admin/operations-theme.css`
- `src/components/beta/BetaFeedbackForm.jsx`
- `src/components/beta/BugTracker.jsx`
- `src/components/beta/FeedbackDetails.jsx`
- `src/components/beta/FeedbackInbox.jsx`
- `src/components/beta/FeedbackWidget.jsx`
- `src/components/beta/LiveEventChecklist.jsx`
- `src/components/beta/OperationalRiskChecklist.jsx`
- `src/components/beta/QAChecklist.jsx`
- `src/components/founder/EventNavHealthPanel.jsx`
- `src/pages/AdminCommandCenter.jsx`
- `src/pages/AdminMode.jsx`
- `src/pages/BetaDashboard.jsx`
- `src/pages/BetaQA.jsx`
- `src/pages/BetaRecruitment.jsx`
- `src/pages/FounderBetaChecklist.jsx`
- `src/pages/FounderDashboard.jsx`
