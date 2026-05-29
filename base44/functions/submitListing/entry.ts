import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Returns { flagged: bool, reason: string|null }
async function checkSuspicious(base44, sellerEmail, askingPrice) {
  const [purchases, allListings, sellerUsers] = await Promise.all([
    base44.asServiceRole.entities.Purchase.filter({ seller_email: sellerEmail }),
    base44.asServiceRole.entities.Listing.filter({ seller_email: sellerEmail }),
    base44.asServiceRole.entities.User.filter({ email: sellerEmail }),
  ]);

  const seller = sellerUsers[0];

  // Strike-based flag (disputes or admin-assigned strikes)
  if (seller && (seller.strike_count || 0) > 0) {
    return { flagged: true, reason: `Seller has ${seller.strike_count} strike(s)` };
  }

  // Prior disputes
  const disputed = purchases.filter(p => p.transfer_status === 'disputed');
  if (disputed.length > 0) {
    return { flagged: true, reason: `Seller has ${disputed.length} prior dispute(s)` };
  }

  // Repeated cancellations (3+ expired without seller action)
  const expired = purchases.filter(p => p.transfer_status === 'expired' && !p.seller_confirmed);
  if (expired.length >= 3) {
    return { flagged: true, reason: `Seller has ${expired.length} failed transfers` };
  }

  // Spam: more than 10 active listings at once
  const activeListings = allListings.filter(l => l.status === 'active');
  if (activeListings.length >= 10) {
    return { flagged: true, reason: `Seller has ${activeListings.length} active listings (possible spam)` };
  }

  // Unrealistic pricing: asking_price > $2000/ticket
  if (askingPrice > 2000) {
    return { flagged: true, reason: `Asking price $${askingPrice} is unusually high` };
  }

  return { flagged: false, reason: null };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const askingPrice = parseFloat(body.asking_price) || 0;
  const optimisticId = body.optimistic_id; // UI-generated temp ID for optimistic updates

  const isAdmin = user.role === 'admin';
  const isTest = body.is_test === true;

  // Re-fetch the user from DB to get the live stripe_onboarding_complete value,
  // bypassing any stale session token data.
  if (!isAdmin) {
    const freshUsers = await base44.asServiceRole.entities.User.filter({ email: user.email });
    const freshUser = freshUsers[0];
    const onboardingComplete =
      freshUser?.stripe_onboarding_complete === true ||
      freshUser?.stripe_onboarding_complete === 'true';
    if (!onboardingComplete) {
      return Response.json(
        { error: 'Connect your payout account before listing tickets.' },
        { status: 403 }
      );
    }
  }

  // Admin/test listings skip the suspicious check and are auto-approved
  const { flagged, reason } = isAdmin || isTest
    ? { flagged: false, reason: null }
    : await checkSuspicious(base44, user.email, askingPrice);

  // FRAUD-4: Proof image hash deduplication — flag if same proof URL used by multiple listings
  let proofDuplicate = false;
  if (body.proof_url && !isAdmin && !isTest) {
    const existingWithProof = await base44.asServiceRole.entities.Listing.filter({
      proof_url: body.proof_url,
    }).catch(() => []);
    // Filter out the current seller's own prior listings (legitimate reuse unlikely but possible for multi-listing)
    const otherSellerMatches = existingWithProof.filter(l => l.seller_email !== user.email);
    if (otherSellerMatches.length > 0) {
      proofDuplicate = true;
      console.warn('[submitListing] DUPLICATE PROOF detected:', {
        proof_url: body.proof_url,
        seller: user.email,
        matched_sellers: otherSellerMatches.map(l => l.seller_email),
      });
    }
  }

  const now = new Date().toISOString();
  const hasScreenshot = !!(body.transfer_attestation_proof_url);
  const verificationMethod = hasScreenshot ? 'screenshot_verified' : 'seller_attestation';
  const confidenceScore = hasScreenshot ? 75 : 55;

  const listing = await base44.entities.Listing.create({
    event_id: body.event_id,
    seller_email: user.email,
    section: body.section,
    row: body.row,
    seats: body.seats || undefined,
    quantity: body.quantity || 1,
    tier: body.tier || undefined,
    asking_price: askingPrice,
    original_price: body.original_price || undefined,
    transfer_method: body.transfer_method || 'email_transfer',
    proof_url: body.proof_url || undefined,
    proof_status: (flagged || proofDuplicate) ? 'pending_review' : 'approved',
    proof_rejection_reason: flagged ? reason : proofDuplicate ? 'Duplicate proof image detected — requires manual review' : undefined,
    status: 'active',
    notes: (isAdmin || isTest) ? '[TEST] Admin/demo listing' : undefined,
    // ── Transfer verification — starts the 45-min warning / 60-min expiry clock ──
    last_transfer_verification: now,
    transfer_status: 'transfer_confirmed',
    transfer_verification_method: verificationMethod,
    transfer_verification_proof_url: body.transfer_attestation_proof_url || undefined,
    transfer_confidence_score: confidenceScore,
    transfer_verified_by: user.email,
    transfer_platform: body.transfer_source || undefined,
  });

  // ── Fire-and-forget: log verification event for future historical analytics ──
  // Fetch event metadata for enrichment (best-effort — never block listing creation)
  base44.asServiceRole.entities.Event.filter({ id: body.event_id }).then(events => {
    const event = events[0];
    const eventStartMs = event?.event_start_utc
      ? new Date(event.event_start_utc).getTime()
      : event?.date
      ? new Date(event.date).getTime()
      : null;
    const minutesSinceStart = eventStartMs
      ? Math.round((Date.now() - eventStartMs) / 60000)
      : null;

    base44.asServiceRole.entities.TransferVerificationLog.create({
      listing_id: listing.id,
      event_id: body.event_id,
      seller_email: user.email,
      platform: body.transfer_source || undefined,
      verification_timestamp: now,
      transfer_available: true,
      verification_method: verificationMethod,
      event_start_utc: event?.event_start_utc || event?.date || undefined,
      minutes_since_event_start: minutesSinceStart,
      venue: event?.venue || undefined,
      city: event?.city || undefined,
      event_title: event?.title || undefined,
      has_screenshot: hasScreenshot,
      confidence_score: confidenceScore,
    }).catch(err => console.error('[submitListing] TransferVerificationLog failed:', err?.message));
  }).catch(err => console.error('[submitListing] event fetch for log failed:', err?.message));

  return Response.json({ listing, flagged, flag_reason: reason, optimistic_id: optimisticId });
});