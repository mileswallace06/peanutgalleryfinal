import { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { summarizeSellerHistory } from '@/lib/salesPresentation';

export function useSellerSummary(user) {
  const [state, setState] = useState({ status: 'loading', summary: null });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt(n => n + 1), []);
  const userId = user?.id || user?.email;
  useEffect(() => {
    let current = true;
    setState({ status: 'loading', summary: null });
    if (userId) {
      base44.functions.invoke('getPurchaseParticipantView', { action: 'list_mine', perspective: 'seller' })
        .then(res => {
          if (!Array.isArray(res?.data?.sales)) throw new Error('Seller history unavailable');
          if (current) setState({ status: 'ready', summary: summarizeSellerHistory(res.data.sales) });
        })
        .catch(() => { if (current) setState({ status: 'error', summary: null }); });
    }
    return () => { current = false; };
  }, [userId, attempt]);
  return { ...state, reload };
}
