import { useNavigate } from 'react-router-dom';
import { User, Edit2, ChevronRight } from 'lucide-react';

export default function ProfileIdentitySection({ user }) {
  const navigate = useNavigate();
  const initials = user?.full_name
    ? user.full_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  return (
    <section>
      <h3 className="text-xs font-black tracking-widest uppercase text-muted-foreground mb-3">Profile Identity</h3>
      <div className="rounded-2xl overflow-hidden divide-y divide-border" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
        {/* Avatar + name row */}
        <div className="flex items-center gap-3 px-4 py-3.5">
          <div className="w-10 h-10 rounded-full flex items-center justify-center font-display text-base flex-shrink-0 overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)', color: '#fff' }}>
            {user?.avatar_url
              ? <img src={user.avatar_url} alt="avatar" className="w-full h-full object-cover" />
              : initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground truncate">{user?.full_name || 'Fan'}</p>
            <p className="text-[11px] text-muted-foreground truncate">{user?.email}</p>
          </div>
          <button
            onClick={() => navigate('/edit-persona')}
            className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-xl"
            style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}
          >
            <Edit2 className="w-3 h-3" /> Edit
          </button>
        </div>

        {/* Bio */}
        <div className="flex items-center gap-3 px-4 py-3.5">
          <User className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Bio</p>
            <p className="text-sm text-foreground truncate">{user?.bio || <span className="italic text-muted-foreground">Not set</span>}</p>
          </div>
        </div>

        {/* Role */}
        <div className="flex items-center gap-3 px-4 py-3.5">
          <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground text-xs">🥜</div>
          <div className="flex-1">
            <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Account type</p>
            <p className="text-sm text-foreground capitalize">{user?.role === 'admin' ? '✦ Admin' : 'Fan'}</p>
          </div>
        </div>
      </div>
    </section>
  );
}