# October 9 regression repairs

Draft review only. No merge, publication, deployment, or production mutation. [Audit source and comparison base](oct09-audit-source.md) · [Owner decisions](oct09-owner-decisions.md) · [Evidence index](oct09-evidence/README.md).

## Finding-to-change ledger

| ID | Current status and diagnosis | Changed or preserved paths | Isolated verification |
| --- | --- | --- | --- |
| R01 | Coverage added; independent provider continuation preserved. | `eventDiscoveryPager`, `useSellingDiscovery`; no provider limit invention | `oct09-discovery-paging`, existing search/paging suites: independent exhaustion, retry, stable ties and limits |
| R02 | Reproduced and repaired: global query-keyed return snapshots were reused on fresh submissions. Restoration is now keyed to history entry and submitted context; delayed callbacks check generation. | `eventDiscoveryState`, `Events`, detail/hero Back state | Navigation browser before/after: repeated search, quick responses, filters/Clear, direct/reload, Back/Forward, continuation depth and exact focus |
| R03 | Presentation repaired; record equivalence still unconfirmed. Similar names/venue/time no longer collapse different provider records. | `eventIdentity`, Events/Upgrades cards and native/provider details | Identity suite: verified aliases, conflicts, sessions, inventory, sparse timing, legacy IDs; both themes |
| R04 | Reproduced and repaired locally: ended details advertised selling; Flash Drop lacked authoritative lifecycle guard. Existing closed listing form preserved. | native/provider detail, hub/Fan Gifts, `CreateFlashDropSheet`, backend `flashDrop` | Guest/member/admin boundary cases; fresh read failure and changed lifecycle; denied paths have zero mocked writes |
| R05 | Coverage and duplicate-submit protection added; existing loading/empty/Escape recovery preserved. | `CreateFlashDropSheet`; lifecycle fixture | Populated eligible listing, read failure/retry, selection, open draft, repeated submit; expected local-only write counts |
| R06 | Working repair preserved; coverage expanded. | legal renderer unchanged, legal browser/fixture | Actual 320/375/390/430/1280 widths +844×390, both themes; keyboard final-column reach, table semantics, no overflow |
| R07 | Working fragments preserved; coverage expanded. | legal navigation unchanged, staged synthetic hosted content | All 31 Terms anchors; direct/reload/Back/Forward Privacy fragments after two async insertions, reduced motion, focus/header offset |
| R08 | **Owner-blocked.** Refund contradiction intentionally remains. | Policy strings unchanged | No policy reconciliation or refund operation; exact decisions in linked owner document |
| R09 | **Unresolved historical failure.** Original full runner passed before modifications; no cause established. | Fan production code unchanged; runner diagnostics and controlled fixture added | Original and diagnostic gates each19; controlled suite42, including72 async modal-close cycles; exact trigger assertion/raw backdrop unchanged |
| R10 | Previously verified repair preserved. | Profile/rank design unchanged | Existing profile/Beta browser and contrast unit coverage; no new live measurement claimed |
| R11 / N02 | Remaining four refresh names repaired, with loading/error/retry/focus behavior. | TransferWindowAdminPanel, FlashDropMetricsPanel, LiveUpgradeControlPanel, InstantTransferReadyPanel | Async loaded accessibility names, keyboard activation and focus in both themes; prior five-radio/disclosure tests retained |
| R12 | Sparse list repair preserved; hydration failure/retry coverage added. | MySales unchanged; purchase-review fixture | Two same-date/amount sale references remain distinct across hydration failure and recovery |
| R13 | Missing coverage added; no bank-payout promise invented. | Seller summary/participant handler unchanged | Finite/zero/missing/NaN/infinite/string amounts; participant/demo exclusion and 500-record boundary using actual handler in VM |
| R14 | Queue scope repair preserved; independent fault coverage added. | Admin queues unchanged; shared fixture/sales-admin runner | Each alerts/reviews/transfers read fails/retries independently; transaction/donation/report/mode unknown states never become all-clear |
| R15 | Controlled coverage added; no new location defect demonstrated. | Real useFanLocation/control under new fixture | Success, denial, timeout, unavailable, invalid coordinates, stale callbacks, manual override/unmount, cache expiry/future/malformed; synthetic only |
| R16 | Presentation repaired; ambiguous local records retained. | shared event occurrence labels via fanEventChoice | Search/select/remove/cancel; recurring/ambiguous choices, reference search, missing venue zone; no post |
| R17 | Payout navigation preserved and state coverage added; **timing policy owner-blocked**. | Payout copy unchanged | Loading, failure/retry, disconnected and missing readiness, section expansion/focus; no onboarding/bank action |
| N01 | Reproduced and repaired: Upgrades filter lived only in component state. | `Upgrades`, validated `view=live` URL state; discovery return context | Live→hub→Back/Forward, reload, pointer/keyboard, defaults/invalid values, retained tabs and depth |
| N03 | Associated selector label and occurrence context repaired. Exact action target IDs retained. | LiveUpgradeControlPanel/shared labels | Dated option names, uncertainty, full references, explicit label association, no release action |
| N04 | Reproduced and repaired: seller summary/advice used buyer wording and silently sparse context. | `PurchaseSuccess`, `purchaseDetailRead` | Authorized participant flags first; seller/buyer/admin, loading/sparse/error/retry/denied, full references, order vs seller amounts, seven viewports/both themes |
| N05 | Persistent Event name label and associated example hint added. | LiveEventChecklist | Explicit label/hint relationships and keyboard behavior; no event creation |
| N06 | Source candidate reproduced in isolation then repaired: rejected reads stranded refresh and empty arrays implied health. | FounderDashboard, EventNavHealthPanel, operational read hook/status, navigation alert coordinator | Each source independently fails/delays/recovers; no-sample/partial status, usable retry, stale response cancellation, same-session alert counts across remount/reload |
| I2 | **Investigation complete within local scope; owner decision open.** | Production tracking/disclosures unchanged | Seven optional offline actual-script probes with inert providers; production processing/storage/consent unknown |
| I3 | **Owner-blocked.** Account Transfer remains unchanged. | Flash Drop option unchanged | No option selected, account access or credential flow exercised |

## Scope and evidence limits

Read-only inspection of seven audited public event records found no proof of alias equivalence. The Knocked Loose pair has different provider IDs and actual AXS/Ticketmaster page context; Hail the Sun and Diamondbacks/Pirates records lack provider/timezone identity. A bounded public-field listing query returned zero for those IDs at that time; that does not prove universal inventory absence. No record was merged/deleted or operational target inferred.

Backend Flash Drop adds narrow lifecycle validation around existing auth/ownership/maintenance/rate policy. `submitListing` admin/test exemptions remain unchanged. No claim of atomic multi-write transactions is made. Unknown timing follows the existing eligibility policy.

Founder deduplicates existing unresolved navigation alerts and a same-browser-session incident. Cross-client uniqueness needs a separate backend constraint. A never-settling alert-create request holds the coordinator pending until reload; the dashboard read/retry path and visible spike remain usable. No blind retry of an uncertain write is added.

Completed transaction details hydrate only after authorized participant projection. Pending transfers still require legacy user-scoped Purchase fields for the existing workflow. Private-sidecar identity consistency and financial security are not certified here.

The optional unsaved-persona warning, alert timestamp correctness, LIVE/LIVE EST classification, physical device behavior and deployed transaction flows remain outside this repair. No guessed time offset or dependency upgrade was introduced.

## Verification and review

Combined local results and exact source provenance are recorded in the evidence index: 384 safe tests, 14 browser runners, scoped lint and build pass. Fresh route smoke has 252 passes and 2 known fixture blockers; global lint retains 23 errors in unchanged files. Repository-wide `npm run lint` reports 23 unused-import errors in unchanged files; scoped `npm run lint:audit` is separately reported. The safe unit list is explicit and network-denied; the live financial canary runner `npm test` was not invoked.

Historical CI is not used as proof for this branch. Draft PR CI is pending until an actual new run is observed. Review the final diff for policy/auth changes, removed assertions and unrelated edits; no production SDK is available to isolated fixtures.
