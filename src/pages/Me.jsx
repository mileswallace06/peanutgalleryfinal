import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Ticket, TrendingUp, Shield, LogIn, Edit2, Check, X, Tag, Zap, ChevronRight, LogOut } from 'lucide-react';

export default function Me() {
  const [user, setUser] = useState(null);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
      setDisplayName(u?.full_name || '');
      setBio(u?.bio || '');
    }).catch(() => {});
  }, []);

  const initials = user?.full_name
    ? user.full_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  const handleSave = async () => {
    setSaving(true);
    await base44.auth.updateMe({ bio: bio.trim() });
    setUser(u => ({ ...u, bio: bio.trim() }));
    setSaving(false);
    setSaved(true);
    setEditing(false);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleCancel = () => {
    setBio(user?.bio || '');
    setEditing(false);
  };

  if (!user) {
    return (
      <div className="rave-bg min-h-screen pb-28 flex flex-col items-center justify-center gap-6 px-5">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center text-4xl"
          style={{ background: 'rgba(191,95,255,0.15)', border: '1px solid rgba(191,95,255,0.3)' }}
        >
          🥜
        </div>
        <div className="text-center">
          <h2 className="font-display text-3xl text-foreground mb-2">Welcome Back</h2>
          <p className="text-sm text-muted-foreground max-w-[220px] mx-auto">
            Sign in to view your profile, tickets, and sales.
          </p>
        </div>
        <button
          onClick={() => base44.auth.redirectToLogin()}
          className="flex items-center gap-2 font-black px-8 py-3.5 rounded-full"
          style={{ background: 'linear-gradient(135deg, #00FF87, #00C8FF)', color: '#0D0B14', boxShadow: '0 0 24px rgba(0,255,135,0.3)' }}
        >
          <LogIn className="w-4 h-4" /> Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="rave-bg min-h-screen pb-32">

      {/* Hero banner */}
      <div className="relative h-40 overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=900&q=80"
          alt="concert"
          className="w-full h-full object-cover object-center"
        />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(5,3,12,0.3) 0%, rgba(5,3,12,0.85) 100%)' }} />
      </div>

      {/* Avatar floats over banner */}
      <div className="px-5 -mt-12 relative z-10">
        <div className="flex items-end justify-between mb-4">
          {/* Avatar */}
          <div
            className="w-24 h-24 rounded-full flex items-center justify-center font-display text-3xl text-white flex-shrink-0"
            style={{
              background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)',
              boxShadow: '0 0 32px rgba(191,95,255,0.5)',
              border: '3px solid hsl(255 10% 5%)',
            }}
          >
            {initials}
          </div>

          {/* Edit / Save buttons */}
          {!editing ? (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all"
              style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)' }}
            >
              <Edit2 className="w-3.5 h-3.5" /> Edit Profile
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={handleCancel}
                className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)' }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #00E87A, #00B8E8)', color: '#0D0B14' }}
              >
                {saving
                  ? <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  : <Check className="w-3.5 h-3.5" />
                }
                Save
              </button>
            </div>
          )}
        </div>

        {/* Name + badges */}
        <div className="mb-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-display text-2xl text-foreground">{user.full_name || 'Fan'}</h2>
            {saved && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(0,255,135,0.15)', color: '#00FF87', border: '1px solid rgba(0,255,135,0.3)' }}>
                ✓ Saved
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{user.email}</p>
        </div>

        {/* Role badges */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full"
            style={{ background: 'rgba(0,200,255,0.1)', color: '#00C8FF', border: '1px solid rgba(0,200,255,0.25)' }}>
            🥜 Fan
          </span>
          {user.role === 'admin' && (
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full"
              style={{ background: 'rgba(255,230,0,0.1)', color: '#FFE600', border: '1px solid rgba(255,230,0,0.3)' }}>
              ✦ Admin
            </span>
          )}
        </div>

        {/* Bio */}
        {editing ? (
          <div className="mb-6">
            <label className="block text-xs text-muted-foreground mb-1.5">Bio <span className="opacity-50">(optional)</span></label>
            <textarea
              value={bio}
              onChange={e => setBio(e.target.value)}
              placeholder="Tell the crowd who you are…"
              rows={3}
              maxLength={160}
              className="w-full px-4 py-3 rounded-2xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
            />
            <p className="text-[10px] text-muted-foreground text-right mt-1">{bio.length}/160</p>
          </div>
        ) : user.bio ? (
          <p className="text-sm text-muted-foreground mb-6 leading-relaxed">{user.bio}</p>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-muted-foreground mb-6 italic flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <Tag className="w-3 h-3" /> Add a bio…
          </button>
        )}

        {/* Divider */}
        <div className="h-px mb-5" style={{ background: 'rgba(255,255,255,0.07)' }} />

        {/* Quick links */}
        <div className="space-y-3">

          <Link
            to="/my-tickets"
            className="flex items-center gap-4 px-5 py-4 rounded-2xl transition-all active:scale-[0.98]"
            style={{ background: 'rgba(0,200,255,0.06)', border: '1px solid rgba(0,200,255,0.16)' }}
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(0,200,255,0.12)' }}>
              <Ticket className="w-5 h-5" style={{ color: '#00C8FF' }} />
            </div>
            <div className="flex-1">
              <div className="font-bold text-foreground text-sm">My Tickets</div>
              <div className="text-xs text-muted-foreground">View your purchases</div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </Link>

          <Link
            to="/my-sales"
            className="flex items-center gap-4 px-5 py-4 rounded-2xl transition-all active:scale-[0.98]"
            style={{ background: 'rgba(191,95,255,0.06)', border: '1px solid rgba(191,95,255,0.16)' }}
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(191,95,255,0.12)' }}>
              <TrendingUp className="w-5 h-5" style={{ color: '#BF5FFF' }} />
            </div>
            <div className="flex-1">
              <div className="font-bold text-foreground text-sm">My Sales</div>
              <div className="text-xs text-muted-foreground">Track your listings</div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </Link>

          <Link
            to="/create-listing"
            className="flex items-center gap-4 px-5 py-4 rounded-2xl transition-all active:scale-[0.98]"
            style={{ background: 'rgba(0,255,135,0.05)', border: '1px solid rgba(0,255,135,0.15)' }}
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(0,255,135,0.1)' }}>
              <Zap className="w-5 h-5" style={{ color: '#00FF87' }} />
            </div>
            <div className="flex-1">
              <div className="font-bold text-foreground text-sm">Sell Tickets</div>
              <div className="text-xs text-muted-foreground">List seats you want to move</div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </Link>

          {user.role === 'admin' && (
            <Link
              to="/admin"
              className="flex items-center gap-4 px-5 py-4 rounded-2xl transition-all active:scale-[0.98]"
              style={{ background: 'rgba(255,230,0,0.05)', border: '1px solid rgba(255,230,0,0.15)' }}
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(255,230,0,0.1)' }}>
                <Shield className="w-5 h-5" style={{ color: '#FFE600' }} />
              </div>
              <div className="flex-1">
                <div className="font-bold text-foreground text-sm">Admin Panel</div>
                <div className="text-xs text-muted-foreground">Manage events and listings</div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </Link>
          )}
        </div>

        {/* Sign out */}
        <button
          onClick={() => base44.auth.logout('/')}
          className="w-full flex items-center justify-center gap-2 mt-6 py-3.5 rounded-2xl text-sm font-semibold transition-all"
          style={{ background: 'rgba(255,45,120,0.07)', border: '1px solid rgba(255,45,120,0.15)', color: 'rgba(255,100,140,0.8)' }}
        >
          <LogOut className="w-4 h-4" /> Sign Out
        </button>
      </div>
    </div>
  );
}