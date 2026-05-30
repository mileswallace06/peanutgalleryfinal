/**
 * FlashDropAlertBanner — compact opt-in strip shown in Event Mode.
 * Asks once per event whether user wants Flash Drop alerts.
 * Stored in localStorage keyed by event_id.
 */
import { useState, useEffect } from 'react';
import { Bell, BellOff, X } from 'lucide-react';

export default function FlashDropAlertBanner({ eventId, onOptIn, onDismiss }) {
  const [status, setStatus] = useState('idle'); // idle | opted_in | dismissed

  useEffect(() => {
    if (!eventId) return;
    const stored = localStorage.getItem(`fd_alert_${eventId}`);
    if (stored) setStatus(stored);
  }, [eventId]);

  const handleOptIn = () => {
    localStorage.setItem(`fd_alert_${eventId}`, 'opted_in');
    setStatus('opted_in');
    onOptIn?.();
  };

  const handleDismiss = () => {
    localStorage.setItem(`fd_alert_${eventId}`, 'dismissed');
    setStatus('dismissed');
    onDismiss?.();
  };

  if (status === 'dismissed' || status === 'opted_in') return null;

  return (
    <div className="rounded-2xl px-4 py-3 flex items-center gap-3"
      style={{ background: 'rgba(255,230,0,0.08)', border: '1px solid rgba(255,230,0,0.3)' }}>
      <span className="text-lg flex-shrink-0">🎁</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-black text-foreground">Want Flash Drop alerts tonight?</p>
        <p className="text-[10px] text-muted-foreground">30–90 second windows. Don't miss a free upgrade.</p>
      </div>
      <div className="flex gap-2 flex-shrink-0">
        <button onClick={handleOptIn}
          className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-black"
          style={{ background: 'rgba(255,230,0,0.2)', color: '#FFE600', border: '1px solid rgba(255,230,0,0.4)' }}>
          <Bell className="w-3 h-3" /> Notify Me
        </button>
        <button onClick={handleDismiss} className="p-1.5 rounded-full text-muted-foreground hover:text-foreground">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}