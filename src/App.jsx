import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import Layout from '@/components/Layout';
import { Navigate } from 'react-router-dom';
import Landing from '@/pages/Landing';
import Events from '@/pages/Events';
import EventDetail from '@/pages/EventDetail';
import PurchaseSuccess from '@/pages/PurchaseSuccess';
import AdminMode from '@/pages/AdminMode';
import MySales from '@/pages/MySales';
import MyTickets from '@/pages/MyTickets';
import CreateListing from '@/pages/CreateListing';
import FanZone from '@/pages/FanZone';
import Me from '@/pages/Me';
import Upgrades from '@/pages/Upgrades';
import EventDetailUpgrade from '@/pages/EventDetailUpgrade';
import Sell from '@/pages/Sell';
import EventDetailTM from '@/pages/EventDetailTM';
import AccountSettingsPage from '@/pages/AccountSettingsPage';
import EditPersona from '@/pages/EditPersona';
import BetaQA from '@/pages/BetaQA';
import TermsOfService from '@/pages/TermsOfService';
import PrivacyPolicy from '@/pages/PrivacyPolicy';
import InstantListingsGuide from '@/pages/InstantListingsGuide';
import SellerPayoutGuide from '@/pages/SellerPayoutGuide';
import WhyPeanutGallery from '@/pages/WhyPeanutGallery';
import Leaderboard from '@/pages/Leaderboard';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin, checkAppState, isAuthenticated, user } = useAuth();
  const location = useLocation();

  // Branded loading spinner
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4"
        style={{ background: 'hsl(255 10% 5%)' }}>
        <img
          src="https://media.base44.com/images/public/69ef9900cf3862dc0ea39734/9022a5431_ChatGPTImageMay1202601_29_27PM.png"
          alt="Peanut Gallery"
          className="h-16 w-auto rounded-2xl mb-2"
        />
        <div className="w-8 h-8 border-4 rounded-full animate-spin"
          style={{ borderColor: 'rgba(191,95,255,0.3)', borderTopColor: '#BF5FFF' }} />
      </div>
    );
  }

  // Only show auth error screens if the user is genuinely not authenticated.
  // If we already have a user session, ignore transient auth errors (network blips, rate limits, etc.)
  if (authError && !isAuthenticated && !user) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError onRetry={checkAppState} />;
    } else if (authError.type === 'auth_required') {
      // Not logged in — show the branded landing page instead of redirecting to Base44 login
      return (
        <AnimatePresence mode="wait">
          <Routes key={location.pathname}>
            <Route path="/" element={<Landing />} />
            <Route path="*" element={<Landing />} />
          </Routes>
        </AnimatePresence>
      );
    }
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div key={location.pathname}>
        <Routes>
          {/* Authenticated root → straight to events */}
          <Route path="/" element={<Navigate to="/events" replace />} />
          <Route element={<Layout />}>
            <Route path="/events" element={<Events />} />
            <Route path="/events/:id" element={<EventDetail />} />
            <Route path="/purchase/:id" element={<PurchaseSuccess />} />
            <Route path="/admin" element={<AdminMode />} />
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
          </Route>
          <Route path="*" element={<PageNotFound />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
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