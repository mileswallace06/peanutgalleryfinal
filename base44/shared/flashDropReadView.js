// Public-facing Flash Drop shapes. Raw records stay behind entity RLS; service
// reads must always use these allowlists, including the mutation responses.
export function validFlashDropId(value) {
  return typeof value === 'string' && value.length <= 200 && value.trim().length > 0;
}

export function isFlashDropViewer(user) {
  return Boolean(user && validFlashDropId(user.id) &&
    typeof user.email === 'string' && /^[^\s@]+@[^\s@]+$/.test(user.email) &&
    !user.disabled);
}

function text(value) {
  return typeof value === 'string' ? value : null;
}

function count(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function displayName(value) {
  // Legacy name columns sometimes contain full_name || email. Never preserve
  // that email fallback or coerce nested values into a display name.
  if (typeof value !== 'string' || value.includes('@')) return null;
  return value.trim().slice(0, 120) || null;
}

function matchesViewer(email, viewer) {
  return isFlashDropViewer(viewer) && typeof email === 'string' && email === viewer.email;
}

export function projectFlashDrop(drop, viewer) {
  const anonymous = Boolean(drop.is_anonymous);
  return {
    id: text(drop.id),
    event_id: text(drop.event_id),
    section: text(drop.section),
    row: text(drop.row),
    quantity: count(drop.quantity, 1),
    donor_message: text(drop.donor_message),
    is_anonymous: anonymous,
    donor_name: anonymous ? null : displayName(drop.donor_name),
    status: text(drop.status),
    scheduled_label: text(drop.scheduled_label),
    entry_closes_at: text(drop.entry_closes_at),
    entry_count: count(drop.entry_count),
    winner_selected_at: text(drop.winner_selected_at),
    winner_name: displayName(drop.winner_name),
    ownership_verified: drop.ownership_verified === true,
    trust_score: count(drop.trust_score),
    ownership_delivery_method: text(drop.ownership_delivery_method),
    tier: text(drop.tier),
    is_donor: matchesViewer(drop.donor_email, viewer),
    is_winner: matchesViewer(drop.winner_email, viewer),
  };
}

export function projectFlashDropWinner(drop, viewer) {
  return {
    name: displayName(drop.winner_name),
    is_you: matchesViewer(drop.winner_email, viewer),
  };
}

export function flashDropLeaders(drops) {
  const named = new Map();
  // A mixed anonymous/named donor must never gain named credit for anonymous
  // contributions. Pool anonymous contributions without disclosing identities,
  // donor counts, stable email hashes or cross-drop identifiers.
  const anonymous = { name: 'Anonymous Fan', drops: 0, wins: 0 };
  for (const drop of drops) {
    if (typeof drop.donor_email !== 'string' || !drop.donor_email) continue;
    let leader;
    if (drop.is_anonymous) {
      leader = anonymous;
    } else {
      if (!named.has(drop.donor_email)) {
        named.set(drop.donor_email, { name: displayName(drop.donor_name) || 'A generous fan', drops: 0, wins: 0 });
      }
      leader = named.get(drop.donor_email);
    }
    leader.drops++;
    if (drop.status === 'winner_selected') leader.wins++;
  }
  const leaders = [...named.values()];
  if (anonymous.drops) leaders.push(anonymous);
  return leaders.sort((a, b) => b.drops - a.drops).slice(0, 5);
}
