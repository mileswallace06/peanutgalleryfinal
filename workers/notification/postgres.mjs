// Same row-lock/owner-token/write-intent pattern as Mission 1, in an isolated
// notification schema. There are no financial authority or outbox operations.
export function createCoordinator(query, scope) {
  if (typeof scope !== 'string' || !scope.length || scope.length > 160) throw new Error('INVALID_SCOPE');
  const call = async (name, args) => {
    try {
      const params = [scope, ...args];
      const rows = await query(`SELECT notification_worker.${name}(${params.map((_, i) => `$${i + 1}`).join(',')}) AS result`, params);
      return rows[0].result;
    } catch {
      // Do not leak URLs, credentials, SQL arguments, entity fields, or stacks.
      throw new Error('COORDINATION_FAILED');
    }
  };
  return {
    claim: (owner, recover = false) => call('claim', [owner, recover]),
    begin: (owner, write) => call('begin_write', [owner, write.write_id, write.entity, write.target_id, JSON.stringify(write.patch), write.dedupe_key]),
    returned: (owner, write, target) => call('record_return', [owner, write, target]),
    finishWrite: (owner, write, applied) => call('finish_write', [owner, write, applied]),
    finishRun: (owner, offset, code) => call('finish_run', [owner, offset, code]),
    status: () => call('status', []),
  };
}

export async function connectCoordinator(env) {
  // Explicit dedicated configuration only; no DATABASE_URL/admin fallback.
  let url;
  try { url = new URL(env.PG_NOTIFICATION_DATABASE_URL); } catch { throw new Error('NOTIFICATION_DATABASE_REQUIRED'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.password ||
      !/\.neon\.(tech|build)$/.test(url.hostname) || !url.username ||
      ['postgres', 'neondb_owner', 'authority_owner', 'authority_executor', 'authority_worker', 'authority_stripe_recorder'].includes(decodeURIComponent(url.username))) {
    throw new Error('DEDICATED_NOTIFICATION_DATABASE_IDENTITY_REQUIRED');
  }
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(env.PG_NOTIFICATION_DATABASE_URL);
  return createCoordinator((query, args) => sql(query, args), env.PG_NOTIFICATION_SCOPE);
}
