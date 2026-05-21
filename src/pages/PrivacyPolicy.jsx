import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export default function PrivacyPolicy() {
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
          <h1 className="font-display text-xl text-foreground">Privacy Policy</h1>
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
          <h2 className="font-black text-base">1. Who We Are</h2>
          <p className="text-muted-foreground">
            Peanut Gallery ("we," "us," or "our") operates a fan-to-fan ticket marketplace. This Privacy Policy
            explains what information we collect, how we use it, and your rights regarding your data.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-black text-base">2. Information We Collect</h2>
          <p className="text-muted-foreground font-semibold">Account Information</p>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Name and email address (provided at registration or via Google Sign-In)</li>
            <li>Profile photo (optional)</li>
            <li>Phone number (optional, used for transfer coordination)</li>
          </ul>
          <p className="text-muted-foreground font-semibold mt-3">Transaction Information</p>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Ticket listings you create (event, section, row, price)</li>
            <li>Purchases and sales history</li>
            <li>Transfer status and confirmation records</li>
          </ul>
          <p className="text-muted-foreground font-semibold mt-3">Payment Information</p>
          <p className="text-muted-foreground">
            We do not store your payment card details. Payments are processed by Stripe. If you connect
            a Stripe seller account, Stripe collects and stores your banking and identity information
            under their own Privacy Policy.
          </p>
          <p className="text-muted-foreground font-semibold mt-3">Location Information</p>
          <p className="text-muted-foreground">
            With your permission, we collect your device's GPS coordinates to show nearby events and
            to verify your physical proximity to a venue for in-venue seat upgrades. Location is used
            only during an active session and is not stored long-term.
          </p>
          <p className="text-muted-foreground font-semibold mt-3">Usage Data</p>
          <p className="text-muted-foreground">
            We may collect anonymized usage data (pages visited, features used, error logs) to improve
            the app. This data is not linked to your identity.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-black text-base">3. How We Use Your Information</h2>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>To operate the marketplace and process ticket transactions.</li>
            <li>To verify your identity and prevent fraud.</li>
            <li>To facilitate ticket transfers between buyers and sellers.</li>
            <li>To show you relevant events based on your location.</li>
            <li>To send transactional emails (purchase confirmations, transfer notifications).</li>
            <li>To resolve disputes between buyers and sellers.</li>
            <li>To comply with legal obligations.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-black text-base">4. How We Share Your Information</h2>
          <p className="text-muted-foreground">
            We do not sell your personal data. We share information only as follows:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>
              <strong>With the other party in a transaction:</strong> Buyers and sellers may see each
              other's display name and contact details as needed to complete a ticket transfer.
            </li>
            <li>
              <strong>With Stripe:</strong> To process payments and manage seller payouts via Stripe Connect.
            </li>
            <li>
              <strong>With Ticketmaster:</strong> Event search queries are sent to the Ticketmaster API.
              No personal data is shared.
            </li>
            <li>
              <strong>With service providers:</strong> Infrastructure and analytics providers who process
              data on our behalf under strict confidentiality agreements.
            </li>
            <li>
              <strong>As required by law:</strong> To comply with legal process, court orders, or
              government requests.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-black text-base">5. Location Data</h2>
          <p className="text-muted-foreground">
            Location access is requested only when you use features that require it (finding nearby events,
            in-venue upgrades). You can deny location access at any time in your device settings. Location
            coordinates are used only for the current session and are not stored on our servers beyond what
            is necessary to complete the transaction.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-black text-base">6. Data Retention</h2>
          <p className="text-muted-foreground">
            We retain your account and transaction data for as long as your account is active or as needed
            to comply with legal obligations. You may request deletion of your account and associated data
            at any time from Account Settings.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-black text-base">7. Your Rights</h2>
          <p className="text-muted-foreground">Depending on your jurisdiction, you may have the right to:</p>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Access the personal data we hold about you.</li>
            <li>Correct inaccurate data.</li>
            <li>Request deletion of your data ("right to be forgotten").</li>
            <li>Object to or restrict certain processing.</li>
            <li>Port your data to another service.</li>
          </ul>
          <p className="text-muted-foreground">
            To exercise these rights, contact us at{' '}
            <a href="mailto:support@peanutgallery.app" className="underline" style={{ color: '#00FF87' }}>
              support@peanutgallery.app
            </a>
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-black text-base">8. Security</h2>
          <p className="text-muted-foreground">
            We use industry-standard security measures including encrypted connections (HTTPS), access
            controls, and third-party payment security (Stripe PCI-DSS compliance). No system is 100%
            secure. If you suspect unauthorized access to your account, contact us immediately.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-black text-base">9. Children's Privacy</h2>
          <p className="text-muted-foreground">
            Peanut Gallery is not intended for users under 18. We do not knowingly collect personal
            information from minors. If we become aware that a minor has created an account, we will
            delete their information promptly.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-black text-base">10. Third-Party Links</h2>
          <p className="text-muted-foreground">
            The app may display links to third-party sites (e.g., Ticketmaster event pages). We are not
            responsible for the privacy practices of those sites. Please review their policies directly.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-black text-base">11. Changes to This Policy</h2>
          <p className="text-muted-foreground">
            We may update this Privacy Policy from time to time. We will notify you of material changes
            by posting the new policy in-app. Your continued use of Peanut Gallery after changes are
            posted constitutes acceptance of the updated policy.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-black text-base">12. Contact</h2>
          <p className="text-muted-foreground">
            Questions or concerns about your privacy? Email us at{' '}
            <a href="mailto:support@peanutgallery.app" className="underline" style={{ color: '#00FF87' }}>
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