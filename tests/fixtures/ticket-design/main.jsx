import './setup';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider } from '@/lib/AuthContext';
import { AuthenticatedApp } from '@/App';
import Layout from '@/components/Layout';
import Upgrades from '@/pages/Upgrades';
import WhatIsPGOverlay from '@/components/WhatIsPGOverlay';
import { fixtureUser } from './base44';
import '../../../src/index.css';

const params = new URLSearchParams(location.search);
const page = params.get('page') || 'events';
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const routes = { help: '/help', story: '/our-story', terms: '/terms', privacy: '/privacy', cookies: '/cookies', 'bucket-empty': '/fan-zone?tab=bucket_list', 'bucket-edit': '/fan-zone?tab=bucket_list&bucket=edit', events: '/events', upgrades: '/upgrades', hub: '/upgrades/fixture-live', sell: '/sell', 'fan-zone': '/fan-zone', 'my-tickets': '/my-tickets', me: '/me', 'my-sales': '/my-sales', 'shared-listing': '/listings/fixture-seller-active', 'shared-event': '/events/fixture-night?listing=fixture-seller-active', 'account-settings': '/account-settings', founder: '/founder', 'seller-payout-guide': '/seller-payout-guide', 'upgrades-intro': '/review-upgrades-intro', 'create-listing': '/create-listing?event_id=fixture-live', 'beta-qa': '/beta-qa', admin: '/admin' };
function ReviewRouter() {
  const route = useLocation();
  const navigate = useNavigate();
  React.useEffect(() => { window.__PG_REVIEW_NAVIGATE__ = navigate; window.__PG_REVIEW_LOCATION__ = route; }, [navigate, route]);
  // Full production route map; only the previously documented introduction fixture is special.
  if (page === 'upgrades-intro') return <UpgradesIntroReview />;
  return <AuthenticatedApp />;
}
function UpgradesIntroReview() {
  const [open, setOpen] = React.useState(true);
  return <><Layout /><Upgrades />{open && <WhatIsPGOverlay user={fixtureUser} onDismiss={() => setOpen(false)} />}{!open && <button className="pg-action" onClick={() => setOpen(true)}>Reopen introduction</button>}</>;
}
class ReviewError extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() { return this.state.error ? <div role="alert" style={{ padding: 24, color: '#be123c', background: '#fff' }}><h1>Visual review fixture error</h1><pre style={{ whiteSpace: 'pre-wrap' }}>{this.state.error.message}</pre></div> : this.props.children; }
}
const initialRoute = params.get('route') || routes[page] || '/events';
createRoot(document.getElementById('root')).render(<ReviewError><QueryClientProvider client={queryClient}><AuthProvider><MemoryRouter initialEntries={[initialRoute]}><ReviewRouter /></MemoryRouter></AuthProvider></QueryClientProvider></ReviewError>);
