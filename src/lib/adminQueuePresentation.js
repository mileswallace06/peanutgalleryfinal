import { isVerificationExpired } from './transferConfidence.js';

export const ADMIN_QUEUE_LIMITS = { alerts: 100, reviews: 50, transfers: 200 };
export function summarizeAdminQueue(kind, rows) {
  if (!Array.isArray(rows)) throw new Error('Queue response unavailable');
  const matching = kind === 'alerts' ? rows.filter(row => !row.resolved)
    : kind === 'transfers' ? rows.filter(row => ['active', 'pending_transfer', 'hidden'].includes(row.status) && (isVerificationExpired(row) || !row.last_transfer_verification))
      : rows;
  return { status: 'ready', count: matching.length, loaded: rows.length, limit: ADMIN_QUEUE_LIMITS[kind] };
}
export function queueStatusLabel(state) {
  if (!state || state.status === 'loading') return 'Loading…';
  if (state.status === 'error') return 'Unavailable — retry';
  return `${state.count} in loaded records`;
}
