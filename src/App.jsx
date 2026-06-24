import { Suspense, lazy } from 'react'
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import Layout from '@/components/Layout';
import Landing from '@/pages/Landing';
import RouteFallback from '@/components/RouteFallback';

// ── Route-based code splitting ────────────────────────────────────────────
// All authenticated routes are lazily loaded to reduce the initial bundle.
// Landing, Layout, and auth-critical components stay eager for instant first paint.
const Events = lazy(() => import('@/pages/Events'));
const EventDetail = lazy(() => import('@/pages/EventDetail'));
const PurchaseSuccess = lazy(() => import('@/pages/PurchaseSuccess'));
const AdminMode = lazy(() => import('@/pages/AdminMode'));
const AdminCommandCenter = lazy(() => import('@/pages/AdminCommandCenter'));
const MySales = lazy(() => import('@/pages/MySales'));
const MyTickets = lazy(() => import('@/pages/MyTickets'));
const CreateListing = lazy(() => import('@/pages/CreateListing'));
const FanZone = lazy(() => import('@/pages/FanZone'));
const Me = lazy(() => import('@/pages/Me'));
const Upgrades = lazy(() => import('@/pages/Upgrades'));
const EventDetailUpgrade = lazy(() => import('@/pages/EventDetailUpgrade'));
const Sell = lazy(() => import('@/pages/Sell'));
const EventDetailTM = lazy(() => import('@/pages/EventDetailTM'));
const AccountSettingsPage = lazy(() => import('@/pages/AccountSettingsPage'));
const EditPersona = lazy(() => import('@/pages/EditPersona'));
const BetaQA = lazy(() => import('@/pages/BetaQA'));
const TermsOfService = lazy(() => import('@/pages/TermsOfService'));
const PrivacyPolicy = lazy(() => import('@/pages/PrivacyPolicy'));
const InstantListingsGuide = lazy(() => import('@/pages/InstantListingsGuide'));
const SellerPayoutGuide = lazy(() => import('@/pages/SellerPayoutGuide'));
const WhyPeanutGallery = lazy(() => import('@/pages/WhyPeanutGallery'));
const Leaderboard = lazy(() => import('@/pages/Leaderboard'));
const FounderDashboard = lazy(() => import('@/pages/FounderDashboard'));
const FounderBetaChecklist = lazy(() => import('@/pages/FounderBetaChecklist'));
const BetaRecruitment = lazy(() => import('@/pages/BetaRecruitment'));
const BetaDashboard = lazy(() => import('@/pages/BetaDashboard'));
const Notifications = lazy(() => import('@/pages/Notifications'));
const EventMode = lazy(() => import('@/pages/EventMode'));

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin, checkAppState, isAuthenticated, user } = useAuth();

  // Branded loading spinner
  if (isLoadingPublicSettings || isLoadingAuth) {
    return <RouteFallback />;
  }

  // Only show auth error screens if the user is genuinely not authenticated.
  // If we already have a user session, ignore transient auth errors (network blips, rate limits, etc.)
  if (authError && !isAuthenticated && !user) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError onRetry={checkAppState} />;
    } else if (authError.type === 'auth_required') {
      // Not logged in — show the branded landing page instead of redirecting to Base44 login
      return (
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      );
    }
  }

  return (
        <Suspense fallback={<RouteFallback />}>
        <Routes>
          {/* Authenticated root → straight to events */}
          <Route path="/" element={<Navigate to="/events" replace />} />
          <Route element={<Layout />}>
            <Route path="/events" element={<Events />} />
            <Route path="/events/:id" element={<EventDetail />} />
            <Route path="/purchase/:id" element={<PurchaseSuccess />} />
            <Route path="/admin" element={<AdminCommandCenter />} />
            <Route path="/admin-legacy" element={<AdminMode />} />
            <Route path="/my-sales" element={<MySales />} />
            <Route path="/my-tickets" element={<MyTickets />} />
            <Route path="/create-listing" element={<CreateListing />} />
            <Route path="/fan-zone" element={<FanZone />} />
            <Route path="/me" element={<Me />} />
            <Route path="/upgrades" element={<Upgrades />} />
            <Route path="/upgrades/:id" element={<EventDetailUpgrade />} />
            <Route path="/sell" element={<Sell />} />
            <Route path="/events/tm/:tmId" element={<EventDetailTM />} />
            <Route path="/account-settings" element={<AccountSettingsPage />} />
            <Route path="/edit-persona" element={<EditPersona />} />
            <Route path="/beta-qa" element={<BetaQA />} />
            <Route path="/terms" element={<TermsOfService />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/instant-listings" element={<InstantListingsGuide />} />
            <Route path="/seller-payout-guide" element={<SellerPayoutGuide />} />
            <Route path="/why-peanut-gallery" element={<WhyPeanutGallery />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/founder" element={<FounderDashboard />} />
            <Route path="/beta-checklist" element={<FounderBetaChecklist />} />
            <Route path="/beta-testers" element={<BetaRecruitment />} />
            <Route path="/beta-dashboard" element={<BetaDashboard />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/event-mode/:id" element={<EventMode />} />
          </Route>
          <Route path="*" element={<PageNotFound />} />
        </Routes>
        </Suspense>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;