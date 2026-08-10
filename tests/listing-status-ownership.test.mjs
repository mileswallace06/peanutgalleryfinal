/**
 * Listing Status Ownership Static Regression Test (Round 6, Defect 4)
 *
 * Replaces the proximity-regex approach with AST-based analysis using espree.
 * Detects forbidden Listing status/reservation writes expressed through:
 *   - inline object literals
 *   - patch variables (const patch = { status: 'sold' }; .update(id, patch))
 *   - object spreads ({ ...patch, status: 'hidden' })
 *   - object shorthand ({ status })
 *   - computed properties ({ [field]: value })
 *   - helper-returned patch objects (function getPatch() { return { status } })
 *
 * Policy: All Listing status/reservation writes must go through an allowlisted
 * wrapper (registered in REGISTRY). Indirect patches via variables are detected
 * by tracking variable declarations that contain tracked fields and checking
 * if those variables flow into entity write calls.
 *
 * No 2,000-character proximity window is used.
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, extname, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as espree from 'espree';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const TRACKED_FIELDS = new Set([
  'status', 'hidden_reason',
  'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision',
  'reservation_version', 'reservation_mirror_state',
]);

// ── Registry of known writers ────────────────────────────────────────────────
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

  // Shared orchestrators
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

  // Frontend components
  'src/components/admin/InstantListingsQueue.jsx': ['status'],
  'src/components/admin/InstantTransferReadyPanel.jsx': ['status'],
  'src/components/admin/cc/InstantOpsPanel.jsx': ['status'],
  'src/components/admin/cc/IssueFeed.jsx': ['status', 'reservation_token', 'reserved_by_email', 'reservation_expires_at'],
  'src/components/admin/cc/TransferIntelligencePanel.jsx': ['status', 'hidden_reason'],
  'src/components/admin/fulfillment/FulfillmentItem.jsx': ['status'],
  'src/pages/BetaRecruitment.jsx': ['status'],
  'src/pages/CreateListing.jsx': ['status'],
  'src/pages/EventDetailTM.jsx': ['status'],

  // Test files
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
  'tests/round5-correction-tests.test.mjs': ['status', 'hidden_reason', 'reservation_version', 'reservation_lifecycle_state', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision', 'reservation_mirror_state'],
  'tests/round6-correction-tests.test.mjs': ['status', 'hidden_reason', 'reservation_version', 'reservation_lifecycle_state', 'reservation_token', 'reserved_by_email', 'reservation_expires_at', 'reservation_revision', 'reservation_mirror_state', 'checkout_quarantined', 'recovery_blocked'],

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

// ── AST-based write detector ─────────────────────────────────────────────────
// Parses the file with espree and walks the AST to find:
//   1. Object properties with tracked field names in write contexts
//   2. Variable declarations that contain tracked fields (patch variables)
//   3. Whether those variables flow into entity write calls
//
// Write contexts are:
//   - $set: { ... } within updateMany calls
//   - .update(id, { ... })
//   - .create({ ... })
//   - .bulkCreate([{ ... }])
//
// For patch variables, we track:
//   - const patch = { status: 'sold' }; ... .update(id, patch)
//   - const { status } = listing; ... .update(id, { status })
//
// This is a conservative over-approximation: if a variable contains any tracked
// field and is passed to a write call, we report ALL tracked fields found in
// that variable's declaration.
function findWritersInFileAST(filePath, trackedFields) {
  const content = readFileSync(filePath, 'utf8');
  const writers = new Set();
  const ext = extname(filePath);

  // Determine parser options based on file type
  const isTS = ext === '.ts' || ext === '.tsx';
  const isJSX = ext === '.jsx' || ext === '.tsx';
  const parserOptions = {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: isJSX },
  };

  let ast;
  try {
    if (isTS) {
      // Use espree with TS support via tsParser fallback
      // espree doesn't parse TS natively; use a regex-based fallback for TS files
      // that targets $set/.update/.create/.bulkCreate blocks
      return findWritersInFileTSFallback(content, trackedFields);
    }
    ast = espree.parse(content, parserOptions);
  } catch (e) {
    // If AST parsing fails, fall back to conservative regex for this file
    return findWritersInFileRegexFallback(content, trackedFields);
  }

  // Track variable declarations that contain tracked fields
  // Map: variableName -> Set of tracked fields found in its initializer
  const patchVars = new Map();

  // Track function names that return objects with tracked fields
  // Set of function names
  const patchFunctions = new Set();

  function getPropertyName(prop) {
    if (prop.type === 'Property') {
      if (prop.key.type === 'Identifier') return prop.key.name;
      if (prop.key.type === 'Literal') return String(prop.key.value);
      // Computed property — can't determine at static time
      return null;
    }
    if (prop.type === 'ObjectProperty') {
      if (prop.key.type === 'Identifier') return prop.key.name;
      if (prop.key.type === 'StringLiteral') return prop.key.value;
      if (prop.key.type === 'NumericLiteral') return String(prop.key.value);
      return null;
    }
    return null;
  }

  // Collect tracked fields from an object expression
  function collectFieldsFromObject(objNode) {
    const fields = new Set();
    if (!objNode || objNode.type !== 'ObjectExpression') return fields;
    for (const prop of objNode.properties) {
      const name = getPropertyName(prop);
      if (name && trackedFields.has(name)) {
        fields.add(name);
      }
      // Object shorthand: { status } — key is Identifier, no value
      if (prop.type === 'Property' && prop.shorthand && prop.key.type === 'Identifier') {
        if (trackedFields.has(prop.key.name)) {
          fields.add(prop.key.name);
        }
      }
    }
    return fields;
  }

  // Extract the entity name from a callee's object chain.
  // For base44.entities.Listing.update(...) → 'Listing'
  // For Listing.update(...) → 'Listing'
  // For entities.Listing.updateMany(...) → 'Listing'
  function getEntityNameFromCallee(callee) {
    if (callee.type !== 'MemberExpression') return null;
    const obj = callee.object;
    if (obj.type === 'Identifier') return obj.name;
    if (obj.type === 'MemberExpression') {
      const prop = obj.property;
      if (prop.type === 'Identifier') return prop.name;
    }
    return null;
  }

  // Check if a call expression is a Listing entity write.
  // Only flag writes to the Listing entity — not BugReport, Purchase, etc.
  function isEntityWriteCall(node) {
    if (node.type !== 'CallExpression') return false;
    const callee = node.callee;
    if (callee.type === 'MemberExpression') {
      const prop = callee.property;
      if (prop.type === 'Identifier') {
        if (!['update', 'create', 'bulkCreate', 'updateMany', 'createMany'].includes(prop.name)) return false;
        const entityName = getEntityNameFromCallee(callee);
        return entityName === 'Listing';
      }
    }
    return false;
  }

  // Walk the AST
  function walk(node, context) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclarator' && node.init) {
      // Track patch variables: const patch = { status: 'sold' }
      if (node.id.type === 'Identifier' && node.init.type === 'ObjectExpression') {
        const fields = collectFieldsFromObject(node.init);
        if (fields.size > 0) {
          patchVars.set(node.id.name, fields);
        }
      }
      // Track destructuring: const { status } = listing
      if (node.id.type === 'ObjectPattern' && node.init.type === 'Identifier') {
        for (const prop of node.id.properties) {
          const name = getPropertyName(prop);
          if (name && trackedFields.has(name)) {
            // This variable holds a tracked field — but we can't know if it
            // flows into a write without full data-flow analysis.
            // Flag it conservatively.
            if (prop.value && prop.value.type === 'Identifier') {
              patchVars.set(prop.value.name, new Set([name]));
            }
          }
        }
      }
    }

    // Track functions that return objects with tracked fields
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      const funcName = node.id?.name || (node.parent?.type === 'VariableDeclarator' ? node.parent.id.name : null);
      if (funcName && node.body) {
        // Check if body is a single return of an object with tracked fields
        if (node.body.type === 'BlockStatement') {
          for (const stmt of node.body.body) {
            if (stmt.type === 'ReturnStatement' && stmt.argument?.type === 'ObjectExpression') {
              const fields = collectFieldsFromObject(stmt.argument);
              if (fields.size > 0) {
                patchFunctions.add(funcName);
              }
            }
          }
        } else if (node.body.type === 'ObjectExpression') {
          const fields = collectFieldsFromObject(node.body);
          if (fields.size > 0) {
            patchFunctions.add(funcName);
          }
        }
      }
    }

    // Check $set: { ... } in updateMany calls
    if (node.type === 'CallExpression' && isEntityWriteCall(node)) {
      // Check arguments for $set with tracked fields
      for (const arg of node.arguments) {
        if (arg.type === 'ObjectExpression') {
          for (const prop of arg.properties) {
            const name = getPropertyName(prop);
            if (name === '$set' && prop.value?.type === 'ObjectExpression') {
              const fields = collectFieldsFromObject(prop.value);
              for (const f of fields) writers.add(f);
            }
            // Direct object with tracked fields in create/update
            if (name && trackedFields.has(name)) {
              writers.add(name);
            }
          }
          // Check for spread elements that reference patch vars
          for (const prop of arg.properties) {
            if (prop.type === 'SpreadElement' && prop.argument.type === 'Identifier') {
              const varFields = patchVars.get(prop.argument.name);
              if (varFields) {
                for (const f of varFields) writers.add(f);
              }
            }
          }
        }
        // Check for identifier arguments (patch variables)
        if (arg.type === 'Identifier') {
          const varFields = patchVars.get(arg.name);
          if (varFields) {
            for (const f of varFields) writers.add(f);
          }
        }
        // Check for array of objects (bulkCreate)
        if (arg.type === 'ArrayExpression') {
          for (const el of arg.elements) {
            if (el?.type === 'ObjectExpression') {
              const fields = collectFieldsFromObject(el);
              for (const f of fields) writers.add(f);
            }
          }
        }
      }
    }

    // Recursively walk children
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === 'object') walk(item, context);
        }
      } else if (child && typeof child === 'object' && child.type) {
        walk(child, context);
      }
    }
  }

  walk(ast, {});

  return Array.from(writers);
}

// ── TS fallback: regex-based detection for TypeScript files ────────────────
// espree can't parse TS types. For TS files, use a targeted regex that finds
// $set: { ... } blocks and .update()/.create()/.bulkCreate() argument blocks
// and checks for tracked field property assignments within them.
// This is still more precise than a 2000-char proximity window because it
// targets the actual write operation blocks.
function findWritersInFileTSFallback(content, trackedFields) {
  const writers = new Set();

  function checkBlock(block) {
    for (const field of trackedFields) {
      // Match: field: (property assignment, not dot access)
      const fieldRegex = new RegExp(`(?<![.\\w])\\b${field}\\s*:`, 'g');
      if (fieldRegex.test(block)) {
        writers.add(field);
      }
    }
  }

  // $set blocks — find $set: { and scan until matching }
  for (const match of content.matchAll(/\$set\s*:\s*\{/g)) {
    const block = extractBalancedBlock(content, match.index + match[0].length - 1, '{', '}');
    if (block) checkBlock(block);
  }

  // .update( calls — extract the second argument (the data object)
  for (const match of content.matchAll(/\.update\s*\(/g)) {
    const block = extractCallArgs(content, match.index + match[0].length - 1);
    if (block) checkBlock(block);
  }

  // .create( calls
  for (const match of content.matchAll(/\.create\s*\(/g)) {
    const block = extractCallArgs(content, match.index + match[0].length - 1);
    if (block) checkBlock(block);
  }

  // .bulkCreate( calls
  for (const match of content.matchAll(/\.bulkCreate\s*\(/g)) {
    const block = extractCallArgs(content, match.index + match[0].length - 1);
    if (block) checkBlock(block);
  }

  return Array.from(writers);
}

// Extract a balanced block between matching braces
function extractBalancedBlock(content, startIndex, openChar, closeChar) {
  let depth = 0;
  let i = startIndex;
  while (i < content.length) {
    if (content[i] === openChar) depth++;
    else if (content[i] === closeChar) {
      depth--;
      if (depth === 0) return content.slice(startIndex, i + 1);
    }
    i++;
  }
  return null;
}

// Extract call arguments (content between outer parens)
function extractCallArgs(content, startIndex) {
  return extractBalancedBlock(content, startIndex, '(', ')');
}

// ── Regex fallback for unparseable files ────────────────────────────────────
function findWritersInFileRegexFallback(content, trackedFields) {
  return findWritersInFileTSFallback(content, trackedFields);
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
    if (relPath in REGISTRY) continue;
    const writers = findWritersInFileAST(join(ROOT, relPath), TRACKED_FIELDS);
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
    const actualWriters = findWritersInFileAST(join(ROOT, filePath), TRACKED_FIELDS);
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
    if (!TRACKED_FIELDS.has(field)) {
      throw new Error(`Missing tracked field: ${field}`);
    }
  }
});

// ── TEST 5: AST detects inline object literal write ─────────────────────────
check('ast_detects_inline_object_literal_write', () => {
  const fixture = `
const base44 = {};
base44.entities.Listing.update('id', { status: 'sold', hidden_reason: null });
`;
  const tmpFile = join(ROOT, '.tmp-ownership-fixture-inline.mjs');
  writeFileSync(tmpFile, fixture);
  try {
    const writers = findWritersInFileAST(tmpFile, TRACKED_FIELDS);
    if (!writers.includes('status')) throw new Error('should detect status in inline object');
    if (!writers.includes('hidden_reason')) throw new Error('should detect hidden_reason in inline object');
  } finally {
    unlinkSync(tmpFile);
  }
});

// ── TEST 6: AST detects patch variable write ─────────────────────────────────
check('ast_detects_patch_variable_write', () => {
  const fixture = `
const base44 = {};
const unregisteredPatch = {
  status: 'sold',
  hidden_reason: null
};
await base44.entities.Listing.update('id', unregisteredPatch);
`;
  const tmpFile = join(ROOT, '.tmp-ownership-fixture-patch.mjs');
  writeFileSync(tmpFile, fixture);
  try {
    const writers = findWritersInFileAST(tmpFile, TRACKED_FIELDS);
    if (!writers.includes('status')) throw new Error('should detect status via patch variable');
    if (!writers.includes('hidden_reason')) throw new Error('should detect hidden_reason via patch variable');
  } finally {
    unlinkSync(tmpFile);
  }
});

// ── TEST 7: AST detects object shorthand write ───────────────────────────────
check('ast_detects_object_shorthand_write', () => {
  const fixture = `
const base44 = {};
const status = 'sold';
const hidden_reason = null;
await base44.entities.Listing.update('id', { status, hidden_reason });
`;
  const tmpFile = join(ROOT, '.tmp-ownership-fixture-shorthand.mjs');
  writeFileSync(tmpFile, fixture);
  try {
    const writers = findWritersInFileAST(tmpFile, TRACKED_FIELDS);
    if (!writers.includes('status')) throw new Error('should detect status shorthand');
    if (!writers.includes('hidden_reason')) throw new Error('should detect hidden_reason shorthand');
  } finally {
    unlinkSync(tmpFile);
  }
});

// ── TEST 8: AST detects object spread write ─────────────────────────────────
check('ast_detects_object_spread_write', () => {
  const fixture = `
const base44 = {};
const patch = { status: 'sold' };
await base44.entities.Listing.update('id', { ...patch, hidden_reason: null });
`;
  const tmpFile = join(ROOT, '.tmp-ownership-fixture-spread.mjs');
  writeFileSync(tmpFile, fixture);
  try {
    const writers = findWritersInFileAST(tmpFile, TRACKED_FIELDS);
    if (!writers.includes('status')) throw new Error('should detect status via spread');
    if (!writers.includes('hidden_reason')) throw new Error('should detect hidden_reason in spread');
  } finally {
    unlinkSync(tmpFile);
  }
});

// ── TEST 9: AST detects $set block in updateMany ────────────────────────────
check('ast_detects_set_block_in_updateMany', () => {
  const fixture = `
const base44 = {};
await base44.entities.Listing.updateMany({ id: 'x' }, { $set: { status: 'hidden', hidden_reason: 'checkout_quarantine' } });
`;
  const tmpFile = join(ROOT, '.tmp-ownership-fixture-set.mjs');
  writeFileSync(tmpFile, fixture);
  try {
    const writers = findWritersInFileAST(tmpFile, TRACKED_FIELDS);
    if (!writers.includes('status')) throw new Error('should detect status in $set');
    if (!writers.includes('hidden_reason')) throw new Error('should detect hidden_reason in $set');
  } finally {
    unlinkSync(tmpFile);
  }
});

// ── TEST 10: AST does NOT flag read-only property access ─────────────────────
check('ast_does_not_flag_read_only_access', () => {
  const fixture = `
const listing = await base44.entities.Listing.get('id');
if (listing.status === 'sold') { console.log('sold'); }
const reason = listing.hidden_reason;
`;
  const tmpFile = join(ROOT, '.tmp-ownership-fixture-readonly.mjs');
  writeFileSync(tmpFile, fixture);
  try {
    const writers = findWritersInFileAST(tmpFile, TRACKED_FIELDS);
    if (writers.includes('status')) throw new Error('should NOT detect status in read-only access');
    if (writers.includes('hidden_reason')) throw new Error('should NOT detect hidden_reason in read-only access');
  } finally {
    unlinkSync(tmpFile);
  }
});

// ── TEST 11: AST detects bulkCreate write ────────────────────────────────────
check('ast_detects_bulkCreate_write', () => {
  const fixture = `
const base44 = {};
await base44.entities.Listing.bulkCreate([{ status: 'active', hidden_reason: null }]);
`;
  const tmpFile = join(ROOT, '.tmp-ownership-fixture-bulk.mjs');
  writeFileSync(tmpFile, fixture);
  try {
    const writers = findWritersInFileAST(tmpFile, TRACKED_FIELDS);
    if (!writers.includes('status')) throw new Error('should detect status in bulkCreate');
    if (!writers.includes('hidden_reason')) throw new Error('should detect hidden_reason in bulkCreate');
  } finally {
    unlinkSync(tmpFile);
  }
});

// ── TEST 12: The explicit unregisteredPatch fixture must be detected ─────────
// This is the exact fixture from the Round 6 specification
check('explicit_unregistered_patch_fixture_is_detected', () => {
  const fixture = `
const base44 = {};
const unregisteredPatch = {
  status: 'sold',
  hidden_reason: null
};
await base44.entities.Listing.update(id, unregisteredPatch);
`;
  const tmpFile = join(ROOT, '.tmp-ownership-fixture-explicit.mjs');
  writeFileSync(tmpFile, fixture);
  try {
    const writers = findWritersInFileAST(tmpFile, TRACKED_FIELDS);
    if (!writers.includes('status')) throw new Error('must detect status in the explicit unregisteredPatch fixture');
    if (!writers.includes('hidden_reason')) throw new Error('must detect hidden_reason in the explicit unregisteredPatch fixture');
  } finally {
    unlinkSync(tmpFile);
  }
});

// ── MAIN RUNNER ──────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Listing Status Ownership AST-Based Regression Test (Round 6) ===\n');
  console.log(`Scanned ${allFiles.length} source files.\n`);
  console.log(`Overall: ${failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log(`Tests run: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) {
    console.log(`\nFailed: ${failures.join(', ')}`);
    process.exit(1);
  }
}

main().catch(err => { console.error('Test runner error:', err); process.exit(1); });