import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Layout from '../../src/components/Layout';
import Me from '../../src/pages/Me';
import Upgrades from '../../src/pages/Upgrades';
import BetaDashboard from '../../src/pages/BetaDashboard';
import '../../src/index.css';

localStorage.setItem('pg_onboarded', '1');
localStorage.setItem('pg_theme', 'dark');
localStorage.setItem('pg_what_is_pg_seen_v2', '1');
localStorage.setItem('pg_upgrades_location', JSON.stringify({ city: 'Phoenix, AZ' }));
const params = new URLSearchParams(location.search);
const page = params.get('page') || '/me';
createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={[page]}><Routes><Route element={<Layout />}>
    <Route path="/me" element={<Me />} />
    <Route path="/upgrades" element={<Upgrades />} />
    <Route path="/beta-dashboard" element={<BetaDashboard />} />
  </Route></Routes></MemoryRouter>
);
