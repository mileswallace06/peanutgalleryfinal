# October 6 legal presentation and unresolved policy decisions

This is source-based implementation evidence, not approved legal advice or proof of transaction behavior. No live policy-provider response, customer data, financial endpoint, or tracking provider was exercised for this report.

## R06 — Privacy table

The policy renderer forced a provider table to `width: 100%` and `table-layout: fixed` without accommodating its five columns; URL labels used `word-break: break-all`. The renderer now wraps each injected table in a named, keyboard-focusable horizontal scroll region, preserves table elements/headers and supplied links, allocates equal readable column widths, clears incompatible provider column widths, and uses descriptive link text for raw URL labels. Normalization remains active for later provider DOM updates.

Acceptance status: local legal browser suite passed five-column widths, keyboard/pointer horizontal scroll, last-column link focus, no page-wide overflow, and heading/table semantics at actual 320/375/390/430/1280 CSS-pixel viewports and 844×390 landscape in both themes. 200%/400% CSS zoom emulation passed; this is not physical-device or native browser zoom evidence. Policy data was a synthetic local five-column fixture; the current external provider document was not loaded.

## R07 — Legal fragments

Public pages scroll in a `100dvh` element rather than the window. Fragment handling now measures that element's actual sticky header, offsets the target, and focuses its heading without a second scroll. Router-driven fragment navigation uses the same path as direct loading; a MutationObserver waits for asynchronously inserted policy targets. Empty-fragment Back restores the recorded history entry's internal scroll position. Instant scrolling supports reduced motion. A resized header updates scroll padding.

Acceptance status: unit coverage passed exact/malformed fragments, internal coordinates, measured offsets, and focus behavior. Local browser checks passed all 31 Terms ToC targets in both themes, direct/reloaded Terms refund fragments across all six viewport sizes, async Privacy direct/reloaded fragments, and MemoryRouter Back/Forward. Reduced motion was enabled. Real production BrowserRouter/native history and physical-device tests remain unverified.

## L1 — Legal semantics

Terms, Privacy, and Cookies now contain a named main landmark. The public page supplies the document h1; repeated provider document titles become paragraphs, provider section headings begin at h2, skipped levels are compressed, and styled Termly section/subsection labels receive heading semantics. Text, hrefs, and legacy anchor identifiers are retained.

## R08 — Owner-blocked refund policy

The repository supplies no authoritative approved reconciliation. The product/policy decision belongs to Miles / Peanut Gallery, with legal review as appropriate. Existing transaction behavior must be validated by the separately authorized purchase-security owner.

Current source statements:

| Surface | Existing claim |
| --- | --- |
| `/terms#returnno` | “All sales are final and no refund will be issued.” |
| `/why-peanut-gallery`, fraudulent-ticket FAQ | “If a ticket is ever found to be fraudulent, the buyer receives a full refund and the seller's account is permanently suspended.” |
| `/why-peanut-gallery`, seller-cancellation FAQ | “If a seller backs out after a purchase, the buyer receives a full refund and the seller is penalized or removed from the platform.” |

`src/lib/refundPolicyCopy.js` is now the shared presentation source for all three claims and explicitly records `owner-decision-required` with `approvedWording: null`. This intentionally preserves the original discrepancy; it does not choose or invent legal exceptions. R08 is NOT complete.

Decision needed: provide the authoritative approved refund rule, including any exceptions for fraudulent tickets and seller cancellation and the approved enforcement language. Update all three strings together only after that decision. Separately validate that the authorized transaction path implements the approved rule.

## I2 — Cookie/Privacy tracking discrepancy: evidence and limits

The audit reports Privacy's marketing/advertising purpose and Browser fingerprint disclosure. Privacy is hosted by Usercentrics and the policy text itself is not committed in this repository. Its currently served wording was not independently retrieved during this change.

`src/pages/CookiePolicy.jsx` claims no advertising/retargeting cookies, ad-network tracking pixels, cross-site tracking cookies, or device fingerprinting for advertising. Its analytics paragraph says anonymized or pseudonymized aggregate usage is not used for an advertising profile.

Confirmed source facts:

- `index.html` loads an Impact script from `https://utt.impactcdn.com/P-A7374474-4aa1-43ab-af61-43ef107a047f1.js`, then calls `impactStat('transformLinks')` and `impactStat('trackImpression')` at startup.
- `src/pages/CreateListing.jsx` invokes Base44's `listing_submitted` analytics event with fee model, asking price, quantity, listing mode, buyer total, platform fee, and onboarding completion.
- `src/lib/AuthContext.jsx` initializes OneSignal at startup and links the authenticated account with `loginOneSignalUser(currentUser?.email)` after authentication. `src/lib/oneSignal.js` passes that email to `OneSignal.login`.
- `src/lib/navLogger.js` writes EventNavigationLog diagnostic records with user agent, session ID, event identity, generated destination, and optional user email. These are navigation diagnostics; this source does not establish advertising use or fingerprint generation.
- Canvas use found in `src/lib/listingShareImage.js` generates user-requested share images. Canvas use by itself is not evidence of fingerprinting.

Unknown: the loaded Impact script's runtime storage/network/fingerprinting behavior, provider-side SDK processing and account configuration, consent configuration, deployed production source equivalence, and the current full hosted Privacy policy. There is no basis here to declare either misconduct or absence of tracking.

Decision/investigation needed: the policy owner should reconcile the hosted Privacy text and Cookie claims with the actual configured Impact, Base44, OneSignal, and other provider processing. Preserve wording until that assessment is approved; a source grep does not prove runtime privacy properties.

## Verification record

- `node --test tests/legal-document.test.mjs`: 5 passed, 0 failed, 0 skipped.
- `node --test tests/public-access-render.test.mjs`: 4 passed, 0 failed, 0 skipped; pre-existing StaticRouter Navigate notice remains.
- Targeted ESLint for PublicPage, TermsOfService, PrivacyPolicy, CookiePolicy, and WhyPeanutGallery: pass.
- All four changed page JSX entry points bundled successfully via esbuild.
- `PG_LEGAL_START_FIXTURE=1 PG_LEGAL_REVIEW_URL=http://127.0.0.1:4176 ... node tests/legal-document-browser.mjs`: 34 recorded browser checks passed, no runtime errors, no attempted external requests. Chromium ran in a clean, local-only context with fixture SDK/Auth aliases. Exact executable environment appears in the root delivery evidence.
- Browser report: `/tmp/pg-legal-browser/result.json` (to be collected by the parent delivery task). These results apply to the shared working tree at execution, not a merged/deployed SHA.
