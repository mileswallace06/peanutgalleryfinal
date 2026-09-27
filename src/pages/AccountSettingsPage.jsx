import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useTheme } from '@/hooks/useTheme';
import { Disclosure } from '@/components/ClarityUI';
import ProfileIdentitySection from '@/components/account/ProfileIdentitySection';
import SecuritySection from '@/components/account/SecuritySection';
import StripePayoutSection from '@/components/account/StripePayoutSection';
import TransactionHistorySection from '@/components/account/TransactionHistorySection';
import NotificationsSection from '@/components/account/NotificationsSection';
import SupportLegalSection from '@/components/account/SupportLegalSection';
import SessionSection from '@/components/account/SessionSection';
import VerificationStatusSection from '@/components/account/VerificationStatusSection';
import DeleteAccountModal from '@/components/DeleteAccountModal';
import './account-clarity.css';

export default function AccountSettingsPage() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [user, setUser] = useState(null);
  const [purchases, setPurchases] = useState([]);
  const [sales, setSales] = useState([]);
  const [stripeStatus, setStripeStatus] = useState(null);
  const [loadingStripe, setLoadingStripe] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
      if (u?.email) {
        // Phase 1B-2: fetch purchases and sales through the safe participant view
        base44.functions.invoke('getPurchaseParticipantView', {
          action: 'list_mine', perspective: 'both',
        }).then(res => {
          setPurchases(res?.data?.purchases || []);
          setSales(res?.data?.sales || []);
        }).catch(() => {});

        // Always obtain Stripe onboarding state through checkSellerOnboarding
        setLoadingStripe(true);
        base44.functions.invoke('checkSellerOnboarding', {})
          .then(res => setStripeStatus(res?.data))
          .catch(() => {})
          .finally(() => setLoadingStripe(false));
      }
    }).catch(() => {});
  }, []);

  return (
    <div className="pg-secondary-page pg-account-page pg-account-settings-page">
      <header className="pg-page-intro pg-account-heading-row">
        <button type="button" className="pg-back-link" onClick={() => navigate(-1)}><ArrowLeft size={16} aria-hidden="true" /> Back</button>
        <h1 className="pg-page-title font-display">Account Settings</h1>
      </header>

      <div className="pg-account-disclosures">
        <Disclosure title="Profile & verification" description="Your identity, profile and verification status">
          <div className="pg-account-settings-group">
            <ProfileIdentitySection user={user} />
            <VerificationStatusSection user={user} stripeStatus={stripeStatus} />
          </div>
        </Disclosure>
        <Disclosure title="Payouts & transactions" description="Seller payouts, purchases and sales history">
          <div className="pg-account-settings-group">
            <StripePayoutSection user={user} stripeStatus={stripeStatus} loading={loadingStripe} />
            <TransactionHistorySection purchases={purchases} sales={sales} />
          </div>
        </Disclosure>
        <Disclosure title="Notifications" description="Choose the updates you want to receive">
          <NotificationsSection user={user} onUpdate={updated => setUser(u => ({ ...u, ...updated }))} />
        </Disclosure>
        <Disclosure title="Security" description="Password and account protection">
          <SecuritySection user={user} />
        </Disclosure>
        <Disclosure title="Help & legal" description="Contact support, policies and terms">
          <SupportLegalSection />
        </Disclosure>
      </div>
      <div className="pg-account-session">
        <SessionSection onDeleteRequest={() => setShowDeleteModal(true)} theme={theme} toggleTheme={toggleTheme} user={user} />
      </div>

      {user && (
        <DeleteAccountModal
          user={user}
          isOpen={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
        />
      )}
    </div>
  );
}
