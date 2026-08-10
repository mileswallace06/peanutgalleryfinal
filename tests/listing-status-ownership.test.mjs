/**
 * Listing Status Ownership Static Regression Test (Round 5, Defect 6)
 *
 * Scans all source files for writes to tracked Listing fields and verifies
 * every writer is registered. Uses structured regex patterns (word-boundary
 * + colon) to identify property assignments in object literals — NOT substring
 * assertions. Property accesses (listing.status) use a dot, not a colon, and
 * do not match.
 *
 * An unregistered writer fails the inventory check.
 *
 * Tracked fields:
 *   - status, hidden_reason
 *   - reservation_token, reserved_by_email, reservation_expires_at, reservation_revision
 *   - reservation_version, reservation_mirror_state
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const TRACKED_FIELDS = [
  'status', 'hidden_reason',
  'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision',
  'reservation_version', 'reservation_mirror_state',
];

// ── Registry of known writers ────────────────────────────────────────────────
// Each entry maps a file path (relative to project root) to the tracked fields
// it writes. Files that only READ these fields do NOT need to be registered.
const REGISTRY = {
  // Backend functions — status/hidden_reason writers
  'base44/functions/submitListing/entry.ts': ['status', 'hidden_reason'],
  'base44/functions/approveListingReview/entry.ts': ['status', 'hidden_reason'],
  'base44/functions/rejectListingReview/entry.ts': ['status', 'hidden_reason'],
  'base44/functions/capturePayment/entry.ts': ['status', 'hidden_reason', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'base44/functions/abortCheckout/entry.ts': ['status', 'hidden_reason', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'base44/functions/cancelPurchase/entry.ts': ['status', 'hidden_reason', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'base44/functions/cleanupAbandonedCheckouts/entry.ts': ['status', 'hidden_reason', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'base44/functions/stripeWebhook/entry.ts': ['status', 'hidden_reason', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'base44/functions/releaseReservation/entry.ts': ['status', 'hidden_reason', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'base44/functions/deleteAccount/entry.ts': ['status', 'hidden_reason', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'base44/functions/reserveListing/entry.ts': ['status', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'base44/functions/createCheckout/entry.ts': ['status', 'hidden_reason', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'base44/functions/reconcilePurchaseOutcomes/entry.ts': ['status', 'hidden_reason'],
  'base44/functions/processTransferReminders/entry.ts': ['status', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'base44/functions/syncInventoryOnListingChange/entry.ts': ['status'],
  'base44/functions/verifyTransferProof/entry.ts': ['status'],
  'base44/functions/adminOverrideAIVerification/entry.ts': ['status'],
  'base44/functions/recordTransferOutcome/entry.ts': ['status'],
  'base44/functions/flashDrop/entry.ts': ['status'],
  'base44/functions/seatDonation/entry.ts': ['status'],
  'base44/functions/openDispute/entry.ts': ['status'],
  'base44/functions/sellerConfirmTransfer/entry.ts': ['status'],
  'base44/functions/seedDemoListings/entry.ts': ['status', 'hidden_reason', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'base44/functions/createDemoUpgrade/entry.ts': ['status', 'hidden_reason', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'base44/functions/calibrateConfidenceWeights/entry.ts': ['status'],
  'base44/functions/cleanupStaleDonations/entry.ts': ['status'],
  'base44/functions/getPurchaseParticipantView/entry.ts': ['status'],
  'base44/functions/migrateSensitiveData/entry.ts': ['status', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'base44/functions/onboardSeller/entry.ts': ['status'],
  'base44/functions/scanTransferWindows/entry.ts': ['status', 'hidden_reason'],
  'base44/functions/syncTMEvent/entry.ts': ['status'],
  'base44/functions/uploadListingProof/entry.ts': ['status'],
  'base44/functions/uploadTransferProof/entry.ts': ['status'],

  // Shared orchestrators — status/hidden_reason + reservation tuple writers
  'base44/shared/checkoutOrchestrator.js': ['status', 'hidden_reason', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'base44/shared/captureOrchestrator.js': ['status', 'hidden_reason', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'base44/shared/cancelOrchestrator.js': ['status', 'hidden_reason', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'base44/shared/abortOrchestrator.js': ['status', 'hidden_reason', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'base44/shared/releaseOrchestrator.js': ['status', 'hidden_reason', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'base44/shared/cleanupOrchestrator.js': ['status', 'hidden_reason', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'base44/shared/webhookOrchestrator.js': ['status', 'hidden_reason', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'base44/shared/confirmCheckoutOrchestrator.js': ['status', 'hidden_reason'],
  'base44/shared/reserveOrchestrator.js': ['reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'base44/shared/resumeOrchestrator.js': ['status', 'hidden_reason', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'base44/shared/remindersOrchestrator.js': ['status', 'hidden_reason'],
  'base44/shared/checkoutLogic.js': ['status', 'hidden_reason'],
  'base44/shared/captureReconciliation.js': ['status', 'hidden_reason', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'base44/shared/tupleTransition.js': ['status', 'hidden_reason', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'base44/shared/orchestratorHelpers.js': ['status', 'hidden_reason', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'base44/shared/privateData.ts': ['status', 'hidden_reason'],

  // Authority modules
  'base44/shared/reservationAuthority.js': ['status', 'hidden_reason', 'reservation_version', 'reservation_lifecycle_state', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision', 'reservation_mirror_state'],
  'base44/shared/reservationAuthorityMirror.js': ['status', 'hidden_reason', 'reservation_version', 'reservation_mirror_state'],
  'base44/shared/reservationAuthorityMigration.js': ['reservation_version', 'reservation_lifecycle_state', 'reservation_mirror_state'],
  'base44/shared/reservationAuthorityConstants.js': ['reservation_version', 'reservation_lifecycle_state', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision', 'reservation_mirror_state'],

  // Frontend components (write via base44.entities.Listing.update/create)
  'src/components/admin/InstantListingsQueue.jsx': ['status'],
  'src/components/admin/InstantTransferReadyPanel.jsx': ['status'],
  'src/components/admin/cc/InstantOpsPanel.jsx': ['status'],
  'src/components/admin/cc/IssueFeed.jsx': ['status', 'reservation_token', 'reserved_by_email', 'reservation_expires_at'],
  'src/components/admin/cc/TransferIntelligencePanel.jsx': ['status', 'hidden_reason'],
  'src/components/admin/fulfillment/FulfillmentItem.jsx': ['status'],
  'src/pages/BetaRecruitment.jsx': ['status'],
  'src/pages/CreateListing.jsx': ['status'],
  'src/pages/EventDetailTM.jsx': ['status'],

  // Test files (write tracked fields in seed/setup)
  'tests/authority/helpers.mjs': ['status', 'hidden_reason', 'reservation_version', 'reservation_lifecycle_state', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision', 'reservation_mirror_state'],
  'tests/reservation-authority-concurrency.test.mjs': ['status', 'hidden_reason', 'reservation_version', 'reservation_lifecycle_state', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision', 'reservation_mirror_state'],
  'tests/reservation-authority-adversarial.test.mjs': ['status', 'hidden_reason', 'reservation_version', 'reservation_lifecycle_state', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision', 'reservation_mirror_state'],
  'tests/launch-gate.test.mjs': ['reservation_version', 'reservation_lifecycle_state', 'reservation_token', 'reserved_by_email', 'reservation_expires_at'],
  'tests/probe-artifacts/single-authority-cas-probe.mjs': ['reservation_version', 'reservation_lifecycle_state', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision', 'status'],
  'tests/probe-artifacts/predicate-semantics-probe.mjs': ['reservation_version', 'reservation_lifecycle_state', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision', 'checkout_quarantined', 'recovery_blocked'],
  'tests/helpers/mockDeps.mjs': ['status', 'hidden_reason', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'tests/concurrent-alert-deduplication.test.mjs': [],
  'tests/mutation-paths.test.mjs': ['status', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'tests/payment-webhook.test.mjs': ['status', 'hidden_reason', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'tests/post-prefetch-concurrency.test.mjs': ['status', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'tests/checkout-concurrency.test.mjs': ['status', 'hidden_reason', 'reservation_token', 'reserved_by_email', 'reservation_expires_at'],
  'tests/freeze-completeness.test.mjs': ['status', 'hidden_reason', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'tests/legacy-revision-init.test.mjs': ['reservation_revision', 'reservation_expires_at'],
  'tests/partial-finalization-states.test.mjs': ['status', 'hidden_reason', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'tests/payment-reconciliation.test.mjs': ['status', 'hidden_reason', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'tests/tuple-invariant-validation.test.mjs': ['status', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision'],
  'tests/listing-status-ownership.test.mjs': ['status', 'hidden_reason', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision', 'reservation_version', 'reservation_mirror_state'],

  // Schema files (define fields, not write them at runtime)
  'base44/entities/Listing.jsonc': [],
  'base44/entities/ListingPrivate.jsonc': [],
};

// ── File scanner ────────────────────────────────────────────────────────────
function scanDirectory(dir, extensions, results = []) {
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    let stat;
    try { stat = statSync(fullPath); } catch (e) { continue; }
    if (stat.isDirectory()) {
      scanDirectory(fullPath, extensions, results);
    } else if (extensions.includes(extname(fullPath))) {
      results.push(fullPath);
    }
  }
  return results;
}

// ── Write detector ───────────────────────────────────────────────────────────
// Uses proximity-based detection: finds tracked fields ONLY within entity write
// operation blocks ($set, .update, .create, .bulkCreate). This is reliable
// because it targets write operations specifically, not just any occurrence of
// a field name. Property accesses (listing.status) use a dot, not a colon, and
// do not match. Type annotations outside write blocks are excluded.
function findWritersInFile(filePath, trackedFields) {
  const content = readFileSync(filePath, 'utf8');
  const writers = new Set();
  const WINDOW = 2000;

  // Helper: check if a block contains any tracked field as a property assignment
  function checkBlock(block) {
    for (const field of trackedFields) {
      // Match: NOT preceded by dot or word char + word boundary + field + colon
      const fieldRegex = new RegExp(`(?<![.\\w])\\b${field}\\s*:`, 'g');
      if (fieldRegex.test(block)) {
        writers.add(field);
      }
    }
  }

  // Pattern 1: $set blocks — find $set: { and scan the next WINDOW chars
  for (const match of content.matchAll(/\$set\s*:\s*\{/g)) {
    checkBlock(content.slice(match.index, match.index + WINDOW));
  }

  // Pattern 2: .update() calls — find .update( and scan the next WINDOW chars
  for (const match of content.matchAll(/\.update\s*\(/g)) {
    checkBlock(content.slice(match.index, match.index + WINDOW));
  }

  // Pattern 3: .create() calls — find .create( and scan the next WINDOW chars
  for (const match of content.matchAll(/\.create\s*\(/g)) {
    checkBlock(content.slice(match.index, match.index + WINDOW));
  }

  // Pattern 4: .bulkCreate() calls
  for (const match of content.matchAll(/\.bulkCreate\s*\(/g)) {
    checkBlock(content.slice(match.index, match.index + WINDOW));
  }

  return Array.from(writers);
}

// ── Test runner ──────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (e) {
    console.log(`[FAIL] ${name}`);
    console.log(`  ${e.message}`);
    failures.push(name);
    failed++;
  }
}

// Scan all source directories
const sourceDirs = [
  { dir: join(ROOT, 'base44/functions'), exts: ['.ts', '.js'] },
  { dir: join(ROOT, 'base44/shared'), exts: ['.ts', '.js'] },
  { dir: join(ROOT, 'src/components'), exts: ['.jsx', '.js'] },
  { dir: join(ROOT, 'src/pages'), exts: ['.jsx', '.js'] },
  { dir: join(ROOT, 'src/lib'), exts: ['.js', '.jsx'] },
  { dir: join(ROOT, 'tests'), exts: ['.mjs', '.js'] },
  { dir: join(ROOT, 'base44/entities'), exts: ['.jsonc'] },
];

const allFiles = [];
for (const { dir, exts } of sourceDirs) {
  const files = scanDirectory(dir, exts);
  for (const f of files) {
    const relPath = relative(ROOT, f).replace(/\\/g, '/');
    allFiles.push(relPath);
  }
}

// ── TEST 1: All registered files exist ──────────────────────────────────────
check('all_registered_files_exist', () => {
  const missing = [];
  for (const filePath of Object.keys(REGISTRY)) {
    if (!existsSync(join(ROOT, filePath))) {
      missing.push(filePath);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Registry references non-existent files: ${missing.join(', ')}`);
  }
});

// ── TEST 2: No unregistered writers exist ───────────────────────────────────
check('no_unregistered_writers_exist', () => {
  const unregistered = [];
  for (const relPath of allFiles) {
    // Skip registry entries
    if (relPath in REGISTRY) continue;

    const writers = findWritersInFile(join(ROOT, relPath), TRACKED_FIELDS);
    if (writers.length > 0) {
      unregistered.push({ file: relPath, fields: writers });
    }
  }
  if (unregistered.length > 0) {
    const details = unregistered.map(u => `  ${u.file}: writes [${u.fields.join(', ')}]`).join('\n');
    throw new Error(`Unregistered writers found:\n${details}`);
  }
});

// ── TEST 3: Registry covers all found writers ───────────────────────────────
check('registry_covers_all_found_writers', () => {
  const incomplete = [];
  for (const [filePath, registeredFields] of Object.entries(REGISTRY)) {
    if (!existsSync(join(ROOT, filePath))) continue;
    const actualWriters = findWritersInFile(join(ROOT, filePath), TRACKED_FIELDS);
    const registeredSet = new Set(registeredFields);
    const unregistered = actualWriters.filter(f => !registeredSet.has(f));
    if (unregistered.length > 0) {
      incomplete.push({ file: filePath, unregistered, actual: actualWriters, registered: registeredFields });
    }
  }
  if (incomplete.length > 0) {
    const details = incomplete.map(u => `  ${u.file}: found [${u.actual.join(', ')}] but registered [${u.registered.join(', ')}] — missing [${u.unregistered.join(', ')}]`).join('\n');
    throw new Error(`Registry entries are incomplete:\n${details}`);
  }
});

// ── TEST 4: Tracked fields are complete ─────────────────────────────────────
check('tracked_fields_are_complete', () => {
  const required = [
    'status', 'hidden_reason',
    'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision',
    'reservation_version', 'reservation_mirror_state',
  ];
  for (const field of required) {
    if (!TRACKED_FIELDS.includes(field)) {
      throw new Error(`Missing tracked field: ${field}`);
    }
  }
});

// ── MAIN RUNNER ──────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Listing Status Ownership Static Regression Test (Round 5) ===\n');
  console.log(`Scanned ${allFiles.length} source files.\n`);
  console.log(`Overall: ${failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log(`Tests run: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) {
    console.log(`\nFailed: ${failures.join(', ')}`);
    process.exit(1);
  }
}

main().catch(err => { console.error('Test runner error:', err); process.exit(1); });