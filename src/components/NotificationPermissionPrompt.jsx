/**
 * NotificationPermissionPrompt
 * ─────────────────────────────
 * Non-intrusive permission request shown after a meaningful action
 * (buying a ticket, listing a ticket). Shown at most once per session,
 * and permanently dismissed after user responds.
 *
 * Beta: stores push token to User entity when browser supports it.
 * For native apps, replace the Web Push logic with Expo/FCM SDK calls.
 */

import { useState, useEffect } from 'react';
import { Bell, X } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const DISMISSED_KEY = 'pg_notif_prompt_dismissed';

export default function NotificationPermissionPrompt({ trigger }) {
  const [visible, setVisible] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    // Don't show if already dismissed permanently
    if (localStorage.getItem(DISMISSED_KEY)) return;
    // Don't show if notifications not supported
    if (!('Notification' in window)) return;
    // Don't show if already granted or denied
    if (Notification.permission !== 'default') return;

    // Show after a short delay so it doesn't feel jarring
    const t = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(t);
  }, [trigger]);

  const handleAllow = async () => {
    setAsking(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        // Web Push: register service worker + get subscription
        // For Expo/native: use Notifications.getExpoPushTokenAsync() instead
        if ('serviceWorker' in navigator && 'PushManager' in window) {
          try {
            const reg = await navigator.serviceWorker.ready;
            // VAPID public key — replace with real key when setting up web push
            // const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY });
            // await base44.auth.updateMe({ push_token: JSON.stringify(sub), push_token_updated_at: new Date().toISOString() });
            console.log('[NotifPrompt] Web Push supported but VAPID key not configured — token not stored yet.');
          } catch (_) {}
        }
        console.log('[NotifPrompt] Notification permission granted ✅');
      }
    } catch (err) {
      console.warn('[NotifPrompt] Permission request failed:', err?.message);
    }
    localStorage.setItem(DISMISSED_KEY, '1');
    setVisible(false);
    setAsking(false);
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, '1');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-24 left-4 right-4 z-50 max-w-sm mx-auto rounded-2xl px-4 py-4 flex items-start gap-3 shadow-xl"
      style={{
        background: 'hsl(var(--card))',
        border: '1px solid hsl(var(--border))',
        boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
      }}
    >
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: 'rgba(191,95,255,0.15)', border: '1px solid rgba(191,95,255,0.3)' }}>
        <Bell className="w-4 h-4" style={{ color: '#BF5FFF' }} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-foreground">Stay in the loop</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
          Get notified when your tickets transfer or your sale completes.
        </p>
        <div className="flex gap-2 mt-3">
          <button
            onClick={handleAllow}
            disabled={asking}
            className="flex-1 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-60"
            style={{ background: '#BF5FFF', color: '#fff' }}
          >
            {asking ? 'Asking…' : 'Enable'}
          </button>
          <button
            onClick={handleDismiss}
            className="flex-1 py-2 rounded-xl text-xs font-medium transition-all text-muted-foreground"
            style={{ background: 'hsl(var(--muted))', border: '1px solid hsl(var(--border))' }}
          >
            Not now
          </button>
        </div>
      </div>

      <button onClick={handleDismiss} className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}