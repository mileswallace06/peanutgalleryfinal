import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Ticket, TrendingUp, Shield, LogIn, Edit2, Tag, Zap, ChevronRight, Camera, ImagePlus, UserPlus, UserCheck, Settings } from 'lucide-react';

export default function Me() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const avatarInputRef = useRef(null);
  const bannerInputRef = useRef(null);
  const [followers, setFollowers] = useState([]);
  const [following, setFollowing] = useState([]);
  const [socialTab, setSocialTab] = useState('following');

  useEffect(() => {
    base44.auth.me({ fresh: true }).then(u => {
      setUser(u);
      if (u?.email) {
        Promise.all([
          base44.entities.Follow.filter({ follower_email: u.email }),
          base44.entities.Follow.filter({ following_email: u.email }),
        ]).then(([fwing, fwers]) => {
          setFollowing(fwing);
          setFollowers(fwers);
        }).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  const handleUnfollow = async (followRecord) => {
    await base44.entities.Follow.delete(followRecord.id);
    setFollowing(prev => prev.filter(f => f.id !== followRecord.id));
  };

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

  const initials = user?.full_name
    ? user.full_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  if (!user) {
    return (
      <div className="min-h-screen pb-28 flex flex-col items-center justify-center gap-6 px-5 dark:rave-bg">
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
    <div className="min-h-screen pb-32 dark:rave-bg relative" style={{ paddingTop: 'env(safe-area-inset-top)' }}>

      {/* Hero banner */}
      <div className="relative h-40 overflow-hidden group/banner">
        <img
          src={user.banner_url || 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=900&q=80'}
          alt="banner"
          className="w-full h-full object-cover object-center"
        />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(5,3,12,0.3) 0%, rgba(5,3,12,0.85) 100%)' }} />
        {/* Banner edit overlay */}
        <button
          onClick={() => bannerInputRef.current?.click()}
          disabled={uploadingBanner}
          className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/banner:opacity-100 transition-opacity"
          style={{ background: 'rgba(0,0,0,0.4)' }}
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

      {/* Avatar floats over banner */}
      <div className="px-5 -mt-12 relative z-10">
        <div className="flex items-end justify-between mb-4">
          {/* Avatar */}
          <div className="relative group/avatar flex-shrink-0">
            <div
              className="w-24 h-24 rounded-full flex items-center justify-center font-display text-3xl text-white overflow-hidden"
              style={{
                background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)',
                boxShadow: '0 0 32px rgba(191,95,255,0.5)',
                border: '3px solid hsl(255 10% 5%)',
              }}
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

          {/* Edit Persona button */}
          <button
            onClick={() => navigate('/edit-persona')}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 dark:text-[rgba(255,255,255,0.7)] dark:bg-[rgba(255,255,255,0.07)] dark:border-[rgba(255,255,255,0.12)]"
            style={{ background: '#f0f0f0', border: '1px solid #d0d0d0', color: '#000' }}
          >
            <Edit2 className="w-3.5 h-3.5" /> Edit Persona
          </button>
        </div>

        {/* Name + badges */}
        <div className="mb-1">
          <h2 className="font-display text-2xl text-foreground">{user.full_name || 'Fan'}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{user.email}</p>
        </div>

        {/* Role badges + Account Settings button */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full dark:bg-[rgba(0,200,255,0.25)] dark:border-[rgba(0,200,255,0.5)] dark:text-[#00FFFF]"
            style={{ background: '#e0f0f8', color: '#00C8FF', border: '1px solid #d0e8f0' }}>
            🥜 Fan
          </span>
          {user.role === 'admin' && (
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full dark:bg-[rgba(255,230,0,0.25)] dark:border-[rgba(255,230,0,0.5)] dark:text-[#FFFF00]"
              style={{ background: '#f8f8e8', color: '#FFE600', border: '1px solid #f0e8d0' }}>
              ✦ Admin
            </span>
          )}
          <button
            onClick={() => navigate('/account-settings')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold transition-all active:scale-95"
            style={{ background: 'rgba(191,95,255,0.1)', border: '1px solid rgba(191,95,255,0.3)', color: '#BF5FFF' }}
          >
            <Settings className="w-3 h-3" /> Account Settings
          </button>
        </div>

        {/* Bio */}
        {user.bio ? (
          <p className="text-sm text-muted-foreground mb-6 leading-relaxed">{user.bio}</p>
        ) : (
          <button
            onClick={() => navigate('/edit-persona')}
            className="text-xs text-muted-foreground mb-6 italic flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <Tag className="w-3 h-3" /> Add a bio…
          </button>
        )}

        {/* Profile content */}
        <>

        {/* Followers / Following */}
        <div className="mb-5">
          {/* Stats row */}
          <div className="flex gap-4 mb-3">
            <button
              onClick={() => setSocialTab('following')}
              className="flex flex-col items-center px-4 py-2.5 rounded-2xl transition-all"
              style={socialTab === 'following'
                ? { background: 'rgba(191,95,255,0.12)', border: '1px solid rgba(191,95,255,0.3)', color: '#BF5FFF' }
                : { background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }
              }
            >
              <span className="font-black text-lg leading-none text-foreground">{following.length}</span>
              <span className="text-[10px] font-semibold mt-0.5">Following</span>
            </button>
            <button
              onClick={() => setSocialTab('followers')}
              className="flex flex-col items-center px-4 py-2.5 rounded-2xl transition-all"
              style={socialTab === 'followers'
                ? { background: 'rgba(191,95,255,0.12)', border: '1px solid rgba(191,95,255,0.3)', color: '#BF5FFF' }
                : { background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }
              }
            >
              <span className="font-black text-lg leading-none text-foreground">{followers.length}</span>
              <span className="text-[10px] font-semibold mt-0.5">Followers</span>
            </button>
          </div>

          {/* List */}
          {socialTab === 'following' && (
            following.length === 0
              ? <p className="text-xs text-muted-foreground px-1">You're not following anyone yet. React to posts to find fans, or follow from their profile.</p>
              : <div className="space-y-2">
                  {following.map(f => (
                    <div key={f.id} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl"
                      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                      <div className="w-9 h-9 rounded-full flex items-center justify-center font-black text-sm flex-shrink-0"
                        style={{ background: 'linear-gradient(135deg, #BF5FFF, #FF2D78)', color: '#fff' }}>
                        {f.following_avatar_url
                          ? <img src={f.following_avatar_url} alt="" className="w-full h-full object-cover rounded-full" />
                          : (f.following_name || f.following_email || '?')[0].toUpperCase()
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-foreground truncate">{f.following_name || f.following_email}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{f.following_email}</p>
                      </div>
                      <button
                        onClick={() => handleUnfollow(f)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold dark:bg-[rgba(255,45,120,0.1)] dark:border-[rgba(255,45,120,0.2)]"
                        style={{ background: '#f8e8f0', color: '#FF2D78', border: '1px solid #f0d0d8' }}
                      >
                        <UserCheck className="w-3 h-3" /> Unfollow
                      </button>
                    </div>
                  ))}
                </div>
          )}
          {socialTab === 'followers' && (
            followers.length === 0
              ? <p className="text-xs text-muted-foreground px-1">No followers yet.</p>
              : <div className="space-y-2">
                  {followers.map(f => {
                    const alreadyFollowing = following.some(fw => fw.following_email === f.follower_email);
                    return (
                      <div key={f.id} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl"
                        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                        <div className="w-9 h-9 rounded-full flex items-center justify-center font-black text-sm flex-shrink-0"
                          style={{ background: 'linear-gradient(135deg, #00C8FF, #00FF87)', color: '#0a0510' }}>
                          {(f.follower_email || '?')[0].toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-foreground truncate">{f.follower_email}</p>
                        </div>
                        {!alreadyFollowing && (
                          <button
                            onClick={async () => {
                              const created = await base44.entities.Follow.create({
                                follower_email: user.email,
                                following_email: f.follower_email,
                                following_name: null,
                                following_avatar_url: null,
                              });
                              setFollowing(prev => [...prev, created]);
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold dark:bg-[rgba(191,95,255,0.12)] dark:border-[rgba(191,95,255,0.3)]"
                            style={{ background: '#f0e8f8', color: '#BF5FFF', border: '1px solid #e8d0f0' }}
                          >
                            <UserPlus className="w-3 h-3" /> Follow Back
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
          )}
        </div>

        {/* Divider */}
        <div className="h-px mb-5" style={{ background: 'var(--border)' }} />

        {/* Quick links */}
        <div className="space-y-3">

          <Link
            to="/my-tickets"
            className="flex items-center gap-4 px-5 py-4 rounded-2xl transition-all active:scale-[0.98]"
            style={{ background: 'rgba(0,200,255,0.1)', border: '1px solid rgba(0,200,255,0.25)' }}
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(0,200,255,0.2)' }}>
              <Ticket className="w-5 h-5 dark:!text-[#00C8FF] dark:drop-shadow-[0_0_8px_rgba(0,200,255,0.8)]" style={{ color: '#003366' }} />
            </div>
            <div className="flex-1">
              <div className="font-bold text-sm" style={{ color: '#003366' }} className="dark:!text-[#00FFFF]">My Tickets</div>
              <div className="text-[9px] dark:!text-[#00FFFF]" style={{ color: '#002847' }}>View your purchases</div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </Link>

          <Link
            to="/my-sales"
            className="flex items-center gap-4 px-5 py-4 rounded-2xl transition-all active:scale-[0.98]"
            style={{ background: 'rgba(191,95,255,0.1)', border: '1px solid rgba(191,95,255,0.25)' }}
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(191,95,255,0.2)' }}>
              <TrendingUp className="w-5 h-5 dark:!text-[#BF5FFF] dark:drop-shadow-[0_0_8px_rgba(191,95,255,0.8)]" style={{ color: '#6B3B7F' }} />
            </div>
            <div className="flex-1">
              <div className="font-bold text-sm" style={{ color: '#6B3B7F' }} className="dark:!text-[#FF00FF]">My Sales</div>
              <div className="text-[9px] dark:!text-[#FF99FF]" style={{ color: '#4A2D5F' }}>Track your listings</div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </Link>

          <Link
            to="/create-listing"
            className="flex items-center gap-4 px-5 py-4 rounded-2xl transition-all active:scale-[0.98]"
            style={{ background: 'rgba(0,255,135,0.1)', border: '1px solid rgba(0,255,135,0.25)' }}
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(0,255,135,0.2)' }}>
              <Zap className="w-5 h-5 dark:!text-[#00FF87] dark:drop-shadow-[0_0_8px_rgba(0,255,135,0.8)]" style={{ color: '#004D30' }} />
            </div>
            <div className="flex-1">
              <div className="font-bold text-sm" style={{ color: '#004D30' }} className="dark:!text-[#00FF99]">Sell Tickets</div>
              <div className="text-[9px] dark:!text-[#00FF99]" style={{ color: '#003D24' }}>List seats you want to move</div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </Link>

          {user.role === 'admin' && (
            <Link
              to="/admin"
              className="flex items-center gap-4 px-5 py-4 rounded-2xl transition-all active:scale-[0.98]"
              style={{ background: 'rgba(255,230,0,0.1)', border: '1px solid rgba(255,230,0,0.25)' }}
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(255,230,0,0.2)' }}>
                <Shield className="w-5 h-5 dark:!text-[#FFE600] dark:drop-shadow-[0_0_8px_rgba(255,230,0,0.8)]" style={{ color: '#664D00' }} />
              </div>
              <div className="flex-1">
                <div className="font-bold text-sm" style={{ color: '#664D00' }} className="dark:!text-[#FFFF00]">Admin Panel</div>
                <div className="text-[9px] dark:!text-[#FFFF99]" style={{ color: '#4D3300' }}>Manage events and listings</div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </Link>
          )}
        </div>

        </>
      </div>
    </div>
  );
}