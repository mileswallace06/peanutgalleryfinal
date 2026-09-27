import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { formatDistanceToNow } from 'date-fns';
import { Bell, CheckCheck, ArrowRight, RefreshCw } from 'lucide-react';
import { PageIntro } from '@/components/ClarityUI';
import './activity-clarity.css';

const TYPE_COLORS = {
  purchase_confirmed: '#00FF87',
  tickets_sent:       '#00C8FF',
  transfer_verified:  '#00FF87',
  transfer_rejected:  '#FF2D78',
  buyer_confirmed:    '#00FF87',
  sale_complete:      '#00FF87',
  payout_processing:  '#BF5FFF',
  dispute_opened:     '#FFE600',
  dispute_resolved:   '#00FF87',
  donation_won:       '#FF99CC',
  donation_accepted:  '#FF99CC',
  donation_expired:   '#FF8C00',
  listing_hidden:     '#FF2D78',
  listing_approved:   '#00FF87',
  listing_rejected:   '#FF2D78',
  listing_expired:    '#FF8C00',
  sale_created:       '#BF5FFF',
  ai_verified:        '#00C8FF',
  ai_rejected:        '#FF8C00',
  admin_message:      '#FFE600',
};

function NotifCard({ notif, onMarkRead }) {
  const color = TYPE_COLORS[notif.type] || '#BF5FFF';
  const isUnread = !notif.read;
  const className = `pg-notification-row ${isUnread ? 'is-unread' : 'is-read'}`;
  const content = (
    <>
      <span className="pg-notification-icon" style={{ '--notification-color': color }} aria-hidden="true">
        {notif.icon || '🔔'}
      </span>
      <span className="pg-notification-copy">
        <span className="pg-notification-meta">
          <span className={`pg-notification-state ${isUnread ? 'is-unread' : ''}`}>{isUnread ? 'Unread' : 'Read'}</span>
          {notif.created_date && (
            <time dateTime={notif.created_date} title={new Date(notif.created_date).toLocaleString()}>
              {formatDistanceToNow(new Date(notif.created_date), { addSuffix: true })}
            </time>
          )}
        </span>
        <span className="pg-notification-title">{notif.title}</span>
        {notif.body && <span className="pg-notification-body">{notif.body}</span>}
        {notif.action_url && <span className="pg-notification-open">View update <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" /></span>}
        {!notif.action_url && isUnread && <span className="pg-notification-open">Mark as read</span>}
      </span>
    </>
  );

  if (notif.action_url) {
    return <Link to={notif.action_url} onClick={() => !notif.read && onMarkRead(notif.id)} className={className}>{content}</Link>;
  }
  if (isUnread) {
    return <button type="button" onClick={() => onMarkRead(notif.id)} className={className}>{content}</button>;
  }
  return <div className={className}>{content}</div>;
}

export default function Notifications() {
  const [user, setUser] = useState(null);
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all' | 'unread'

  const load = useCallback(async () => {
    setLoading(true);
    const me = await base44.auth.me().catch(() => null);
    setUser(me);
    if (me?.email) {
      const data = await base44.entities.Notification.filter({ user_email: me.email },  '-created_date', 80).catch(() => []);
      // Superseded concurrent-duplicate records are hidden from the inbox
      // (they never dispatched); they remain in the DB for audit.
      setNotifs(data.filter((n) => n.dispatch_status !== 'superseded'));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const markRead = async (id) => {
    await base44.entities.Notification.update(id, { read: true }).catch(() => {});
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const markAllRead = async () => {
    const unread = notifs.filter(n => !n.read);
    await Promise.all(unread.map(n => base44.entities.Notification.update(n.id, { read: true }).catch(() => {})));
    setNotifs(prev => prev.map(n => ({ ...n, read: true })));
  };

  const unreadCount = notifs.filter(n => !n.read).length;
  const displayed = filter === 'unread' ? notifs.filter(n => !n.read) : notifs;

  if (loading && !user) {
    return (
      <div className="pg-secondary-page pg-activity-page pg-notifications-page">
        <PageIntro eyebrow="Your activity" title="Notifications" description="Updates on purchases, transfers, and listings." backTo="/me" backLabel="Your account" />
        <div className="pg-state pg-activity-state" role="status">
          <RefreshCw className="w-6 h-6 animate-spin" aria-hidden="true" />
          <p>Loading notifications…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="pg-secondary-page pg-activity-page pg-notifications-page">
        <PageIntro eyebrow="Your activity" title="Notifications" description="Updates on purchases, transfers, and listings." backTo="/me" backLabel="Your account" />
        <div className="pg-state pg-activity-state">
          <Bell className="w-8 h-8" aria-hidden="true" />
          <h2>Sign in to see your notifications</h2>
          <button onClick={() => base44.auth.redirectToLogin()} className="pg-action">Sign In</button>
        </div>
      </div>
    );
  }

  return (
    <div className="pg-secondary-page pg-activity-page pg-notifications-page">
      <PageIntro eyebrow="Your activity" title="Notifications" description="Updates on purchases, transfers, and listings." backTo="/me" backLabel="Your account" />

      <div className="pg-notification-toolbar">
        <p className="pg-notification-count" aria-live="polite">
          <strong>{unreadCount}</strong> unread {unreadCount === 1 ? 'update' : 'updates'}
        </p>
        <div className="pg-activity-controls">
          <button onClick={load} className="pg-action pg-activity-secondary" aria-label="Refresh notifications">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
          </button>
          {unreadCount > 0 && (
            <button onClick={markAllRead} className="pg-action pg-activity-secondary">
              <CheckCheck className="w-4 h-4" aria-hidden="true" /> Mark all read
            </button>
          )}
        </div>
      </div>

      <div className="pg-notification-filters" role="group" aria-label="Filter notifications">
        {[['all', 'All updates'], ['unread', `Unread (${unreadCount})`]].map(([key, label]) => (
          <button key={key} onClick={() => setFilter(key)} aria-pressed={filter === key}
            className={filter === key ? 'is-active' : ''}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="pg-notification-loading" role="status">
          <span className="sr-only">Loading notifications…</span>
          {[1, 2, 3, 4].map(i => <div key={i} className="pg-notification-skeleton animate-pulse" aria-hidden="true" />)}
        </div>
      ) : displayed.length === 0 ? (
        <div className="pg-state pg-activity-state">
          <Bell className="w-8 h-8" aria-hidden="true" />
          <h2>{filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}</h2>
          <p>Important events — purchases, transfers, disputes — will appear here.</p>
        </div>
      ) : (
        <ul className="pg-notification-list" aria-label={filter === 'unread' ? 'Unread notifications' : 'All notifications'}>
          {displayed.map(n => (
            <li key={n.id}><NotifCard notif={n} onMarkRead={markRead} /></li>
          ))}
        </ul>
      )}
    </div>
  );
}
