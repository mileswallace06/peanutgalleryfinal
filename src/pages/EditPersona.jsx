import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Camera, ImagePlus, Check, Loader2, Star, Trash2, ArrowUpRight, ArrowLeft } from 'lucide-react';
import { Disclosure, PageIntro } from '@/components/ClarityUI';
import './account-clarity.css';

export default function EditPersona() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
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
      <div className="pg-secondary-page pg-account-page">
        <PageIntro eyebrow="YOUR PROFILE" title="Edit persona" action={<button type="button" className="pg-back-link" onClick={() => navigate(-1)}><ArrowLeft size={16} aria-hidden="true" /> Back</button>} />
        <div className="pg-state" role="status"><Loader2 className="animate-spin" size={24} /><p>Loading your profile…</p></div>
      </div>
    );
  }

  return (
    <div className="pg-secondary-page pg-account-page pg-persona-page">
      <PageIntro
        eyebrow="YOUR PROFILE"
        title="Edit persona"
        description="Make your fan profile feel like you."
        action={<><button type="button" className="pg-back-link" onClick={() => navigate(-1)}><ArrowLeft size={16} aria-hidden="true" /> Back</button><button onClick={handleSave} disabled={saving || saved} className="pg-action pg-persona-save">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
          {saved ? 'Saved' : saving ? 'Saving…' : 'Save'}
        </button></>}
      />

      <section className="pg-persona-photos" aria-label="Profile photos">
        <div className="pg-member-banner pg-persona-banner">
          <img src={user.banner_url || 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=900&q=80'} alt="Your profile banner" />
          <button type="button" onClick={() => bannerInputRef.current?.click()} disabled={uploadingBanner} className="pg-photo-action" aria-label="Change profile banner">
            <ImagePlus size={16} /> {uploadingBanner ? 'Uploading…' : 'Change banner'}
          </button>
          <input ref={bannerInputRef} type="file" accept="image/*" className="hidden" aria-label="Upload profile banner" onChange={handleBannerUpload} />
        </div>
        <div className="pg-persona-photo-row">
          <div className="pg-member-avatar-wrap">
            <div className="pg-member-avatar">{user.avatar_url ? <img src={user.avatar_url} alt="Your profile photo" /> : initials}</div>
            <button type="button" onClick={() => avatarInputRef.current?.click()} disabled={uploadingAvatar} aria-label={uploadingAvatar ? 'Uploading profile photo' : 'Change profile photo'} className="pg-avatar-action">
              {uploadingAvatar ? <span className="pg-account-spinner" /> : <Camera size={16} />}
            </button>
            <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" aria-label="Upload profile photo" onChange={handleAvatarUpload} />
          </div>
          <p>Tap the camera to change your photo.<br />Photos save as soon as they upload.</p>
        </div>
      </section>

      <div className="pg-persona-fields">
        <div className="pg-persona-field">
          <span className="pg-account-section-label" id="persona-name-label">Display name</span>
          <div className="pg-persona-name" aria-labelledby="persona-name-label">{user.full_name || '—'}</div>
          <p className="pg-persona-hint">Your name is set by your account. Contact support to change it.</p>
        </div>
        <div className="pg-persona-field">
          <label htmlFor="persona-bio" className="pg-account-section-label">Bio</label>
          <textarea
            id="persona-bio"
            value={bio}
            onChange={e => setBio(e.target.value)}
            placeholder="Tell the crowd who you are…"
            rows={3}
            maxLength={160}
            aria-describedby="persona-bio-hint persona-bio-count"
          />
          <div className="pg-persona-field-footer"><p id="persona-bio-hint">A few words for your fan profile.</p><span id="persona-bio-count">{bio.length}/160</span></div>
        </div>
      </div>

      <Disclosure title="Bucket list" description={`${bucketList.length} saved artists and venues · Manage in Fan Zone`}>
        {bucketList.length === 0 ? <p className="pg-account-empty">No bucket list items yet. Add artists and venues in the Fan Zone.</p> : <div className="pg-account-people">
          {bucketList.map(item => (
            <div key={item.id} className="pg-account-person">
              <div className="pg-persona-bucket-image">{item.image_url ? <img src={item.image_url} alt="" /> : <Star size={18} aria-hidden="true" />}</div>
              <div className="pg-account-person-name"><strong>{item.name}</strong><small className="capitalize">{item.type}{item.genre ? ` · ${item.genre}` : ''}</small></div>
              <button type="button" onClick={() => handleRemoveBucketItem(item)} className="pg-persona-remove" aria-label={`Remove ${item.name} from your bucket list`}><Trash2 size={17} aria-hidden="true" /></button>
            </div>
          ))}
        </div>}
        <Link to="/fan-zone" className="pg-account-text-link">Open Fan Zone <ArrowUpRight size={15} /></Link>
      </Disclosure>
      <p className="pg-persona-save-status" role="status">{saved ? 'Your profile is saved. Going back…' : 'Use Save above to update your bio.'}</p>
    </div>
  );
}
