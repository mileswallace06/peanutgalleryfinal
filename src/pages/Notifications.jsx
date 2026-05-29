import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { formatDistanceToNow } from 'date-fns';
import { Bell, CheckCheck, ArrowLeft, RefreshCw } from 'lucide-react';

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

  const inner = (
    <div
      onClick={() => !notif.read && onMarkRead(notif.id)}
      className="flex items-start gap-3 p-4 rounded-2xl transition-all"
      style={{
        background: isUnread ? `${color}0D` : 'hsl(var(--card))',
        border: `1px solid ${isUnread ? color + '35' : 'hsl(var(--border))'}`,
        cursor: isUnread ? 'pointer' : 'default',
      }}
    >
      {/* Icon */}
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-lg"
        style={{ background: `${color}18`, border: `1px solid ${color}30` }}>
        {notif.icon || '🔔'}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="font-bold text-sm text-foreground leading-tight">{notif.title}</p>
          {isUnread && (
            <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ background: color }} />
          )}
        </div>
        {notif.body && (
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{notif.body}</p>
        )}
        <p className="text-[10px] text-muted-foreground mt-1.5">
          {notif.created_date ? formatDistanceToNow(new Date(notif.created_date), { addSuffix: true }) : ''}
        </p>
      </div>
    </div>
  );

  if (notif.action_url) {
    return <Link to={notif.action_url} onClick={() => !notif.read && onMarkRead(notif.id)}>{inner}</Link>;
  }
  return inner;
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
      setNotifs(data);
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

  if (!user) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center space-y-4">
        <Bell className="w-12 h-12 text-muted-foreground mx-auto" />
        <p className="font-semibold text-foreground">Sign in to see your notifications</p>
        <button onClick={() => base44.auth.redirectToLogin()}
          className="px-6 py-2.5 rounded-full bg-primary text-primary-foreground font-bold text-sm">
          Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 pb-12" style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top))' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/me" className="p-2 rounded-xl hover:bg-muted transition-colors">
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </Link>
          <div>
            <h1 className="font-bold text-xl text-foreground flex items-center gap-2">
              <Bell className="w-5 h-5 text-primary" />
              Notifications
              {unreadCount > 0 && (
                <span className="text-xs font-black px-2 py-0.5 rounded-full"
                  style={{ background: '#FF2D78', color: '#fff' }}>
                  {unreadCount}
                </span>
              )}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
          </button>
          {unreadCount > 0 && (
            <button onClick={markAllRead}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full transition-colors"
              style={{ background: 'rgba(191,95,255,0.12)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.3)' }}>
              <CheckCheck className="w-3.5 h-3.5" /> Mark all read
            </button>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-5">
        {[['all', 'All'], ['unread', `Unread (${unreadCount})`]].map(([key, label]) => (
          <button key={key} onClick={() => setFilter(key)}
            className="px-4 py-1.5 rounded-full text-xs font-bold transition-all"
            style={filter === key
              ? { background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }
              : { background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))', border: '1px solid hsl(var(--border))' }}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-20 rounded-2xl bg-muted animate-pulse" />)}
        </div>
      ) : displayed.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-4xl mb-3">🔔</p>
          <p className="font-semibold text-foreground">
            {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Important events — purchases, transfers, disputes — will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayed.map(n => (
            <NotifCard key={n.id} notif={n} onMarkRead={markRead} />
          ))}
        </div>
      )}
    </div>
  );
}