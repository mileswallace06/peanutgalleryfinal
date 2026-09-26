import './setup';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { AuthProvider } from '@/lib/AuthContext';
import Layout from '@/components/Layout';
import Events from '@/pages/Events';
import Upgrades from '@/pages/Upgrades';
import EventDetailUpgrade from '@/pages/EventDetailUpgrade';
import Sell from '@/pages/Sell';
import FanZone from '@/pages/FanZone';
import MyTickets from '@/pages/MyTickets';
import '../../../src/index.css';

const page = new URLSearchParams(location.search).get('page') || 'events';
const routes = { events: '/events', upgrades: '/upgrades', hub: '/upgrades/fixture-live', sell: '/sell', 'fan-zone': '/fan-zone', 'my-tickets': '/my-tickets', me: '/me' };
function OutsideReview() {
  const route = useLocation();
  return <div style={{ padding: 24, color: 'hsl(var(--foreground))' }}><h1>Outside the six-screen review</h1><p>This navigation reached <code>{route.pathname}</code>. Its production destination is outside this isolated fixture.</p><Link to="/events">Back to Tickets</Link></div>;
}
class ReviewError extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() { return this.state.error ? <div role="alert" style={{ padding: 24, color: '#be123c', background: '#fff' }}><h1>Visual review fixture error</h1><pre style={{ whiteSpace: 'pre-wrap' }}>{this.state.error.message}</pre></div> : this.props.children; }
}
createRoot(document.getElementById('root')).render(<ReviewError><AuthProvider><MemoryRouter initialEntries={[routes[page] || '/events']}><Routes><Route element={<Layout />}><Route path="/events" element={<Events />} /><Route path="/upgrades" element={<Upgrades />} /><Route path="/upgrades/:id" element={<EventDetailUpgrade />} /><Route path="/sell" element={<Sell />} /><Route path="/fan-zone" element={<FanZone />} /><Route path="/my-tickets" element={<MyTickets />} /><Route path="/me" element={<MyTickets />} /><Route path="*" element={<OutsideReview />} /></Route></Routes></MemoryRouter></AuthProvider></ReviewError>);
