# PG public presentation pass — 2026-09-27

This pass updates presentation only. Public access, auth submissions, password/reset/verification conditions, navigation destinations, provider integration, legal content, query behavior, approval polling, and onboarding completion/swipe handlers are unchanged. All photograph URLs and founder type choices remain unchanged.

## Route and state inventory

| Route or entry | Surface | Changes |
| --- | --- | --- |
| `/` for visitors | Landing | Preserved event photograph, headline colors/type, CTA copy and navigation. Removed floating glow/particles and pill brand chrome; added a simple brand rule, perforation line and flat neon actions. |
| `/login`, `/register` | BrandedAuth / PGAuthShell | Preserved photographic header and display title. Added theme-aware form stock, borders, fields, provider buttons and legal footer. Inputs and form actions remain at least 48px high. |
| Registration verification step | BrandedAuth | Verification text, notice, resend and alternate-email controls share the form tokens; all existing state/handlers remain. |
| `/forgot-password`, `/reset-password` | BrandedAuth | Reset-unavailable, notice, busy/disabled and return-link presentation shares the same form styles. No token handling or submission changes. |
| `/terms`, `/privacy`, `/cookies` | Legal pages | Shared canvas/header presentation and 44px back buttons with accessible names. Existing document typography, body widths, content and injected-provider CSS are preserved. |
| Privacy loading/error/ready | PrivacyPolicy | Tokenized loading/error surfaces and retry button; provider script lifecycle and rendered-document styling are untouched. |
| `/our-story` | OurStory | Retained explicitly dark photo essay, editorial/serif/mono typography, content and photographs. Replaced rave/glow chrome with the shared header; aligned perforation colors with its canvas. |
| Unmatched URL | PageNotFound | Replaced white/slate template styling with PG tokens, display type, flat action, state panel and scrollable viewport. Existing admin-note condition and home handler are preserved. |
| Lazy route loading | RouteFallback | Shared theme-aware canvas, simpler logo treatment and brand-colored spinner. |
| Member access awaiting approval | UserNotRegisteredError | Theme-aware state panel, readable countdown/sign-out text and at least 44px actions. Approval checks, retry/polling and sign-out handlers are preserved. |
| Member first-use presentation | Onboarding | Preserved slides, photographs, headline type/colors, swipe/next/back/finish handlers. Flattened tag/skip/action chrome, made the viewport scrollable, and gave skip/back/progress controls 44px targets. Progress markers now use buttons with the existing selection handler and accessible slide labels. |

Onboarding and awaiting approval are member-entry states, not separately routable public pages. They are included because they render outside the member layout wrapper.

## Shared presentation

`src/components/PublicPage.jsx` invokes the existing `useTheme` hook so direct public loads receive the same saved theme as member routes. Preference resolution/storage behavior is not modified. `src/components/public-page.css` consumes the global PG variables supplied by the root pass, uses 8–10px control/surface corners, simple dashed separators and theme-aware text/borders. Photographic landing/auth/onboarding areas retain explicit pale text on their photographs; auth fields and notices use theme-aware surfaces. Our Story retains its explicit `.dark` scope.

## Verification and limits

- Targeted ESLint passed for PublicPage, PGAuthShell, RouteFallback, UserNotRegisteredError, Onboarding, Landing, BrandedAuth, TermsOfService, PrivacyPolicy, CookiePolicy and OurStory.
- PageNotFound is outside the repository's default JSX lint scope. Applying the same JSX lint configuration specifically to that file reported no errors and one existing unused `error` catch-binding warning.
- `git diff --check` passed for the changed tracked presentation files.
- Diff review confirmed no changes to photograph URLs, policy prose, auth submission logic, reset-token handling, route destinations, approval polling or onboarding completion handlers.
- No automated tests, browser rendering, provider requests, live authentication, account actions, commits or deployment were performed in this focused pass.

Live visual checks still needed: 320px/390px and short landscape viewports; light/dark legal and auth surfaces; keyboard-open form scrolling; auth busy/error/verification/reset-unavailable states; privacy loading/error/provider tables; long 404 pathname and optional admin note; approval idle/checking; all five onboarding slides and progress controls; Our Story long-scroll header and photo essay. This source pass does not claim those live states were exercised.
