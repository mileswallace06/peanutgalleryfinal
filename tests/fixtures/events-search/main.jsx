import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Upgrades from '../../../src/pages/Upgrades';
import Events from '../../../src/pages/Events';
import Layout from '../../../src/components/Layout';
import { safeDiscoveryReturnTo } from '../../../src/lib/eventDiscoveryState';
import '../../../src/index.css';
function Detail() { const location = useLocation(); return <main><h1>Isolated event detail</h1><Link to={safeDiscoveryReturnTo(location.state?.discoveryReturnTo)} state={{ restoreDiscoveryEntry: location.state?.discoveryReturnKey }}>Back to events</Link>{location.state?.upgradesReturnTo && <Link to={location.state.upgradesReturnTo} state={{restoreDiscoveryEntry:location.state.upgradesReturnKey}}>Back to upgrades</Link>}</main>; }
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><BrowserRouter><Routes><Route element={<Layout />}><Route path="/events" element={<Events />} /><Route path="/events/*" element={<Detail />} /><Route path="/upgrades" element={<Upgrades />} /><Route path="/upgrades/*" element={<Detail />} /><Route path="*" element={<Events />} /></Route></Routes></BrowserRouter></QueryClientProvider>);
