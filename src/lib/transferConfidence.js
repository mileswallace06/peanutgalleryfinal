/**
 * transferConfidence.js
 * Listing-level transfer confidence engine.
 * 
 * Computes a 0-100 score representing confidence that a specific listing
 * ticket can still be transferred at this moment.
 */

/**
 * Compute the transfer confidence score for a listing.
 * @param {object} listing - Listing entity
 * @param {object} event - Event entity (for advisory window status)
 * @param {object[]} reports - TransferReport[] for this event
 * @returns {{ score: number, factors: string[], label: string, color: string, bg: string, border: string, status: string }}
 */
export function computeTransferConfidence(listing, event = null, reports = []) {
  let score = 50; // neutral baseline
  const factors = [];

  const now = Date.now();
  const lastVerified = listing.last_transfer_verification
    ? new Date(listing.last_transfer_verification).getTime()
    : null;
  const minutesSinceVerification = lastVerified ? (now - lastVerified) / 60000 : null;

  // ── Verification method bonuses ──────────────────────────────────────────
  if (listing.transfer_verification_method === 'admin_verified') {
    score += 30;
    factors.push('+30 Admin verified');
  } else if (listing.transfer_verification_method === 'screenshot_verified') {
    score += 25;
    factors.push('+25 Screenshot verified');
  } else if (listing.transfer_verification_method === 'seller_attestation') {
    score += 20;
    factors.push('+20 Seller attested');
  } else if (listing.transfer_verification_method === 'buyer_confirmed') {
    score += 15;
    factors.push('+15 Buyer confirmed');
  } else if (listing.transfer_verification_method === 'community_verified') {
    score += 15;
    factors.push('+15 Community verified');
  }

  // Screenshot proof present (additive on top of method)
  if (listing.transfer_verification_proof_url) {
    score += 10;
    factors.push('+10 Proof screenshot attached');
  }

  // Seller verified recently (extra bonus for recency)
  if (minutesSinceVerification !== null) {
    if (minutesSinceVerification <= 5) {
      score += 20;
      factors.push('+20 Verified in last 5 min');
    } else if (minutesSinceVerification <= 15) {
      score += 10;
      factors.push('+10 Verified in last 15 min');
    }
  }

  // ── Time decay ────────────────────────────────────────────────────────────
  if (minutesSinceVerification !== null) {
    if (minutesSinceVerification > 90) {
      score -= 50;
      factors.push('-50 Verified 90+ min ago');
    } else if (minutesSinceVerification > 60) {
      score -= 30;
      factors.push('-30 Verified 60+ min ago');
    } else if (minutesSinceVerification > 30) {
      score -= 15;
      factors.push('-15 Verified 30+ min ago');
    }
  } else {
    // No verification at all
    score -= 20;
    factors.push('-20 Never verified');
  }

  // ── Community reports ──────────────────────────────────────────────────
  if (reports.length > 0) {
    const recentReports = reports.filter(r => {
      const age = (now - new Date(r.created_date).getTime()) / 60000;
      return age <= 120; // only last 2 hours
    });
    const openReports = recentReports.filter(r => r.report_type === 'transfer_available');
    const closedReports = recentReports.filter(r => r.report_type === 'transfer_unavailable');

    if (openReports.length > closedReports.length && openReports.length >= 2) {
      score += 15;
      factors.push(`+15 Community reports transfers open (${openReports.length} reports)`);
    } else if (closedReports.length > openReports.length && closedReports.length >= 2) {
      score -= 20;
      factors.push(`-20 Community reports transfers closed (${closedReports.length} reports)`);
    }
  }

  // ── Event-level advisory ──────────────────────────────────────────────
  if (event) {
    const eStatus = event.transfer_window_status;
    if (eStatus === 'manually_verified_closed' || eStatus === 'closed') {
      score -= 40;
      factors.push('-40 Event transfer window closed');
    } else if (eStatus === 'manually_verified_open') {
      score += 10;
      factors.push('+10 Event transfer window confirmed open');
    } else if (eStatus === 'closing_soon') {
      score -= 10;
      factors.push('-10 Event transfer window closing soon');
    }
  }

  // ── Hard overrides ───────────────────────────────────────────────────
  if (listing.transfer_status === 'transfer_disabled') {
    score = 0;
  } else if (listing.transfer_verification_method === 'admin_verified' && listing.transfer_status === 'transfer_confirmed') {
    score = Math.max(score, 85); // admin verification floors at 85
  }

  // Clamp 0–100
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    factors,
    ...getConfidenceDisplay(score),
    isExpired: minutesSinceVerification !== null && minutesSinceVerification > 60,
    minutesSinceVerification,
  };
}

export function getConfidenceDisplay(score) {
  if (score >= 80) {
    return {
      label: `${score}% Transfer Confidence`,
      color: '#00FF87',
      bg: 'rgba(0,255,135,0.08)',
      border: 'rgba(0,255,135,0.25)',
      tier: 'high',
    };
  } else if (score >= 50) {
    return {
      label: `${score}% Transfer Confidence`,
      color: '#FF8C00',
      bg: 'rgba(255,140,0,0.08)',
      border: 'rgba(255,140,0,0.25)',
      tier: 'medium',
    };
  } else {
    return {
      label: `${score}% Transfer Confidence`,
      color: '#FF2D78',
      bg: 'rgba(255,45,120,0.08)',
      border: 'rgba(255,45,120,0.25)',
      tier: 'low',
    };
  }
}

/**
 * Human-readable label for how long ago verification happened.
 */
export function formatVerificationAge(isoTimestamp) {
  if (!isoTimestamp) return null;
  const mins = (Date.now() - new Date(isoTimestamp).getTime()) / 60000;
  if (mins < 1) return 'Verified just now';
  if (mins < 60) return `Verified ${Math.round(mins)} min ago`;
  const hrs = Math.floor(mins / 60);
  return `Verified ${hrs}h ${Math.round(mins % 60)}m ago`;
}

/**
 * Check if a listing's transfer verification is expired (>60 min old).
 */
export function isVerificationExpired(listing) {
  if (!listing.last_transfer_verification) return false;
  const mins = (Date.now() - new Date(listing.last_transfer_verification).getTime()) / 60000;
  return mins > 60;
}

/**
 * Get the transfer status badge config for a listing.
 */
export function getTransferStatusBadge(listing) {
  const expired = isVerificationExpired(listing);

  if (listing.transfer_status === 'transfer_disabled') {
    return {
      icon: '❌',
      label: 'Transfer Unavailable',
      color: '#FF2D78',
      bg: 'rgba(255,45,120,0.1)',
      border: 'rgba(255,45,120,0.3)',
      canPurchase: false,
    };
  }

  if (expired || listing.transfer_status === 'transfer_expired') {
    return {
      icon: '⏱',
      label: 'Verification Expired',
      color: '#FF8C00',
      bg: 'rgba(255,140,0,0.08)',
      border: 'rgba(255,140,0,0.25)',
      canPurchase: true, // buyer can still proceed with warning
    };
  }

  if (listing.transfer_status === 'transfer_confirmed') {
    return {
      icon: '✅',
      label: 'Transfer Verified',
      color: '#00FF87',
      bg: 'rgba(0,255,135,0.08)',
      border: 'rgba(0,255,135,0.25)',
      canPurchase: true,
    };
  }

  // transfer_unconfirmed or no status
  return {
    icon: '⚠️',
    label: 'Transfer Unconfirmed',
    color: '#FFE600',
    bg: 'rgba(255,230,0,0.08)',
    border: 'rgba(255,230,0,0.25)',
    canPurchase: true,
  };
}