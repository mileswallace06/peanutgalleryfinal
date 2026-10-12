import './setup';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import FounderDashboard from '@/pages/FounderDashboard';
import TransferWindowAdminPanel from '@/components/admin/TransferWindowAdminPanel';
import FlashDropMetricsPanel from '@/components/admin/cc/FlashDropMetricsPanel';
import InstantTransferReadyPanel from '@/components/admin/InstantTransferReadyPanel';
import LiveEventChecklist from '@/components/beta/LiveEventChecklist';
import '@/index.css';
import '@/components/ticket-design.css';
import '@/components/admin/operations-theme.css';
function App() {
 const [mounted, setMounted] = React.useState(true);
 React.useEffect(() => { window.founderFixture.mount = setMounted; }, []);
 const screen = new URLSearchParams(location.search).get('screen') || 'founder';
 const Component = { founder: FounderDashboard, windows: TransferWindowAdminPanel, drops: FlashDropMetricsPanel, instant: InstantTransferReadyPanel, beta: LiveEventChecklist }[screen];
 return <MemoryRouter><div className="pg-operations-page" style={{ minHeight: '100vh' }}><p className="text-xs text-muted-foreground p-2">ISOLATED FIXTURE · fictional records · no production connection</p>{mounted && (screen === 'founder' ? <Component /> : <div className="p-4 max-w-3xl mx-auto"><Component /></div>)}</div></MemoryRouter>;
}
createRoot(document.getElementById('root')).render(<App />);
