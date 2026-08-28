/**
 * Authority Contract Tests (7C.9C.2F.2.1 — SQL Semantic Correction Gate)
 *
 * Validates:
 *   1. Correct artifact installation order (001→002→003→004)
 *   2. 15-state payment model (cancel_failed, refund_failed added)
 *   3. One-active-binding index covers all unsettled states
 *   4. Generic operation-ledger subject model (subject_type, subject_id, nullable listing_id)
 *   5. Deferred FK for initialize_listing
 *   6. initialize_listing does NOT use ON CONFLICT DO NOTHING for authority
 *   7. No duplicate action-completion mechanism (complete_payment_action removed)
 *   8. record_*_result: action-not-found before operation acquire
 *   9. record_*_result: every branch finishes with deterministic result
 *  10. record_*_result: exact row-count checks
 *  11. finalize_sale: exact matching capture action (listing, purchase, PI)
 *  12. begin_refund: does NOT accept capture_unknown
 *  13. Failed states: cancel_failed/refund_failed are unsettled (not generic failed)
 *  14. Exhausted lease escalation (binding + authority + incident)
 *  15. SECURITY DEFINER with pg_temp last in search_path
 *  16. EXECUTE revoked from PUBLIC
 *  17. No hardcoded database name (uses current_database())
 *  18. Dedicated worker role (authority_worker)
 *  19. No public token/buyer in mirror
 *  20. No process.env for AUTHORITY_DB_URL
 *
 * Classification:
 *   - static contract check: structural validation of file content
 *   - SQL parse/compile check: NOT performed (no psql available)
 *   - real PostgreSQL runtime test: NOT performed (no PostgreSQL available)
 *
 * IMPORTANT: These tests do NOT use substring checks as proof of transactional
 * behavior. They validate structural contracts. Transactional behavior (CAS
 * atomicity, exactly-one-winner, rollback) requires a real PostgreSQL runtime
 * test — classified as "not yet tested."
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
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

// ── File paths (corrected order) ───────────────────────────────────────────
const SQL_SCHEMA = join(ROOT, 'database/authority_v1/001_schema.sql');
const SQL_FUNCTIONS = join(ROOT, 'database/authority_v1/002_functions.sql');
const SQL_WORKERS = join(ROOT, 'database/authority_v1/003_workers.sql');
const SQL_ROLES = join(ROOT, 'database/authority_v1/004_roles_and_grants.sql');
const DOC = join(ROOT, 'src/docs/ATOMICITY_ARCHITECTURE_DECISION.md');

// ── Load file contents ─────────────────────────────────────────────────────
const schema = existsSync(SQL_SCHEMA) ? readFileSync(SQL_SCHEMA, 'utf8') : '';
const functions = existsSync(SQL_FUNCTIONS) ? readFileSync(SQL_FUNCTIONS, 'utf8') : '';
const workers = existsSync(SQL_WORKERS) ? readFileSync(SQL_WORKERS, 'utf8') : '';
const roles = existsSync(SQL_ROLES) ? readFileSync(SQL_ROLES, 'utf8') : '';
const doc = existsSync(DOC) ? readFileSync(DOC, 'utf8') : '';

// ═══════════════════════════════════════════════════════════════════════════
// TEST 1: All 4 SQL artifact files exist in correct order
// ═══════════════════════════════════════════════════════════════════════════
check('artifact_001_schema_exists', () => existsSync(SQL_SCHEMA));
check('artifact_002_functions_exists', () => existsSync(SQL_FUNCTIONS));
check('artifact_003_workers_exists', () => existsSync(SQL_WORKERS));
check('artifact_004_roles_exists', () => existsSync(SQL_ROLES));

// ═══════════════════════════════════════════════════════════════════════════
// TEST 2: Correct artifact installation order (003=workers, 004=roles)
// ═══════════════════════════════════════════════════════════════════════════
check('artifact_order_003_is_workers', () => {
  if (!workers.includes('claim_outbox_batch')) throw new Error('003_workers.sql does not contain worker functions');
  if (!workers.includes('escalate_exhausted_payment_action')) throw new Error('003_workers.sql missing escalate_exhausted_payment_action');
  return true;
});

check('artifact_order_004_is_roles', () => {
  if (!roles.includes('authority_owner')) throw new Error('004_roles_and_grants.sql does not contain role definitions');
  if (!roles.includes('GRANT EXECUTE')) throw new Error('004_roles_and_grants.sql does not contain grants');
  return true;
});

check('no_old_003_roles_file', () => {
  const oldPath = join(ROOT, 'database/authority_v1/003_roles_and_grants.sql');
  if (existsSync(oldPath)) throw new Error('old 003_roles_and_grants.sql still exists — must be renamed to 004');
  return true;
});

check('no_old_004_workers_file', () => {
  const oldPath = join(ROOT, 'database/authority_v1/004_workers.sql');
  if (existsSync(oldPath)) throw new Error('old 004_workers.sql still exists — must be renamed to 003');
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 3: 15-state payment model (cancel_failed, refund_failed added)
// ═══════════════════════════════════════════════════════════════════════════
const STATES_15 = [
  'authorized',
  'capture_requested', 'capture_unknown', 'captured', 'finalized',
  'cancel_requested', 'cancel_unknown', 'cancel_failed', 'canceled',
  'refund_requested', 'refund_unknown', 'refund_failed', 'refunded',
  'aborted', 'failed',
];

check('schema_has_15_capture_states', () => {
  for (const s of STATES_15) {
    if (!schema.includes(`'${s}'`)) {
      throw new Error(`schema missing state '${s}' in CHECK constraint`);
    }
  }
  return true;
});

check('cancel_failed_is_real_state', () => {
  if (!schema.includes("'cancel_failed'")) throw new Error("schema missing 'cancel_failed' state");
  if (!functions.includes("'cancel_failed'")) throw new Error("functions missing 'cancel_failed' state");
  return true;
});

check('refund_failed_is_real_state', () => {
  if (!schema.includes("'refund_failed'")) throw new Error("schema missing 'refund_failed' state");
  if (!functions.includes("'refund_failed'")) throw new Error("functions missing 'refund_failed' state");
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 4: One-active-binding index covers all unsettled states
// ═══════════════════════════════════════════════════════════════════════════
const UNSETTLED_STATES = [
  'authorized',
  'capture_requested', 'capture_unknown', 'captured',
  'cancel_requested', 'cancel_unknown', 'cancel_failed',
  'refund_requested', 'refund_unknown', 'refund_failed',
];

check('one_active_binding_index_covers_all_unsettled_states', () => {
  const idxMatch = schema.match(/idx_one_active_binding_per_listing[\s\S]*?WHERE capture_state IN \(([\s\S]*?)\)/);
  if (!idxMatch) throw new Error('idx_one_active_binding_per_listing not found');
  const indexStates = idxMatch[1];
  for (const s of UNSETTLED_STATES) {
    if (!indexStates.includes(`'${s}'`)) {
      throw new Error(`one-active-binding index missing unsettled state '${s}'`);
    }
  }
  // Terminal states must NOT be in the index
  for (const s of ['finalized', 'canceled', 'refunded', 'aborted', 'failed']) {
    if (indexStates.includes(`'${s}'`)) {
      throw new Error(`one-active-binding index should NOT include terminal state '${s}'`);
    }
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 5: Generic operation-ledger subject model
// ═══════════════════════════════════════════════════════════════════════════
check('operations_has_subject_type', () => {
  if (!schema.includes('subject_type')) throw new Error('reservation_operations missing subject_type column');
  if (!schema.includes("CHECK (subject_type IN ('listing','user'))"))
    throw new Error('subject_type CHECK constraint missing listing/user values');
  return true;
});

check('operations_has_subject_id', () => {
  if (!schema.includes('subject_id')) throw new Error('reservation_operations missing subject_id column');
  return true;
});

check('operations_listing_id_nullable', () => {
  // listing_id must be nullable (no NOT NULL on the listing_id column in reservation_operations)
  const opsTableMatch = schema.match(/CREATE TABLE authority_v1\.reservation_operations[\s\S]*?\);/);
  if (!opsTableMatch) throw new Error('reservation_operations table not found');
  const opsTable = opsTableMatch[0];
  // The listing_id line must NOT have NOT NULL
  const listingIdLine = opsTable.match(/listing_id\s+TEXT.*?REFERENCES/);
  if (!listingIdLine) throw new Error('listing_id column not found in reservation_operations');
  if (listingIdLine[0].includes('NOT NULL')) {
    throw new Error('listing_id must be nullable in reservation_operations for initialize_listing and anonymize_user');
  }
  return true;
});

check('operations_listing_id_deferrable', () => {
  if (!schema.includes('DEFERRABLE INITIALLY DEFERRED')) {
    throw new Error('listing_id FK must be DEFERRABLE INITIALLY DEFERRED for initialize_listing');
  }
  return true;
});

check('operations_valid_subject_combination', () => {
  if (!schema.includes('valid_operation_subject_combination')) {
    throw new Error('missing valid_operation_subject_combination CHECK constraint');
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 6: initialize_listing does NOT use ON CONFLICT DO NOTHING for authority
// ═══════════════════════════════════════════════════════════════════════════
check('initialize_listing_no_on_conflict_for_authority', () => {
  const fnStart = functions.indexOf('CREATE OR REPLACE FUNCTION authority_v1.initialize_listing');
  const fnEnd = functions.indexOf('$$;', fnStart);
  if (fnStart < 0 || fnEnd < 0) throw new Error('initialize_listing not found');
  const fnBody = functions.substring(fnStart, fnEnd);
  // The authority INSERT must NOT use ON CONFLICT DO NOTHING
  // Find the INSERT INTO reservation_authority line
  const authInsertMatch = fnBody.match(/INSERT INTO reservation_authority[\s\S]*?;/);
  if (!authInsertMatch) throw new Error('initialize_listing has no INSERT INTO reservation_authority');
  if (authInsertMatch[0].includes('ON CONFLICT')) {
    throw new Error('initialize_listing must NOT use ON CONFLICT DO NOTHING for authority insert — must verify existing row matches seller');
  }
  // Must verify existing row matches seller
  if (!fnBody.includes('seller_user_id') || !fnBody.includes('INITIALIZE_CONFLICT')) {
    throw new Error('initialize_listing must verify existing row matches seller and return INITIALIZE_CONFLICT on mismatch');
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 7: No duplicate action-completion mechanism (complete_payment_action removed)
// ═══════════════════════════════════════════════════════════════════════════
check('no_complete_payment_action', () => {
  // complete_payment_action must NOT exist in any SQL file
  if (functions.includes('complete_payment_action')) {
    throw new Error('complete_payment_action must be removed — record_*_result is the single completion path');
  }
  if (workers.includes('complete_payment_action')) {
    throw new Error('complete_payment_action must be removed from workers — record_*_result is the single completion path');
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 8: record_*_result: action-not-found before operation acquire
// ═══════════════════════════════════════════════════════════════════════════
check('record_capture_action_not_found_before_acquire', () => {
  const fnStart = functions.indexOf('CREATE OR REPLACE FUNCTION authority_v1.record_capture_result');
  const fnEnd = functions.indexOf('$$;', fnStart);
  if (fnStart < 0 || fnEnd < 0) throw new Error('record_capture_result not found');
  const fnBody = functions.substring(fnStart, fnEnd);
  const notFoundIdx = fnBody.indexOf('ACTION_NOT_FOUND');
  const acquireIdx = fnBody.indexOf('acquire_operation');
  if (notFoundIdx < 0) throw new Error('record_capture_result missing ACTION_NOT_FOUND check');
  if (acquireIdx < 0) throw new Error('record_capture_result missing acquire_operation call');
  if (notFoundIdx > acquireIdx) {
    throw new Error('ACTION_NOT_FOUND must be checked BEFORE acquire_operation (prevents null listing_id)');
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 9: record_*_result: every branch finishes with deterministic result
// ═══════════════════════════════════════════════════════════════════════════
check('record_capture_all_branches_commit', () => {
  const fnStart = functions.indexOf('CREATE OR REPLACE FUNCTION authority_v1.record_capture_result');
  const fnEnd = functions.indexOf('$$;', fnStart);
  const fnBody = functions.substring(fnStart, fnEnd);
  // Count branches: succeeded, failed, unknown (ELSE)
  const hasSucceeded = fnBody.includes("p_result_derived = 'succeeded'");
  const hasFailed = fnBody.includes("p_result_derived = 'failed'");
  const hasElse = fnBody.includes('ELSE');
  if (!hasSucceeded || !hasFailed || !hasElse) throw new Error('not all branches present');
  // Every branch must update reservation_operations SET status = 'committed'
  const committedCount = (fnBody.match(/SET status = 'committed'/g) || []).length;
  if (committedCount < 3) {
    throw new Error(`expected at least 3 committed status updates (succeeded/failed/unknown), got ${committedCount}`);
  }
  return true;
});

check('record_cancel_all_branches_commit', () => {
  const fnStart = functions.indexOf('CREATE OR REPLACE FUNCTION authority_v1.record_cancel_result');
  const fnEnd = functions.indexOf('$$;', fnStart);
  const fnBody = functions.substring(fnStart, fnEnd);
  const committedCount = (fnBody.match(/SET status = 'committed'/g) || []).length;
  if (committedCount < 3) {
    throw new Error(`expected at least 3 committed status updates, got ${committedCount}`);
  }
  return true;
});

check('record_refund_all_branches_commit', () => {
  const fnStart = functions.indexOf('CREATE OR REPLACE FUNCTION authority_v1.record_refund_result');
  const fnEnd = functions.indexOf('$$;', fnStart);
  const fnBody = functions.substring(fnStart, fnEnd);
  const committedCount = (fnBody.match(/SET status = 'committed'/g) || []).length;
  if (committedCount < 3) {
    throw new Error(`expected at least 3 committed status updates, got ${committedCount}`);
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 10: record_*_result: exact row-count checks
// ═══════════════════════════════════════════════════════════════════════════
check('record_capture_has_row_count_checks', () => {
  const fnStart = functions.indexOf('CREATE OR REPLACE FUNCTION authority_v1.record_capture_result');
  const fnEnd = functions.indexOf('$$;', fnStart);
  const fnBody = functions.substring(fnStart, fnEnd);
  // Must have GET DIAGNOSTICS v_updated_count = ROW_COUNT and checks
  if (!fnBody.includes('GET DIAGNOSTICS')) throw new Error('missing GET DIAGNOSTICS row count checks');
  if (!fnBody.includes('ROW_COUNT')) throw new Error('missing ROW_COUNT checks');
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 11: finalize_sale requires exact matching capture action
// ═══════════════════════════════════════════════════════════════════════════
check('finalize_sale_exact_capture_match', () => {
  const fnStart = functions.indexOf('CREATE OR REPLACE FUNCTION authority_v1.finalize_sale');
  const fnEnd = functions.indexOf('$$;', fnStart);
  const fnBody = functions.substring(fnStart, fnEnd);
  // The capture action lookup must include listing_id AND payment_intent_id
  const captureLookup = fnBody.match(/SELECT \* INTO v_capture_action FROM payment_actions[\s\S]*?FOR UPDATE/);
  if (!captureLookup) throw new Error('finalize_sale missing capture action lookup');
  const lookup = captureLookup[0];
  if (!lookup.includes('listing_id = p_listing_id')) {
    throw new Error('finalize_sale capture action lookup must filter by listing_id');
  }
  if (!lookup.includes('payment_intent_id = p_payment_intent_id')) {
    throw new Error('finalize_sale capture action lookup must filter by payment_intent_id');
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 12: begin_refund does NOT accept capture_unknown
// ═══════════════════════════════════════════════════════════════════════════
check('begin_refund_no_capture_unknown', () => {
  const fnStart = functions.indexOf('CREATE OR REPLACE FUNCTION authority_v1.begin_refund');
  const fnEnd = functions.indexOf('$$;', fnStart);
  const fnBody = functions.substring(fnStart, fnEnd);
  // The binding lookup must NOT include capture_unknown
  const bindingLookup = fnBody.match(/SELECT \* INTO v_binding FROM reservation_payment_bindings[\s\S]*?FOR UPDATE/);
  if (!bindingLookup) throw new Error('begin_refund missing binding lookup');
  if (bindingLookup[0].includes("'capture_unknown'")) {
    throw new Error('begin_refund must NOT accept capture_unknown — resolve whether capture succeeded first');
  }
  // Must accept captured and finalized
  if (!bindingLookup[0].includes("'captured'")) throw new Error('begin_refund must accept captured');
  if (!bindingLookup[0].includes("'finalized'")) throw new Error('begin_refund must accept finalized');
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 13: Failed states: cancel_failed/refund_failed are unsettled
// ═══════════════════════════════════════════════════════════════════════════
check('cancel_failed_in_unsettled_index', () => {
  const idxMatch = schema.match(/idx_one_active_binding_per_listing[\s\S]*?WHERE capture_state IN \(([\s\S]*?)\)/);
  if (!idxMatch) throw new Error('one-active-binding index not found');
  if (!idxMatch[1].includes("'cancel_failed'")) {
    throw new Error('cancel_failed must be in the one-active-binding index (unsettled)');
  }
  return true;
});

check('refund_failed_in_unsettled_index', () => {
  const idxMatch = schema.match(/idx_one_active_binding_per_listing[\s\S]*?WHERE capture_state IN \(([\s\S]*?)\)/);
  if (!idxMatch) throw new Error('one-active-binding index not found');
  if (!idxMatch[1].includes("'refund_failed'")) {
    throw new Error('refund_failed must be in the one-active-binding index (unsettled)');
  }
  return true;
});

check('failed_only_for_capture_failure', () => {
  // The 'failed' state should only appear in record_capture_result, not in
  // record_cancel_result or record_refund_result (which use cancel_failed/refund_failed)
  const cancelFnStart = functions.indexOf('CREATE OR REPLACE FUNCTION authority_v1.record_cancel_result');
  const cancelFnEnd = functions.indexOf('$$;', cancelFnStart);
  const cancelFnBody = functions.substring(cancelFnStart, cancelFnEnd);
  // record_cancel_result must NOT set binding to 'failed' (it uses cancel_failed)
  if (cancelFnBody.includes("capture_state = 'failed'")) {
    throw new Error('record_cancel_result must NOT use generic failed — use cancel_failed');
  }

  const refundFnStart = functions.indexOf('CREATE OR REPLACE FUNCTION authority_v1.record_refund_result');
  const refundFnEnd = functions.indexOf('$$;', refundFnStart);
  const refundFnBody = functions.substring(refundFnStart, refundFnEnd);
  if (refundFnBody.includes("capture_state = 'failed'")) {
    throw new Error('record_refund_result must NOT use generic failed — use refund_failed');
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 14: Exhausted lease escalation (binding + authority + incident)
// ═══════════════════════════════════════════════════════════════════════════
check('escalate_exhausted_payment_action_exists', () => {
  if (!workers.includes('CREATE OR REPLACE FUNCTION authority_v1.escalate_exhausted_payment_action')) {
    throw new Error('escalate_exhausted_payment_action function not found');
  }
  return true;
});

check('escalate_updates_binding_and_authority', () => {
  const fnStart = workers.indexOf('CREATE OR REPLACE FUNCTION authority_v1.escalate_exhausted_payment_action');
  const fnEnd = workers.indexOf('$$;', fnStart);
  const fnBody = workers.substring(fnStart, fnEnd);
  // Must update binding to unknown state
  if (!fnBody.includes('reservation_payment_bindings')) throw new Error('must update binding');
  if (!fnBody.includes('capture_unknown') && !fnBody.includes('cancel_unknown') && !fnBody.includes('refund_unknown')) {
    throw new Error('must transition binding to appropriate unknown state');
  }
  // Must update authority (recovery_blocked)
  if (!fnBody.includes('reservation_authority')) throw new Error('must update authority');
  if (!fnBody.includes('recovery_blocked')) throw new Error('must set recovery_blocked on authority');
  // Must create incident
  if (!fnBody.includes('operational_incidents')) throw new Error('must create operational incident');
  return true;
});

check('escalate_exhausted_webhook_event_exists', () => {
  if (!workers.includes('CREATE OR REPLACE FUNCTION authority_v1.escalate_exhausted_webhook_event')) {
    throw new Error('escalate_exhausted_webhook_event function not found');
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 15: SECURITY DEFINER with pg_temp last in search_path
// ═══════════════════════════════════════════════════════════════════════════
check('all_functions_security_definer_pg_temp_last', () => {
  const allSQL = functions + '\n' + workers;
  const fnCount = (allSQL.match(/CREATE OR REPLACE FUNCTION authority_v1\./g) || []).length;
  const sdCount = (allSQL.match(/SECURITY DEFINER/g) || []).length;
  const spCount = (allSQL.match(/SET search_path = authority_v1, pg_temp/g) || []).length;
  if (fnCount === 0) throw new Error('no functions found');
  if (sdCount !== fnCount) throw new Error(`${sdCount} SECURITY DEFINER vs ${fnCount} functions`);
  if (spCount !== fnCount) throw new Error(`${spCount} hardened search_path (pg_temp last) vs ${fnCount} functions`);
  return true;
});

check('no_old_search_path_without_pg_temp', () => {
  // The old search_path "authority_v1, pg_catalog" must NOT appear
  if (functions.includes('pg_catalog')) {
    throw new Error('functions still use old search_path with pg_catalog — must use "authority_v1, pg_temp"');
  }
  if (workers.includes('pg_catalog')) {
    throw new Error('workers still use old search_path with pg_catalog — must use "authority_v1, pg_temp"');
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 16: EXECUTE revoked from PUBLIC
// ═══════════════════════════════════════════════════════════════════════════
check('roles_revokes_execute_from_public', () => {
  if (!roles.includes('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA authority_v1 FROM PUBLIC')) {
    throw new Error('EXECUTE not revoked from PUBLIC on all functions');
  }
  return true;
});

check('roles_has_default_privileges_revoke', () => {
  if (!roles.includes('ALTER DEFAULT PRIVILEGES')) {
    throw new Error('missing ALTER DEFAULT PRIVILEGES to prevent future functions from gaining PUBLIC EXECUTE');
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 17: No hardcoded database name
// ═══════════════════════════════════════════════════════════════════════════
check('roles_no_hardcoded_database_name', () => {
  if (roles.includes('GRANT CONNECT ON DATABASE postgres')) {
    throw new Error('roles file hardcodes database name "postgres" — must use current_database()');
  }
  if (!roles.includes('current_database()')) {
    throw new Error('roles file must use current_database() for CONNECT grant');
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 18: Dedicated worker role
// ═══════════════════════════════════════════════════════════════════════════
check('roles_has_dedicated_worker_role', () => {
  if (!roles.includes('authority_worker')) throw new Error('missing authority_worker role');
  // Worker functions must be granted to authority_worker, not authority_executor
  if (roles.includes('GRANT EXECUTE ON FUNCTION authority_v1.claim_outbox_batch') && !roles.includes('TO authority_worker')) {
    throw new Error('worker functions must be granted to authority_worker');
  }
  return true;
});

check('worker_functions_not_granted_to_executor', () => {
  // Webhook worker functions (claim_webhook_event, complete_webhook_event,
  // recover_expired_webhook_leases, escalate_exhausted_webhook_event) are
  // intentionally granted to authority_executor because the webhook processor
  // runs as the executor role (P0-01K). Outbox and payment-action workers
  // remain worker-only. This check excludes webhook-specific functions.
  const webhookWorkerFns = ['claim_webhook_event', 'complete_webhook_event',
    'recover_expired_webhook_leases', 'escalate_exhausted_webhook_event'];
  const grantLines = roles.split('\n').filter(l => l.includes('GRANT EXECUTE'));
  for (const line of grantLines) {
    if ((line.includes('claim_') || line.includes('recover_') || line.includes('escalate_') || line.includes('complete_'))
        && line.includes('TO authority_executor')) {
      // Extract the function name to check if it's a webhook worker
      const fnMatch = line.match(/authority_v1\.(\w+)/);
      const fnName = fnMatch ? fnMatch[1] : '';
      if (webhookWorkerFns.includes(fnName)) continue; // intentionally granted to executor
      throw new Error('worker function ' + fnName + ' must NOT be granted to authority_executor — only to authority_worker');
    }
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 19: No public token/buyer in mirror specification
// ═══════════════════════════════════════════════════════════════════════════
check('no_public_token_or_buyer_in_mirror', () => {
  const mirrorSection = doc.match(/Fields that become MIRROR PROJECTIONS on Base44 `Listing`[\s\S]*?(?=\n####|\n###|\n---)/);
  if (!mirrorSection) throw new Error('mirror projection section not found');
  const mirrorText = mirrorSection[0];
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
// TEST 20: No process.env for AUTHORITY_DB_URL
// ═══════════════════════════════════════════════════════════════════════════
check('doc_uses_secrets_not_process_env', () => {
  if (doc.includes('process.env.AUTHORITY_DB_URL')) {
    throw new Error('document still references process.env.AUTHORITY_DB_URL');
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 21: Existing checks retained
// ═══════════════════════════════════════════════════════════════════════════
check('no_underscore_placeholders_in_select_into', () => {
  const matches = [...functions.matchAll(/SELECT \* INTO\s+[^;]+_\s*,/gi)];
  if (matches.length > 0) {
    throw new Error(`found ${matches.length} undeclared '_' placeholder(s) in SELECT INTO`);
  }
  return true;
});

check('no_explicit_transaction_control_in_functions', () => {
  const lines = functions.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === 'BEGIN;' || trimmed === 'COMMIT;' || trimmed === 'BEGIN' || trimmed === 'COMMIT') {
      let dollarCount = 0;
      for (let j = 0; j <= i; j++) {
        dollarCount += (lines[j].match(/\$\$/g) || []).length;
      }
      if (dollarCount % 2 === 0) {
        throw new Error(`line ${i + 1}: transaction control '${trimmed}' outside function body`);
      }
    }
  }
  return true;
});

check('acquire_operation_uses_returning', () => {
  if (!functions.includes('ON CONFLICT (operation_id) DO NOTHING')) {
    throw new Error('acquire_operation does not use ON CONFLICT DO NOTHING');
  }
  if (!functions.includes('RETURNING operation_id INTO v_inserted')) {
    throw new Error('acquire_operation does not use RETURNING to distinguish new vs existing');
  }
  return true;
});

check('acquire_operation_has_subject_params', () => {
  if (!functions.includes('p_subject_type')) throw new Error('acquire_operation missing p_subject_type parameter');
  if (!functions.includes('p_subject_id')) throw new Error('acquire_operation missing p_subject_id parameter');
  return true;
});

check('bind_payment_intent_exists', () => {
  if (!functions.includes('CREATE OR REPLACE FUNCTION authority_v1.bind_payment_intent')) {
    throw new Error('bind_payment_intent function not found');
  }
  return true;
});

check('record_capture_result_atomic_finalize', () => {
  const fnStart = functions.indexOf('CREATE OR REPLACE FUNCTION authority_v1.record_capture_result');
  const fnEnd = functions.indexOf('$$;', fnStart);
  if (fnStart < 0 || fnEnd < 0) throw new Error('record_capture_result not found');
  const fnBody = functions.substring(fnStart, fnEnd);
  // On succeeded, record_capture_result must ATOMICALLY finalize:
  // binding → finalized, authority → sold, outbox events — all in one transaction.
  if (!fnBody.includes("'finalized'")) throw new Error("record_capture_result must set binding to 'finalized' on succeeded");
  if (!fnBody.includes("'sold'")) throw new Error("record_capture_result must transition authority to 'sold' on succeeded");
  if (!fnBody.includes("'mirror_project'")) throw new Error("record_capture_result must create mirror_project outbox event");
  if (!fnBody.includes("'notification_dispatch'")) throw new Error("record_capture_result must create notification_dispatch outbox event");
  if (!fnBody.includes("'point_award'")) throw new Error("record_capture_result must create point_award outbox event");
  return true;
});

check('finalize_sale_is_separate', () => {
  if (!functions.includes('CREATE OR REPLACE FUNCTION authority_v1.finalize_sale')) {
    throw new Error('finalize_sale function not found');
  }
  return true;
});

check('payment_actions_has_lease_fields', () => {
  const required = ['lease_owner', 'lease_expires_at', 'claimed_at',
    'attempt_count', 'max_attempts', 'next_attempt_at', 'last_error'];
  for (const f of required) {
    if (!schema.includes(f)) throw new Error(`payment_actions missing lease field '${f}'`);
  }
  return true;
});

check('webhook_events_has_lease_fields', () => {
  const required = ['lease_owner', 'lease_expires_at', 'claimed_at',
    'attempt_count', 'max_attempts', 'next_attempt_at', 'last_error'];
  const webhookStart = schema.indexOf('stripe_webhook_events');
  const webhookEnd = schema.indexOf(';', webhookStart + 200);
  const webhookSection = schema.substring(webhookStart, webhookEnd + 500);
  for (const f of required) {
    if (!webhookSection.includes(f)) throw new Error(`stripe_webhook_events missing lease field '${f}'`);
  }
  return true;
});

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

check('cancel_unknown_is_real_state', () => {
  if (!schema.includes("'cancel_unknown'")) throw new Error("schema missing 'cancel_unknown' state");
  if (!functions.includes("'cancel_unknown'")) throw new Error("functions missing 'cancel_unknown' state");
  return true;
});

check('server_derives_operation_ids', () => {
  if (functions.includes('p_operation_id ')) {
    throw new Error('functions still use p_operation_id (should be p_server_operation_id)');
  }
  if (!functions.includes('p_server_operation_id')) {
    throw new Error('functions do not use p_server_operation_id');
  }
  return true;
});

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

check('roles_ownership_transfer_by_signature', () => {
  if (!roles.includes('pg_get_function_identity_arguments')) {
    throw new Error('ownership transfer must use exact function signatures, not ambiguous names');
  }
  return true;
});

check('doc_references_sql_artifacts', () => {
  if (!doc.includes('database/authority_v1/001_schema.sql')) throw new Error('doc does not reference 001_schema.sql');
  if (!doc.includes('database/authority_v1/002_functions.sql')) throw new Error('doc does not reference 002_functions.sql');
  if (!doc.includes('database/authority_v1/003_workers.sql')) throw new Error('doc does not reference 003_workers.sql');
  if (!doc.includes('database/authority_v1/004_roles_and_grants.sql')) throw new Error('doc does not reference 004_roles_and_grants.sql');
  return true;
});

check('no_capture_first_freeze_second', () => {
  const changeLogStart = doc.indexOf('## 18. Correction Change Log');
  const specBody = changeLogStart >= 0 ? doc.substring(0, changeLogStart) : doc;
  if (/capture.{0,30}first.{0,30}freeze|freeze.{0,30}after.{0,30}capture/i.test(specBody)) {
    throw new Error('spec body still contains "capture first, freeze second" language');
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 22: Strengthened database constraints
// ═══════════════════════════════════════════════════════════════════════════
check('schema_available_clears_tuple', () => {
  if (!schema.includes('available_clears_tuple')) {
    throw new Error('missing available_clears_tuple CHECK constraint');
  }
  return true;
});

check('schema_frozen_requires_full_tuple', () => {
  if (!schema.includes('frozen_requires_full_tuple')) {
    throw new Error('missing frozen_requires_full_tuple CHECK constraint (requires buyer, token hash, expiry, revision)');
  }
  return true;
});

check('schema_quarantine_timestamp_required', () => {
  if (!schema.includes('quarantine_timestamp_required')) {
    throw new Error('missing quarantine_timestamp_required CHECK constraint');
  }
  return true;
});

check('schema_payment_actions_max_attempts_bounded', () => {
  if (!schema.includes('max_attempts > 0 AND max_attempts <= 20')) {
    throw new Error('payment_actions max_attempts must be bounded (1..20)');
  }
  return true;
});

check('schema_payment_actions_attempt_count_valid', () => {
  if (!schema.includes('attempt_count_valid')) {
    throw new Error('missing attempt_count_valid CHECK constraint on payment_actions');
  }
  return true;
});

check('schema_payment_actions_lease_fields_consistent', () => {
  if (!schema.includes('lease_fields_consistent')) {
    throw new Error('missing lease_fields_consistent CHECK constraint on payment_actions');
  }
  return true;
});

check('schema_payment_intent_id_not_null', () => {
  // payment_intent_id must be NOT NULL and UNIQUE
  const bindingMatch = schema.match(/CREATE TABLE authority_v1\.reservation_payment_bindings[\s\S]*?\);/);
  if (!bindingMatch) throw new Error('reservation_payment_bindings table not found');
  if (!bindingMatch[0].includes('payment_intent_id               TEXT        UNIQUE NOT NULL')) {
    throw new Error('payment_intent_id must be NOT NULL and UNIQUE');
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 23: No alternate canary-enablement path (PG_CANARY_CERT_OVERRIDE absent)
// ═══════════════════════════════════════════════════════════════════════════
// No environment variable, global, request field, query parameter, header, or
// secret may override the canary flag. The only enabled-state source is the
// trusted caller-supplied canaryEnabled dependency. This static check scans
// every file under base44/functions, base44/shared, and the certification
// harness for the literal override identifier and fails if any remains.
function listFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) listFiles(full, acc);
    else acc.push(full);
  }
  return acc;
}
check('no_pg_canary_cert_override_in_functions', () => {
  const dir = join(ROOT, 'base44/functions');
  if (!existsSync(dir)) return true;
  const offenders = listFiles(dir)
    .filter(f => /\.tsx?$|\.js$|\.mjs$|\.ts$/.test(f))
    .map(f => [f, readFileSync(f, 'utf8')])
    .filter(([, src]) => src.includes('PG_CANARY_CERT_OVERRIDE'));
  if (offenders.length) throw new Error('PG_CANARY_CERT_OVERRIDE present in: ' + offenders.map(([f]) => f).join(', '));
  return true;
});
check('no_pg_canary_cert_override_in_shared', () => {
  const dir = join(ROOT, 'base44/shared');
  if (!existsSync(dir)) return true;
  const offenders = listFiles(dir)
    .filter(f => /\.tsx?$|\.js$|\.mjs$|\.ts$/.test(f))
    .map(f => [f, readFileSync(f, 'utf8')])
    .filter(([, src]) => src.includes('PG_CANARY_CERT_OVERRIDE'));
  if (offenders.length) throw new Error('PG_CANARY_CERT_OVERRIDE present in: ' + offenders.map(([f]) => f).join(', '));
  return true;
});
check('no_pg_canary_cert_override_in_cert_harness', () => {
  const file = join(ROOT, 'tests/capture-canary-real-stripe.test.mjs');
  if (!existsSync(file)) throw new Error('certification harness not found');
  if (readFileSync(file, 'utf8').includes('PG_CANARY_CERT_OVERRIDE')) {
    throw new Error('PG_CANARY_CERT_OVERRIDE present in certification harness');
  }
  return true;
});
check('no_pg_canary_cert_override_in_cancel_cert_harness', () => {
  const file = join(ROOT, 'tests/cancel-purchase-real-stripe.test.mjs');
  if (!existsSync(file)) throw new Error('cancel-purchase certification harness not found');
  if (readFileSync(file, 'utf8').includes('PG_CANARY_CERT_OVERRIDE')) {
    throw new Error('PG_CANARY_CERT_OVERRIDE present in cancel-purchase certification harness');
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 24: P0-01K webhook ingress — ingest_stripe_webhook_event contract
// ═══════════════════════════════════════════════════════════════════════════
check('webhook_ingest_function_exists', () => {
  if (!functions.includes('ingest_stripe_webhook_event')) {
    throw new Error('ingest_stripe_webhook_event function not found in 002_functions.sql');
  }
  return true;
});
function webhookIngestBody() {
  const fnStart = functions.indexOf('CREATE OR REPLACE FUNCTION authority_v1.ingest_stripe_webhook_event');
  if (fnStart === -1) throw new Error('ingest_stripe_webhook_event function not found');
  const fnEnd = functions.indexOf('$$;', fnStart);
  if (fnEnd === -1) throw new Error('function body end not found');
  return functions.substring(fnStart, fnEnd);
}
check('webhook_ingest_function_security_definer', () => {
  const body = webhookIngestBody();
  if (!body.includes('SECURITY DEFINER')) throw new Error('must be SECURITY DEFINER');
  if (!body.includes('SET search_path = authority_v1, pg_temp')) throw new Error('must harden search_path');
  return true;
});
check('webhook_ingest_grant_recorder_only', () => {
  const grants = roles.match(/GRANT EXECUTE ON FUNCTION authority_v1\.ingest_stripe_webhook_event[^\n]*/g);
  if (!grants || grants.length === 0) throw new Error('no grant found for ingest_stripe_webhook_event');
  for (const g of grants) {
    if (!g.includes('authority_stripe_recorder')) throw new Error('grant must be to authority_stripe_recorder: ' + g);
    if (g.includes('authority_executor')) throw new Error('ingest must NOT be granted to executor (P0-01K privilege correction): ' + g);
  }
  if (!roles.includes('REVOKE EXECUTE ON FUNCTION authority_v1.ingest_stripe_webhook_event')) {
    throw new Error('REVOKE from executor not found');
  }
  return true;
});
check('webhook_events_envelope_columns', () => {
  if (!schema.includes('payload_hash')) throw new Error('payload_hash column not found in schema');
  if (!schema.includes('payment_intent_id')) throw new Error('payment_intent_id column not found');
  if (!schema.includes('provider_created_at')) throw new Error('provider_created_at column not found');
  if (!schema.includes('livemode')) throw new Error('livemode column not found');
  if (!schema.includes('api_version')) throw new Error('api_version column not found');
  return true;
});
check('webhook_ingest_no_raw_payload_storage', () => {
  const body = webhookIngestBody();
  const insertMatch = body.match(/INSERT INTO stripe_webhook_events[\s\S]*?VALUES[\s\S]*?\)/);
  if (!insertMatch) throw new Error('INSERT statement not found in ingest function');
  if (insertMatch[0].includes('raw_payload')) {
    throw new Error('ingest must not store raw_payload (customer data)');
  }
  return true;
});
check('webhook_ingest_canary_ownership_from_binding', () => {
  const body = webhookIngestBody();
  if (!body.includes('reservation_payment_bindings')) {
    throw new Error('must determine canary ownership from reservation_payment_bindings');
  }
  return true;
});
check('webhook_ingest_incident_on_mismatch', () => {
  const body = webhookIngestBody();
  if (!body.includes('verification_mismatch')) {
    throw new Error('must create verification_mismatch incident on hash conflict');
  }
  return true;
});
check('webhook_ingest_idempotent_on_conflict', () => {
  const body = webhookIngestBody();
  if (!body.includes('ON CONFLICT (webhook_event_id) DO NOTHING')) {
    throw new Error('must use ON CONFLICT DO NOTHING for idempotent ingestion');
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 25: P0-01K webhook processor — new functions, grants, and privilege boundary
// ═══════════════════════════════════════════════════════════════════════════
check('resolve_webhook_action_function_exists', () => {
  if (!functions.includes('resolve_webhook_action')) throw new Error('resolve_webhook_action not found in 002_functions.sql');
  return true;
});
check('create_webhook_incident_function_exists', () => {
  if (!functions.includes('create_webhook_incident')) throw new Error('create_webhook_incident not found in 002_functions.sql');
  return true;
});
check('flag_webhook_missing_action_function_exists', () => {
  if (!functions.includes('flag_webhook_missing_action')) throw new Error('flag_webhook_missing_action not found in 002_functions.sql');
  return true;
});
check('webhook_worker_functions_granted_to_executor', () => {
  const fns = ['claim_webhook_event', 'complete_webhook_event', 'recover_expired_webhook_leases', 'escalate_exhausted_webhook_event'];
  for (const fn of fns) {
    const re = new RegExp('GRANT EXECUTE ON FUNCTION authority_v1\\.' + fn + '[^\\n]*TO authority_executor');
    if (!re.test(roles)) throw new Error(fn + ' not granted to authority_executor');
  }
  return true;
});
check('processor_functions_granted_to_executor', () => {
  const fns = ['resolve_webhook_action', 'create_webhook_incident', 'flag_webhook_missing_action'];
  for (const fn of fns) {
    const re = new RegExp('GRANT EXECUTE ON FUNCTION authority_v1\\.' + fn + '[^\\n]*TO authority_executor');
    if (!re.test(roles)) throw new Error(fn + ' not granted to authority_executor');
  }
  return true;
});
check('recorder_has_exactly_four_functions', () => {
  const lines = roles.split('\n').filter(l => l.includes('GRANT EXECUTE') && l.includes('authority_stripe_recorder'));
  if (lines.length !== 4) throw new Error('recorder must have exactly 4 GRANT EXECUTE lines, got ' + lines.length + ': ' + lines.map(l => l.trim()).join(' | '));
  const fns = lines.map(l => l.match(/authority_v1\.(\w+)/)?.[1]).sort();
  const expected = ['ingest_stripe_webhook_event', 'record_cancel_result', 'record_capture_result', 'record_refund_result'].sort();
  if (JSON.stringify(fns) !== JSON.stringify(expected)) throw new Error('recorder grants mismatch: ' + fns.join(', '));
  return true;
});
check('recorder_zero_table_privileges', () => {
  if (!roles.includes('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA authority_v1 FROM authority_stripe_recorder')) {
    throw new Error('recorder must have ALL table privileges revoked');
  }
  return true;
});
check('webhook_processor_no_base44_authoritative_writes', () => {
  const src = readFileSync(join(ROOT, 'base44/shared/webhookProcessor.js'), 'utf8');
  if (!src.includes('executorClient') || !src.includes('recorderClient')) throw new Error('must use executor + recorder clients');
  if (src.includes('asServiceRole') || /\.entities\./.test(src)) throw new Error('must not use Base44 entities directly');
  return true;
});
check('webhook_ingress_uses_recorder_not_executor', () => {
  const src = readFileSync(join(ROOT, 'base44/shared/webhookCanaryIngress.js'), 'utf8');
  if (!src.includes('recorderClient') || !src.includes('recorderUrl')) throw new Error('must use recorder client');
  if (src.includes('executorClient') || src.includes('executorUrl')) throw new Error('must NOT use executor client for ingestion (P0-01K privilege correction)');
  return true;
});
check('webhook_processor_entry_no_admin', () => {
  const src = readFileSync(join(ROOT, 'base44/functions/processWebhookEvents/entry.ts'), 'utf8');
  if (src.includes('AUTHORITY_DB_URL_DEV_ADMIN') || src.includes('authorityV1TestAdmin')) {
    throw new Error('processor must not use admin credentials');
  }
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 26: P0-01L cancel-purchase canary — orchestrator, provider, handler
// ═══════════════════════════════════════════════════════════════════════════
check('cancel_purchase_orchestrator_exists', () => {
  const path = join(ROOT, 'base44/shared/cancelPurchaseCanaryOrchestrator.js');
  if (!existsSync(path)) throw new Error('cancelPurchaseCanaryOrchestrator.js not found');
  return true;
});
check('cancel_purchase_shared_provider_exists', () => {
  const path = join(ROOT, 'base44/shared/stripeCancelProvider.js');
  if (!existsSync(path)) throw new Error('stripeCancelProvider.js not found');
  const src = readFileSync(path, 'utf8');
  if (!src.includes('createStripeCancelProvider')) throw new Error('must export createStripeCancelProvider');
  if (!src.includes('cancelPaymentIntent')) throw new Error('must export cancelPaymentIntent');
  return true;
});
check('cancel_purchase_orchestrator_no_admin', () => {
  const src = readFileSync(join(ROOT, 'base44/shared/cancelPurchaseCanaryOrchestrator.js'), 'utf8');
  if (src.includes('authorityV1TestAdmin')) throw new Error('must not import admin client');
  if (src.includes('AUTHORITY_DB_URL_DEV_ADMIN')) throw new Error('must not reference admin URL');
  if (src.includes('Deno.env')) throw new Error('must not use Deno.env');
  return true;
});
check('cancel_purchase_orchestrator_uses_certified_primitives', () => {
  const src = readFileSync(join(ROOT, 'base44/shared/cancelPurchaseCanaryOrchestrator.js'), 'utf8');
  // Must reuse begin_cancel (executor) and record_cancel_result (recorder)
  if (!src.includes('beginCancel')) throw new Error('must use executor beginCancel');
  if (!src.includes('recordCancelResult')) throw new Error('must use recorder recordCancelResult');
  // Must use quarantine_listing for transfer-uncertain quarantine
  if (!src.includes('quarantineListing')) throw new Error('must use quarantineListing for transfer guard');
  // Must use createWebhookIncident for captured-out-of-scope incident
  if (!src.includes('createWebhookIncident')) throw new Error('must use createWebhookIncident for captured rejection');
  // Must use resolveWebhookAction for reconciliation
  if (!src.includes('resolveWebhookAction')) throw new Error('must use resolveWebhookAction for reconciliation');
  return true;
});
check('cancel_purchase_orchestrator_canary_enabled_di', () => {
  const src = readFileSync(join(ROOT, 'base44/shared/cancelPurchaseCanaryOrchestrator.js'), 'utf8');
  // Must use canaryEnabled DI (not isCanaryEnabled internal call)
  if (!src.includes('canaryEnabled')) throw new Error('must accept canaryEnabled DI');
  // Check for isCanaryEnabled() as a function call (exclude JSDoc comment lines)
  const codeLines = src.split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//'));
  const code = codeLines.join('\n');
  if (code.includes('isCanaryEnabled()')) throw new Error('must NOT call isCanaryEnabled() internally (use DI)');
  return true;
});
check('cancel_purchase_handler_wiring', () => {
  const src = readFileSync(join(ROOT, 'base44/functions/cancelPurchase/entry.ts'), 'utf8');
  if (!src.includes('maybeRouteCanaryCancelPurchase')) throw new Error('handler must import orchestrator');
  if (!src.includes('createStripeCancelProvider')) throw new Error('handler must import shared provider');
  if (!src.includes('isCanaryEnabled')) throw new Error('handler must use isCanaryEnabled');
  if (!src.includes("secrets.get('STRIPE_SECRET_KEY')")) throw new Error('handler must use base44:runtime secrets for Stripe key');
  if (!src.includes("secrets.get('AUTHORITY_V1_DB_URL_DEV_EXECUTOR')")) throw new Error('handler must use base44:runtime for executor URL');
  if (!src.includes("secrets.get('AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER')")) throw new Error('handler must use base44:runtime for recorder URL');
  if (src.includes('authorityV1TestAdmin')) throw new Error('handler must not import admin client');
  return true;
});
check('cancel_purchase_handler_canary_before_maintenance', () => {
  const src = readFileSync(join(ROOT, 'base44/functions/cancelPurchase/entry.ts'), 'utf8');
  const canaryIdx = src.indexOf('maybeRouteCanaryCancelPurchase');
  const maintenanceIdx = src.indexOf('isMaintenanceActive()');
  if (canaryIdx < 0 || maintenanceIdx < 0) throw new Error('both canary and maintenance checks must exist');
  // The canary call must appear before the maintenance gate in the legacy path
  // (the canary route is before the second isMaintenanceActive check)
  const lastMaintenanceIdx = src.lastIndexOf('isMaintenanceActive()');
  if (canaryIdx > lastMaintenanceIdx) throw new Error('canary route must be before maintenance gate');
  return true;
});
check('cancel_purchase_executor_client_has_quarantine', () => {
  const src = readFileSync(join(ROOT, 'base44/shared/authorityV1Client.js'), 'utf8');
  if (!src.includes('quarantineListing')) throw new Error('executor client must expose quarantineListing');
  return true;
});
check('cancel_purchase_no_parallel_implementation', () => {
  // The orchestrator must NOT reimplement cancel logic — it must call begin_cancel
  // and record_cancel_result (the certified primitives). It must NOT directly
  // call stripe.paymentIntents.cancel (that's in the shared provider).
  const orchSrc = readFileSync(join(ROOT, 'base44/shared/cancelPurchaseCanaryOrchestrator.js'), 'utf8');
  if (orchSrc.includes('stripe.paymentIntents')) throw new Error('orchestrator must not call Stripe SDK directly (use shared provider)');
  const providerSrc = readFileSync(join(ROOT, 'base44/shared/stripeCancelProvider.js'), 'utf8');
  if (!providerSrc.includes('stripe.paymentIntents.cancel')) throw new Error('shared provider must call Stripe cancel API');
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 27: P0-01M transfer-state foundation — schema, functions, orchestrator, handler
// ═══════════════════════════════════════════════════════════════════════════
check('schema_has_transfer_state_column', () => {
  if (!schema.includes('transfer_state')) throw new Error('schema missing transfer_state column on reservation_authority');
  if (!schema.includes("'not_started'")) throw new Error("schema missing 'not_started' transfer state");
  if (!schema.includes("'in_progress'")) throw new Error("schema missing 'in_progress' transfer state");
  if (!schema.includes("'seller_reported_sent'")) throw new Error("schema missing 'seller_reported_sent' transfer state");
  if (!schema.includes("'terminal_cancelled'")) throw new Error("schema missing 'terminal_cancelled' transfer state");
  return true;
});
check('schema_has_transfer_operation_types', () => {
  if (!schema.includes("'begin_transfer'")) throw new Error("schema missing 'begin_transfer' operation type");
  if (!schema.includes("'record_seller_report'")) throw new Error("schema missing 'record_seller_report' operation type");
  return true;
});
check('begin_transfer_function_exists', () => {
  if (!functions.includes('CREATE OR REPLACE FUNCTION authority_v1.begin_transfer')) {
    throw new Error('begin_transfer function not found in 002_functions.sql');
  }
  return true;
});
check('record_seller_report_function_exists', () => {
  if (!functions.includes('CREATE OR REPLACE FUNCTION authority_v1.record_seller_report')) {
    throw new Error('record_seller_report function not found in 002_functions.sql');
  }
  return true;
});
check('begin_transfer_security_definer', () => {
  const fnStart = functions.indexOf('CREATE OR REPLACE FUNCTION authority_v1.begin_transfer');
  const fnEnd = functions.indexOf('$$;', fnStart);
  const fnBody = functions.substring(fnStart, fnEnd);
  if (!fnBody.includes('SECURITY DEFINER')) throw new Error('begin_transfer must be SECURITY DEFINER');
  if (!fnBody.includes('SET search_path = authority_v1, pg_temp')) throw new Error('begin_transfer must harden search_path');
  if (!fnBody.includes('acquire_operation')) throw new Error('begin_transfer must use acquire_operation for replay safety');
  return true;
});
check('record_seller_report_never_provider_verified', () => {
  const fnStart = functions.indexOf('CREATE OR REPLACE FUNCTION authority_v1.record_seller_report');
  const fnEnd = functions.indexOf('$$;', fnStart);
  const fnBody = functions.substring(fnStart, fnEnd);
  if (!fnBody.includes("'seller_reported_sent'")) throw new Error("must transition to 'seller_reported_sent'");
  if (!fnBody.includes("'provider_verified', false")) throw new Error("must explicitly set provider_verified=false (seller self-report is NOT provider-verified)");
  return true;
});
check('get_state_returns_transfer_state', () => {
  const fnStart = functions.indexOf('CREATE OR REPLACE FUNCTION authority_v1.get_state');
  const fnEnd = functions.indexOf('$$;', fnStart);
  const fnBody = functions.substring(fnStart, fnEnd);
  if (!fnBody.includes('transfer_state')) throw new Error('get_state must return transfer_state');
  if (!fnBody.includes('transfer_state_updated_at')) throw new Error('get_state must return transfer_state_updated_at');
  return true;
});
check('roles_grant_transfer_functions_to_executor', () => {
  if (!roles.includes('GRANT EXECUTE ON FUNCTION authority_v1.begin_transfer')) {
    throw new Error('begin_transfer not granted to authority_executor');
  }
  if (!roles.includes('GRANT EXECUTE ON FUNCTION authority_v1.record_seller_report')) {
    throw new Error('record_seller_report not granted to authority_executor');
  }
  return true;
});
check('seller_confirm_orchestrator_exists', () => {
  const path = join(ROOT, 'base44/shared/sellerConfirmTransferCanaryOrchestrator.js');
  if (!existsSync(path)) throw new Error('sellerConfirmTransferCanaryOrchestrator.js not found');
  return true;
});
check('seller_confirm_orchestrator_no_admin', () => {
  const src = readFileSync(join(ROOT, 'base44/shared/sellerConfirmTransferCanaryOrchestrator.js'), 'utf8');
  if (src.includes('authorityV1TestAdmin')) throw new Error('must not import admin client');
  if (src.includes('AUTHORITY_DB_URL_DEV_ADMIN')) throw new Error('must not reference admin URL');
  if (src.includes('Deno.env')) throw new Error('must not use Deno.env');
  return true;
});
check('seller_confirm_orchestrator_uses_certified_primitives', () => {
  const src = readFileSync(join(ROOT, 'base44/shared/sellerConfirmTransferCanaryOrchestrator.js'), 'utf8');
  if (!src.includes('beginTransfer')) throw new Error('must use executor beginTransfer');
  if (!src.includes('recordSellerReport')) throw new Error('must use executor recordSellerReport');
  if (!src.includes('canaryEnabled')) throw new Error('must accept canaryEnabled DI');
  return true;
});
check('seller_confirm_orchestrator_no_auto_relist', () => {
  const src = readFileSync(join(ROOT, 'base44/shared/sellerConfirmTransferCanaryOrchestrator.js'), 'utf8');
  if (src.includes("status: 'active'")) throw new Error('must not set listing status to active (no auto-relist)');
  if (src.includes('recovery_blocked: false')) throw new Error('must not clear recovery_blocked (no auto-recovery)');
  return true;
});
check('seller_confirm_handler_wiring', () => {
  const src = readFileSync(join(ROOT, 'base44/functions/sellerConfirmTransfer/entry.ts'), 'utf8');
  if (!src.includes('maybeRouteCanarySellerConfirm')) throw new Error('handler must import orchestrator');
  if (!src.includes('isCanaryEnabled')) throw new Error('handler must use isCanaryEnabled');
  if (!src.includes("secrets.get('AUTHORITY_V1_DB_URL_DEV_EXECUTOR')")) throw new Error('handler must use base44:runtime for executor URL');
  if (src.includes('authorityV1TestAdmin')) throw new Error('handler must not import admin client');
  if (src.includes('Deno.env')) throw new Error('handler must not use Deno.env');
  return true;
});
check('seller_confirm_handler_canary_before_maintenance', () => {
  const src = readFileSync(join(ROOT, 'base44/functions/sellerConfirmTransfer/entry.ts'), 'utf8');
  const canaryIdx = src.indexOf('maybeRouteCanarySellerConfirm');
  const maintenanceIdx = src.indexOf('isMaintenanceActive()');
  if (canaryIdx < 0 || maintenanceIdx < 0) throw new Error('both canary and maintenance checks must exist');
  if (canaryIdx > maintenanceIdx) throw new Error('canary route must be before maintenance gate');
  return true;
});
check('executor_client_has_transfer_functions', () => {
  const src = readFileSync(join(ROOT, 'base44/shared/authorityV1Client.js'), 'utf8');
  if (!src.includes('beginTransfer')) throw new Error('executor client must expose beginTransfer');
  if (!src.includes('recordSellerReport')) throw new Error('executor client must expose recordSellerReport');
  return true;
});
check('cancel_purchase_reads_transfer_state', () => {
  const src = readFileSync(join(ROOT, 'base44/shared/cancelPurchaseCanaryOrchestrator.js'), 'utf8');
  // The cancel-purchase orchestrator must include transfer_state in its response
  // and handle the transfer-wins concurrency case (retry on CONFLICT).
  if (!src.includes('transfer_state')) throw new Error('cancel-purchase orchestrator must reference transfer_state');
  if (!src.includes('CONFLICT')) throw new Error('cancel-purchase orchestrator must handle CONFLICT retry');
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 28: P0-01N cancel-purchase real Stripe test-mode certification harness
// ═══════════════════════════════════════════════════════════════════════════
check('cancel_purchase_real_stripe_harness_exists', () => {
  const path = join(ROOT, 'tests/cancel-purchase-real-stripe.test.mjs');
  if (!existsSync(path)) throw new Error('cancel-purchase-real-stripe.test.mjs not found');
  return true;
});
check('cancel_purchase_real_stripe_uses_seam', () => {
  const src = readFileSync(join(ROOT, 'tests/cancel-purchase-real-stripe.test.mjs'), 'utf8');
  if (!src.includes('maybeRouteCanaryCancelPurchase')) throw new Error('must import maybeRouteCanaryCancelPurchase (the production seam)');
  return true;
});
check('cancel_purchase_real_stripe_uses_shared_provider', () => {
  const src = readFileSync(join(ROOT, 'tests/cancel-purchase-real-stripe.test.mjs'), 'utf8');
  if (!src.includes('createStripeCancelProvider')) throw new Error('must import createStripeCancelProvider (shared production adapter)');
  return true;
});
check('cancel_purchase_real_stripe_no_direct_orchestrator', () => {
  const src = readFileSync(join(ROOT, 'tests/cancel-purchase-real-stripe.test.mjs'), 'utf8');
  // Look for actual function CALLS (with opening paren), not mere mentions in JSDoc comments.
  // The seam is maybeRouteCanaryCancelPurchase; the saga function must never be called directly.
  if (/runCanaryCancelPurchaseSaga\s*\(/.test(src)) throw new Error('must NOT call runCanaryCancelPurchaseSaga directly (use the seam)');
  return true;
});
check('cancel_purchase_real_stripe_no_flag_override', () => {
  const src = readFileSync(join(ROOT, 'tests/cancel-purchase-real-stripe.test.mjs'), 'utf8');
  if (src.includes('PG_CANARY_CERT_OVERRIDE')) throw new Error('must not contain PG_CANARY_CERT_OVERRIDE');
  return true;
});
check('cancel_purchase_real_stripe_no_live_key', () => {
  const src = readFileSync(join(ROOT, 'tests/cancel-purchase-real-stripe.test.mjs'), 'utf8');
  if (src.includes('STRIPELIVESECRETKEY')) throw new Error('must not read STRIPELIVESECRETKEY');
  return true;
});
check('cancel_purchase_real_stripe_tags_p0_01n', () => {
  const src = readFileSync(join(ROOT, 'tests/cancel-purchase-real-stripe.test.mjs'), 'utf8');
  if (!src.includes("pg_cert: 'P0-01N'")) throw new Error('must tag Stripe objects with metadata.pg_cert=P0-01N');
  return true;
});
check('cancel_purchase_real_stripe_no_admin', () => {
  const src = readFileSync(join(ROOT, 'tests/cancel-purchase-real-stripe.test.mjs'), 'utf8');
  if (src.includes('authorityV1TestAdmin')) throw new Error('must not import admin client');
  return true;
});
check('cancel_purchase_real_stripe_instruments_cancel_separately', () => {
  const src = readFileSync(join(ROOT, 'tests/cancel-purchase-real-stripe.test.mjs'), 'utf8');
  if (!src.includes('cancelCount')) throw new Error('must instrument cancel POSTs separately (cancelCount)');
  if (!src.includes('retrieveCount')) throw new Error('must instrument retrievals separately (retrieveCount)');
  return true;
});
check('cancel_purchase_real_stripe_manual_capture', () => {
  const src = readFileSync(join(ROOT, 'tests/cancel-purchase-real-stripe.test.mjs'), 'utf8');
  if (!src.includes("capture_method: 'manual'")) throw new Error('must use manual-capture test PaymentIntents');
  if (!src.includes('pm_card_visa')) throw new Error('must use predefined Stripe test payment method (pm_card_visa)');
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
console.log('[SKIP] deferred_fk_runtime — requires real PostgreSQL to verify deferred FK  [not yet tested]');

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n=== Authority Contract Tests (7C.9C.2F.2.1) ===`);
console.log(`Tests run: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
console.log(`Overall: ${failed === 0 ? 'PASS' : 'FAIL'}`);
if (failed > 0) {
  console.log(`Failed: ${failures.join(', ')}`);
  process.exit(1);
}