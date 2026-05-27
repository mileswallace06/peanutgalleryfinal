/**
 * useUrgency — computes urgency level and countdown for a listing/purchase
 * based on event start time and fulfillment state.
 *
 * Returns: { level: 'critical'|'high'|'medium'|'low', label, msUntilEvent, countdown }
 */

export function getUrgency(eventDateStr, purchaseCreatedAt, fulfillmentStatus) {
  const now = Date.now();
  const eventMs = eventDateStr ? new Date(eventDateStr).getTime() : null;
  const msUntilEvent = eventMs ? eventMs - now : null;

  // Time since purchase (for sold/unfulfilled SLA)
  const purchaseMs = purchaseCreatedAt ? new Date(purchaseCreatedAt).getTime() : null;
  const msSincePurchase = purchaseMs ? now - purchaseMs : null;

  let level = 'low';

  if (eventMs) {
    if (msUntilEvent < 0) {
      level = 'ended';
    } else if (msUntilEvent < 3 * 60 * 60 * 1000) {
      level = 'critical'; // < 3h
    } else if (msUntilEvent < 24 * 60 * 60 * 1000) {
      level = 'high'; // < 24h
    } else if (msUntilEvent < 72 * 60 * 60 * 1000) {
      level = 'medium'; // < 72h
    }
  }

  // Escalate if sold but unfulfilled too long
  if (
    fulfillmentStatus === 'awaiting_pg_transfer' &&
    msSincePurchase !== null &&
    msSincePurchase > 10 * 60 * 1000 && // > 10 min
    level === 'low'
  ) {
    level = 'medium';
  }
  if (
    fulfillmentStatus === 'awaiting_pg_transfer' &&
    msSincePurchase !== null &&
    msSincePurchase > 30 * 60 * 1000 // > 30 min
  ) {
    if (level === 'low' || level === 'medium') level = 'high';
  }

  const labelMap = {
    critical: '🔴 Critical',
    high: '🟠 High',
    medium: '🟡 Medium',
    low: '🟢 Low',
    ended: '⬛ Ended',
  };

  const countdown = msUntilEvent !== null ? formatCountdown(msUntilEvent) : null;

  return { level, label: labelMap[level] || level, msUntilEvent, countdown };
}

export function formatCountdown(ms) {
  if (ms < 0) return 'Ended';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export const URGENCY_STYLES = {
  critical: { bg: 'rgba(255,45,120,0.12)', border: 'rgba(255,45,120,0.35)', color: '#FF2D78', dot: 'bg-red-500 animate-pulse' },
  high:     { bg: 'rgba(255,140,0,0.1)',   border: 'rgba(255,140,0,0.3)',   color: '#FF8C00', dot: 'bg-orange-400' },
  medium:   { bg: 'rgba(255,230,0,0.07)',  border: 'rgba(255,230,0,0.25)', color: '#FFE600', dot: 'bg-yellow-400' },
  low:      { bg: 'rgba(0,255,135,0.05)',  border: 'rgba(0,255,135,0.2)',  color: '#00FF87', dot: 'bg-green-400' },
  ended:    { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)', dot: 'bg-gray-500' },
};