/**
 * Shared mock deps and test utilities for authority tests (7C.9C.2E Correction)
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
  return {
    filter: async (query) => {
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
      let updated = 0;
      for (const [id, rec] of store) {
        let match = true;
        for (const [k, v] of Object.entries(query)) {
          if (k === 'id') { if (v !== id) { match = false; break; } }
          else if (rec[k] !== v) { match = false; break; }
        }
        if (match) {
          if (update.$set) for (const [k, v] of Object.entries(update.$set)) rec[k] = v;
          updated++;
          break;
        }
      }
      return { updated, has_more: false };
    },
    update: async (id, data) => {
      const rec = store.get(id);
      if (!rec) throw new Error('not found');
      for (const [k, v] of Object.entries(data)) rec[k] = v;
      return { ...rec };
    },
    delete: async (id) => { store.delete(id); },
    list: async (sort, limit) => {
      const results = Array.from(store.values()).map(r => ({ ...r }));
      return results.slice(0, limit || results.length);
    },
    create: async (data) => {
      const id = `mock_${++counter}`;
      const rec = { id, ...data };
      store.set(id, rec);
      return { ...rec };
    },
    _store: store,
  };
}

export function createMockDeps() {
  const lp = createMockStore();
  const listing = createMockStore();
  const hooks = {};
  return {
    entities: { ListingPrivate: lp, Listing: listing },
    now: () => Date.now(),
    generateId: () => `rev_${Math.random().toString(36).slice(2, 10)}`,
    hashEnvelope: mockHashEnvelope,
    hooks,
    _lpStore: lp._store,
    _listingStore: listing._store,
    _seedLP: (id, data) => {
      lp._store.set(id, {
        id, listing_id: id,
        reservation_version: 0, reservation_lifecycle_state: 'available',
        checkout_quarantined: false, recovery_blocked: false,
        reservation_token: null, reserved_by_email: null, reservation_expires_at: null,
        reservation_revision: null,
        last_operation_id: null, last_operation_type: null,
        last_operation_payload_hash: null, last_operation_result_json: null,
        last_operation_at: null, pending_effects_json: '[]',
        ...data,
      });
    },
    _seedListing: (id, data) => {
      listing._store.set(id, {
        id, reservation_version: 0, status: 'active', hidden_reason: null,
        reservation_token: null, reserved_by_email: null,
        ...data,
      });
    },
    _setHook: (name, fn) => { hooks[name] = fn; },
    _clearHooks: () => { for (const k of Object.keys(hooks)) delete hooks[k]; },
  };
}