import '../ticket-design/setup';
import './base44';
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Events from '@/pages/Events';
import EventDetail from '@/pages/EventDetail';
import EventDetailTM from '@/pages/EventDetailTM';
import FanPostComposer from '@/components/fanzone/FanPostComposer';
import LiveUpgradeControlPanel from '@/components/admin/cc/LiveUpgradeControlPanel';
import { identityEvents } from './catalog.mjs';
import '../../../src/index.css';
import '../../../src/components/ticket-design.css';
import '../../../src/components/browse-ticket.css';
import '../../../src/components/printed-ticket.css';
window.identityNavigationLogs = [];
const params = new URLSearchParams(location.search);
function Composer() {
  const [open, setOpen] = useState(false), triggerRef = useRef(null);
  return <><button ref={triggerRef} onClick={() => setOpen(true)}>Open fixture composer</button>{open && <FanPostComposer user={{ email: 'identity@example.invalid', full_name: 'Fixture Fan' }} events={identityEvents} onClose={() => setOpen(false)} triggerRef={triggerRef} onPosted={() => { throw new Error('Posting is forbidden in identity review'); }} />}</>;
}
const initial = params.get('route') || '/events?browse=1&q=Fixture%20Knocked&past=1&scope=nationwide';
createRoot(document.getElementById('root')).render(<div className="pg-ticket-app pg-ticket-app--designed pg-ticket-app--browse" style={{ maxWidth: 780, margin: '0 auto', padding: 20 }}><MemoryRouter initialEntries={[initial]}><Routes>
  <Route path="/events" element={<Events />} /><Route path="/events/tm/:tmId" element={<EventDetailTM />} /><Route path="/events/:id" element={<EventDetail />} />
  <Route path="/composer" element={<Composer />} /><Route path="/admin" element={<LiveUpgradeControlPanel />} />
</Routes></MemoryRouter></div>);
