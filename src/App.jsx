import { Suspense, lazy, useLayoutEffect, useState } from 'react'
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate, Outlet, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import Layout from '@/components/Layout';
import Landing from '@/pages/Landing';
import RouteFallback from '@/components/RouteFallback';
import { memberAccess } from '@/lib/memberAccess';

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
const CookiePolicy = lazy(() => import('@/pages/CookiePolicy'));
const OurStory = lazy(() => import('@/pages/OurStory'));
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
const BrandedAuth = lazy(() => import('@/pages/BrandedAuth'));

const MemberRoute = () => {
  const auth = useAuth();
  const location = useLocation();
  const access = memberAccess(auth);
  if (access === 'loading') return <RouteFallback />;
  if (access === 'unregistered') return <UserNotRegisteredError onRetry={auth.checkAppState} />;
  if (access === 'unavailable') return (
    <main className="min-h-dvh bg-background text-foreground flex items-center justify-center p-6">
      <div className="max-w-sm text-center space-y-4">
        <h1 className="font-display text-2xl">We couldn’t check your sign-in</h1>
        <p>Please try again. Your account has not been changed.</p>
        <button onClick={auth.checkAppState} className="min-h-11 px-5 py-3 rounded-xl border border-border">Try again</button>
        <a href="/" className="block underline">Back to Peanut Gallery</a>
      </div>
    </main>
  );
  if (access !== 'member') {
    const next = location.pathname + location.search;
    return <Navigate to={`/login?from_url=${encodeURIComponent(next)}`} replace />;
  }
  return <Outlet />;
};

const Home = () => {
  const auth = useAuth();
  return memberAccess(auth) === 'member' ? <Navigate to="/events" replace /> : <Landing />;
};

const ResetPasswordRoute = () => {
  const location = useLocation();
  // Base44's current public ResetPassword component reads the `token` query
  // parameter. Keep it in memory and remove it from the address before effects.
  const [resetToken] = useState(() => {
    const tokens = new URLSearchParams(location.search).getAll('token');
    return tokens.length === 1 ? tokens[0] : '';
  });
  useLayoutEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('token')) return;
    params.delete('token');
    const query = params.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  }, []);
  return <BrandedAuth key="reset" mode="reset" resetToken={resetToken} />;
};

const AuthenticatedApp = () => {
  return (
        <Suspense fallback={<RouteFallback />}>
        <Routes>
          {/* Public content renders even while authentication is unavailable. */}
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<BrandedAuth key="login" mode="login" />} />
          <Route path="/register" element={<BrandedAuth key="register" mode="register" />} />
          <Route path="/forgot-password" element={<BrandedAuth key="forgot" mode="forgot" />} />
          <Route path="/reset-password" element={<ResetPasswordRoute />} />
          {/* Public routes — accessible without authentication (App Store requirement) */}
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/cookies" element={<CookiePolicy />} />
          <Route path="/our-story" element={<OurStory />} />
          <Route element={<MemberRoute />}>
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
