import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import PurchaseSuccess from '../../../src/pages/PurchaseSuccess';
import MySales from '../../../src/pages/MySales';
import AccountSettingsPage from '../../../src/pages/AccountSettingsPage';
import '../../../src/index.css';
import '../../../src/components/ticket-design.css';
const query = new URLSearchParams(location.search);
document.documentElement.classList.toggle('dark', query.get('theme') === 'dark');
// This component fixture has no app-shell scroller; let the document expose
// the complete route for keyboard checks and full-page evidence.
document.documentElement.style.overflow = 'auto';
document.body.style.overflow = 'auto';
document.body.style.height = 'auto';
localStorage.setItem('pg_theme', query.get('theme') || 'light');
localStorage.setItem('pg_notif_prompt_dismissed', '1');
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={[query.get('route') || '/purchase/fixture-sale-aaaaaaaaaaaaaaaa']}><Routes><Route path="/purchase/:id" element={<PurchaseSuccess />} /><Route path="/my-sales" element={<MySales />} /><Route path="/account-settings" element={<AccountSettingsPage />} /></Routes></MemoryRouter>);
