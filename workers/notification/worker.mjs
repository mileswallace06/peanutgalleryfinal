import { createHash, randomUUID } from 'node:crypto';
import { dispatchSaleNotificationsDeps } from '../../base44/shared/saleDispatch.js';
import { dispatchWebhookNotifications } from '../../base44/shared/webhookNotifications.js';

// Only an adapter that positively knows NO request was issued may throw this.
// HTTP errors, aborts, disconnects, and timeouts are never classified this way.
export class WriteNotSent extends Error {
  constructor() { super('WRITE_NOT_SENT'); }
}
class WorkerFault extends Error {
  constructor(code) { super(code); this.code = code; }
}
const digest = value => createHash('sha256').update(value).digest('hex');
const samePatch = (row, patch) => row && Object.entries(patch).every(([key, value]) => row[key] === value);
const stableJSON = value => JSON.stringify(value, Object.keys(value).sort());
const errorResult = code => ({ ok: false, code });

function validateBounds(batchSize, groupLimit, maxWrites) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100 ||
      !Number.isInteger(groupLimit) || groupLimit < 1 || groupLimit > 100 ||
      !Number.isInteger(maxWrites) || maxWrites < 1 || maxWrites > 500) throw new WorkerFault('INVALID_BOUNDS');
}

function guardedEntities({ entities, coordinator, owner, maintenance, signal, maxWrites }) {
  let fault = null, writes = 0;
  const fail = code => { fault = new WorkerFault(code); throw fault; };
  const check = async () => {
    if (fault) throw fault;
    if (signal?.aborted) return fail('STOPPED');
    let active;
    try { active = await maintenance(); } catch { return fail('MAINTENANCE_UNVERIFIED'); }
    if (active !== false) return fail('MAINTENANCE');
  };
  const filter = async (entity, query, sort, limit = 101, skip = 0) => {
    await check();
    try {
      const rows = await entities[entity].filter(query, sort, limit, skip);
      if (!Array.isArray(rows) || rows.length > limit) throw new Error();
      return rows;
    } catch { throw new WorkerFault('ENTITY_READ_FAILED'); }
  };
  const write = async (entity, target, patch) => {
    await check();
    if (entity !== 'AdminAlert') {
      // Only known, fresh equality avoids a redundant update. Never use this
      // check to resolve an outstanding write from a previous owner.
      const rows = await filter(entity, { id: target });
      if (rows.length !== 1) throw new WorkerFault('ENTITY_CARDINALITY');
      if (samePatch(rows[0], patch)) return rows[0];
    }
    if (writes >= maxWrites) return fail('WRITE_BUDGET');
    const intent = { write_id: randomUUID(), entity, target_id: target, patch,
      dedupe_key: entity === 'AdminAlert' ? digest(stableJSON(patch)) : null };
    let started;
    try { started = await coordinator.begin(owner, intent); } catch { return fail('COORDINATION_FAILED'); }
    if (started?.ok !== true) return fail('COORDINATION_FAILED');
    if (started.already_applied) return { id: started.target_id, ...patch };
    writes++;
    let result;
    try {
      // Recheck immediately before the request. A stopped worker whose intent
      // is already durable can prove it has not sent this particular write.
      try { await check(); } catch { throw new WriteNotSent(); }
      result = target === null ? await entities[entity].create(patch) : await entities[entity].update(target, patch);
    } catch (error) {
      if (error instanceof WriteNotSent) {
        try { await coordinator.finishWrite(owner, intent.write_id, false); }
        catch { return fail('COORDINATION_FAILED'); }
        throw new WorkerFault('WRITE_NOT_SENT');
      }
      // Shared logic catches errors; latch this failure to prevent it issuing
      // any later write after an ambiguous result.
      return fail('WRITE_OUTCOME_UNKNOWN');
    }
    const id = target ?? result?.id;
    if (typeof id !== 'string' || !id) return fail('WRITE_OUTCOME_UNKNOWN');
    try { await coordinator.returned(owner, intent.write_id, id); }
    catch { return fail('COORDINATION_FAILED'); }
    // A durable terminal response allows read-only recovery if this read or
    // the subsequent PostgreSQL acknowledgement is interrupted.
    let verified;
    try { verified = await filter(entity, { id }); }
    catch { return fail('WRITE_VERIFICATION_REQUIRED'); }
    if (verified.length !== 1 || !samePatch(verified[0], patch)) return fail('WRITE_VERIFICATION_REQUIRED');
    try { await coordinator.finishWrite(owner, intent.write_id, true); }
    catch { return fail('COORDINATION_FAILED'); }
    return verified[0];
  };
  const wrapped = Object.fromEntries(['Notification', 'Purchase', 'PurchasePrivate', 'AdminAlert'].map(entity => [entity, {
    filter: (...args) => filter(entity, ...args),
    update: (id, patch) => write(entity, id, patch),
    create: patch => {
      if (entity !== 'AdminAlert') throw new WorkerFault('CREATE_NOT_ALLOWED');
      return write(entity, null, patch);
    },
  }]));
  return { entities: wrapped, check, fault: () => fault?.code, writes: () => writes };
}

const keyOf = row => row.idempotency_key || row.reference_id || row.id;
const kindOf = row => row.type === 'sale_created' ? 'sale' : row.idempotency_key?.startsWith('webhook:') ? 'webhook' : null;
const summaryErrors = result => (result.errors || 0) + (result.purchase_missing || 0) + (result.pp_missing || 0) + (result.pp_duplicate || 0);

export async function runOnce({ entities, coordinator, maintenance, signal,
  batchSize = 50, groupLimit = 100, maxWrites = 500, now = Date.now }) {
  let owner, claim, guarded;
  const totals = { scanned: 0, groups: 0, dispatched: 0, superseded: 0, errors: 0, writes: 0, push_sends: 0, email_sends: 0, issues: [] };
  let nextOffset;
  try {
    validateBounds(batchSize, groupLimit, maxWrites);
    if (signal?.aborted) return errorResult('STOPPED');
    let active;
    try { active = await maintenance(); } catch { return errorResult('MAINTENANCE_UNVERIFIED'); }
    if (active !== false) return { ok: true, code: 'MAINTENANCE', ...totals };
    owner = randomUUID();
    claim = await coordinator.claim(owner);
    if (!claim?.ok) return { ok: claim?.code === 'MAINTENANCE', code: claim?.code || 'COORDINATION_FAILED' };
    nextOffset = Number(claim.offset);
    if (!Number.isSafeInteger(nextOffset) || nextOffset < 0) throw new WorkerFault('INVALID_CURSOR');
    guarded = guardedEntities({ entities, coordinator, owner, maintenance, signal, maxWrites });
    // Scan stable membership (all notifications, not only mutable 'pending').
    // Persist the offset, then wrap. Concurrent inserts/deletes are revisited
    // on later sweeps; this is not a snapshot or an atomic Base44 queue.
    const page = await guarded.entities.Notification.filter({}, 'created_date', batchSize, nextOffset);
    totals.scanned = page.length;
    const seen = new Set();
    for (const candidate of page) {
      await guarded.check();
      const key = keyOf(candidate), kind = kindOf(candidate);
      if (!kind || typeof key !== 'string' || key.startsWith('test:') || seen.has(key)) continue;
      seen.add(key);
      const query = candidate.idempotency_key ? { idempotency_key: key }
        : candidate.reference_id ? { reference_id: key } : { id: candidate.id };
      const rows = await guarded.entities.Notification.filter(query, 'created_date', groupLimit + 1);
      if (rows.length > groupLimit) {
        totals.errors++;
        totals.issues.push({ key_hash: digest(key), code: 'GROUP_TOO_LARGE' });
        continue; // no partial deduplication
      }
      const notifications = rows.filter(row => keyOf(row) === key && kindOf(row) === kind && row.dispatch_status !== 'superseded')
        .sort((a, b) => (Date.parse(a.created_date || 0) - Date.parse(b.created_date || 0)) || String(a.id).localeCompare(String(b.id)));
      if (!notifications.length) continue;
      const dispatch = kind === 'sale' ? dispatchSaleNotificationsDeps : dispatchWebhookNotifications;
      const result = await dispatch({ entities: guarded.entities, now }, { keys: [key], notifications, limit: groupLimit });
      totals.groups++;
      totals.dispatched += result.dispatched || 0;
      totals.superseded += result.superseded || 0;
      totals.errors += summaryErrors(result);
      if (summaryErrors(result)) totals.issues.push({ key_hash: digest(key), code: 'DISPATCH_INTEGRITY' });
      // A dispatching record is an old unresolved claim, never reclaimed on a
      // timer. Report non-success so it is visible during cutover/backlog work.
      if (notifications.some(row => row.dispatch_status === 'dispatching')) {
        totals.errors++;
        totals.issues.push({ key_hash: digest(key), code: 'LEGACY_DISPATCHING' });
      }
      if (guarded.fault()) throw new WorkerFault(guarded.fault());
    }
    nextOffset = page.length < batchSize ? 0 : nextOffset + page.length;
    const code = totals.errors ? 'RETRY_REQUIRED' : 'OK';
    if (!await coordinator.finishRun(owner, nextOffset, code)) throw new WorkerFault('WRITE_BLOCKED');
    return { ok: !totals.errors, code, ...totals, writes: guarded.writes() };
  } catch (error) {
    // finishRun is conditional: it cannot clear a pending/ambiguous write or
    // another owner's claim. Failed SQL never licenses another entity write.
    if (claim?.ok) {
      try { await coordinator.finishRun(owner, Number(claim.offset), signal?.aborted ? 'STOPPED' : 'RETRY_REQUIRED'); } catch { /* durable state retained */ }
    }
    return { ...errorResult(error instanceof WorkerFault ? error.code : 'COORDINATION_FAILED'), ...totals,
      writes: guarded?.writes() || 0 };
  }
}

// Explicit read-only recovery command. Does not run dispatch or send a write
// to Base44. Works under maintenance. Pending 'started' writes remain blocked.
export async function recoverReturned({ entities, coordinator }) {
  const owner = randomUUID();
  try {
    const claim = await coordinator.claim(owner, true);
    if (!claim?.ok) return errorResult(claim?.code || 'COORDINATION_FAILED');
    if (claim.pending) {
      const { entity, target_id: id, patch, write_id: write } = claim.pending;
      let rows;
      try { rows = await entities[entity].filter({ id }, undefined, 2); }
      catch { return errorResult('WRITE_VERIFICATION_REQUIRED'); }
      if (!Array.isArray(rows) || rows.length !== 1 || !samePatch(rows[0], patch)) return errorResult('WRITE_VERIFICATION_REQUIRED');
      await coordinator.finishWrite(owner, write, true);
    }
    if (!await coordinator.finishRun(owner, Number(claim.offset), 'RECOVERED')) return errorResult('WRITE_BLOCKED');
    return { ok: true, code: 'RECOVERED' };
  } catch { return errorResult('COORDINATION_FAILED'); }
}

export function publicStatus(status) {
  if (!status) return { ok: false, code: 'NOT_CONFIGURED' };
  return { ok: !status.pending, code: status.pending ? 'WRITE_BLOCKED' : status.last_code,
    maintenance: status.maintenance, owned: !!status.owner_token, offset: status.offset,
    pending_write: status.pending?.write_id || null, phase: status.pending?.phase || null,
    started_at: status.pending?.started_at || null };
}
