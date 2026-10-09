/**
 * R08 is OWNER-BLOCKED. These are the existing, conflicting published statements,
 * centralized without changing their meaning. They are NOT an approved policy.
 * Before replacing them, Miles (product/policy owner) must supply one approved
 * policy with legal review; the separate security owner must validate behavior.
 * Future approved copy must update all three surfaces together here.
 */
export const REFUND_POLICY_REVIEW = Object.freeze({
  status: 'owner-decision-required',
  owner: 'Miles / Peanut Gallery product and policy owner',
  approvedWording: null,
  implementationValidationOwner: 'Existing purchase-security workstream',
});

export const REFUND_POLICY_COPY = Object.freeze({
  terms: 'All sales are final and no refund will be issued.',
  fraudulentTicketFaq: "All listings go through a verification process. For Instant listings, we physically hold the ticket. If a ticket is ever found to be fraudulent, the buyer receives a full refund and the seller's account is permanently suspended. Escrow means nobody gets paid until delivery is confirmed.",
  sellerCancellationFaq: "Funds are in escrow — the seller can't take them. If a seller backs out after a purchase, the buyer receives a full refund and the seller is penalized or removed from the platform.",
});
