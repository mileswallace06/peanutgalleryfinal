import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import Layout from '@/components/Layout';
import { Navigate } from 'react-router-dom';
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

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin, checkAppState } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-amber-200 border-t-amber-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError) {
      if (authError.type === 'user_not_registered') {
        return <UserNotRegisteredError onRetry={checkAppState} />;
      } else if (authError.type === 'auth_required') {
      navigateToLogin();
      return null;
    }
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/events" replace />} />
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
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
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