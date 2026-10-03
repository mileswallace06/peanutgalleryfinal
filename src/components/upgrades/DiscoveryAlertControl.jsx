import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, RefreshCw } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import './discovery-alert.css';

/** Durable event watches feed the server's in-app discovery notification dispatcher. */
export default function DiscoveryAlertControl({ eventId, user }) {
  const [enabled, setEnabled] = useState(false);
  const [supported, setSupported] = useState(null);
  const [serviceActive, setServiceActive] = useState(false);
  const [state, setState] = useState('loading');
  const [retry, setRetry] = useState(0);
  const request = useRef(0);

  useEffect(() => {
    const requestId = ++request.current;
    setEnabled(false);
    setSupported(null);
    setServiceActive(false);
    if (!user?.email || !eventId) {
      setState('ready');
      return;
    }
    setState('loading');
    base44.functions.invoke('manageDiscoveryAlerts', { action: 'get_event', event_id: eventId })
      .then(result => {
        if (['enabled', 'supported', 'service_active'].some(key => typeof result?.data?.[key] !== 'boolean')) {
          throw new Error('Invalid alert response');
        }
        if (request.current !== requestId) return;
        setEnabled(result.data.enabled);
        setSupported(result.data.supported);
        setServiceActive(result.data.service_active);
        setState('ready');
      })
      .catch(() => { if (request.current === requestId) setState('load_error'); });
    return () => { request.current += 1; };
  }, [eventId, user?.email, retry]);

  const toggle = async () => {
    if (!user?.email) {
      base44.auth.redirectToLogin(window.location.href);
      return;
    }
    if (state === 'load_error') {
      setRetry(value => value + 1);
      return;
    }
    if (!enabled && supported !== true) return;
    const requestId = ++request.current;
    setState('saving');
    try {
      const result = await base44.functions.invoke('manageDiscoveryAlerts', {
        action: 'set_event', event_id: eventId, enabled: !enabled,
      });
      if (result?.data?.enabled !== !enabled || typeof result?.data?.service_active !== 'boolean') {
        throw new Error('Alert was not saved');
      }
      if (request.current !== requestId) return;
      setEnabled(result.data.enabled);
      setServiceActive(result.data.service_active);
      setState('ready');
    } catch (error) {
      if (request.current !== requestId) return;
      const code = error?.response?.data?.error || error?.data?.error;
      if (!enabled && ['event_alert_not_supported', 'event_unavailable'].includes(code)) {
        setSupported(false);
        setState('ready');
      } else {
        setState('save_error');
      }
    }
  };

  const pending = state === 'loading' || state === 'saving';
  const failed = state === 'load_error' || state === 'save_error';
  const unavailable = supported === false && !enabled && !failed;
  return (
    <div className="pg-discovery-alert">
      <button type="button" className="pg-action" onClick={toggle} disabled={pending || !eventId || unavailable}
        aria-pressed={enabled}>
        {pending ? <RefreshCw size={16} className="animate-spin" /> : enabled ? <BellOff size={16} /> : <Bell size={16} />}
        {pending ? state === 'saving' ? 'Saving…' : 'Checking alerts…'
          : state === 'load_error' ? 'Retry alert settings'
            : enabled ? 'Turn off alert' : unavailable ? 'Alerts unavailable'
              : user?.email && !serviceActive ? 'Save alert preference' : 'Notify me when available'}
      </button>
      <p role={failed ? 'alert' : 'status'}>
        {state === 'load_error' ? 'We couldn’t load your alert settings. Please try again.'
          : state === 'save_error' ? 'Your change wasn’t saved. Please try again.'
            : state === 'loading' ? 'Checking alert availability for this event.'
              : supported === false ? enabled
                ? 'Alerts are not available for this event yet. You can turn off your saved preference.'
                : 'Alerts are not available for this event yet.'
                : enabled ? serviceActive
                  ? 'In-app alert saved. Find alerts in Notifications.'
                  : 'Alert preference saved. Alerts will start when this service is enabled.'
                  : user?.email ? serviceActive
                    ? 'Get an in-app alert when upgrades are listed for this event.'
                    : 'Save your preference. Alerts will start when this service is enabled.'
                    : 'Sign in to check alert availability for this event.'}
      </p>
    </div>
  );
}
