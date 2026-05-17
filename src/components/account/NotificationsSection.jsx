import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Bell } from 'lucide-react';

const PREFS = [
  { key: 'notif_upgrade_alerts', label: 'Upgrade Alerts', desc: 'When a matching seat upgrade is available' },
  { key: 'notif_transfer_updates', label: 'Transfer Updates', desc: 'Buyer/seller confirms your ticket transfer' },
  { key: 'notif_fan_zone', label: 'Fan Zone Activity', desc: 'Reactions and new posts from people you follow' },
];

function Toggle({ on, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className="relative w-11 h-6 rounded-full transition-colors flex-shrink-0"
      style={{ background: on ? '#BF5FFF' : 'hsl(var(--muted))' }}
    >
      <span
        className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
        style={{ transform: on ? 'translateX(20px)' : 'translateX(0)' }}
      />
    </button>
  );
}

export default function NotificationsSection({ user, onUpdate }) {
  const [prefs, setPrefs] = useState({
    notif_upgrade_alerts: user?.notif_upgrade_alerts ?? true,
    notif_transfer_updates: user?.notif_transfer_updates ?? true,
    notif_fan_zone: user?.notif_fan_zone ?? false,
  });

  const toggle = async (key) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    await base44.auth.updateMe({ [key]: next[key] });
    onUpdate?.({ [key]: next[key] });
  };

  return (
    <section>
      <h3 className="text-xs font-black tracking-widest uppercase text-muted-foreground mb-3">Notifications</h3>
      <div className="rounded-2xl overflow-hidden divide-y divide-border" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
        {PREFS.map(({ key, label, desc }) => (
          <div key={key} className="flex items-center gap-3 px-4 py-3.5">
            <Bell className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">{label}</p>
              <p className="text-[11px] text-muted-foreground">{desc}</p>
            </div>
            <Toggle on={prefs[key]} onToggle={() => toggle(key)} />
          </div>
        ))}
      </div>
    </section>
  );
}