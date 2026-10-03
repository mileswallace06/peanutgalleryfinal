# Contrast follow-up evidence — 2026-10-03

Scope: F3, F6, F10, F11 and F12 from `UI_AUDIT_HANDOFF_20261003.md`, reconciled against the current published-baseline worktree. These results are local source/token calculations and isolated component-handler tests, **not browser-rendered computed styles or a screen-reader audit**. No production preferences, auth accounts, listings, payments or alerts were changed.

## Reconciliation and changes

| Finding | Baseline and local result |
| --- | --- |
| F3 seller chooser | Partly fixed in existing CSS, but `.pg-detail-surface :is(.text-foreground, h2, h3)` has specificity `(0,2,0)` and beats the old paper heading selector `(0,1,2)`. The new `.pg-selling-picker.pg-detail-surface > article h2` selector `(0,2,2)` restores invariant paper ink. The select button gets an inset dark focus outline. Selected-event summary markup/styles are unchanged. |
| F6 auth/seat controls | Still present in the active `BrandedAuth` route, which uses raw `.pg-auth-input` fields rather than the legacy Login/Register/ForgotPassword components. Added separate active-control border, hover, focus, error, autofill and disabled tokens in `control-contrast.css`. Shared Input and seller seat/quantity/price/notes fields use those tokens. Auth failures now associate the visible message with relevant fields via `aria-describedby` and `aria-invalid`; editing/retrying/resending clears stale errors. Provider failure does not invalidate email/password. Native required/email validation remains enabled; recovery still conceals account existence. |
| F10 event back | Text color was already corrected in the baseline. Consolidated invariant overlay ink/background in the actual rule and added a light inset focus outline against the known dark overlay. Native/imported detail still use the same Link and navigation destination. |
| F11 Why accent | Already corrected by baseline semantic light `--neon-green: #246345`; preserved it. Numeric checks cover the small relevant label/accent backgrounds in each theme. No refund or marketing copy changed. |
| F12 off switches | Still present: Settings uses custom notification/appearance switches, independent of the shared Radix component. Updated both to shared off/on/hover/focus/thumb tokens, preserving switch role/name/state, thumb travel and 44/48px hit areas. Applied the same tokens to the shared Radix switch. No real settings toggled. |

## Measured token contrast

Ratios use WCAG relative luminance on values parsed from the actual CSS. The overlay calculation composites its `rgba(13,11,20,.86)` fill over image pixels before calculating contrast; white is the brightest/worst-case image background. Disabled controls are deliberately excluded from active-control 3:1 assertions.

| Pair | Light | Dark |
| --- | ---: | ---: |
| Default input boundary / fill | 4.16:1 | 5.70:1 |
| Default input boundary / surrounding card | 4.54:1 | 5.12:1 |
| Default input boundary / raised surface (weakest tested surrounding surface) | 3.81:1 | 4.61:1 |
| Off-switch track / card | 4.54:1 | 5.12:1 |
| Thumb / off track | 4.98:1 | 5.46:1 |
| Thumb / on track | 6.94:1 | 5.61:1 |
| Chooser title / invariant paper | 16.73:1 | 16.73:1 |
| Chooser metadata / invariant paper | 6.65:1 | 6.65:1 |
| Why green small label / page canvas | 5.95:1 | 14.56:1 |
| Why green comparison header / raised surface | 5.45:1 | 11.77:1 |
| Event-back label/focus / overlay composited over white image | 12.65:1 | 12.65:1 |

The regression suite also asserts all active hover/focus/error boundary tokens against page, card, raised and field-fill surfaces; on/off tracks against those surfaces; autofill text contrast; price/notes tinted fills; and relevant Why accent colors against their actual page/card/tinted-panel backgrounds. The F3 regression compares parsed selector specificity, so merely retaining an overridden paper-color declaration cannot pass.

## Commands and actual results

- `node --test tests/ui-control-contrast.test.mjs tests/branded-auth-fields.test.mjs tests/branded-auth.test.mjs` — **25 passed, 0 failed**. Nine token/style/specificity checks; four actual BrandedAuth component-handler/render-tree tests with an isolated hook harness and mocked SDK; twelve existing auth helper/return-to/privacy/duplicate-submit checks.
- `npx eslint src/pages/BrandedAuth.jsx src/pages/CreateListing.jsx src/components/account/NotificationsSection.jsx src/components/account/SessionSection.jsx --quiet` — exit 0, no lint findings. npm emitted its existing `http-proxy` environment warning. The repository lint configuration excludes `components/ui`; root build/syntax validation covers those small class edits.
- No full suite, build or typecheck run by this subtask. Root owns the single integration pass.

## Changed files owned by this subtask

`src/components/control-contrast.css` (new), `ticket-design.css`, `member-surfaces.css`, `events/detail-ticket.css`, `ui/input.jsx`, `ui/switch.jsx`, `account/NotificationsSection.jsx`, `account/SessionSection.jsx`, `src/pages/BrandedAuth.jsx`, `CreateListing.jsx`, `event-detail-clarity.css`, `tests/ui-control-contrast.test.mjs` (new), `tests/branded-auth-fields.test.mjs` (new), and this evidence document. All remain uncommitted local edits at this point.

## Remaining rendered checks

Root still needs browser evidence through the actual appearance control: default/hover/focus/error/native-invalid/autofill/disabled inputs, off/on switches in isolated preferences, both detail types over varied/missing images, and seller chooser/selected-event cards. CSS parsing and isolated handlers do not prove browser cascade, forced-colors behavior, real autofill painting, keyboard focus appearance, zoom/viewport layout, or screen-reader announcements. No production-auth or transaction clearance is implied.
