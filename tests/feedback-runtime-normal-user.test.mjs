#!/usr/bin/env node
/**
 * feedback-runtime-normal-user.test.mjs — M0.3 normal-user runtime tests.
 *
 * STATUS: NEEDS_OWNER_ACTION
 *
 * This file documents the mandatory runtime proofs that must be executed with
 * a REAL non-admin authenticated test account. The build agent cannot execute
 * these tests because:
 *
 *   1. exec_tool runs as the app owner (admin) and bypasses RLS — it cannot
 *      simulate a non-admin session or test RLS denial.
 *   2. test_backend_function runs as admin — cannot test the normal-user path.
 *   3. No tool can create a non-admin authenticated session or impersonate one.
 *
 * The app owner must manually execute these 10 proofs using a real non-admin
 * account (e.g., via a browser session or a dedicated test harness) and record
 * the results. M0 remains FAIL until these pass.
 *
 * ── Required Proofs ────────────────────────────────────────────────────────
 *
 *  1. First submitFeedback call → 200 with record ID.
 *     - Authenticate as a non-admin user.
 *     - POST to submitFeedback with { feedback_type: 'bug', page: '/events' }.
 *     - Assert: HTTP 200, response body { status: 'submitted', id: '<uuid>' }.
 *
 *  2. Exact created record contains the authenticated user's ID in submitter_user_id.
 *     - As admin, read the record by the returned ID.
 *     - Assert: record.submitter_user_id === the non-admin user's ID.
 *
 *  3. Spoofed submitter_user_id, user_email, user_name, and created_by_id request
 *     values are ignored.
 *     - As the non-admin user, POST to submitFeedback with:
 *       { feedback_type: 'idea', page: '/me',
 *         submitter_user_id: 'spoof-attacker-id',
 *         user_email: 'attacker@example.com',
 *         user_name: 'Attacker',
 *         created_by_id: 'spoof-attacker-id' }
 *     - Wait 61s (or until cooldown expires).
 *     - Assert: HTTP 200, and the created record's submitter_user_id is the
 *       real user's ID, NOT 'spoof-attacker-id'.
 *
 *  4. Immediate second call → 429.
 *     - Immediately after proof 1 or 3, POST again.
 *     - Assert: HTTP 429, body { error: 'cooldown', retry_after: <number> }.
 *
 *  5. Anonymous function call → 401.
 *     - Without any authentication, POST to submitFeedback.
 *     - Assert: HTTP 401, body { error: 'Unauthorized' }.
 *
 *  6. Authenticated direct BetaFeedbackEvent.create() → denied.
 *     - As the non-admin user, attempt base44.entities.BetaFeedbackEvent.create(...)
 *       from the client SDK.
 *     - Assert: request is rejected (RLS create=false denies all non-admin).
 *
 *  7. Anonymous direct creation → denied.
 *     - Without authentication, attempt BetaFeedbackEvent.create(...).
 *     - Assert: request is rejected.
 *
 *  8. Normal user cannot read feedback records.
 *     - As the non-admin user, attempt base44.entities.BetaFeedbackEvent.list().
 *     - Assert: returns empty or is rejected (RLS read is admin-only).
 *
 *  9. Admin can read the created record.
 *     - As admin, base44.entities.BetaFeedbackEvent.get(id).
 *     - Assert: returns the record with correct submitter_user_id.
 *
 * 10. Delete the exact synthetic record and prove counts return to baseline.
 *     - As admin, delete the records created in proofs 1 and 3.
 *     - Assert: records are gone, and BetaFeedbackEvent count for that
 *       submitter_user_id returns to baseline (0 for a fresh test account).
 *
 * ── Exit Code ──────────────────────────────────────────────────────────────
 *
 * This file exits with code 0 (not a failure) but prints NEEDS_OWNER_ACTION.
 * It does NOT report PASS. M0 remains FAIL until the owner manually completes
 * the 10 proofs above and records the results.
 */

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║  feedback-runtime-normal-user.test.mjs — NEEDS_OWNER_ACTION   ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');
console.log('  STATUS: NEEDS_OWNER_ACTION');
console.log('  The build agent cannot execute non-admin runtime tests.');
console.log('  The app owner must manually complete the 10 proofs documented');
console.log('  in this file using a real non-admin authenticated account.');
console.log('  M0 remains FAIL until these proofs pass.\n');
process.exit(0);