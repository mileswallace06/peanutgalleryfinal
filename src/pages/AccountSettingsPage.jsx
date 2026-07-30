import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTheme } from '@/hooks/useTheme';
import { ChevronLeft } from 'lucide-react';
import ProfileIdentitySection from '@/components/account/ProfileIdentitySection';
import SecuritySection from '@/components/account/SecuritySection';
import StripePayoutSection from '@/components/account/StripePayoutSection';
import TransactionHistorySection from '@/components/account/TransactionHistorySection';
import NotificationsSection from '@/components/account/NotificationsSection';
import SupportLegalSection from '@/components/account/SupportLegalSection';
import SessionSection from '@/components/account/SessionSection';
import VerificationStatusSection from '@/components/account/VerificationStatusSection';
import DeleteAccountModal from '@/components/DeleteAccountModal';

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
    <div className="pb-32 dark:rave-bg">
      {/* Header — sticky within the tab scroll container */}
      <div
        className="flex items-center gap-3 px-4 py-3 sticky top-0 z-10 frosted-bar border-b border-white/5"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}
      >
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90"
          style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="font-display text-xl text-foreground">Account</h1>
      </div>

      <div className="px-4 pt-5 space-y-6 pb-10">
        <ProfileIdentitySection user={user} />
        <VerificationStatusSection user={user} stripeStatus={stripeStatus} />
        <StripePayoutSection user={user} stripeStatus={stripeStatus} loading={loadingStripe} />
        <TransactionHistorySection purchases={purchases} sales={sales} />
        <NotificationsSection user={user} onUpdate={updated => setUser(u => ({ ...u, ...updated }))} />
        <SecuritySection user={user} />
        <SupportLegalSection />
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