# Data, identity and policy follow-up — October 3, 2026

Read-only source review against published baseline `07d4031c816c7540b91ebff03671092abb1b265c`, informed by `UI_AUDIT_HANDOFF_20261003.md`. This report is the only file changed by this review. No tests, browser review, provider requests, record mutations, policy changes or publication were performed. Line references identify the reviewed source and may move during parallel UI repairs.

## Follow-up disposition

The native-detail alert recommendation below was subsequently implemented on this branch using the existing Upgrade alerts control. Fresh Unicode fixtures also now cover normalization, JSON roundtrip and actual card text; the original malformed title still needs source payload evidence. Public exact-ID searches did not resolve the required raw payload or pair identity. A Live Nation page for the first FIGHTMASTER ID was found, but one member of a pair is insufficient to prove equivalent admission: https://www.livenation.com/event/17k8v0G6uJHF6YD/fightmaster. No source-record correction or deduplication was performed.

## F9 — encoding remains evidence-blocked

The inspected ingestion path does not apply a title encoding conversion:

| Boundary | Source evidence |
| --- | --- |
| Provider response | `base44/functions/getTicketmasterEvents/entry.ts:55–75` uses `res.json()` and the shared normalizer. |
| Normalization | `base44/shared/tmResponseHandler.js:97–100` maps `title: e.name` without substitutions. |
| Client transport/cache | `src/lib/tmCache.js:43–65` retains the returned events array. URL encoding at line 17 concerns cache-key parameters, not titles. |
| New local record | `base44/functions/syncTMEvent/entry.ts:31,113–119` writes the supplied `title` unchanged. |
| Existing local record | `syncTMEvent/entry.ts:87–108` updates search/image metadata but does **not** refresh the stored title. A previously bad title can therefore remain, but this does not establish where its encoding changed. |
| Display | `src/pages/Events.jsx:496`, `Upgrades.jsx:237`, and `EventDetailTM.jsx:227` render the event title directly. |
| Search index | `base44/shared/searchNormalize.js:22–46` strips diacritics/punctuation only into the separate search value; it does not rewrite the display title. |

No original response or stored record for `1AtZk39Gkdc4e7Z` was available in this review. The existing illustrative `Lotería` search tests establish no authoritative spelling for that historical event. **No title repair is proven safe yet.** Do not apply a global mojibake decoder, guess spelling, or change search normalization to repair display data.

Next evidence: capture the exact provider `name`, provider ID, normalized title and stored title for the same event from authorized read-only sources; compare Unicode code points and JSON content at each boundary. If the provider already supplies the broken value, address that specific source record or an explicitly approved ID-scoped override. If the provider value is correct and the stored value differs, repair the demonstrated boundary and plan a separate narrowly scoped correction of affected records. Regression fixtures should preserve accented characters, apostrophes, non-Latin text and even literal mojibake unchanged unless a specific documented conversion is required. Those tests were not run in this review.

## Duplicate-looking events — identities unresolved

`src/lib/eventSourceMerger.js:83–93` already deduplicates provider/local copies by exact `tm_id`, otherwise exact local `id`; it prefers the local record and preserves its route. `src/lib/sellingEventDiscovery.js:27–36` combines local rows by local ID and provider results by exact provider ID. No title/venue/time fuzzy deduplication is present.

The reported FIGHTMASTER pair (`17k8v0G6uJHF6YD`, `Z7r9jZ1A7Pwpd`) and Chanel Beads pair (`Z7r9jZ1A7PO8U`, `rZ7HnEZ1AfP8Od`) have **different provider IDs**, so existing exact-identity deduplication deliberately retains them. Matching visible title, venue and time alone cannot establish equivalent admission/session identity. No source payloads for either pair were available; no cross-ID merge, relabeling or alias rule is justified yet.

Before reconciliation, compare official source URLs, provider/promoter identifiers, stable venue IDs, start instant, admission/session description, and local records/listing associations. If equivalence is confirmed, preserve both historical routes with explicit aliases and retain inventory associations; if sessions/admission types differ, show the verified distinction.

Existing caution: `base44/functions/syncTMEvent/entry.ts:79–96` deletes extra local rows sharing **one** `tm_id`, keeping the newest. That block shows no associated-link/listing migration. It does not explain the reported distinct-ID pairs. Do not extend that deletion behavior into a fuzzy or cross-ID deduplicator; no destructive change was made here.

## F5 and event alerts — different completion states

- **F5 already implemented in the baseline:** `src/components/account/SupportLegalSection.jsx:6–19` sends Help Center to `/help` and labels Contact Support as email. `src/App.jsx:114` registers the real Help Center. `src/pages/HelpCenter.jsx` contains searchable/filterable FAQ content and support recovery. Earlier PR14 evidence records both-theme rendered review; this source review does not add new rendered verification.
- **Existing supported-event watch:** `src/pages/EventDetailUpgrade.jsx:325` mounts `DiscoveryAlertControl`. Its `get_event`/`set_event` calls, enable/disable states, inactive-delivery text and error recovery live in `src/components/upgrades/DiscoveryAlertControl.jsx:25–101`. It promises **upgrade availability**, not every ordinary ticket listing.
- **Bucket List is separate:** `src/components/fanzone/BucketListAlerts.jsx:91–136` saves discovery preferences, explains in-app delivery and the chosen area, shows inactive delivery and provides opt-out. It does not replace an event-specific ordinary-ticket watch.
- **Remaining misleading native-detail block:** `src/pages/EventDetail.jsx:282–284` says “Get notified when tickets drop” / “We'll alert you the moment a listing goes live” but points to generic account settings. Safe UI recommendation: use the existing control under an explicit **Upgrade alerts** label, preserving its unsupported/inactive states, or replace the unsupported promise with truthful availability guidance. Do not imply this is a general ticket-alert system or create a second overlapping preference store.
- **Activation remains separate:** `base44/shared/discoveryAlerts.js:81–91` requires a real provider ID for new event watches; native events without one remain unsupported. `base44/functions/processDiscoveryAlerts/entry.ts:16` is default-off. `manageDiscoveryAlerts/entry.ts:27` exposes only the activation flag, not scheduler health. Follow `src/docs/DISCOVERY_ALERTS_RUNBOOK.md` before activation; delivery is in-app only and Bucket coverage is bounded to discovered events. This review neither changed nor independently rechecked production activation.

## F13 — customer-facing copy inventory; owner decision required

| Surface | Source | Current promise/context |
| --- | --- | --- |
| Terms §7 | `src/lib/tosHtml.js:42`, rendered by `src/pages/TermsOfService.jsx:25` | “All sales are final and no refund will be issued.” |
| FAQ — fraud | `src/pages/WhyPeanutGallery.jsx:107` | Fraudulent tickets receive a “full refund”; seller permanently suspended. |
| FAQ — seller cancellation | `src/pages/WhyPeanutGallery.jsx:111` | Seller backs out: buyer receives a “full refund”; seller penalized/removed. |
| Checkout — Instant Transfer Ready | `src/components/events/PurchaseDialog.jsx:218,232` | “If delivery fails for any reason, you'll be automatically refunded.” |
| Pending purchase cancellation | `src/pages/PurchaseSuccess.jsx:47,342` | “Cancel purchase & refund” before seller-confirmed sending, including PG-managed Instant transfers. |
| Cancellation confirmation | `src/pages/PurchaseSuccess.jsx:199` | “Cancel this purchase? The payment will be refunded.” |
| Cancelled/expired banner | `src/pages/PurchaseSuccess.jsx:290–296` | “Refund issued to your original payment method.” |
| Seller validity agreement | `src/components/listings/InstantTransferAgreement.jsx:29` | Invalid-ticket seller “may be held liable for any buyer refund.” |
| Listing protection copy | `src/components/events/ListingCard.jsx:220` | Money held in escrow, seller paid after confirmation, disputes supported. |
| Checkout protection copy | `src/components/events/PurchaseDialog.jsx:244–245` | Payment held until upgraded-seat access or ticket receipt is confirmed. |
| Why/FAQ protection copy | `src/pages/WhyPeanutGallery.jsx:71` | Buyers do not release funds until receipt confirmation. |
| Instant listings guide | `src/pages/InstantListingsGuide.jsx:155` | Every Instant or Standard purchase is described as escrow-protected. |
| Dispute dialog | `src/components/purchase/DisputeModal.jsx:39` | “Our team will review and resolve within 24–48 hours.” |
| Help Center | `src/pages/HelpCenter.jsx:12,84` | No explicit refund policy; order issues route to available order actions/support, and legal link routes to the conflicting Terms. |

Terms §12's App Distributor refund wording on the same `tosHtml.js:42` concerns an **App purchase price**, not a ticket refund; do not conflate it with §7. This inventory identifies copy commitments, not a conclusion about operational refund behavior.

**Exact owner question:** What refund policy should govern ordinary tickets and seat upgrades, including Standard and Instant delivery: which cases qualify (fraudulent/invalid tickets, seller cancellation, delivery failure, and buyer cancellation), does “full refund” include all fees, are refunds automatic or reviewed, and what timing can we promise—and should Terms §7 state those exceptions?

After the owner answers, prepare one approved policy statement covering eligibility, exclusions, amount/fees, process, timing and support/disputes, then align the listed surfaces with it. Operational verification remains a separate authorized task. No legal or promise-bearing copy was changed.
