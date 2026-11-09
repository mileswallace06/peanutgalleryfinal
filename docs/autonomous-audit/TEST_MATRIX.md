# Autonomous readiness audit

Cycle: 2026-11-09. Inspected remote main: `a8d53251db3e57aee833b68447fe04bab1c59f34`. Environment: isolated Linux cloud checkout, Node v24.22.1. Audit branch: `audit/autonomous-readiness`. No production code, provider configuration, accounts, financial operations, or deployed state changed.

This is an initial bounded cycle, not an exhaustive certification. The separate unreleased Mission 1 local candidate was not available here and is not replaced or disproved by remote-main findings. Classifications describe the specific behavior, not an entire feature. Evidence levels: E1 policy/design; E2 inspected implementation; E3 executable synthetic/mocked checks; E4 real isolated integration; E5 verified deployed behavior.

# Tests and coverage

## Executed cycle 1

- `npm ci --ignore-scripts --cache /tmp/pg-audit-npm-cache`: succeeded, 683 packages. First attempt using default cache failed; writable cache retry succeeded. No lifecycle scripts ran.
- `node tests/run-audit-safe.mjs`: exit 0; 41 suites, 418 tests passed, zero failed/skipped. This allowlist imports `tests/deny-network.mjs` in every child. Initial run before dependency setup had module-resolution failures; final run supersedes those environment failures, not historical product defects.
- `node --import ./tests/deny-network.mjs tests/launch-gate.test.mjs`: exit 1; two explicit failures: `production_entry_points_integrated`, `concurrent_alert_duplication_is_known_blocker`. These gates declare evidence gaps, not newly observed live failures.
- `npm run lint`: exit 0, no reported errors.
- Actual proof handler synthetic reproduction below: exit 0, two assertions reproduced defects PG-AUD-004/005. Passing reproduction means the defects were observed, not fixed.
- `git diff --check`: passed before final commit.

Node v24.22.1 differs from CI Node 22; no equivalence claim. No browser, Deno deployment, real PostgreSQL, Stripe, Base44, notification, file-scan engine or production traffic tests ran. No whole-app certification.

### Offline suite results

| Suite | Tests | Passed | Failed | Skipped |
|---|---:|---:|---:|---:|
| audit-workflow-semantics | 9 | 9 | 0 | 0 |
| branded-auth-fields | 4 | 4 | 0 | 0 |
| branded-auth | 12 | 12 | 0 | 0 |
| member-access | 5 | 5 | 0 | 0 |
| event-date-display | 13 | 13 | 0 | 0 |
| flash-drop-dialog | 7 | 7 | 0 | 0 |
| public-access-render | 4 | 4 | 0 | 0 |
| ui-control-contrast | 10 | 10 | 0 | 0 |
| upgrade-route-clock | 4 | 4 | 0 | 0 |
| upgrade-showtime-state | 11 | 11 | 0 | 0 |
| tm-event-timezone-handler | 14 | 14 | 0 | 0 |
| venue-timezone-frontend | 10 | 10 | 0 | 0 |
| event-search-request | 13 | 13 | 0 | 0 |
| selling-event-picker | 13 | 13 | 0 | 0 |
| selling-ongoing-provider | 8 | 8 | 0 | 0 |
| tm-ongoing-handler | 7 | 7 | 0 | 0 |
| search-normalize | 28 | 28 | 0 | 0 |
| tm-response-handler | 15 | 15 | 0 | 0 |
| upgrade-discovery | 7 | 7 | 0 | 0 |
| upgrades-live-discovery | 7 | 7 | 0 | 0 |
| upgrades-owned-navigation | 6 | 6 | 0 | 0 |
| listing-share | 15 | 15 | 0 | 0 |
| shared-listing-destination | 14 | 14 | 0 | 0 |
| fan-post-composer | 12 | 12 | 0 | 0 |
| bucket-list-feed | 4 | 4 | 0 | 0 |
| browse-ticket-interaction | 13 | 13 | 0 | 0 |
| event-discovery-paging | 13 | 13 | 0 | 0 |
| listing-event-lifecycle | 6 | 6 | 0 | 0 |
| legal-document | 5 | 5 | 0 | 0 |
| fan-zone-recovery | 10 | 10 | 0 | 0 |
| profile-beta-accessibility | 9 | 9 | 0 | 0 |
| sales-admin-presentation | 11 | 11 | 0 | 0 |
| route-metadata | 2 | 2 | 0 | 0 |
| oct09-discovery-state | 5 | 5 | 0 | 0 |
| oct09-discovery-paging | 4 | 4 | 0 | 0 |
| event-identity-presentation | 10 | 10 | 0 | 0 |
| oct09-lifecycle | 27 | 27 | 0 | 0 |
| founder-read-recovery | 10 | 10 | 0 | 0 |
| purchase-detail | 7 | 7 | 0 | 0 |
| purchase-transfer-platform | 21 | 21 | 0 | 0 |
| purchase-cancellation-recovery | 13 | 13 | 0 | 0 |

## Coverage matrix

| Area | Current evidence | Outstanding important coverage |
|---|---|---|
| Auth/member/public access | Allowlist synthetic checks | Real auth/session/role persistence and cross-account attacks |
| Event/search/timezone/lifecycle | Allowlist synthetic checks | Provider changes, delayed events, real venue dates/timezones |
| Listing creation/transferability | Static review of submitListing | Actual handler validation, ownership/duplicates, evidence and race tests |
| Proof verification | Static review plus two actual-handler synthetic defect reproductions | Full scanner/AI integration, fault recovery, concurrency |
| Purchase UI cancellation | 13 synthetic checks | Real refund/cancel/reconciliation, device rendering |
| Checkout/payments/refunds/payouts | Source inventory and launch-gate declarations | Current owner candidate and isolated/hosted evidence |
| Fan Zone/content | Allowlist synthetic checks | Cross-user privacy, abuse, scale, browser behavior |
| Fan Drops/Seat Flex/Gifts/Points | Partial allowlist only; otherwise not reviewed | End-to-end concurrency, allocation, rewards and failure recovery |
| Admin/notifications/jobs/support | Partial UI checks; not end-to-end reviewed | Authorization, repeated jobs, retries, actual delivery |
| Infrastructure/recovery | README/workflow inspected | Installed mappings, migration grants, backup/restore, scanner |
| Legal/operational/accessibility/scale | Policy anchors and limited component checks | Contracts, transfer rights, assistive-tech tests, load/resource costs |

Inventory found 42 page components and 54 backend entry files; this is a count, not coverage of every behavior. An area may have tests elsewhere that this cycle did not run.

## Reproduce PG-AUD-004 and PG-AUD-005 safely

Save the following to a local temporary `.mjs` file and execute from the inspected repository using `node --import ./tests/deny-network.mjs /path/to/repro.mjs`. It strips TypeScript syntax and imports, executes the actual handler with local fakes, and injects scanning on/maintenance off only inside the VM. It never changes real configuration or calls providers. Requires Node with `stripTypeScriptTypes` support; tested on 24.22.1. Do not use live credentials. This is a synthetic handler test, not a Deno or provider integration test.

```js
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=readFileSync('base44/functions/verifyTransferProof/entry.ts','utf8');
let handler; let signedCalls=0;
const pp={seller_email:'seller@example.test',buyer_email:'buyer@example.test',ai_proof_status:'pending',current_transfer_proof_asset_id:'asset'};
const p={id:'purchase',listing_id:'listing',event_id:'event',ai_proof_status:'pending'};
const entities={Purchase:{filter:async()=>[p],updateMany:async()=>{p.ai_proof_status='processing';return {updated:1}},update:async(_,v)=>Object.assign(p,v)},Listing:{filter:async()=>[{id:'listing'}]},Event:{filter:async()=>[{id:'event'}]},ProofAsset:{filter:async()=>[{id:'asset',reference_type:'purchase',reference_id:'purchase',proof_type:'transfer_proof',scan_status:'clean',storage_uri:'local-fixture'}]}};
const sandbox={Deno:{serve:f=>handler=f},Response,console:{warn(){},error(){}},createClientFromRequest:()=>({auth:{me:async()=>({email:'seller@example.test',role:'user'})},asServiceRole:{entities},integrations:{Core:{CreateFileSignedUrl:async()=>{signedCalls++;throw new Error('synthetic signing unavailable')}}}}),secrets:{get:()=>undefined},isMaintenanceActive:()=>false,isProofScanningEnabled:()=>true,maybeRouteCanaryProofAssessment:async()=>null,isCanaryEnabled:()=>false,getPurchasePrivate:async()=>pp,upsertPurchasePrivate:async(_,__,v)=>Object.assign(pp,v),alertPrivateWriteFailure:async()=>{}};
vm.runInNewContext(stripTypeScriptTypes(source.replace(/^import .*;\n/gm,'')),sandbox);
const request=force=>({json:async()=>({purchase_id:'purchase',proof_asset_id:'asset',...(force?{force_reprocess:true}:{})})});
const first=await handler(request(false)); assert.equal(first.status,500); assert.equal(pp.ai_proof_status,'processing');
const retry=await handler(request(false)); assert.equal(retry.status,200); assert.equal((await retry.json()).reason,'already_processing_or_verified'); assert.equal(signedCalls,1);
console.log('PASS: actual handler leaves processing after signing failure; ordinary retry skips (defect reproduced).');
await handler(request(true)); await handler(request(true)); assert.equal(signedCalls,3);
console.log('PASS: ordinary seller force_reprocess bypasses processing guard twice (defect reproduced).');

```

## Evidence hashes (SHA-256)

- `base44/functions/verifyTransferProof/entry.ts`: `a91e5bf773e00aa3e47c16c58c73d0ce7d7daae52f90243134351d0295a9567e`
- `base44/functions/submitListing/entry.ts`: `13f0fdb7cfba701234b68da939fb0137ef2703bd8d610e3f5211d35fb93fb807`
- `tests/run-audit-safe.mjs`: `acbded95f4c7110e094ebe1cd90e58d77450ae6103703181e144aa48591a282a`
- `tests/deny-network.mjs`: `3e773b83707679ce66b447f49382a7c4b22b7530a650fee530fe6a35b75ce1a8`
- `package-lock.json`: `ff0f13e74673cd153e6e06e72db4637f3b3a3d73ae8fca198631138c49a5f1e7`
