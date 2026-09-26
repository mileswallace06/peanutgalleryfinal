# Fan Gifts read privacy — branded-login prerequisite

Prepared September 26, 2026. This candidate descends from PR11 head
`4d1cf5b7bda8615bbd69b93d2bbcb0ac18dcd885` through the existing BetaFeedback fix
`3f7a2863a0062ed4bf4c8a6b14687ef79bc772b5`. No unrelated launch-readiness,
purchase-engine, feature-hold, or prototype commits are included.

## Reason for this change

Final's FlashDrop Permissions screen displayed All Users READ on September 23.
The source stores donor/winner emails and internal ownership references on those
rows. Member screens previously downloaded raw rows and compared emails to show
donor and winner states; result polling also returned the winner's email.
Before broadening visibility for custom login, these paths need a limited view.

## Prepared behavior

- Raw FlashDrop client reads require admin. Other FlashDrop mutation rules and
  FlashDropEntry's existing own-entry/admin read rule are unchanged.
- New authenticated `getFlashDropView({event_id})` returns explicitly selected
  display fields, server-derived `is_donor`/`is_winner`, and aggregated leaderboard
  entries. It does not trust a caller-provided user or role. It performs no writes.
- Names that contain legacy email fallbacks become generic names. Anonymous
  contributions are pooled under Anonymous Fan and never added to a named donor's
  totals. This is an intentional privacy change to leaderboard grouping, not a
  suspension of Fan Gifts.
- Creation and every winner-result branch return limited responses. Other
  entrants no longer receive the winner's email. No raw-row fallback is added.
- Event Detail and Fan Karma use the new view. The card uses server-derived
  flags. Failed reads display retry instead of implying there are no gifts.
  Fan Karma receives the resolved event ID rather than a Ticketmaster alias.
- Existing design, entry action, draw algorithm, donation delivery logic,
  notifications and admin metrics remain. The existing mutation maintenance gate
  is unchanged; the dedicated read endpoint preserves read availability.

Official contract references checked September 26:

- https://docs.base44.com/developers/backend/resources/entities/security
  confirms authenticated `user_condition.role`, denied list/filter behavior,
  and that service-role functions must enforce their own checks.
- https://docs.base44.com/sdk-getting-started/client
  describes the backend service-role access used by the limited view.

## Verification recorded

- 23 focused server/projection tests passed. They execute bundled handler source
  with SDK/entity fixtures: authentication failures/spoofing, malformed inputs,
  generic failures, every winner-return branch, creation, anonymous grouping,
  explicit field allowlists, RLS shape and maintenance preservation.
- 8 client tests passed, covering donor/entrant/winner/nonwinner/no-entry displays,
  retry presentation and no raw-record fallback. An initial test fixture lacked
  router context; it was corrected with StaticRouter and all eight passed.
- Scoped ESLint passed for all changed JSX and the three server code files.
- Frontend production compilation passed. The local environment lacks app ID/base
  URL configuration, so this is compilation evidence, not an app-connectivity or
  deployed-build pass. No dependencies or lockfiles were changed.
- Existing 11 BetaFeedback and 22 branded-auth tests are retained evidence from
  September 23. They were not rerun because that source is unchanged.
- Independent bounded review found no mismatch between the server projection
  and member readers, donor/winner presentation, leaderboard or retry states.

No live entity-rule enforcement, provider function execution, real-account flow,
mobile layout or physical TestFlight behavior is proven by these local checks.

## Delivery sequence and acceptance

This is a local candidate, not a live permission change. The tested feedback fix
is already included in its ancestry; do not apply it twice.

1. Transfer this descendant branch and update PR11. Review only the added
   feedback/Fan Gifts commits. A GitHub branch push alone does not release it.
2. Establish the scoped Base44 deployment operation for exactly the new read
   function, patched flashDrop function/shared helper, and the BetaFeedback and
   FlashDrop entity rules. Do not run a repository-wide backend deploy or assume
   a frontend GitHub sync installs entity permissions.
3. Coordinate functions, member UI and rules as one release while visibility
   remains Private. Existing cached clients rely on raw reads and old winner
   response fields. Do not restrict rows without the replacement read function
   and UI, or claim a mixed-version window is safe for an active drawing. Verify
   the installed app reloads the new UI before accepting the cutover.
4. Verify deployed rules, current-account authentication, denied anonymous/raw
   reads, regular-member safe reads, admin metrics and an authorized synthetic
   donor/entrant flow. Do not use existing private records as test content.
5. Reconcile Base44's custom-auth activation wiring with PR11. The public-mode
   change still needs its action-time owner confirmation. Preserve existing
   Google/Apple settings, callback and credentials. Verify login, registration,
   recovery, return navigation and actual TestFlight behavior after publication.

## Limits and separate findings

This closes the identified read paths in the prepared source; it does not
certify the whole Fan Gifts feature or overall public access. Pre-existing
`close_and_pick` lacks a server close-time check and uses a non-atomic lock;
`confirm_delivery` does not compare the caller against the requested donor or
winner role. These are recorded source defects, not newly demonstrated live
exploits or regressions caused by custom login. They were not redesigned here.
Other previously recorded permission gaps remain separate findings; this is not
an instruction to import feature-pausing commits or the purchase-security work.
The new read endpoint retains the previous single event-filter semantics, with
no pagination added. Provider result limits can truncate large event histories;
complete high-volume leaderboard counts are not established by this patch.

No live invocation, customer record access, deployment, app-visibility change,
publication, credential change, migration or native build occurred in preparation.
Location-prompt branding still awaits the response to ticket #6ab45e09's existing
follow-up; it is not fixed by this web candidate.
