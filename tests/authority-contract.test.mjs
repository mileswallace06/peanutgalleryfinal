/**
 * Authority Contract Tests (7C.9C.2F.2)
 *
 * Validates:
 *   1. SQL artifact inventory (all 4 files exist)
 *   2. State consistency (13 states across schema, functions, document)
 *   3. Absence of public token/buyer projection in mirror specification
 *   4. No undeclared `_` placeholders in PL/pgSQL
 *   5. No BEGIN/COMMIT inside function bodies
 *   6. acquire_operation uses INSERT ... ON CONFLICT DO NOTHING RETURNING
 *   7. bind_payment_intent function exists
 *   8. record_capture_result does NOT finalize
 *   9. finalize_sale is separate
 *  10. payment_actions has leasing fields
 *  11. stripe_webhook_events has leasing fields
 *  12. One-active-binding index covers all unsettled-obligation states
 *  13. SECURITY DEFINER with hardened search_path on all functions
 *  14. No process.env for AUTHORITY_DB_URL in architecture document
 *  15. Server derives operation IDs (no raw client operation ID)
 *
 * Classification:
 *   - static contract check: structural validation of file content
 *   - SQL parse/compile check: NOT performed (no psql available)
 *   - real PostgreSQL runtime test: NOT performed (no PostgreSQL available)
 *   - not yet tested: clearly labeled
 *
 * IMPORTANT: These tests do NOT use substring checks as proof of transactional
 * behavior. They validate structural contracts (file existence, field
 * presence, state enumeration consistency). Transactional behavior (CAS
 * atomicity, exactly-one-winner, rollback) requires a real PostgreSQL
 * runtime test — classified as "not yet tested."
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, fn, classification = 'static contract check') {
  try {
    const result = fn();
    if (result === false) throw new Error('check returned false');
    console.log(`[PASS] ${name}  [${classification}]`);
    passed++;
  } catch (e) {
    console.log(`[FAIL] ${name}  [${classification}]`);
    console.log(`  ${e.message}`);
    failures.push(name);
    failed++;
  }
}

// ── File paths ──────────────────────────────────────────────────────────────
const SQL_SCHEMA = join(ROOT, 'database/authority_v1/001_schema.sql');
const SQL_FUNCTIONS = join(ROOT, 'database/authority_v1/002_functions.sql');
const SQL_ROLES = join(ROOT, 'database/authority_v1/003_roles_and_grants.sql');
const SQL_WORKERS = join(ROOT, 'database/authority_v1/004_workers.sql');
const DOC = join(ROOT, 'src/docs/ATOMICITY_ARCHITECTURE_DECISION.md');

// ── Load file contents ─────────────────────────────────────────────────────
const schema = existsSync(SQL_SCHEMA) ? readFileSync(SQL_SCHEMA, 'utf8') : '';
const functions = existsSync(SQL_FUNCTIONS) ? readFileSync(SQL_FUNCTIONS, 'utf8') : '';
const roles = existsSync(SQL_ROLES) ? readFileSync(SQL_ROLES, 'utf8') : '';
const workers = existsSync(SQL_WORKERS) ? readFileSync(SQL_WORKERS, 'utf8') : '';
const doc = existsSync(DOC) ? readFileSync(DOC, 'utf8') : '';

// ═══════════════════════════════════════════════════════════════════════════
// TEST 1: All 4 SQL artifact files exist
// ═══════════════════════════════════════════════════════════════════════════
check('artifact_001_schema_exists', () => existsSync(SQL_SCHEMA));
check('artifact_002_functions_exists', () => existsSync(SQL_FUNCTIONS));
check('artifact_003_roles_exists', () => existsSync(SQL_ROLES));
check('artifact_004_workers_exists', () => existsSync(SQL_WORKERS));

// ═══════════════════════════════════════════════════════════════════════════
// TEST 2: 13-state consistency — schema CHECK constraint
// ═══════════════════════════════════════════════════════════════════════════
const STATES_13 = [
  'authorized',
  'capture_requested', 'capture_unknown', 'captured', 'finalized',
  'cancel_requested', 'cancel_unknown', 'canceled',
  'refund_requested', 'refund_unknown', 'refunded',
  'aborted', 'failed',
];

check('schema_has_13_capture_states', () => {
  for (const s of STATES_13) {
    if (!schema.includes(`'${s}'`)) {
      throw new Error(`schema missing state '${s}' in CHECK constraint`);
    }
  }
  // Verify no 14th state
  if (schema.includes("'cancel_pending'")) throw new Error('unexpected 14th state');
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 3: One-active-binding index covers all unsettled-obligation states
// ═══════════════════════════════════════════════════════════════════════════
const UNSETTLED_STATES = [
  'authorized',
  'capture_requested', 'capture_unknown', 'captured',
  'cancel_requested', 'cancel_unknown',
  'refund_requested', 'refund_unknown',
];

check('one_active_binding_index_covers_all_unsettled_states', () => {
  // Find the idx_one_active_binding_per_listing definition
  const idxMatch = schema.match(/idx_one_active_binding_per_listing[\s\S]*?WHERE capture_state IN \(([\s\S]*?)\)/);
  if (!idxMatch) throw new Error('idx_one_active_binding_per_listing not found');
  const indexStates = idxMatch[1];
  for (const s of UNSETTLED_STATES) {
    if (!indexStates.includes(`'${s}'`)) {
      throw new Error(`one-active-binding index missing unsettled state '${s}'`);
    }
  }
  // Verify terminal states are NOT in the index
  for (const s of ['finalized', 'canceled', 'refunded', 'aborted', 'failed']) {
    if (indexStates.includes(`'${s}'`)) {
      throw new Error(`one-active-binding index should NOT include terminal state '${s}'`);
    }
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 4: No undeclared `_` placeholders in PL/pgSQL SELECT INTO
// ═══════════════════════════════════════════════════════════════════════════
check('no_underscore_placeholders_in_select_into', () => {
  const matches = [...functions.matchAll(/SELECT \* INTO\s+[^;]+_\s*,/gi)];
  if (matches.length > 0) {
    throw new Error(`found ${matches.length} undeclared '_' placeholder(s) in SELECT INTO`);
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 5: No BEGIN/COMMIT inside function bodies (only DECLARE...BEGIN...END)
// ═══════════════════════════════════════════════════════════════════════════
check('no_explicit_transaction_control_in_functions', () => {
  // Look for standalone BEGIN; or COMMIT; statements (not the function body BEGIN)
  // The function body starts with $$ ... DECLARE ... BEGIN ... END; $$
  // A standalone "BEGIN;" or "COMMIT;" would be transaction control.
  const lines = functions.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    // Skip lines that are part of function body (BEGIN ... END blocks)
    // We're looking for standalone BEGIN; or COMMIT; outside of $$ blocks
    if (trimmed === 'BEGIN;' || trimmed === 'COMMIT;' || trimmed === 'BEGIN' || trimmed === 'COMMIT') {
      // Check if we're inside a $$ block
      // Simple heuristic: count $$ delimiters
      let dollarCount = 0;
      for (let j = 0; j <= i; j++) {
        dollarCount += (lines[j].match(/\$\$/g) || []).length;
      }
      if (dollarCount % 2 === 0) {
        // Outside a function body — this is transaction control
        throw new Error(`line ${i + 1}: transaction control '${trimmed}' outside function body`);
      }
    }
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 6: acquire_operation uses INSERT ... ON CONFLICT DO NOTHING RETURNING
// ═══════════════════════════════════════════════════════════════════════════
check('acquire_operation_uses_returning', () => {
  if (!functions.includes('ON CONFLICT (operation_id) DO NOTHING')) {
    throw new Error('acquire_operation does not use ON CONFLICT DO NOTHING');
  }
  if (!functions.includes('RETURNING operation_id INTO v_inserted')) {
    throw new Error('acquire_operation does not use RETURNING to distinguish new vs existing');
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 7: bind_payment_intent function exists
// ═══════════════════════════════════════════════════════════════════════════
check('bind_payment_intent_exists', () => {
  if (!functions.includes('CREATE OR REPLACE FUNCTION authority_v1.bind_payment_intent')) {
    throw new Error('bind_payment_intent function not found');
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 8: record_capture_result does NOT finalize (no sold transition)
// ═══════════════════════════════════════════════════════════════════════════
check('record_capture_result_does_not_finalize', () => {
  // Extract the record_capture_result function body
  const fnStart = functions.indexOf('CREATE OR REPLACE FUNCTION authority_v1.record_capture_result');
  const fnEnd = functions.indexOf('$$;', fnStart);
  if (fnStart < 0 || fnEnd < 0) throw new Error('record_capture_result not found');
  const fnBody = functions.substring(fnStart, fnEnd);
  // It should set binding to 'captured' but NOT set lifecycle_state to 'sold'
  if (!fnBody.includes("'captured'")) throw new Error("record_capture_result should set binding to 'captured'");
  if (fnBody.includes("'sold'")) throw new Error("record_capture_result must NOT finalize (no 'sold' transition)");
  if (fnBody.includes("'finalized'")) throw new Error("record_capture_result must NOT set binding to 'finalized'");
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 9: finalize_sale is a separate function
// ═══════════════════════════════════════════════════════════════════════════
check('finalize_sale_is_separate', () => {
  if (!functions.includes('CREATE OR REPLACE FUNCTION authority_v1.finalize_sale')) {
    throw new Error('finalize_sale function not found');
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 10: payment_actions has leasing fields
// ═══════════════════════════════════════════════════════════════════════════
check('payment_actions_has_lease_fields', () => {
  const required = ['lease_owner', 'lease_expires_at', 'claimed_at',
    'attempt_count', 'max_attempts', 'next_attempt_at', 'last_error'];
  for (const f of required) {
    if (!schema.includes(f)) throw new Error(`payment_actions missing lease field '${f}'`);
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 11: stripe_webhook_events has leasing fields
// ═══════════════════════════════════════════════════════════════════════════
check('webhook_events_has_lease_fields', () => {
  const required = ['lease_owner', 'lease_expires_at', 'claimed_at',
    'attempt_count', 'max_attempts', 'next_attempt_at', 'last_error'];
  // Check the webhook table section
  const webhookStart = schema.indexOf('stripe_webhook_events');
  const webhookEnd = schema.indexOf(';', webhookStart + 200);
  const webhookSection = schema.substring(webhookStart, webhookEnd + 500);
  for (const f of required) {
    if (!webhookSection.includes(f)) throw new Error(`stripe_webhook_events missing lease field '${f}'`);
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 12: Workers file has claim and recover functions for all 3 entity types
// ═══════════════════════════════════════════════════════════════════════════
check('workers_has_outbox_claim_and_recover', () => {
  if (!workers.includes('claim_outbox_batch')) throw new Error('missing claim_outbox_batch');
  if (!workers.includes('recover_expired_outbox_leases')) throw new Error('missing recover_expired_outbox_leases');
  return true;
});

check('workers_has_payment_action_claim_and_recover', () => {
  if (!workers.includes('claim_payment_action')) throw new Error('missing claim_payment_action');
  if (!workers.includes('recover_expired_payment_action_leases')) throw new Error('missing recover_expired_payment_action_leases');
  return true;
});

check('workers_has_webhook_claim_and_recover', () => {
  if (!workers.includes('claim_webhook_event')) throw new Error('missing claim_webhook_event');
  if (!workers.includes('recover_expired_webhook_leases')) throw new Error('missing recover_expired_webhook_leases');
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 13: All functions use SECURITY DEFINER with hardened search_path
// ═══════════════════════════════════════════════════════════════════════════
check('all_functions_security_definer_hardened_search_path', () => {
  const fnCount = (functions.match(/CREATE OR REPLACE FUNCTION authority_v1\./g) || []).length;
  const sdCount = (functions.match(/SECURITY DEFINER/g) || []).length;
  const spCount = (functions.match(/SET search_path = authority_v1, pg_catalog/g) || []).length;
  if (fnCount === 0) throw new Error('no functions found');
  if (sdCount !== fnCount) throw new Error(`${sdCount} SECURITY DEFINER vs ${fnCount} functions`);
  if (spCount !== fnCount) throw new Error(`${spCount} hardened search_path vs ${fnCount} functions`);
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 14: No process.env for AUTHORITY_DB_URL in architecture document
// ═══════════════════════════════════════════════════════════════════════════
check('doc_uses_secrets_not_process_env', () => {
  // The document should reference secrets.get, not process.env for AUTHORITY_DB_URL
  if (doc.includes('process.env.AUTHORITY_DB_URL')) {
    throw new Error('document still references process.env.AUTHORITY_DB_URL');
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 15: No public token/buyer projection in mirror specification
// ═══════════════════════════════════════════════════════════════════════════
check('no_public_token_or_buyer_in_mirror', () => {
  // The document's mirror projection section should NOT list reservation_token
  // or reserved_by_email as public mirror fields.
  // Find the "MIRROR PROJECTIONS on Base44 Listing" section
  const mirrorSection = doc.match(/Fields that become MIRROR PROJECTIONS on Base44 `Listing`[\s\S]*?(?=\n####|\n###|\n---)/);
  if (!mirrorSection) throw new Error('mirror projection section not found');
  const mirrorText = mirrorSection[0];
  // Should NOT contain reservation_token (plaintext) or reserved_by_email
  if (/reservation_token[^_hash]/.test(mirrorText.replace(/reservation_token_hash/g, ''))) {
    throw new Error('public mirror still projects reservation_token');
  }
  if (mirrorText.includes('reserved_by_email')) {
    throw new Error('public mirror still projects reserved_by_email (buyer email)');
  }
  if (mirrorText.includes('buyer_user_id')) {
    throw new Error('public mirror still projects buyer_user_id');
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 16: cancel_unknown is a real state (13 states, not 12)
// ═══════════════════════════════════════════════════════════════════════════
check('cancel_unknown_is_real_state', () => {
  if (!schema.includes("'cancel_unknown'")) throw new Error("schema missing 'cancel_unknown' state");
  if (!functions.includes("'cancel_unknown'")) throw new Error("functions missing 'cancel_unknown' state");
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 17: Server derives operation IDs (parameter named p_server_operation_id)
// ═══════════════════════════════════════════════════════════════════════════
check('server_derives_operation_ids', () => {
  // All functions should use p_server_operation_id, not p_operation_id
  if (functions.includes('p_operation_id ')) {
    throw new Error('functions still use p_operation_id (should be p_server_operation_id)');
  }
  if (!functions.includes('p_server_operation_id')) {
    throw new Error('functions do not use p_server_operation_id');
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 18: Roles file has NOLOGIN owner and separate executor boundaries
// ═══════════════════════════════════════════════════════════════════════════
check('roles_has_nologin_owner', () => {
  if (!roles.includes('authority_owner NOLOGIN')) throw new Error('authority_owner is not NOLOGIN');
  return true;
});

check('roles_has_separate_executor_and_stripe_recorder', () => {
  if (!roles.includes('authority_executor')) throw new Error('missing authority_executor role');
  if (!roles.includes('authority_stripe_recorder')) throw new Error('missing authority_stripe_recorder role');
  return true;
});

check('roles_revokes_create_from_public', () => {
  if (!roles.includes('REVOKE CREATE ON SCHEMA authority_v1 FROM PUBLIC')) {
    throw new Error('CREATE not revoked from PUBLIC');
  }
  return true;
});

check('roles_revokes_table_privileges_from_executors', () => {
  if (!roles.includes('REVOKE ALL PRIVILEGES ON ALL TABLES')) {
    throw new Error('table privileges not revoked from executor roles');
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 19: Document references SQL artifacts as source of truth
// ═══════════════════════════════════════════════════════════════════════════
check('doc_references_sql_artifacts', () => {
  if (!doc.includes('database/authority_v1/001_schema.sql')) throw new Error('doc does not reference 001_schema.sql');
  if (!doc.includes('database/authority_v1/002_functions.sql')) throw new Error('doc does not reference 002_functions.sql');
  if (!doc.includes('database/authority_v1/003_roles_and_grants.sql')) throw new Error('doc does not reference 003_roles_and_grants.sql');
  if (!doc.includes('database/authority_v1/004_workers.sql')) throw new Error('doc does not reference 004_workers.sql');
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 20: No "capture first, freeze second" language in spec body
// ═══════════════════════════════════════════════════════════════════════════
check('no_capture_first_freeze_second', () => {
  const changeLogStart = doc.indexOf('## 18. Correction Change Log');
  const specBody = changeLogStart >= 0 ? doc.substring(0, changeLogStart) : doc;
  if (/capture.{0,30}first.{0,30}freeze|freeze.{0,30}after.{0,30}capture/i.test(specBody)) {
    throw new Error('spec body still contains "capture first, freeze second" language');
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// NOT YET TESTED: SQL parse/compile and real PostgreSQL runtime
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── NOT YET TESTED ──');
console.log('[SKIP] sql_parse_compile — no psql available  [not yet tested]');
console.log('[SKIP] real_postgres_runtime — no PostgreSQL instance available  [not yet tested]');
console.log('[SKIP] cas_atomicity_runtime — requires real PostgreSQL  [not yet tested]');
console.log('[SKIP] exactly_one_winner_concurrency — requires real PostgreSQL  [not yet tested]');
console.log('[SKIP] rollback_verification — requires real PostgreSQL  [not yet tested]');
console.log('[SKIP] unique_constraint_runtime — requires real PostgreSQL  [not yet tested]');

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n=== Authority Contract Tests ===`);
console.log(`Tests run: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
console.log(`Overall: ${failed === 0 ? 'PASS' : 'FAIL'}`);
if (failed > 0) {
  console.log(`Failed: ${failures.join(', ')}`);
  process.exit(1);
}