# Listing sharing: isolated browser evidence

All data is fictional. This local fixture aliases the SDK, blocks mutations and intercepts external requests. No real account, provider API, purchase, reservation or hosted route was exercised.

- `result.json`: ten initial cases passed, including four viewport/theme dialog combinations, both actual PNG dimensions, simulated native-share cancellation, stale availability, guest success/missing/provider failure and exact event handoff.
- `modal-auth-recheck.json`: three targeted cases passed after the localized modal correction. Its two dialog screenshots show the final 12px margins and feedback-widget coverage. The guest 403 screenshot shows PG sign-in with the exact listing retained in `from_url`.
- `*-before-modal-fix.png`: historical images only; use the corrected `share-320-dark.png` and `share-390-light.png` to assess the final dialog.
- `square.png` and `story.png`: actual local download outputs, 1080×1080 and 1080×1920 respectively.

The fixture's remote brand logo is intentionally blocked and appears broken behind the modal; this is not a result about the production logo. The exported art uses only generated shapes/text/QR and no remote imagery.

A first immediate focus assertion ran before Radix's close autofocus completed. The runner now waits for that actual focus state; Escape returned focus to the original Share listing button in all observed cases. Native share cancellation is simulated, not physical iPhone verification. Real camera scanning, hosted public routing and TestFlight remain unverified here.
