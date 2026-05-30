/**
 * EventModePreview — shown when a user visits Event Mode before the event is live.
 * Educates them on what Event Mode is, shows a countdown, and lets them opt in to notifications.
 */
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { Bell, BellOff, ArrowLeft, Zap, Gift, TrendingUp, Trophy } from 'lucide-react';
import { getEventLiveStatus } from '@/lib/eventTiming';

function useCountdown(targetMs) {
  const [timeLeft, setTimeLeft] = useState(Math.max(0, targetMs - Date.now()));
  useEffect(() => {
    const id = setInterval(() => setTimeLeft(Math.max(0, targetMs - Date.now())), 1000);
    return () => clearInterval(id);
  }, [targetMs]);
  const totalSecs = Math.floor(timeLeft / 1000);
  const days = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  return { days, hours, mins, secs, totalSecs };
}

function CountdownUnit({ value, label }) {
  return (
    <div className="flex flex-col items-center">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center font-display text-3xl"
        style={{ background: 'rgba(191,95,255,0.12)', border: '1px solid rgba(191,95,255,0.3)', color: '#BF5FFF' }}>
        {String(value).padStart(2, '0')}
      </div>
      <span className="text-[10px] font-bold text-muted-foreground mt-1 uppercase tracking-wider">{label}</span>
    </div>
  );
}

const FEATURES = [
  { icon: Gift, color: '#FFE600', label: 'Flash Drops', desc: 'Free seats given away in real-time by generous fans' },
  { icon: Zap, color: '#00FF87', label: 'Seat Upgrades', desc: 'Buy better seats from fans already at the venue' },
  { icon: Trophy, color: '#BF5FFF', label: 'Fan Karma', desc: 'Earn points for donations and transactions tonight' },
  { icon: TrendingUp, color: '#00C8FF', label: 'Live Activity', desc: 'See what\'s happening at the venue in real time' },
];

export default function EventModePreview({ event, user }) {
  const [notifOptIn, setNotifOptIn] = useState(() => {
    return localStorage.getItem(`pg_event_notif_${event?.id}`) === '1';
  });

  const timing = getEventLiveStatus(event);
  const startMs = timing.start_utc_ms;
  const countdown = useCountdown(startMs || Date.now());
  const isSoon = timing.status === 'soon';

  const handleNotifToggle = () => {
    const next = !notifOptIn;
    setNotifOptIn(next);
    if (event?.id) localStorage.setItem(`pg_event_notif_${event.id}`, next ? '1' : '0');
    if (next && user?.email) {
      base44.entities.DonationOptIn.create({
        event_id: event.id,
        user_email: user.email,
        opted_in_at: new Date().toISOString(),
      }).catch(() => {});
    }
  };

  return (
    <div className="min-h-screen pb-32" style={{ background: 'hsl(var(--background))' }}>
      {/* Header */}
      <div className="sticky top-0 z-20 px-4 py-3 flex items-center gap-3"
        style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <Link to="/upgrades"
          className="flex items-center gap-1 text-sm font-semibold text-muted-foreground"
          style={{ marginTop: 'env(safe-area-inset-top)' }}>
          <ArrowLeft className="w-4 h-4" /> Upgrades
        </Link>
        <div className="flex-1 min-w-0">
          <p className="font-black text-xs text-foreground truncate">{event.title}</p>
          <p className="text-[10px] text-muted-foreground">{event.venue}{event.city ? `, ${event.city}` : ''}</p>
        </div>
        <span className="text-[10px] font-black px-2.5 py-1 rounded-full flex-shrink-0"
          style={isSoon
            ? { background: 'rgba(255,230,0,0.2)', color: '#FFE600', border: '1px solid rgba(255,230,0,0.4)' }
            : { background: 'rgba(191,95,255,0.15)', color: '#BF5FFF', border: '1px solid rgba(191,95,255,0.3)' }}>
          {isSoon ? '⏰ Starting Soon' : '📅 Upcoming'}
        </span>
      </div>

      <div className="px-4 pt-6 space-y-6 max-w-2xl mx-auto">

        {/* Hero headline */}
        <div className="text-center space-y-2">
          <div className="text-5xl mb-2">⚡</div>
          <h1 className="font-display text-3xl text-foreground">Event Mode</h1>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto leading-relaxed">
            The live companion for fans at the show. Flash Drops, seat upgrades, and real-time fan activity — activates at showtime.
          </p>
        </div>

        {/* Countdown */}
        {startMs && (
          <div className="rounded-2xl px-4 py-5 text-center space-y-4"
            style={{ background: 'rgba(191,95,255,0.06)', border: '1px solid rgba(191,95,255,0.2)' }}>
            <p className="text-[11px] font-black tracking-widest uppercase text-muted-foreground">
              Event Mode Activates In
            </p>
            <div className="flex items-center justify-center gap-3">
              {countdown.days > 0 && <CountdownUnit value={countdown.days} label="days" />}
              <CountdownUnit value={countdown.hours} label="hrs" />
              <CountdownUnit value={countdown.mins} label="min" />
              <CountdownUnit value={countdown.secs} label="sec" />
            </div>
            <p className="text-xs text-muted-foreground">
              {startMs ? format(new Date(startMs), 'EEEE, MMMM d · h:mm a') : ''}
            </p>
          </div>
        )}

        {/* What's inside Event Mode */}
        <div className="space-y-3">
          <p className="text-[11px] font-black tracking-widest uppercase text-muted-foreground px-1">
            What's Inside Event Mode
          </p>
          {FEATURES.map(({ icon: Icon, color, label, desc }) => (
            <div key={label} className="flex items-start gap-3 rounded-2xl px-4 py-3.5"
              style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: `${color}18` }}>
                <Icon className="w-4.5 h-4.5" style={{ color, width: 18, height: 18 }} />
              </div>
              <div>
                <p className="font-black text-sm text-foreground">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Notification opt-in */}
        <div className="rounded-2xl px-4 py-4"
          style={{ background: notifOptIn ? 'rgba(0,255,135,0.07)' : 'hsl(var(--card))', border: notifOptIn ? '1px solid rgba(0,255,135,0.3)' : '1px solid hsl(var(--border))' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: notifOptIn ? 'rgba(0,255,135,0.15)' : 'rgba(255,255,255,0.06)' }}>
              {notifOptIn ? <Bell className="w-5 h-5" style={{ color: '#00FF87' }} /> : <BellOff className="w-5 h-5 text-muted-foreground" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-black text-sm text-foreground">Notify me when Event Mode opens</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {notifOptIn ? "You're on the list — we'll ping you at showtime." : "Get alerted the moment Flash Drops go live."}
              </p>
            </div>
            <button
              onClick={handleNotifToggle}
              className="flex-shrink-0 px-3 py-2 rounded-xl text-xs font-black transition-all"
              style={notifOptIn
                ? { background: 'rgba(0,255,135,0.15)', color: '#00FF87', border: '1px solid rgba(0,255,135,0.3)' }
                : { background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}>
              {notifOptIn ? '✓ On' : 'Notify Me'}
            </button>
          </div>
        </div>

        {/* Preview teaser — Flash Drops */}
        <div className="rounded-2xl overflow-hidden"
          style={{ border: '1px solid rgba(255,230,0,0.2)', background: 'rgba(255,230,0,0.04)' }}>
          <div className="px-4 py-3 flex items-center gap-2"
            style={{ borderBottom: '1px solid rgba(255,230,0,0.15)' }}>
            <Gift className="w-4 h-4" style={{ color: '#FFE600' }} />
            <p className="font-black text-sm text-foreground">Flash Drops Preview</p>
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full font-bold"
              style={{ background: 'rgba(255,230,0,0.15)', color: '#FFE600' }}>Locked until showtime</span>
          </div>
          <div className="px-4 py-4 space-y-3">
            {[
              { seat: 'Floor Section A', detail: 'Row 3 · 2 tickets', badge: 'Premium Drop' },
              { seat: 'Lower Bowl 104', detail: 'Row F · 2 tickets', badge: 'Community Drop' },
            ].map(({ seat, detail, badge }) => (
              <div key={seat} className="flex items-center gap-3 blur-[3px] select-none pointer-events-none">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                  style={{ background: 'rgba(255,230,0,0.1)' }}>🎁</div>
                <div className="flex-1">
                  <p className="font-bold text-sm text-foreground">{seat}</p>
                  <p className="text-xs text-muted-foreground">{detail}</p>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(255,230,0,0.15)', color: '#FFE600' }}>{badge}</span>
              </div>
            ))}
            <p className="text-center text-xs text-muted-foreground pt-1">
              🔒 Real drops appear when the event starts
            </p>
          </div>
        </div>

        {/* CTA at bottom */}
        <div className="text-center space-y-3 pb-6">
          <p className="text-sm font-bold text-foreground">Come back at showtime</p>
          <p className="text-xs text-muted-foreground">Event Mode goes live automatically when the show begins. Just open the app and tap ⚡.</p>
          <Link
            to={`/events/${event.id}`}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold"
            style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
            View Event Details →
          </Link>
        </div>

      </div>
    </div>
  );
}