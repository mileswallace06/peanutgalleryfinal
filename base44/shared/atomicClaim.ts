/**
 * atomicClaim — DB-enforced single-document compare-and-set for concurrency.
 *
 * Base44 platform primitives available:
 *   - updateMany with a conditional filter + $set   ✅ (MongoDB document-level
 *                                                   atomicity)
 *   - $or / $lt / $ne / $exists query operators      ✅
 *   - Unique field indexes                           ❌
 *   - Multi-document transactions                    ❌
 *   - Custom / deterministic entity IDs              ❌
 *
 * The strongest DB-enforced primitive is therefore a conditional updateMany on
 * ONE document: the first concurrent invocation whose filter matches the
 * null/unset sentinel wins (updated===1); every other concurrent invocation's
 * filter no longer matches (the winner just set the sentinel) and gets
 * updated===0. MongoDB guarantees this is atomic at the document level, so it
 * is enforced by the database — not by an application-level read-then-write
 * convention that can be raced.
 *
 * `claimOnce` returns { won: true } for exactly one winner.
 * `staleMinutes` > 0 makes a claim reclaimable after a crash/timeout so a
 * retry can finish the work; combined with per-record existence checks in the
 * caller, a reclaim completes missing work without duplicating completed work.
 * `releaseClaim` nulls a fresh claim so a failed attempt can be retried
 * immediately (safe because a stale-reclaim can only fire after staleMinutes,
 * never within seconds of a fresh claim).
 * `claimFlag` atomically flips a boolean-ish sentinel (false/null → true) and
 * returns whether THIS call was the one that flipped it — used for exactly-once
 * per-purchase strikes (e.g. false_claim_recorded).
 */
export async function claimOnce(base44, entityName, id, claimField, claimedAtField, staleMinutes = 0) {
  const now = new Date().toISOString();
  const or = [{ [claimField]: null }, { [claimField]: '' }];
  if (staleMinutes > 0) {
    or.push({ [claimedAtField]: { $lt: new Date(Date.now() - staleMinutes * 60000).toISOString() } });
  }
  const res = await base44.asServiceRole.entities[entityName].updateMany(
    { id, $or: or },
    { $set: { [claimField]: `${entityName}:${id}:${claimField}`, [claimedAtField]: now } }
  ).catch((err) => {
    console.error('[atomicClaim] updateMany failed', entityName, id, err?.message);
    return { updated: 0 };
  });
  const updated = Number(res?.updated ?? res?.modified ?? res?.matchedCount ?? 0);
  return { won: updated > 0, updated };
}

export async function releaseClaim(base44, entityName, id, claimField, claimedAtField) {
  await base44.asServiceRole.entities[entityName].updateMany(
    { id },
    { $set: { [claimField]: null, [claimedAtField]: null } }
  ).catch(() => {});
}

// Atomically flip a sentinel field from not-true → true. Returns true if THIS
// call performed the flip (the caller owes the side effect); false if already
// true (another invocation already did it).
export async function claimFlag(base44, entityName, id, field) {
  const res = await base44.asServiceRole.entities[entityName].updateMany(
    { id, [field]: { $ne: true } },
    { $set: { [field]: true } }
  ).catch((err) => {
    console.error('[atomicClaim] claimFlag failed', entityName, id, field, err?.message);
    return { updated: 0 };
  });
  return (Number(res?.updated ?? 0)) > 0;
}