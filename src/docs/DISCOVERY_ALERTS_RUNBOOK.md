# Discovery alert activation and limits

This change implements saved preferences and in-app notification processing locally. It has not deployed schemas/functions, set remote secrets, created a schedule, contacted Ticketmaster, or sent any real notification. `DISCOVERY_ALERTS_ENABLED` defaults off. A saved preference is not proof that delivery is active.

## Included behavior

- `manageDiscoveryAlerts` authenticates the current user and derives both user ID and recipient email from that identity. Request-supplied recipient fields are ignored. New entities are admin-write-only with owner reads; users manage their own records through the endpoint.
- An event watch is separate from DonationOptIn. New watches require a real local Event with a Ticketmaster ID; native events without that provider identity return `supported: false` and reject enabling with `event_alert_not_supported`. Disabling remains possible for removed/unsupported events.
- Bucket List preferences are an explicit opt-in. Saved attractions match provider attraction IDs and require consent, an explicitly selected city event-venue area, and a radius of 10, 25, 50 or 100 miles. Saved venues match stable provider venue IDs and need no location. Coordinates are rounded to two decimals; no ongoing/device location is collected. Removing location consent clears the saved coordinates and radius.
- The city resolver uses the median coordinates of up to 20 exact city/state US venue matches from Ticketmaster. It is an approximate event-venue area, not a geocoded city center. The UI labels it accordingly and requires confirmation.
- The processor uses only recent provider-verified, onsale, unambiguous event timestamps. Bucket matches must start in the future. Upgrade watches can match during the confirmed end window, or a conservative four-hour estimated window when the provider supplies no end. TBA, canceled, postponed, invalid and stale events do not alert. Bucket discovery requires `onsale`; upgrade watches also accept `offsale` while timing and inventory remain eligible, because ended primary ticket sales do not determine PG upgrade availability.
- Upgrade eligibility is deliberately stricter than the existing public listing reader: one matching approved private sidecar, real active upgrade inventory, positive quantity/price, matching available lifecycle/mirror versions, no pending effects, no hold tuple, no quarantine/pause/cancel state, no demo/test evidence, and open listing/event windows. Owner inventory is excluded. Missing authority metadata suppresses delivery; alerts never grant purchase rights.
- Existing `notif_upgrade_alerts: false` suppresses event watches. Bucket preferences are their own explicit opt-in; the legacy generic nearby-events account toggle does not enable or disable this feature.
- Notification types are `upgrade_available` and `bucket_list_event`. Delivery is in-app only. The code makes no push/email/provider notification calls and imports no payment or purchase modules.

## Frontend contract

All calls use `base44.functions.invoke('manageDiscoveryAlerts', body)` and read `response.data`.

| Action | Input | Result |
| --- | --- | --- |
| `get_event` | `event_id` | `{ enabled, supported, service_active }` |
| `set_event` | `event_id`, boolean `enabled` | `{ enabled, service_active }` |
| `get_preferences` | no additional input | `{ enabled, location_consent, city_label, latitude, longitude, radius_miles, service_active }` |
| `set_preferences` | the preference fields above except `service_active` | the saved preference fields plus `service_active` |
| `resolve_city` | `city`, two-letter uppercase `state` | `{ city_label, latitude, longitude, location_source: 'venue_area', service_active }` |

Missing preferences are disabled with null location. `service_active` reflects the server activation flag; it does not inspect the external scheduler's current health. Keep it false until deployment and schedule verification are complete. Missing/false flags must show that alerts are inactive, even when preferences were saved successfully.

## Activation prerequisites — not performed

1. Review and deploy `DiscoveryAlertPreference`, `DiscoveryAlertSubscription`, `DiscoveryEventCache`, the two Notification type additions, and both new functions/shared dependencies. Deploy the isolated cache ingest addition to `getTicketmasterEvents` and the frontend changes together.
2. Verify the production entity API supports the worker's ordered `id > cursor` keyset filters. The worker rejects nonadvancing pages; it never treats an unsupported cursor or scan cap as complete coverage.
3. Deploy the narrow `deleteAccount` cleanup addition alongside the new schemas. It removes both new per-user entities using the resolved target User ID or target email, preserving the existing authorization and deletion flow. This also removes records saved before an email change. The processor independently skips missing User records.
4. Configure the existing server-only `Ticketmaster_consumer_key`. For an external scheduler, configure `DISCOVERY_ALERT_SCHEDULER_SECRET` with a random secret at least 32 characters long. Never expose either key in the frontend.
5. Configure a serialized, nonoverlapping scheduler to POST to `processDiscoveryAlerts`, for example every five minutes, with the exact `x-discovery-scheduler-secret` header. Authenticated admins may also call the endpoint. A missing session alone is rejected; `x-base44-service-role` is not a bypass. The existing sessionless Base44 automation pattern is not sufficient unless it can securely supply the configured secret. No workflow is activated in this patch.
6. After the approved deployment and controlled schedule/auth checks, set `DISCOVERY_ALERTS_ENABLED=true`. The worker returns 503 while disabled. Monitor non-2xx execution results; do not suppress them in the scheduler. Set the flag false to stop future processing while keeping saved preferences.

## Coverage and bounded operation

Bucket List coverage is **events Peanut Gallery discovers**, not Ticketmaster's complete catalog. Only after `DISCOVERY_ALERTS_ENABLED=true`, successful `getTicketmasterEvents` responses opportunistically cache at most the first eight raw provider results. The cache warms after activation; default-off discovery performs no added cache or service-role calls. The existing runtime awaits this bounded cache work before returning the search response; failed cache writes are caught and do not change search results. This adds up to two datastore-operation rounds to response latency (eight concurrent lookups followed by up to eight writes). No new runtime dependency or unretained fire-and-forget task is introduced. Measure deployed latency and successful writes before claiming delivery is active. Metadata older than six hours is ineligible. No historical backfill, catalog crawler, or general attraction/venue polling is included.

Event watches do not rely on earlier search-cache coverage: each run refreshes watched Ticketmaster IDs with the server key before reading eligible inventory. Refresh is bounded to 20 distinct watched events and four concurrent provider requests, with a five-second timeout per request. A provider 404 creates an unavailable tombstone. Any refresh error stops delivery for that run instead of falling back to stale data. Native events without a provider ID are explicitly unsupported.

A run allows at most 100 opted-in recipient identities, 20 distinct watched events, 2,000 rows per bounded entity scan, and 200 candidate notifications. Limits, unsupported pagination, and datastore errors return non-2xx instead of silently processing only the first page. Above those limits, implement a durable cursor or sharded scheduler before increasing capacity. Disabled/old records still count toward the underlying scan limit and need an explicit retention policy. No destructive cleanup is part of this patch.

## Idempotency and inbox behavior

Upgrade idempotency keys use recipient user ID plus local event ID: one logical available-upgrade alert per watched event. Bucket keys use recipient user ID, provider event ID and start timestamp: a rescheduled future show can produce a new notice. Overlapping follows for the same show collapse into one alert.

The datastore lacks an atomic unique-key insert. The processor creates pending records, selects one canonical ID, supersedes duplicate records and publishes the canonical in-app record. Inbox and badge readers hide undispatched discovery records and deduplicate published discovery keys. Transactional notification behavior remains unchanged. Retrying a completed run preserves existing read state. This is convergent in-app deduplication, not a claim of atomic exactly-once external delivery; serialize the scheduler and retain the hidden duplicates for audit. The processor re-reads the current user, watch/preference, followed items and upgrade inventory before each publication, and evaluates timing again using the current clock. This prevents a long provider refresh from using an obsolete opt-in or expired window. A final concurrent change between that check and creation cannot be atomic in this datastore. A failed datastore write returns non-2xx for retry. Availability can change after an alert, so the message links to the current event inventory and says so.

## Local validation

Run:

```sh
node --test tests/discovery-alerts.test.mjs tests/discovery-alert-security.test.mjs tests/discovery-notification-visibility.test.mjs tests/discovery-alert-account-deletion.test.mjs tests/discovery-cache-rollout.test.mjs
```

The tests use in-memory adapters and an isolated endpoint VM. They cover authenticated identity scoping, admin/secret scheduler gates before service access, location consent/radius, provider freshness and timing, held/hidden/demo/unapproved inventory, canonical recipient deduplication, retry/read preservation, opt-outs, missing users, pagination errors, provider refresh failure/404/ID binding, capacity bounds and inbox visibility. No real API, database, payment or messaging operation is used.
