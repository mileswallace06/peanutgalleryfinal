import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export default function TermsOfService() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Header */}
      <div className="sticky top-0 z-20 frosted-bar border-b border-border"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
        <div className="flex items-center gap-3 px-4 pb-3">
          <button onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="font-display text-xl text-foreground">Terms of Service</h1>
        </div>
      </div>

      <div className="px-5 py-6 pb-32 max-w-2xl mx-auto space-y-6 text-sm text-foreground leading-relaxed">

        {/* Legal disclaimer banner */}
        <div className="px-4 py-3 rounded-2xl text-xs font-medium"
          style={{ background: 'rgba(255,140,0,0.1)', border: '1px solid rgba(255,140,0,0.3)', color: '#FF8C00' }}>
          ⚠️ These starter policies should be reviewed by legal counsel before public launch.
        </div>

        <p className="text-muted-foreground text-xs">Last updated: May 2026</p>

        <section className="space-y-2">
          <h2 className="font-black text-base">1. About Peanut Gallery</h2>
          <p className="text-muted-foreground">
            Peanut Gallery ("we," "us," or "our") is a fan-to-fan ticket marketplace that allows users to buy,
            sell, and upgrade event tickets — including live in-venue seat upgrades during an event. By accessing
            or using Peanut Gallery, you agree to these Terms of Service.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-black text-base">2. Eligibility</h2>
          <p className="text-muted-foreground">
            You must be at least 18 years old to use Peanut Gallery. By creating an account, you represent that
            you are 18 or older and have the legal capacity to enter into binding agreements.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-black text-base">3. The Marketplace</h2>
          <p className="text-muted-foreground">
            Peanut Gallery is a peer-to-peer marketplace. We do not own or sell tickets ourselves. All listings
            are created by individual sellers. We are not responsible for the accuracy of listing descriptions,
            seat locations, or event details provided by sellers.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-black text-base">4. Seller Responsibilities</h2>
          <p className="text-muted-foreground">
            As a seller, you agree to:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Only list tickets you legally own and have the right to sell.</li>
            <li>Accurately describe the tickets, section, row, and seat numbers.</li>
            <li>Transfer the tickets to the buyer promptly after a confirmed sale.</li>
            <li>Connect a valid Stripe account to receive payouts.</li>
            <li>Not list counterfeit, invalid, or duplicate tickets.</li>
          </ul>
          <p className="text-muted-foreground">
            Sellers who fail to transfer tickets or list fraudulent tickets may be permanently banned and subject
            to legal action.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-black text-base">5. Buyer Responsibilities</h2>
          <p className="text-muted-foreground">
            As a buyer, you agree to:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Pay the full listed price plus any applicable platform fees.</li>
            <li>Confirm receipt of tickets after the transfer is completed.</li>
            <li>Use tickets only for personal, lawful use.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-black text-base">6. Payments and Escrow</h2>
          <p className="text-muted-foreground">
            All payments are processed by Stripe. When you purchase a ticket, your payment is held in an
            escrow-style flow. The seller is not paid until both parties confirm the transfer is complete.
            A platform fee is deducted from the seller's payout.
          </p>
          <p className="text-muted-foreground">
            Peanut Gallery does not store your payment card information. All financial data is handled directly
            by Stripe in accordance with PCI-DSS standards.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-black text-base">7. Seller Payouts</h2>
          <p className="text-muted-foreground">
            Sellers receive payouts via Stripe Connect after the buyer confirms receipt of the tickets. Stripe
            may impose standard payout delays (typically 2–7 business days for new accounts). Peanut Gallery
            is not liable for delays caused by Stripe's standard processing timelines.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-black text-base">8. Ticket Transfers</h2>
          <p className="text-muted-foreground">
            Tickets may be transferred via platform transfer (e.g., Ticketmaster), email transfer, or
            in-person. The method is specified by the seller at the time of listing. Sellers must initiate
            the transfer within 48 hours of a confirmed sale. Failure to do so may result in a full refund to
            the buyer and removal of the listing.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-black text-base">9. Seat Upgrades</h2>
          <p className="text-muted-foreground">
            The Upgrades feature allows users physically at a venue to purchase better seats from other
            attendees. Location verification may be used to confirm proximity to the venue. Upgrades are
            subject to the same payment, escrow, and transfer rules as standard purchases.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-black text-base">10. Disputes and Refunds</h2>
          <p className="text-muted-foreground">
            If you believe a seller has failed to transfer tickets, you may open a dispute within the app.
            Peanut Gallery will review the dispute and may issue a full or partial refund at our discretion.
            Disputes must be raised before the event ends. We reserve the right to freeze funds pending
            dispute resolution.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-black text-base">11. Location Data</h2>
          <p className="text-muted-foreground">
            Peanut Gallery requests your device location to show nearby events and to verify proximity for
            in-venue seat upgrades. Location data is used only within the app session and is not stored
            permanently or shared with third parties. You may deny location access, but some features
            (including Upgrades) will be unavailable.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-black text-base">12. Prohibited Conduct</h2>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Listing tickets you do not own.</li>
            <li>Manipulating prices to exploit buyers.</li>
            <li>Creating fake or duplicate accounts.</li>
            <li>Attempting to circumvent escrow or payment processes.</li>
            <li>Harassing other users or Peanut Gallery staff.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-black text-base">13. Account Deletion</h2>
          <p className="text-muted-foreground">
            You may delete your account at any time from Account Settings. Upon deletion, your profile and
            personal data will be removed. Active listings will be cancelled and pending purchases will be
            resolved before deletion is finalized.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-black text-base">14. Limitation of Liability</h2>
          <p className="text-muted-foreground">
            Peanut Gallery is provided "as is." To the maximum extent permitted by law, we are not liable for
            any indirect, incidental, or consequential damages arising from your use of the platform, including
            losses related to ticket transfers, event cancellations, or payment processing.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-black text-base">15. Changes to These Terms</h2>
          <p className="text-muted-foreground">
            We may update these Terms at any time. Continued use of Peanut Gallery after changes are posted
            constitutes acceptance of the revised Terms.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-black text-base">16. Contact</h2>
          <p className="text-muted-foreground">
            Questions about these Terms? Email us at{' '}
            <a href="mailto:support@peanutgallery.app" className="underline" style={{ color: '#BF5FFF' }}>
              support@peanutgallery.app
            </a>
          </p>
        </section>

        <div className="pt-4 px-4 py-3 rounded-2xl text-xs text-muted-foreground"
          style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
          ⚠️ These starter policies should be reviewed by legal counsel before public launch.
        </div>
      </div>
    </div>
  );
}