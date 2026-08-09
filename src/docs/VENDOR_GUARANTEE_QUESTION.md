/**
 * Vendor Guarantee Question (7C.9C.2E Task 6)
 *
 * This is the exact support question for owner submission to Base44.
 * Until Base44 provides a written affirmative answer, CAS is described as
 * empirically observed — not sufficiently guaranteed for a real-money
 * production reservation system.
 */

# Base44 updateMany Atomicity — Vendor Guarantee Question

## Question for Base44 Support

Does Base44 `updateMany` evaluate the query predicate and apply the update
atomically per matching record under concurrent requests, such that
`updateMany({id, version: expected}, {$set:{version: next}})` guarantees at
most one winner?

Is this behavior officially supported and stable, or merely an implementation
detail that may change?

## Context

A live probe using synthetic `ListingPrivate` records tested Base44's
`updateMany` with a conditional filter predicate under 20-way concurrency.
The probe ran 10 independent rounds. Each round launched 20 concurrent
`updateMany` calls with the predicate `{ id: recordId, reservation_version:
expectedVersion, checkout_quarantined: false }` and `$set` with a new
`reservation_version`.

**Result**: All 10 rounds produced exactly 1 winner (1 call returned
`updated: 1`, 19 returned `updated: 0`). This is consistent with atomic
compare-and-set behavior.

However, this behavior is not documented in the official Base44 SDK
documentation. The `updateMany` method is described as a batch update
operation, not as an atomic conditional update primitive.

## Why This Matters

The Peanut Gallery marketplace handles real-money transactions (Stripe
payments). The reservation system must guarantee that at most one concurrent
checkout can reserve a given listing. If `updateMany` atomicity is an
implementation detail that may change, a silent platform update could break
the reservation system without warning, allowing double-spending.

## What We Need

A written statement from Base44 confirming one of the following:

1. **Affirmative**: `updateMany` with a filter predicate is an atomic
   conditional update per matching record. This behavior is officially
   supported and stable. It will not change without documented notice.

2. **Negative**: `updateMany` is not guaranteed to be atomic. The observed
   behavior is an implementation detail. A different approach (external
   transactional authority) is required for production safety.

Until we receive a written affirmative answer, we will treat the CAS behavior
as empirically observed but not sufficiently guaranteed for a real-money
production reservation system. The launch gate will remain RED.