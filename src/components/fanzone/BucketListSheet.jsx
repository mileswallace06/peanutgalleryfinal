import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { base44 } from '@/api/base44Client';
import { Bell, Check, Loader2, MapPin, Mic2, Plus, Star, Trash2, X } from 'lucide-react';
import BucketListSearch from './BucketListSearch';
import BucketListIntro from './BucketListIntro';
import BucketListAlerts from './BucketListAlerts';
import './bucket-list.css';

export default function BucketListSheet({ user, onClose, onChange, initialItems = [], initialTab = 'list', triggerRef }) {
  const [following, setFollowing] = useState(initialItems);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(initialTab);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState(null);
  const [status, setStatus] = useState('');
  const mutationLock = useRef(false);
  const followingRef = useRef(initialItems);
  const closeButton = useRef(null);

  const updateList = rows => {
    followingRef.current = rows;
    setFollowing(rows);
    onChange?.(rows);
  };
  const loadList = async () => {
    if (!user?.email) { setLoading(false); return; }
    setLoading(true);
    setLoadError(false);
    try {
      const rows = await base44.entities.BucketListItem.filter({ user_email: user.email });
      updateList(Array.isArray(rows) ? rows : []);
    } catch { setLoadError(true); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadList(); }, [user?.email]);

  const handleFollow = async item => {
    if (mutationLock.current || loading || loadError || !user?.email) return;
    if (followingRef.current.some(row => row.tm_id === item.tm_id && row.type === item.type)) return;
    mutationLock.current = true;
    setPending(`${item.type}:${item.tm_id}`);
    setError('');
    setStatus('');
    try {
      const created = await base44.entities.BucketListItem.create({
        user_email: user.email, tm_id: item.tm_id, name: item.name, type: item.type,
        image_url: item.image_url || null, genre: item.genre || null,
      });
      updateList([...followingRef.current, created]);
      setStatus(`${item.name} added to your bucket list.`);
    } catch { setError('We couldn’t save that favorite. Please try again.'); }
    finally { mutationLock.current = false; setPending(null); }
  };
  const handleUnfollow = async item => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setPending(item.id);
    setError('');
    setStatus('');
    try {
      await base44.entities.BucketListItem.delete(item.id);
      updateList(followingRef.current.filter(row => row.id !== item.id));
      setStatus(`${item.name} removed from your bucket list.`);
    } catch { setError('We couldn’t remove that favorite. Please try again.'); }
    finally { mutationLock.current = false; setPending(null); }
  };
  const groups = [
    { label: 'Artists & teams', rows: following.filter(item => item.type !== 'venue') },
    { label: 'Venues', rows: following.filter(item => item.type === 'venue') },
  ];

  return <Dialog.Root open onOpenChange={open => { if (!open && !mutationLock.current) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="pg-bucket-backdrop" />
      <Dialog.Content className="pg-ticket-app pg-bucket-modal"
        onOpenAutoFocus={event => { event.preventDefault(); closeButton.current?.focus(); }}
        onCloseAutoFocus={event => { event.preventDefault(); const trigger = triggerRef?.current; if (trigger?.isConnected) trigger.focus(); else document.querySelector('.pg-fanzone-page .pg-bucket-tab')?.focus(); }}
        onEscapeKeyDown={event => { if (mutationLock.current) event.preventDefault(); }}>
        <header className="pg-bucket-modal-header">
          <Star size={20} aria-hidden="true" />
          <Dialog.Title>Bucket List</Dialog.Title>
          {!!following.length && <span className="pg-bucket-modal-count">{following.length} saved</span>}
          <button ref={closeButton} type="button" className="pg-bucket-close" disabled={!!pending} onClick={onClose} aria-label="Close bucket list"><X size={21} /></button>
        </header>
        <Dialog.Description className="sr-only">Save artists, teams and venues, and manage your event alerts.</Dialog.Description>
        <div className="pg-bucket-modal-tabs" aria-label="Bucket list views">
          <button type="button" onClick={() => setTab('list')} aria-pressed={tab === 'list'}>My list</button>
          <button type="button" onClick={() => setTab('search')} aria-pressed={tab === 'search'}><Plus size={15} aria-hidden="true" /> Add favorites</button>
          <button type="button" onClick={() => setTab('alerts')} aria-pressed={tab === 'alerts'}><Bell size={14} aria-hidden="true" /> Alerts</button>
        </div>
        <div className="pg-bucket-modal-body">
          {loading ? <p className="pg-bucket-status" role="status">Loading your bucket list…</p> : loadError ? <div className="pg-bucket-problem"><p role="alert">We couldn’t load your saved favorites.</p><button type="button" onClick={loadList}>Try again</button></div> : <>
            {error && <p className="pg-bucket-problem" role="alert">{error}</p>}
            {status && <p className="pg-bucket-status" role="status"><Check size={14} aria-hidden="true" className="inline mr-1" />{status}</p>}
            {tab === 'alerts' ? <BucketListAlerts following={following} /> : tab === 'search' ? <BucketListSearch following={following} onFollow={handleFollow} pending={pending} /> : !following.length ? <BucketListIntro onAdd={() => setTab('search')} /> : <>
              <p className="pg-bucket-note">Your must-see names and places. Related fan posts appear in your Bucket List feed.</p>
              <button className="pg-bucket-alert-link" type="button" onClick={() => setTab('alerts')}><Bell size={16} aria-hidden="true" /><span>Set up event alerts</span><Plus size={15} aria-hidden="true" /></button>
              {groups.map(group => !!group.rows.length && <section className="pg-bucket-group" key={group.label}>
                <h3>{group.label}</h3>
                {group.rows.map(item => <div className="pg-bucket-item" key={item.id}>
                  {item.image_url ? <img src={item.image_url} alt="" className="pg-bucket-item-image" /> : <span className="pg-bucket-item-image">{item.type === 'venue' ? <MapPin size={19} /> : <Mic2 size={19} />}</span>}
                  <span className="pg-bucket-item-copy"><strong>{item.name}</strong><small>{item.genre || (item.type === 'venue' ? 'Venue' : 'Artist / team')}</small></span>
                  <button type="button" className="pg-bucket-item-action" aria-label={`Remove ${item.name} from bucket list`} disabled={!!pending} onClick={() => handleUnfollow(item)}>{pending === item.id ? <Loader2 size={17} className="animate-spin" /> : <Trash2 size={17} />}</button>
                </div>)}
              </section>)}
            </>}
          </>}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
