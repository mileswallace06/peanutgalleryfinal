import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { ChevronLeft, Camera, ImagePlus, Check, Loader2, Star, Trash2, Plus } from 'lucide-react';

export default function EditPersona() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [bucketList, setBucketList] = useState([]);
  const avatarInputRef = useRef(null);
  const bannerInputRef = useRef(null);

  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
      setDisplayName(u?.full_name || '');
      setBio(u?.bio || '');
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (user?.email) {
      base44.entities.BucketListItem.filter({ user_email: user.email })
        .then(setBucketList)
        .catch(() => {});
    }
  }, [user?.email]);

  const handleAvatarUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingAvatar(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    await base44.auth.updateMe({ avatar_url: file_url });
    setUser(u => ({ ...u, avatar_url: file_url }));
    setUploadingAvatar(false);
  };

  const handleBannerUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingBanner(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    await base44.auth.updateMe({ banner_url: file_url });
    setUser(u => ({ ...u, banner_url: file_url }));
    setUploadingBanner(false);
  };

  const handleSave = async () => {
    setSaving(true);
    await base44.auth.updateMe({ bio: bio.trim() });
    setUser(u => ({ ...u, bio: bio.trim() }));
    setSaving(false);
    setSaved(true);
    setTimeout(() => { setSaved(false); navigate(-1); }, 1200);
  };

  const handleRemoveBucketItem = async (item) => {
    await base44.entities.BucketListItem.delete(item.id);
    setBucketList(prev => prev.filter(b => b.id !== item.id));
  };

  const initials = user?.full_name
    ? user.full_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center dark:rave-bg">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-32 dark:rave-bg" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-4 sticky top-0 z-10 frosted-bar" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90"
            style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="font-display text-xl text-foreground">Edit Persona</h1>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || saved}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black transition-all disabled:opacity-60 active:scale-95"
          style={{ background: saved ? 'rgba(0,255,135,0.2)' : 'linear-gradient(135deg, #00E87A, #00B8E8)', color: saved ? '#00FF87' : '#0D0B14' }}
        >
          {saving
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Check className="w-3.5 h-3.5" />
          }
          {saved ? 'Saved!' : 'Save'}
        </button>
      </div>

      {/* Banner */}
      <div className="relative h-44 overflow-hidden group/banner">
        <img
          src={user.banner_url || 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=900&q=80'}
          alt="banner"
          className="w-full h-full object-cover object-center"
        />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(5,3,12,0.3) 0%, rgba(5,3,12,0.7) 100%)' }} />
        <button
          onClick={() => bannerInputRef.current?.click()}
          disabled={uploadingBanner}
          className="absolute inset-0 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.3)' }}
        >
          {uploadingBanner
            ? <span className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : <div className="flex items-center gap-2 px-4 py-2 rounded-full font-bold text-sm text-white" style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', backdropFilter: 'blur(8px)' }}>
                <ImagePlus className="w-4 h-4" /> Change Banner
              </div>
          }
        </button>
        <input ref={bannerInputRef} type="file" accept="image/*" className="hidden" onChange={handleBannerUpload} />
      </div>

      {/* Avatar */}
      <div className="px-5 -mt-12 relative z-10 mb-6">
        <div className="relative group/avatar w-24 h-24">
          <div
            className="w-24 h-24 rounded-full flex items-center justify-center font-display text-3xl text-white overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)', boxShadow: '0 0 32px rgba(191,95,255,0.5)', border: '3px solid hsl(255 10% 5%)' }}
          >
            {user.avatar_url
              ? <img src={user.avatar_url} alt="avatar" className="w-full h-full object-cover" />
              : initials
            }
          </div>
          <button
            onClick={() => avatarInputRef.current?.click()}
            disabled={uploadingAvatar}
            className="absolute inset-0 rounded-full flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity"
            style={{ background: 'rgba(0,0,0,0.55)' }}
          >
            {uploadingAvatar
              ? <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <Camera className="w-5 h-5 text-white" />
            }
          </button>
          <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">Tap avatar or banner to change</p>
      </div>

      {/* Fields */}
      <div className="px-5 space-y-5">

        {/* Display Name (read-only note) */}
        <div>
          <label className="block text-xs font-black tracking-widest uppercase text-muted-foreground mb-2">Display Name</label>
          <div
            className="w-full px-4 py-3 rounded-2xl text-sm font-medium text-foreground"
            style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
          >
            {user.full_name || '—'}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">Your name is set by your account — contact support to change it.</p>
        </div>

        {/* Bio */}
        <div>
          <label className="block text-xs font-black tracking-widest uppercase text-muted-foreground mb-2">Bio</label>
          <textarea
            value={bio}
            onChange={e => setBio(e.target.value)}
            placeholder="Tell the crowd who you are…"
            rows={3}
            maxLength={160}
            className="w-full px-4 py-3 rounded-2xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
            style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
          />
          <p className="text-[10px] text-muted-foreground text-right mt-1">{bio.length}/160</p>
        </div>

        {/* Bucket List */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-black tracking-widest uppercase text-muted-foreground flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5" style={{ color: '#FFE600' }} /> Bucket List
            </label>
            <span className="text-[10px] text-muted-foreground">Manage in Fan Zone</span>
          </div>
          {bucketList.length === 0 ? (
            <div
              className="px-4 py-4 rounded-2xl text-center text-sm text-muted-foreground"
              style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
            >
              No bucket list items yet. Add artists &amp; venues in the Fan Zone.
            </div>
          ) : (
            <div className="space-y-2">
              {bucketList.map(item => (
                <div key={item.id} className="flex items-center gap-3 px-4 py-3 rounded-2xl"
                  style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                  <div className="w-9 h-9 rounded-xl overflow-hidden flex-shrink-0"
                    style={{ background: 'rgba(255,230,0,0.1)' }}>
                    {item.image_url
                      ? <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-lg">🎵</div>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground truncate">{item.name}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">{item.type} {item.genre ? `· ${item.genre}` : ''}</p>
                  </div>
                  <button
                    onClick={() => handleRemoveBucketItem(item)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-all active:scale-90"
                    style={{ background: 'rgba(255,45,120,0.08)', color: '#FF2D78' }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}