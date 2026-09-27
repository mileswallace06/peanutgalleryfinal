import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Ticket, TrendingUp, Shield, LogIn, Edit2, ChevronRight, Camera, ImagePlus, UserPlus, UserCheck, Settings, Eye, EyeOff, MessageSquare, ArrowUpRight } from 'lucide-react';
import PeanutPointsCard from '@/components/points/PeanutPointsCard';
import RecentPointsActivity from '@/components/points/RecentPointsActivity';
import CommunityImpactCard from '@/components/donations/CommunityImpactCard';
import { Disclosure, PageIntro } from '@/components/ClarityUI';
import { isAdmin } from '@/lib/isAdmin';
import { useAuth } from '@/lib/AuthContext';
import { feedbackAccess } from '@/lib/feedbackInbox';
import './account-clarity.css';

/** Email stays private until the member chooses to reveal it. */
function EmailDisplay({ email }) {
  const [shown, setShown] = useState(false);
  if (!email) return null;
  return (
    <button
      type="button"
      onClick={() => setShown(v => !v)}
      aria-label={shown ? 'Hide email address' : 'Show email address'}
      aria-pressed={shown}
      className="pg-member-email"
    >
      {shown ? <Eye size={14} /> : <EyeOff size={14} />}
      <span>{shown ? email : 'Show email'}</span>
    </button>
  );
}

function AccountLink({ to, icon: Icon, title, description }) {
  return (
    <Link to={to} className="pg-account-link">
      {Icon && <Icon size={19} aria-hidden="true" />}
      <span><strong>{title}</strong>{description && <small>{description}</small>}</span>
      <ChevronRight size={17} aria-hidden="true" />
    </Link>
  );
}

export default function Me() {
  const auth = useAuth();
  const { user: authUser } = auth;
  // Keep the resolved session visible while refreshing profile changes.
  const [user, setUser] = useState(authUser || null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const avatarInputRef = useRef(null);
  const bannerInputRef = useRef(null);
  const [followers, setFollowers] = useState([]);
  const [following, setFollowing] = useState([]);
  const [socialTab, setSocialTab] = useState('following');

  useEffect(() => {
    if (authUser) setUser(current => current || authUser);
  }, [authUser]);

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
      <div className="pg-secondary-page pg-account-page">
        <PageIntro eyebrow="YOUR ACCOUNT" title="Me" description="Your tickets, sales and fan profile in one place." />
        <div className="pg-state pg-account-signin">
          <Ticket size={32} aria-hidden="true" />
          <h2>Make yourself at home.</h2>
          <p>Sign in to see your tickets and manage your account.</p>
          <button onClick={() => base44.auth.redirectToLogin()} className="pg-action"><LogIn size={18} /> Sign in</button>
          <Link to="/our-story" className="pg-account-text-link">Read our story <ArrowUpRight size={16} /></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="pg-secondary-page pg-account-page pg-me-page">
      <PageIntro eyebrow="YOUR ACCOUNT" title="Me" description="Find your tickets. Keep track of your sales." />

      <section className="pg-member-ticket" aria-label="Your fan profile">
        <div className="pg-member-banner" data-page-hero="me">
          <img src={user.banner_url || 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=900&q=80'} alt="Your profile banner" />
          <button type="button" onClick={() => bannerInputRef.current?.click()} disabled={uploadingBanner} className="pg-photo-action" aria-label="Change profile banner">
            <ImagePlus size={15} aria-hidden="true" /> {uploadingBanner ? 'Uploading…' : 'Change banner'}
          </button>
          <input ref={bannerInputRef} type="file" accept="image/*" className="hidden" aria-label="Upload profile banner" onChange={handleBannerUpload} />
        </div>
        <div className="pg-member-content">
          <div className="pg-member-topline">
            <div className="pg-member-avatar-wrap">
              <div className="pg-member-avatar">{user.avatar_url ? <img src={user.avatar_url} alt="Your profile photo" /> : initials}</div>
              <button type="button" onClick={() => avatarInputRef.current?.click()} disabled={uploadingAvatar} aria-label={uploadingAvatar ? 'Uploading profile photo' : 'Change profile photo'} className="pg-avatar-action">
                {uploadingAvatar ? <span className="pg-account-spinner" /> : <Camera size={16} aria-hidden="true" />}
              </button>
              <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" aria-label="Upload profile photo" onChange={handleAvatarUpload} />
            </div>
            <Link to="/edit-persona" className="pg-member-edit"><Edit2 size={14} aria-hidden="true" /> Edit persona</Link>
          </div>
          <div className="pg-member-identity">
            <p className="pg-member-eyebrow">Peanut Gallery member</p>
            <h2>{user.full_name || 'Fan'}</h2>
            <EmailDisplay email={user.email} />
            {user.bio && <p className="pg-member-bio">{user.bio}</p>}
          </div>
        </div>
        <div className="pg-member-stub"><span>ALL FANS WELCOME</span><span>FAN{isAdmin(user) ? ' / ADMIN' : ''}</span></div>
      </section>

      <nav className="pg-account-primary" aria-label="Tickets and sales">
        <Link to="/my-tickets" className="pg-account-primary-card pg-account-tickets">
          <Ticket size={22} aria-hidden="true" /><strong>My Tickets</strong><span>View your purchases</span><ChevronRight size={18} aria-hidden="true" />
        </Link>
        <Link to="/my-sales" className="pg-account-primary-card pg-account-sales">
          <TrendingUp size={22} aria-hidden="true" /><strong>My Sales</strong><span>Manage your listings</span><ChevronRight size={18} aria-hidden="true" />
        </Link>
      </nav>
      <div className="pg-account-sell-prompt"><span>Have a ticket to pass on?</span><Link to="/create-listing">Sell tickets <ArrowUpRight size={15} /></Link></div>

      <div className="pg-account-settings-link">
        <AccountLink to="/account-settings" icon={Settings} title="Account Settings" description="Profile, payouts, security and support" />
      </div>

      <div className="pg-account-disclosures">
        <Disclosure title="Fan activity" description="Your points, community impact and recent activity">
          <div className="pg-account-fan-cards">
            <PeanutPointsCard user={user} />
            <CommunityImpactCard userEmail={user.email} />
            <h3 className="pg-account-section-label">Recent activity</h3>
            <RecentPointsActivity userEmail={user.email} />
          </div>
        </Disclosure>

        <Disclosure title="Following" description={`${following.length} following · ${followers.length} followers`}>
          <div className="pg-account-social-tabs" aria-label="People you follow and your followers">
            <button type="button" onClick={() => setSocialTab('following')} aria-pressed={socialTab === 'following'}>Following <span>{following.length}</span></button>
            <button type="button" onClick={() => setSocialTab('followers')} aria-pressed={socialTab === 'followers'}>Followers <span>{followers.length}</span></button>
          </div>
          {socialTab === 'following' && (
            following.length === 0 ? <p className="pg-account-empty">You’re not following anyone yet.</p> : <div className="pg-account-people">
              {following.map(f => (
                <div key={f.id} className="pg-account-person">
                  <div className="pg-account-person-avatar">{f.following_avatar_url ? <img src={f.following_avatar_url} alt="" /> : (f.following_name || f.following_email || '?')[0].toUpperCase()}</div>
                  <div className="pg-account-person-name"><strong>{f.following_name || f.following_email}</strong><small>{f.following_email}</small></div>
                  <button type="button" onClick={() => handleUnfollow(f)} className="pg-account-small-action"><UserCheck size={14} aria-hidden="true" /> Unfollow</button>
                </div>
              ))}
            </div>
          )}
          {socialTab === 'followers' && (
            followers.length === 0 ? <p className="pg-account-empty">No followers yet.</p> : <div className="pg-account-people">
              {followers.map(f => {
                const alreadyFollowing = following.some(fw => fw.following_email === f.follower_email);
                return (
                  <div key={f.id} className="pg-account-person">
                    <div className="pg-account-person-avatar">{(f.follower_email || '?')[0].toUpperCase()}</div>
                    <div className="pg-account-person-name"><strong>{f.follower_email}</strong></div>
                    {!alreadyFollowing && <button type="button" onClick={async () => {
                      const created = await base44.entities.Follow.create({ follower_email: user.email, following_email: f.follower_email, following_name: null, following_avatar_url: null });
                      setFollowing(prev => [...prev, created]);
                    }} className="pg-account-small-action"><UserPlus size={14} aria-hidden="true" /> Follow back</button>}
                  </div>
                );
              })}
            </div>
          )}
        </Disclosure>

        <Disclosure title="About PG" description="How it works, seller payouts and our story">
          <nav aria-label="About Peanut Gallery">
            <AccountLink to="/why-peanut-gallery" title="Why Peanut Gallery?" description="How PG protects fans" />
            <AccountLink to="/seller-payout-guide" title="Seller payout guide" description="Stripe setup and payouts" />
            <AccountLink to="/our-story" title="Our story" description="Built by a fan, for fans" />
          </nav>
        </Disclosure>

        {(isAdmin(user) || feedbackAccess(auth) === 'admin') && <Disclosure title="Admin tools" description="Manage the platform and review feedback">
          {isAdmin(user) && <AccountLink to="/admin" icon={Shield} title="Admin panel" description="Manage events and listings" />}
          {feedbackAccess(auth) === 'admin' && <AccountLink to="/beta-dashboard?view=feedback" icon={MessageSquare} title="Feedback inbox" description="Bugs, confusion, love and ideas" />}
        </Disclosure>}
      </div>
    </div>
  );
}
