/** R17: legacy contradictory timing preserved pending product/policy + payment-owner approval.
 * This is shared copy plumbing, not an approved promise or a Stripe timing contract.
 * Replace all surfaces together only after conditional wording is approved.
 */
export const PAYOUT_POLICY_REVIEW = Object.freeze({ status: 'owner-decision-required', approvedWording: null, owner: 'Miles / policy owner and purchase-security owner' });
export const PAYOUT_TIMING_COPY = Object.freeze({
  "standardTitle": "2–7 Business Days",
  "standard": "After a sale, your money moves from escrow to your bank within 2–7 business days. This is Stripe's standard timeline — not something PG controls.",
  "first": "Stripe holds your very first payout for up to 7 days. This is normal for ALL new accounts — it's their anti-fraud protection. Every seller goes through it.",
  "faq": "Your first payout takes up to 7 days (Stripe's standard new-account hold). After that, payouts typically arrive in 2–5 business days. You'll get a Stripe summary email each month."
});
