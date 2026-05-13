// Optimistic UI helpers for submitListing and capturePayment flows
export const createOptimisticListing = (formData, userId) => {
  // Return optimistic listing object that matches API response shape
  return {
    id: `temp_${Date.now()}`,
    event_id: formData.event_id,
    seller_email: userId,
    section: formData.section,
    row: formData.row,
    seats: formData.seats || undefined,
    quantity: formData.quantity || 1,
    tier: formData.tier || undefined,
    asking_price: parseFloat(formData.asking_price) || 0,
    original_price: formData.original_price ? parseFloat(formData.original_price) : undefined,
    transfer_method: formData.transfer_method || 'email_transfer',
    proof_url: formData.proof_url || undefined,
    proof_status: 'pending_review',
    status: 'active',
    created_date: new Date().toISOString(),
    _optimistic: true // Flag for UI to identify optimistic entries
  };
};

export const createOptimisticPurchase = (listing, buyerEmail, buyerName, amount) => {
  // Return optimistic purchase object
  return {
    id: `temp_${Date.now()}`,
    listing_id: listing.id,
    event_id: listing.event_id,
    buyer_email: buyerEmail,
    buyer_name: buyerName,
    seller_email: listing.seller_email,
    amount: parseFloat(amount) || 0,
    subtotal: (parseFloat(amount) / 1.1) || 0,
    platform_fee: (parseFloat(amount) - (parseFloat(amount) / 1.1)) || 0,
    seller_payout: ((parseFloat(amount) / 1.1) * 0.95) || 0,
    quantity: listing.quantity || 1,
    payment_intent_id: null,
    payment_captured: false,
    transfer_status: 'pending_transfer',
    buyer_confirmed: false,
    seller_confirmed: false,
    created_date: new Date().toISOString(),
    _optimistic: true // Flag for UI to identify optimistic entries
  };
};

export const createOptimisticPurchaseUpdate = (purchaseId, confirming_role) => {
  // Returns optimistic state updates for purchase confirmation
  return {
    id: purchaseId,
    [confirming_role === 'buyer' ? 'buyer_confirmed' : 'seller_confirmed']: true,
    _optimistic: true,
    _updating: true
  };
};