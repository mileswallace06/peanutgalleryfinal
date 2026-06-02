/**
 * LiveHubEmptyState
 * Shown on the Upgrades tab when there are zero upgrades AND zero flash drops.
 * Turns "nothing here" into "be first to know."
 * Social proof numbers are static estimates — replace with real counts when available.
 */
import { Bell, Users, Zap, CheckCircle } from 'lucide-react';

const SOCIAL_PROOF = [
  { icon: <Zap className="w-3.5 h-3.5" style={{ color: '#00FF87' }} />, label: 'Upgrades completed', value: '200+' },
  { icon: <span className="text-sm leading-none">🎁</span>, label: 'Flash Drops given away', value: '80+' },
  { icon: <Users className="w-3.5 h-3.5" style={{ color: '#BF5FFF' }} />, label: 'Fans helped', value: '500+' },
  { icon: <CheckCircle className="w-3.5 h-3.5" style={{ color: '#00C8FF' }} />, label: 'Successful transfers', value: '99%' },
];

export default function LiveHubEmptyState() {
  return (
    <div className="space-y-5 pt-2">
      {/* Main CTA card */}
      <div className="rounded-2xl px-5 py-8 text-center space-y-4"
        style={{ background: 'linear-gradient(135deg, rgba(191,95,255,0.06), rgba(0,255,135,0.04))', border: '1px solid rgba(191,95,255,0.2)' }}>
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto text-2xl"
          style={{ background: 'rgba(191,95,255,0.12)', border: '1px solid rgba(191,95,255,0.25)' }}>
          ⚡
        </div>
        <div>
          <p className="font-black text-base text-foreground">Live Hub Is Ready</p>
          <p className="text-xs text-muted-foreground mt-1.5 max-w-[240px] mx-auto leading-relaxed">
            The moment upgrades or Flash Drops appear, we'll notify you instantly.
          </p>
        </div>
        <button
          className="flex items-center gap-2 px-6 py-3 rounded-full font-black text-sm mx-auto transition-all active:scale-95"
          style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}>
          <Bell className="w-4 h-4" />
          Turn On Alerts
        </button>
      </div>

      {/* Social proof — PG works, even when quiet */}
      <div>
        <p className="text-[10px] font-black tracking-widest uppercase text-muted-foreground mb-2 px-1">
          PG by the numbers
        </p>
        <div className="grid grid-cols-2 gap-2">
          {SOCIAL_PROOF.map((item, i) => (
            <div key={i} className="flex items-center gap-2.5 px-3 py-3 rounded-xl"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
              {item.icon}
              <div className="min-w-0">
                <p className="font-black text-sm text-foreground leading-none">{item.value}</p>
                <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{item.label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}