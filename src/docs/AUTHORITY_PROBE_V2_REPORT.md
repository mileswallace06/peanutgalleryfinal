# Authority Probe v2 — F.3.1 Certification Report

**Phase 1B · Gate F.3.1 · ARTIFACT-AND-RUNTIME-BOUNDARY CORRECTION**
**Verdict: PASS**
**Date: 2026-08-18**
**Run ID: `run_cc5796a6-94bc-4449-a645-ba82c520fae0`**

---

## 1. Executive Summary

The Authority Probe v2 was re-executed against the Neon development database with the F.3.1 artifact-and-runtime-boundary correction applied. This gate splits the authority client into a runtime-only executor client and a separate admin/test client, restricts executor grants to 6 allowlisted functions only, and makes the 15-proof certification substantive via independent invariant assertions.

**F.3.1 Corrections:**

1. **Client split** — `authorityClient.js` (runtime, executor-only, 6 allowlisted methods) separated from `authorityAdmin.js` (deployment/test-only, raw SQL, schema management). Production handlers import only the runtime client.
2. **Executor privilege reduction** — `003_roles.sql` revokes EXECUTE on ALL functions from executor, then grants only 6 runtime-allowlisted functions. `acquire_operation`, `cleanup_synthetic`, `count_synthetic`, and `reserve_and_fail` are explicitly NOT granted.
3. **Substantive test** — `tests/authority-probe-v2-live.test.mjs` rewritten with 114 independent invariant assertions. Each proof's evidence fields are verified against expected invariants, not merely `pass === true`. SQL artifact hashes are independently recomputed and compared.
4. **Canonical results** — Full 15-proof evidence persisted in `tests/authority-probe-v2-live-results.json` under a single run ID. No rerun required for certification retrieval.

**All 15 proofs PASS. 114/114 invariant assertions satisfied. Zero synthetic rows remain. Zero secret leakage detected.**

---

## 2. Live Proof Results (Final Run — 2026-08-18T20:41:18Z)

| Proof | Description | Result |
|-------|-------------|--------|
| safety | Secrets defined, executor role valid, admin/executor connect, no leakage | ✅ PASS |
| schema_setup | Schema, functions, roles deployed (3 tables, 10 functions) | ✅ PASS |
| P1 | Initialize authority state (version 0) | ✅ PASS |
| P2 | Replay committed operation — identical result | ✅ PASS |
| P3 | Persist conflict → make eligible → replay returns original conflict | ✅ PASS (exact_match: true) |
| P4 | Operation ID reuse with changed payload → OPERATION_ID_CONFLICT | ✅ PASS |
| P5 | Stale expected version → CONFLICT | ✅ PASS |
| P6 | Post-update failure → transaction rollback (state unchanged, 0 residue) | ✅ PASS |
| P7 | 100 concurrent distinct reservations → 1 winner, 99 conflicts, 0 errors | ✅ PASS |
| P8 | 100 concurrent identical retries → 1 operation row, all identical | ✅ PASS |
| P9 | Release reservation → available, version incremented | ✅ PASS |
| P10 | Unknown client response → recover by operation ID | ✅ PASS |
| P11 | 100 concurrent incident upserts → 1 row, 1 ID, occurrence_count = 100 | ✅ PASS |
| P12 | Privilege matrix (aclexplode ACL evaluation, PUBLIC EXECUTE count = 0) | ✅ PASS |
| P13 | Handler uses executor secret, never admin | ✅ PASS |
| P14 | 25 latency samples (min 9ms, median 10ms, p95 11ms, max 11ms) | ✅ PASS |
| P15 | Cleanup → zero synthetic rows | ✅ PASS |

### F.3.1 Boundary Verification

- **Runtime client (`authorityClient.js`):** Executor-only URL parameter. No admin URL. No raw-SQL method. 6 allowlisted function calls via hardcoded names. Fingerprint validation (role + Neon hostname + database name).
- **Admin client (`authorityAdmin.js`):** Never imported by any production handler (`base44/functions/*/entry.ts`). Used only by the probe module for schema deployment and privilege auditing.
- **Executor grants:** `acquire_operation`, `cleanup_synthetic`, `count_synthetic`, `reserve_and_fail` explicitly NOT granted to `authority_probe_executor`. P12 verifies all 4 are denied (SQLSTATE 42501).
- **PUBLIC EXECUTE:** `public_execute_count: 0` across all 10 functions. `aclexplode(COALESCE(proacl, acldefault('f', proowner)))` evaluation confirms no grantee=0 EXECUTE entries.

---

## 3. F.3.1 Corrections Applied

### 3.1 Client Split (F.3.1)

- **Before (F.3):** Single `authorityClient.js` with both runtime and admin capabilities.
- **After (F.3.1):** Two modules:
  - `base44/shared/authorityClient.js` — `createRuntimeClient(executorUrl)`. Exports 6 methods + `verifyEnvironment()` + fingerprint metadata. No admin URL, no raw SQL, no schema management.
  - `base44/shared/authorityAdmin.js` — `createAdminClient(adminUrl)`. Raw SQL execution, schema deployment, privilege auditing, synthetic data management. Importable only by test/deployment code.

### 3.2 Executor Privilege Reduction (F.3.1)

`database/authority_probe_v2/003_roles.sql` updated:

- **REVOKE EXECUTE** on ALL functions in schema from PUBLIC and executor (clean slate).
- **GRANT EXECUTE** only on 6 runtime functions: `get_state`, `initialize_listing`, `reserve_listing`, `release_listing`, `get_operation_result`, `upsert_incident`.
- **NOT GRANTED:** `acquire_operation` (internal helper), `cleanup_synthetic` (deletes all probe data), `count_synthetic` (diagnostic), `reserve_and_fail` (test-only rollback verification).
- **Default privileges** altered to prevent future functions from gaining PUBLIC EXECUTE.

### 3.3 Substantive Test (F.3.1)

`tests/authority-probe-v2-live.test.mjs` rewritten:

- **114 independent invariant assertions** — each proof's evidence fields verified against expected values (e.g., P3: `step2_reserve.ok === true`, `step3_conflict.code === 'CONFLICT'`, `state_after_release.lifecycle_state === 'available'`, `exact_match === true`).
- **SQL artifact hash verification** — SHA-256 of each committed SQL file independently recomputed at test time and compared against the hash recorded in the canonical results. Detects SQL drift.
- **No-secret-leakage scan** — raw results JSON scanned for `postgres://`, `postgresql://`, `@neon.tech` patterns.
- **Zero-synthetic-rows verification** — P15 `count_after.total === 0` asserted independently.

### 3.4 Canonical Results Persistence (F.3.1)

Full 15-proof evidence persisted in `tests/authority-probe-v2-live-results.json` under run ID `run_cc5796a6-94bc-4449-a645-ba82c520fae0`. Single run, no rerun. Stale file at `src/tests/authority-probe-v2-live-results.json` deleted.

---

## 4. Retained Artifacts

| File | SHA-256 |
|------|---------|
| `base44/shared/authorityClient.js` | `164cbaef0b16f1d41332744258cdd2efde73903e8e822e7e65a0caddbdd0f817` |
| `base44/shared/authorityAdmin.js` | `ed47d5cf99611311784c1d037eb3f715ce69e5c744f13afe5961f5dc1996bd92` |
| `base44/shared/authorityProbeV2.js` | `8d0de841dfd7d00c6db4a88091392bc7c7e4561a82372d23c7f5695cebb26f1b` |
| `database/authority_probe_v2/001_schema.sql` | `8155a5301b286b6a7b6df56045bdd182ff1f1bd10493761d9436f401112c4c1f` |
| `database/authority_probe_v2/002_functions.sql` | `1c503d6641587536a3f07b3f48a8dd9710a0d3f75cf6398fdcf1e06841befad4` |
| `database/authority_probe_v2/003_roles.sql` | `274c3c931aa5c801158e3cde8a7dcb92aa590aafae63a50430b532b19a4a80a6` |
| `tests/authority-probe-v2-live.test.mjs` | `af7b80346560fa35f520b0cd2f071235b3c50bd74fac9eb820c2a034c39653c0` |
| `tests/authority-probe-v2-live-results.json` | `a83d5c3832b6bbee4a8c25fe76a5361f0f4af8311bbdffb93f3d69c942987e62` |
| `base44/functions/migrateSensitiveData/entry.ts` | `cc24c49c6969ba091b8f97c412159ca30b93af14838b379b15873dc401d8cc92` |

### Files Deleted

- `src/tests/authority-probe-v2-live-results.json` — **DELETED** (stale location; canonical results moved to `tests/`)

### Temporary Wiring Removed

- `migrateSensitiveData` `authority_probe_v2` action — **REMOVED** (restored to pre-test hash `cc24c49c`)
- Persisted MigrationRun probe records (migration_version 99) — **CLEANED** (1 record deleted)

---

## 5. Command Exit Codes

| Command | Exit Code | Notes |
|---------|----------|-------|
| `npm run test:authority-probe-v2` | **0** | 114 passed, 0 failed. All F.3.1 invariants certified. |
| `npm run build` | **0** | Vite build succeeded. |
| `npm test` | **1** | Pre-existing `launch-gate` RED failure (not F.3.1 related). 19/21 suites PASS. `concurrent-alert-deduplication` is a known-limitation. |
| `npm run lint:backend` | **0** | 0 errors, 116 warnings (all `no-unused-vars`, pre-existing). |
| `npm run lint` | **1** | 82 pre-existing `unused-imports` errors in untouched frontend files. Not F.3.1 related. |
| Scoped ESLint `authorityProbeV2.js` | **0** | 0 errors, 6 warnings (pre-existing). |
| Scoped ESLint `migrateSensitiveData/entry.ts` | **0** | 0 errors, 7 warnings (pre-existing). |
| Scoped ESLint `authority-probe-v2-live.test.mjs` | **0** | Clean. |

**Note:** `npm test` exit 1 is caused by the pre-existing launch-gate RED (production integration not implemented). All authority-related suites PASS. The `lint` exit 1 is caused by pre-existing unused-import errors in frontend files not touched by F.3.1.

---

## 6. Restoration Verification

- **`migrateSensitiveData` hash:** `cc24c49c6969ba091b8f97c412159ca30b93af14838b379b15873dc401d8cc92` — matches pre-test hash `cc24c49c` ✅
- **`authorityAdmin.js` never imported by production handlers:** Verified (0 matches in `base44/functions/*/entry.ts`) ✅
- **Runtime client has no admin URL / raw-SQL method:** Verified (regex flags were false positives from security-rule comments) ✅
- **Environment fingerprint distinguishes Neon projects:** Verified (hostname `.neon.tech`/`.neon.build` + role + database, not merely `neondb`) ✅
- **Production reservation entry points:** NOT modified ✅
- **Maintenance mode:** ON ✅

---

## 7. Database Cleanup

- **Synthetic rows remaining:** 0 (authority: 0, operations: 0, incidents: 0) ✅
- **Schema retained:** `authority_probe_v2` (3 tables, 10 functions) ✅
- **Executor role retained:** `authority_probe_executor` ✅
- **Base44 secrets retained:** `AUTHORITY_DB_URL_DEV_ADMIN`, `AUTHORITY_DB_URL_DEV_EXECUTOR` ✅
- **Secret leakage scan:** 0 findings across all retained artifacts ✅

---

## 8. Prototype Ownership Disclaimer

**The Neon admin (`neondb_owner`) currently owns the `authority_probe_v2` SECURITY DEFINER functions.** This is prototype-only for the development environment. A dedicated non-login owner/deployment role remains required before production. The admin role has superuser privileges that exceed the least-privilege principle needed for a production authority system. Production deployment must:

1. Create a dedicated non-login `authority_owner` role.
2. Transfer ownership of all schema objects to `authority_owner`.
3. Use `authority_owner` (not admin) for schema/function deployment.
4. Grant `EXECUTE` only to the runtime executor role.

---

## 9. Launch Gate Status

- **Launch gate:** RED (production integration not implemented) ✅
- **Maintenance mode:** ON ✅
- **7C.9D:** NOT started ✅

---

**F.3.1 certification complete. All retained artifacts committed.**