import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
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
  const location = useLocation();
  const showPayouts = location.hash === '#payouts';
  useEffect(() => {
    if (showPayouts) requestAnimationFrame(() => {
      const target = document.getElementById('payouts');
      target?.scrollIntoView({ block: 'start' });
      target?.focus({ preventScroll: true });
    });
  }, [showPayouts]);
  const { theme, toggleTheme } = useTheme();
  const [user, setUser] = useState(null);
  const [purchases, setPurchases] = useState([]);
  const [sales, setSales] = useState([]);
  const [historyStatus, setHistoryStatus] = useState('loading');
  const loadHistory = useCallback(async () => {
    setHistoryStatus('loading');
    try {
      const res = await base44.functions.invoke('getPurchaseParticipantView', { action: 'list_mine', perspective: 'both' });
      if (!Array.isArray(res?.data?.purchases) || !Array.isArray(res?.data?.sales)) throw new Error('History unavailable');
      setPurchases(res.data.purchases);
      setSales(res.data.sales);
      setHistoryStatus('ready');
    } catch { setHistoryStatus('error'); }
  }, []);
  const [stripeStatus, setStripeStatus] = useState(null);
  const [loadingStripe, setLoadingStripe] = useState(true);
  const [stripeError, setStripeError] = useState(false);
  const loadStripe = useCallback(async () => {
    setLoadingStripe(true);
    setStripeError(false);
    try {
      const res = await base44.functions.invoke('checkSellerOnboarding', {});
      if (typeof res?.data?.details_submitted !== 'boolean' || typeof res?.data?.charges_enabled !== 'boolean') throw new Error('Stripe status unavailable');
      setStripeStatus(res.data);
    } catch {
      setStripeStatus(null);
      setStripeError(true);
    } finally { setLoadingStripe(false); }
  }, []);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
      if (u?.email) {
        // Phase 1B-2: fetch purchases and sales through the safe participant view
        loadHistory();

        // Always obtain Stripe onboarding state through checkSellerOnboarding
        loadStripe();
      } else {
        setHistoryStatus('error');
        setStripeError(true);
        setLoadingStripe(false);
      }
    }).catch(() => {
      setHistoryStatus('error');
      setStripeError(true);
      setLoadingStripe(false);
    });
  }, [loadHistory, loadStripe]);

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
        <Disclosure defaultOpen={showPayouts} title="Payouts & transactions" description="Seller payouts, purchases and sales history">
          <div className="pg-account-settings-group">
            <StripePayoutSection defaultOpen={showPayouts} stripeStatus={stripeStatus} loading={loadingStripe} error={stripeError} onRetry={loadStripe} />
            <TransactionHistorySection purchases={purchases} sales={sales} status={historyStatus} onRetry={loadHistory} />
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
