import './setup';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { AuthProvider } from '@/lib/AuthContext';
import Layout from '@/components/Layout';
import Events from '@/pages/Events';
import EventDetail from '@/pages/EventDetail';
import SharedListing from '@/pages/SharedListing';
import Upgrades from '@/pages/Upgrades';
import EventDetailUpgrade from '@/pages/EventDetailUpgrade';
import Sell from '@/pages/Sell';
import FanZone from '@/pages/FanZone';
import MyTickets from '@/pages/MyTickets';
import Me from '@/pages/Me';
import HelpCenter from '@/pages/HelpCenter';
import OurStory from '@/pages/OurStory';
import MySales from '@/pages/MySales';
import AccountSettingsPage from '@/pages/AccountSettingsPage';
import FounderDashboard from '@/pages/FounderDashboard';
import SellerPayoutGuide from '@/pages/SellerPayoutGuide';
import WhatIsPGOverlay from '@/components/WhatIsPGOverlay';
import { fixtureUser } from './base44';
import '../../../src/index.css';

const page = new URLSearchParams(location.search).get('page') || 'events';
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const routes = { help: '/help', story: '/our-story', 'bucket-empty': '/fan-zone?tab=bucket_list', 'bucket-edit': '/fan-zone?tab=bucket_list&bucket=edit', events: '/events', upgrades: '/upgrades', hub: '/upgrades/fixture-live', sell: '/sell', 'fan-zone': '/fan-zone', 'my-tickets': '/my-tickets', me: '/me', 'my-sales': '/my-sales', 'shared-listing': '/listings/fixture-seller-active', 'shared-event': '/events/fixture-night?listing=fixture-seller-active', 'account-settings': '/account-settings', founder: '/founder', 'seller-payout-guide': '/seller-payout-guide', 'upgrades-intro': '/review-upgrades-intro' };
function UpgradesIntroReview() {
  const [open, setOpen] = React.useState(true);
  return <><Upgrades />{open && <WhatIsPGOverlay user={fixtureUser} onDismiss={() => setOpen(false)} />}{!open && <button className="pg-action" onClick={() => setOpen(true)}>Reopen introduction</button>}</>;
}
function OutsideReview() {
  const route = useLocation();
  return <div style={{ padding: 24, color: 'hsl(var(--foreground))' }}><h1>Outside the isolated review</h1><p>This navigation reached <code>{route.pathname}</code>. Its production destination is outside this isolated fixture.</p><Link to="/events">Back to Tickets</Link></div>;
}
class ReviewError extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() { return this.state.error ? <div role="alert" style={{ padding: 24, color: '#be123c', background: '#fff' }}><h1>Visual review fixture error</h1><pre style={{ whiteSpace: 'pre-wrap' }}>{this.state.error.message}</pre></div> : this.props.children; }
}
createRoot(document.getElementById('root')).render(<ReviewError><QueryClientProvider client={queryClient}><AuthProvider><MemoryRouter initialEntries={[routes[page] || '/events']}><Routes><Route path="/help" element={<HelpCenter />} /><Route path="/our-story" element={<OurStory />} /><Route path="/listings/:listingId" element={<SharedListing />} /><Route element={<Layout />}><Route path="/events" element={<Events />} /><Route path="/events/:id" element={<EventDetail />} /><Route path="/upgrades" element={<Upgrades />} /><Route path="/upgrades/:id" element={<EventDetailUpgrade />} /><Route path="/sell" element={<Sell />} /><Route path="/fan-zone" element={<FanZone />} /><Route path="/my-tickets" element={<MyTickets />} /><Route path="/me" element={<Me />} /><Route path="/my-sales" element={<MySales />} /><Route path="/account-settings" element={<AccountSettingsPage />} /><Route path="/founder" element={<FounderDashboard />} /><Route path="/seller-payout-guide" element={<SellerPayoutGuide />} /><Route path="/review-upgrades-intro" element={<UpgradesIntroReview />} /><Route path="*" element={<OutsideReview />} /></Route></Routes></MemoryRouter></AuthProvider></QueryClientProvider></ReviewError>);
