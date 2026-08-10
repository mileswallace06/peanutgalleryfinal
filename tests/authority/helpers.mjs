/**
 * Shared mock deps and test utilities for authority tests (7C.9C.2E Correction Round 3)
 *
 * Round 3 changes:
 *   - list() supports skip parameter for pagination tests
 *   - Configurable failure modes: updateManyReturnZero, updateManyThrow,
 *     updateManyNoChange, createThrow, updateThrow
 *   - AdminAlert mock store for protection routine tests
 *   - createMockDepsWithRealHash for SHA-256 tests
 */
import { canonicalize } from '../../base44/shared/reservationAuthorityConstants.js';

export function mockHashEnvelope(envelope) {
  const c = canonicalize(envelope);
  let h = 0x811c9dc5;
  for (let i = 0; i < c.length; i++) { h ^= c.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `mock_${(h >>> 0).toString(16)}`;
}

function createMockStore() {
  const store = new Map();
  let counter = 0;
  // Mutable failure config — tests can set/clear these flags
  const failConfig = {
    updateManyReturnZero: false,
    updateManyReturnZeroForVersioned: false,
    updateManyThrow: false,
    updateManyNoChange: false,
    createThrow: false,
    updateThrow: false,
    filterThrow: false,
    filterThrowOnce: false,        // Round 6B: throw on first filter, succeed after
    dropFieldsOnUpdate: null,      // Round 6B: Set of field names to silently drop from $set
    mutateAfterUpdate: null,       // Round 6B: { field: value } to set after $set (simulates mutation)
  };
  let filterCallCount = 0;
  return {
    filter: async (query) => {
      if (failConfig.filterThrow) throw new Error('mock filter throw');
      if (failConfig.filterThrowOnce && filterCallCount === 0) {
        filterCallCount++;
        throw new Error('mock filter throw (once)');
      }
      filterCallCount++;
      const results = [];
      for (const [id, rec] of store) {
        let match = true;
        for (const [k, v] of Object.entries(query)) {
          if (k === 'id') { if (v !== id) { match = false; break; } }
          else if (rec[k] !== v) { match = false; break; }
        }
        if (match) results.push({ ...rec });
      }
      return results;
    },
    updateMany: async (query, update) => {
      if (failConfig.updateManyThrow) throw new Error('mock updateMany throw');
      if (failConfig.updateManyReturnZero) return { updated: 0, has_more: false };
      // Round 4: scoped failure — blocks only versioned CAS calls (with reservation_version
      // in the query), allowing unversioned protection hide calls to succeed.
      if (failConfig.updateManyReturnZeroForVersioned && query.reservation_version !== undefined) {
        return { updated: 0, has_more: false };
      }
      let updated = 0;
      for (const [id, rec] of store) {
        let match = true;
        for (const [k, v] of Object.entries(query)) {
          if (k === 'id') { if (v !== id) { match = false; break; } }
          else if (rec[k] !== v) { match = false; break; }
        }
        if (match) {
          if (!failConfig.updateManyNoChange) {
            if (update.$set) {
              for (const [k, v] of Object.entries(update.$set)) {
                // Round 6B: silently drop specified fields (simulates datastore bug)
                if (failConfig.dropFieldsOnUpdate && failConfig.dropFieldsOnUpdate.has(k)) continue;
                rec[k] = v;
              }
            }
            if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) rec[k] = (rec[k] || 0) + v;
            // Round 6B: mutate fields after update (simulates datastore corruption)
            if (failConfig.mutateAfterUpdate) {
              for (const [k, v] of Object.entries(failConfig.mutateAfterUpdate)) rec[k] = v;
            }
          }
          updated++;
          break;
        }
      }
      return { updated, has_more: false };
    },
    update: async (id, data) => {
      if (failConfig.updateThrow) throw new Error('mock update throw');
      const rec = store.get(id);
      if (!rec) throw new Error('not found');
      for (const [k, v] of Object.entries(data)) rec[k] = v;
      return { ...rec };
    },
    delete: async (id) => { store.delete(id); },
    list: async (sort, limit, skip = 0) => {
      const results = Array.from(store.values()).map(r => ({ ...r }));
      const start = skip || 0;
      const end = limit ? start + limit : results.length;
      return results.slice(start, end);
    },
    create: async (data) => {
      if (failConfig.createThrow) throw new Error('mock create throw');
      const id = `mock_${++counter}`;
      const rec = { id, ...data };
      store.set(id, rec);
      return { ...rec };
    },
    _store: store,
    _failConfig: failConfig,
  };
}

function computeEffectsHash(effectsJson, hashFn) {
  try {
    const effects = JSON.parse(effectsJson);
    return hashFn({ effects });
  } catch (e) {
    return hashFn({ effects: [] });
  }
}

export function createMockDeps(opts = {}) {
  const lp = createMockStore();
  const listing = createMockStore();
  const adminAlert = createMockStore();
  const hooks = {};
  const useRealHash = opts.useRealHash === true;
  const hashFn = useRealHash ? undefined : mockHashEnvelope;

  return {
    entities: { ListingPrivate: lp, Listing: listing, AdminAlert: adminAlert },
    now: () => Date.now(),
    generateId: () => `rev_${Math.random().toString(36).slice(2, 10)}`,
    hashEnvelope: hashFn,
    hooks,
    _lpStore: lp._store,
    _listingStore: listing._store,
    _adminAlertStore: adminAlert._store,
    _lpFailConfig: lp._failConfig,
    _listingFailConfig: listing._failConfig,
    _adminAlertFailConfig: adminAlert._failConfig,
    _seedLP: (id, data) => {
      const effectsJson = data?.pending_effects_json || '[]';
      const effectsHash = computeEffectsHash(effectsJson, mockHashEnvelope);
      lp._store.set(id, {
        id, listing_id: id,
        reservation_version: 0, reservation_lifecycle_state: 'available',
        checkout_quarantined: false, recovery_blocked: false,
        reservation_token: null, reserved_by_email: null, reservation_expires_at: null,
        reservation_revision: null,
        last_operation_id: null, last_operation_type: null,
        last_operation_payload_hash: null, last_operation_result_json: null,
        last_operation_at: null,
        pending_effects_json: '[]', pending_effects_hash: effectsHash,
        ...data,
      });
    },
    _seedListing: (id, data) => {
      listing._store.set(id, {
        id, reservation_version: 0, status: 'active', hidden_reason: null,
        reservation_mirror_state: 'available',
        reservation_token: null, reserved_by_email: null,
        ...data,
      });
    },
    _setHook: (name, fn) => { hooks[name] = fn; },
    _clearHooks: () => { for (const k of Object.keys(hooks)) delete hooks[k]; },
  };
}

// Deps with real SHA-256 hashing (no mock) — for testing the default implementation
export function createMockDepsWithRealHash() {
  return createMockDeps({ useRealHash: true });
}