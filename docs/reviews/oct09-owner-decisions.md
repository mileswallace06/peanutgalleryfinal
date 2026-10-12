# October 9 decisions still required

These questions remain outside the regression repair. No legal wording, payout timing, consent behavior, account-transfer flow, or transaction policy was silently changed.

| ID | Conflicting or unresolved surfaces | Exact decision needed |
| --- | --- | --- |
| R08 | `/terms#returnno` says final sales/no refund. `/why-peanut-gallery` promises a full refund for fraudulent tickets and seller cancellation. Existing text is centralized in `src/lib/refundPolicyCopy.js`; the hosted document may also need an owner update. | Approve one refund rule: eligibility and exclusions, non-delivery/fraud/cancellation coverage, funding source, deadlines, evidence, enforcement, operational responsibility, and final wording. Product intent to protect buyers is not approval of a funded guarantee. |
| R17 | `/seller-payout-guide` (`payoutPolicyCopy.js`) says 2–7 business days, first up to 7; FAQ says subsequent 2–5. Seller `/purchase/:id` (`PurchaseSuccess.jsx`) says 2–7 and first up to 14. | Approve factual timing covering first/subsequent payouts, capture versus bank availability, readiness/verification delays, provider conditions, and all surfaces before changing numbers. |
| I2 | Hosted Privacy reportedly lists Analytics marketing/fingerprint/location categories; `/cookies` disclaims advertising/retargeting/pixels/cross-site/fingerprinting. First-party code initializes Impact and OneSignal and contains Base44 analytics/diagnostics. | Approve the provider/purpose inventory, required consent and withdrawal controls, identity use and retention; verify provider/account/deployed behavior, then approve consistent disclosures. [Investigation and bounded runtime evidence](oct09-tracking-investigation.md). |
| I3 | `CreateFlashDropSheet.jsx` still offers **Account Transfer / Transfer full account access**. | Product/security owner must decide removal or an approved alternative. No credentials were requested, entered or transmitted; no new credential-sharing flow was implemented. |

A future managed-selling/consignment feature, custody, reimbursement promise, or expanded marketplace responsibility is not included.

Other explicit limits: the historical R09 focus failure remains unproven even though a subsequently reproduced startup race is repaired; Founder alert deduplication is not atomic across clients; pending transfers retain an existing user-scoped legacy Purchase dependency; exact deployed versions and real transaction behavior were not verified. None is resolved by a local green test result.
