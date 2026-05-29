/**
 * transferWindow.js
 * Shared logic for computing transfer window status, risk level, and countdown.
 */

/**
 * Given an event, compute the effective transfer window info.
 * Returns:
 *   status: 'open' | 'closing_soon' | 'closed' | 'unknown'
 *   riskLevel: 'low' | 'medium' | 'high' | 'very_high'
 *   minutesRemaining: number | null
 *   label: string
 *   sublabel: string
 *   color: string (hex)
 *   bg: string (rgba)
 *   border: string (rgba)
 *   canUpgrade: boolean
 *   showWarning: boolean
 *   badge: string
 */
export function getTransferWindowInfo(event) {
  const now = Date.now();
  const startMs = event?.event_start_utc
    ? new Date(event.event_start_utc).getTime()
    : event?.date
    ? new Date(event.date).getTime()
    : null;

  const minutesSinceStart = startMs ? (now - startMs) / 60000 : null;
  const closesAt = event?.transfer_window_closes_at
    ? new Date(event.transfer_window_closes_at).getTime()
    : null;

  const status = event?.transfer_window_status || 'unknown';

  // Manually verified — highest trust
  if (status === 'manually_verified_closed') {
    return {
      status: 'closed',
      riskLevel: 'very_high',
      minutesRemaining: null,
      label: 'Live upgrades unavailable',
      sublabel: 'Official ticket transfers are closed for this event.',
      color: '#FF2D78',
      bg: 'rgba(255,45,120,0.08)',
      border: 'rgba(255,45,120,0.3)',
      canUpgrade: false,
      showWarning: false,
      badge: 'Upgrades Closed',
      badgeIcon: '🚫',
    };
  }

  if (status === 'manually_verified_open') {
    const minutesRemaining = closesAt ? Math.max(0, (closesAt - now) / 60000) : null;
    return {
      status: 'open',
      riskLevel: 'low',
      minutesRemaining,
      label: 'Transfers verified open',
      sublabel: minutesRemaining !== null
        ? `Upgrades available for approximately ${Math.round(minutesRemaining)} more minutes`
        : 'Transfer window confirmed open by admin.',
      color: '#00FF87',
      bg: 'rgba(0,255,135,0.08)',
      border: 'rgba(0,255,135,0.3)',
      canUpgrade: true,
      showWarning: false,
      badge: 'Transfer Verified',
      badgeIcon: '✅',
    };
  }

  if (status === 'closed') {
    return {
      status: 'closed',
      riskLevel: 'very_high',
      minutesRemaining: null,
      label: 'Live upgrades unavailable',
      sublabel: 'Official ticket transfers appear closed for this event.',
      color: '#FF2D78',
      bg: 'rgba(255,45,120,0.08)',
      border: 'rgba(255,45,120,0.3)',
      canUpgrade: false,
      showWarning: false,
      badge: 'Upgrades Closed',
      badgeIcon: '🚫',
    };
  }

  // Auto-close if window has passed
  if (closesAt && now > closesAt) {
    return {
      status: 'closed',
      riskLevel: 'very_high',
      minutesRemaining: 0,
      label: 'Transfer window has closed',
      sublabel: 'The transfer window has passed — upgrades are no longer available.',
      color: '#FF2D78',
      bg: 'rgba(255,45,120,0.08)',
      border: 'rgba(255,45,120,0.3)',
      canUpgrade: false,
      showWarning: false,
      badge: 'Upgrades Closed',
      badgeIcon: '🚫',
    };
  }

  if (status === 'open') {
    const minutesRemaining = closesAt ? Math.max(0, (closesAt - now) / 60000) : null;
    const closing = minutesRemaining !== null && minutesRemaining < 30;
    return {
      status: closing ? 'closing_soon' : 'open',
      riskLevel: closing ? 'medium' : 'low',
      minutesRemaining,
      label: closing ? 'Transfers closing soon' : 'Transfers currently open',
      sublabel: minutesRemaining !== null
        ? `Upgrades available for approximately ${Math.round(minutesRemaining)} more minutes`
        : 'Transfer window is open.',
      color: closing ? '#FF8C00' : '#00FF87',
      bg: closing ? 'rgba(255,140,0,0.08)' : 'rgba(0,255,135,0.08)',
      border: closing ? 'rgba(255,140,0,0.3)' : 'rgba(0,255,135,0.3)',
      canUpgrade: true,
      showWarning: closing,
      badge: closing ? 'Transfers Closing Soon' : 'Transfers Open',
      badgeIcon: closing ? '⚠️' : '✅',
    };
  }

  if (status === 'closing_soon') {
    const minutesRemaining = closesAt ? Math.max(0, (closesAt - now) / 60000) : null;
    return {
      status: 'closing_soon',
      riskLevel: 'medium',
      minutesRemaining,
      label: 'Transfers may close soon',
      sublabel: minutesRemaining !== null
        ? `Upgrades available for approximately ${Math.round(minutesRemaining)} more minutes`
        : 'Transfer window may be closing. Act quickly.',
      color: '#FF8C00',
      bg: 'rgba(255,140,0,0.08)',
      border: 'rgba(255,140,0,0.3)',
      canUpgrade: true,
      showWarning: true,
      badge: 'Transfers Closing Soon',
      badgeIcon: '⚠️',
    };
  }

  // Unknown — infer from time since event start
  if (minutesSinceStart === null || minutesSinceStart < 0) {
    // Event hasn't started yet
    return {
      status: 'unknown',
      riskLevel: 'low',
      minutesRemaining: null,
      label: 'Transfer availability not confirmed',
      sublabel: 'Transfer availability has not been confirmed for this event.',
      color: '#BF5FFF',
      bg: 'rgba(191,95,255,0.06)',
      border: 'rgba(191,95,255,0.2)',
      canUpgrade: true,
      showWarning: true,
      badge: 'Transfer Window Unknown',
      badgeIcon: '❓',
    };
  }

  if (minutesSinceStart < 30) {
    return {
      status: 'unknown',
      riskLevel: 'medium_low',
      minutesRemaining: null,
      label: 'Best window for upgrades',
      sublabel: 'Verify transfer is still available in your ticketing app before purchasing.',
      color: '#00C8FF',
      bg: 'rgba(0,200,255,0.06)',
      border: 'rgba(0,200,255,0.2)',
      canUpgrade: true,
      showWarning: true,
      badge: 'Transfer Window Unknown',
      badgeIcon: '❓',
    };
  }

  if (minutesSinceStart < 90) {
    return {
      status: 'unknown',
      riskLevel: 'high',
      minutesRemaining: null,
      label: 'Transfer availability uncertain',
      sublabel: 'Many platforms close transfer windows mid-event. Verify before purchasing.',
      color: '#FF8C00',
      bg: 'rgba(255,140,0,0.08)',
      border: 'rgba(255,140,0,0.3)',
      canUpgrade: true,
      showWarning: true,
      badge: 'Transfer Window Unknown',
      badgeIcon: '⚠️',
    };
  }

  // 90+ min after start — high risk
  return {
    status: 'unknown',
    riskLevel: 'very_high',
    minutesRemaining: null,
    label: 'Transfer availability very uncertain',
    sublabel: 'Most platforms close transfers well before this point. Proceed only if you can verify.',
    color: '#FF2D78',
    bg: 'rgba(255,45,120,0.08)',
    border: 'rgba(255,45,120,0.3)',
    canUpgrade: true,
    showWarning: true,
    badge: 'Transfer Window Unknown',
    badgeIcon: '⚠️',
  };
}