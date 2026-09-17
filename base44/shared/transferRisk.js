export function transferConfidence(listing = {}) {
  const raw = listing.transfer_confidence_score;
  const numeric = Number(raw);
  return raw !== null && raw !== undefined && raw !== '' && Number.isFinite(numeric)
    ? numeric
    : null;
}

// Only an explicitly confirmed transfer with a current confidence score of at
// least 70 bypasses the buyer warning. Status and score are independent gates:
// a stale/low score cannot be made safe merely by a legacy "confirmed" label.
export function requiresTransferRiskAcknowledgment(listing = {}) {
  const confidence = transferConfidence(listing);
  return listing.transfer_status !== 'transfer_confirmed' || confidence === null || confidence < 70;
}
