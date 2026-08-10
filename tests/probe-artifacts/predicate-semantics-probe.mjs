/**
 * Base44 updateMany Predicate Semantics Probe (Round 5, Defect 7)
 *
 * Tests real Base44 `updateMany` predicate behavior for:
 *   - explicit null
 *   - missing field (undefined)
 *   - empty string
 *   - numeric zero
 *   - false
 *   - omitted/undefined JavaScript property
 *
 * Tests every field type used in the CAS snapshot:
 *   - string fields (reservation_lifecycle_state, reservation_token, etc.)
 *   - number fields (reservation_version)
 *   - boolean fields (checkout_quarantined, recovery_blocked)
 *
 * If the SDK omits undefined query keys, the authority must reject records
 * with missing snapshot fields as MIGRATION_REQUIRED or STATE_CORRUPT before CAS.
 *
 * SYNTHETIC RECORDS ONLY — all records are created and deleted within this probe.
 */
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function runProbe(base44) {
  const PROBE_TAG = `PROBE-PRED-${Date.now()}`;
  const results = {
    probe_tag: PROBE_TAG,
    timestamp: new Date().toISOString(),
    sdk_version: 'base44-sdk',
    tests: [],
    summary: {},
  };

  const entity = base44.asServiceRole.entities.ListingPrivate;

  // ── Count records before ──────────────────────────────────────────────────
  const beforeRecords = await entity.list('-created_date', 10000);
  const beforeCount = beforeRecords.length;

  // ── Helper: create a synthetic record with specific field values ──────────
  async function createRecord(id, fieldValues) {
    return await base44.entities.ListingPrivate.create({
      listing_id: `${PROBE_TAG}-${id}`,
      reservation_version: 0,
      reservation_lifecycle_state: 'available',
      checkout_quarantined: false,
      recovery_blocked: false,
      reservation_token: null,
      reserved_by_email: null,
      reservation_expires_at: null,
      reservation_revision: null,
      last_operation_id: null,
      last_operation_type: null,
      last_operation_payload_hash: null,
      last_operation_result_json: null,
      last_operation_at: null,
      pending_effects_json: '[]',
      pending_effects_hash: null,
      is_demo_listing: true,
      notes: `${PROBE_TAG} predicate probe`,
      ...fieldValues,
    });
  }

  // ── Helper: test a predicate and record the result ────────────────────────
  async function testPredicate(testName, fieldName, fieldType, createValue, queryValue, queryValueDescription) {
    const recordId = `${PROBE_TAG}-${testName.replace(/\s/g, '_')}`;
    let record;
    try {
      record = await createRecord(recordId, { [fieldName]: createValue });
    } catch (e) {
      results.tests.push({
        test: testName,
        field: fieldName,
        field_type: fieldType,
        create_value: createValue,
        query_value: queryValueDescription,
        error: `create failed: ${e?.message || String(e)}`,
        updated: null,
      });
      return;
    }

    // Build query — if queryValue is a special marker, omit the field
    const query = { id: record.id };
    if (queryValue !== '__OMIT__') {
      query[fieldName] = queryValue;
    }

    let updated = null;
    let error = null;
    try {
      const result = await entity.updateMany(query, {
        $set: { notes: `${PROBE_TAG} updated` },
      });
      updated = result.updated || 0;
    } catch (e) {
      error = e?.message || String(e);
    }

    results.tests.push({
      test: testName,
      field: fieldName,
      field_type: fieldType,
      create_value: createValue,
      query_value: queryValueDescription,
      query_omitted: queryValue === '__OMIT__',
      updated,
      error,
    });

    // Cleanup
    try { await entity.delete(record.id); } catch (e) { /* best effort */ }
  }

  // ── Test string fields ────────────────────────────────────────────────────
  // Field: reservation_lifecycle_state (string)
  await testPredicate('string_null_vs_null', 'reservation_lifecycle_state', 'string', null, null, 'null');
  await testPredicate('string_null_vs_undefined', 'reservation_lifecycle_state', 'string', null, '__OMIT__', 'omitted/undefined');
  await testPredicate('string_null_vs_empty', 'reservation_lifecycle_state', 'string', null, '', 'empty string');
  await testPredicate('string_value_vs_null', 'reservation_lifecycle_state', 'string', 'available', null, 'null');
  await testPredicate('string_value_vs_undefined', 'reservation_lifecycle_state', 'string', 'available', '__OMIT__', 'omitted/undefined');
  await testPredicate('string_value_vs_value', 'reservation_lifecycle_state', 'string', 'available', 'available', 'matching value');
  await testPredicate('string_value_vs_empty', 'reservation_lifecycle_state', 'string', 'available', '', 'empty string');
  await testPredicate('string_empty_vs_empty', 'reservation_lifecycle_state', 'string', '', '', 'empty string');
  await testPredicate('string_empty_vs_null', 'reservation_lifecycle_state', 'string', '', null, 'null');
  await testPredicate('string_empty_vs_undefined', 'reservation_lifecycle_state', 'string', '', '__OMIT__', 'omitted/undefined');

  // ── Test number fields ────────────────────────────────────────────────────
  // Field: reservation_version (number)
  await testPredicate('number_zero_vs_zero', 'reservation_version', 'number', 0, 0, 'zero');
  await testPredicate('number_zero_vs_null', 'reservation_version', 'number', 0, null, 'null');
  await testPredicate('number_zero_vs_undefined', 'reservation_version', 'number', 0, '__OMIT__', 'omitted/undefined');
  await testPredicate('number_value_vs_value', 'reservation_version', 'number', 5, 5, 'matching value');
  await testPredicate('number_value_vs_zero', 'reservation_version', 'number', 5, 0, 'zero');
  await testPredicate('number_null_vs_null', 'reservation_version', 'number', null, null, 'null');
  await testPredicate('number_null_vs_undefined', 'reservation_version', 'number', null, '__OMIT__', 'omitted/undefined');
  await testPredicate('number_null_vs_zero', 'reservation_version', 'number', null, 0, 'zero');

  // ── Test boolean fields ───────────────────────────────────────────────────
  // Field: checkout_quarantined (boolean)
  await testPredicate('bool_false_vs_false', 'checkout_quarantined', 'boolean', false, false, 'false');
  await testPredicate('bool_false_vs_null', 'checkout_quarantined', 'boolean', false, null, 'null');
  await testPredicate('bool_false_vs_undefined', 'checkout_quarantined', 'boolean', false, '__OMIT__', 'omitted/undefined');
  await testPredicate('bool_true_vs_true', 'checkout_quarantined', 'boolean', true, true, 'true');
  await testPredicate('bool_true_vs_false', 'checkout_quarantined', 'boolean', true, false, 'false');
  await testPredicate('bool_true_vs_null', 'checkout_quarantined', 'boolean', true, null, 'null');
  await testPredicate('bool_true_vs_undefined', 'checkout_quarantined', 'boolean', true, '__OMIT__', 'omitted/undefined');

  // ── Count records after ───────────────────────────────────────────────────
  const afterRecords = await entity.list('-created_date', 10000);
  const afterCount = afterRecords.length;

  // ── Build summary ─────────────────────────────────────────────────────────
  const summary = {
    total_tests: results.tests.length,
    matched: results.tests.filter(t => t.updated > 0).length,
    not_matched: results.tests.filter(t => t.updated === 0).length,
    errors: results.tests.filter(t => t.error).length,
    before_count: beforeCount,
    after_count: afterCount,
    cleanup_ok: afterCount === beforeCount,
  };

  // Specific findings
  const findings = {};
  for (const t of results.tests) {
    const key = `${t.field_type}_${t.query_value}`;
    if (!findings[key]) findings[key] = [];
    findings[key].push({
      field: t.field,
      create_value: t.create_value,
      updated: t.updated,
    });
  }
  summary.findings = findings;

  // Key questions answered:
  // 1. Does null in query match null in record?
  summary.null_matches_null = results.tests.find(t => t.test === 'string_null_vs_null')?.updated > 0;
  // 2. Does undefined (omitted) match everything?
  summary.undefined_matches_all = results.tests.find(t => t.test === 'string_value_vs_undefined')?.updated > 0;
  // 3. Does empty string match empty string?
  summary.empty_matches_empty = results.tests.find(t => t.test === 'string_empty_vs_empty')?.updated > 0;
  // 4. Does zero match zero?
  summary.zero_matches_zero = results.tests.find(t => t.test === 'number_zero_vs_zero')?.updated > 0;
  // 5. Does false match false?
  summary.false_matches_false = results.tests.find(t => t.test === 'bool_false_vs_false')?.updated > 0;
  // 6. Does null match undefined (omitted)?
  summary.null_matches_undefined = results.tests.find(t => t.test === 'string_null_vs_undefined')?.updated > 0;
  // 7. Does undefined (omitted) match null?
  summary.undefined_matches_null = results.tests.find(t => t.test === 'number_null_vs_undefined')?.updated > 0;

  results.summary = summary;

  // ── Save results ──────────────────────────────────────────────────────────
  const resultsPath = join(__dirname, 'predicate-semantics-probe-results.json');
  writeFileSync(resultsPath, JSON.stringify(results, null, 2));

  return results;
}

// ── If run directly (not imported), execute the probe ────────────────────────
if (typeof globalThis.base44 !== 'undefined') {
  runProbe(globalThis.base44).then(results => {
    console.log('=== Predicate Semantics Probe Results ===');
    console.log(`Tests: ${results.summary.total_tests}`);
    console.log(`Matched: ${results.summary.matched}, Not matched: ${results.summary.not_matched}, Errors: ${results.summary.errors}`);
    console.log(`Cleanup: ${results.summary.cleanup_ok ? 'OK' : 'FAILED'} (before=${results.summary.before_count}, after=${results.summary.after_count})`);
    console.log('\nKey findings:');
    console.log(`  null matches null: ${results.summary.null_matches_null}`);
    console.log(`  undefined matches all: ${results.summary.undefined_matches_all}`);
    console.log(`  empty matches empty: ${results.summary.empty_matches_empty}`);
    console.log(`  zero matches zero: ${results.summary.zero_matches_zero}`);
    console.log(`  false matches false: ${results.summary.false_matches_false}`);
    console.log(`  null matches undefined: ${results.summary.null_matches_undefined}`);
    console.log(`  undefined matches null: ${results.summary.undefined_matches_null}`);
  }).catch(err => {
    console.error('Probe error:', err);
    process.exit(1);
  });
}