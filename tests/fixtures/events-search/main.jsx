import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import Events from '../../../src/pages/Events';
import { safeDiscoveryReturnTo } from '../../../src/lib/eventDiscoveryState';
import '../../../src/index.css';
function Detail() { const location = useLocation(); return <main><h1>Isolated event detail</h1><Link to={safeDiscoveryReturnTo(location.state?.discoveryReturnTo)}>Back to events</Link></main>; }
createRoot(document.getElementById('root')).render(<BrowserRouter><Routes><Route path="/events" element={<Events />} /><Route path="/events/*" element={<Detail />} /><Route path="/upgrades/*" element={<Detail />} /><Route path="*" element={<Events />} /></Routes></BrowserRouter>);
