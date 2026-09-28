import { useEffect, useState } from 'react';
import { Copy, Download, RefreshCw, Share2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { getListingShareData } from '@/lib/listingShare';
import { loadSharedListing } from '@/lib/sharedListingDestination';
import './listing-share.css';

const loadListing = id => loadSharedListing({
  invoke: (name, body) => base44.functions.invoke(name, body),
  filterEvents: query => base44.entities.Event.filter(query),
}, id);

export default function ListingShareControl({ listing, event }) {
  const [open, setOpen] = useState(false);
  // This is a display check only. Opening the kit rechecks the public record.
  const candidate = getListingShareData(listing, event);
  if (!candidate.data) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="pg-action pg-listing-share-trigger"><Share2 aria-hidden="true" /> Share listing</button>
      </DialogTrigger>
      {open && <ShareContents listingId={listing.id} />}
    </Dialog>
  );
}

function ShareContents({ listingId }) {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState('loading');
  const [data, setData] = useState(null);
  const [format, setFormat] = useState('square');
  const [asset, setAsset] = useState(null);
  const [imageError, setImageError] = useState(false);
  const [notice, setNotice] = useState('');
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setData(null);
    setNotice('');
    loadListing(listingId).then(result => {
      if (cancelled) return;
      if (result.status !== 'available') { setStatus(result.status === 'unavailable' ? 'unavailable' : 'error'); return; }
      const current = getListingShareData(result.listing, result.event);
      setData(current.data);
      setStatus(current.data ? 'available' : 'unavailable');
    }).catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [listingId, attempt]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl;
    setAsset(null);
    setImageError(false);
    setNotice('');
    if (data) {
      import('@/lib/listingShareImage').then(({ createListingShareImage }) => createListingShareImage(data, format))
        .then(blob => {
          if (cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setAsset({ blob, url: objectUrl, format });
        }).catch(() => { if (!cancelled) setImageError(true); });
    }
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [data, format]);

  const file = asset && typeof File !== 'undefined'
    ? new File([asset.blob], `pg-listing-${listingId}-${asset.format}.png`, { type: 'image/png' }) : null;
  let canShareImage = false;
  try { canShareImage = Boolean(file && navigator.share && navigator.canShare?.({ files: [file] })); } catch { /* Save and copy remain available. */ }

  async function shareImage() {
    if (!file || !canShareImage || sharing) return;
    setSharing(true);
    setNotice('');
    try {
      // The PNG is prepared before this click, preserving the phone's user gesture.
      await navigator.share({ files: [file], title: data.title, text: `View this listing on Peanut Gallery: ${data.url}` });
    } catch (error) {
      setNotice(error?.name === 'AbortError' ? 'Sharing cancelled. Your image is still ready.' : 'Sharing is unavailable here. Save the image or copy the link below.');
    } finally { setSharing(false); }
  }

  async function copyLink() {
    setNotice('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(data.url);
      setNotice('Listing link copied.');
    } catch { setNotice('Select and copy the listing link below.'); }
  }

  return (
    <DialogContent className="pg-listing-share-dialog" overlayClassName="pg-listing-share-overlay">
      <header>
        <p className="pg-listing-share-eyebrow">Peanut Gallery / Seller desk</p>
        <DialogTitle className="font-display">Share your listing</DialogTitle>
        <DialogDescription>A ticket-stub image and a link straight to your listing.</DialogDescription>
      </header>

      {status === 'loading' && <div className="pg-listing-share-state" role="status"><RefreshCw className="animate-spin" aria-hidden="true" /><p>Checking your listing…</p></div>}
      {status === 'error' && <div className="pg-listing-share-state" role="alert"><p>We couldn’t check your listing. Try again before sharing.</p><button className="pg-action" onClick={() => setAttempt(value => value + 1)}>Try again</button></div>}
      {status === 'unavailable' && <div className="pg-listing-share-state" role="status"><p>This listing is not currently available to share. It may be reserved, paused or no longer available.</p><button className="pg-action" onClick={() => setAttempt(value => value + 1)}>Check again</button></div>}

      {status === 'available' && data && <>
        <fieldset className="pg-listing-share-formats" disabled={sharing}>
          <legend className="sr-only">Image format</legend>
          {['square', 'story'].map(value => <label key={value}>
            <input type="radio" name="listing-share-format" value={value} checked={format === value} onChange={() => setFormat(value)} />
            <span>{value === 'square' ? 'Square post' : 'Story'}</span>
          </label>)}
        </fieldset>
        <div className="pg-listing-share-preview" aria-busy={!asset && !imageError}>
          {asset ? <img src={asset.url} alt={`Listing preview for ${data.title}. Section ${data.section}, row ${data.row}. Not a ticket.`} />
            : imageError ? <p role="alert">The image couldn’t be prepared. You can still copy your listing link.</p>
              : <p role="status">Preparing your image…</p>}
        </div>
        <p className="pg-listing-share-caption">{format === 'square' ? '1080 × 1080' : '1080 × 1920'} · The QR opens your listing. This image cannot be used for admission.</p>
        <div className="pg-listing-share-actions">
          {canShareImage && <button className="pg-action pg-listing-share-primary" disabled={sharing} onClick={shareImage}><Share2 aria-hidden="true" />{sharing ? 'Sharing…' : 'Share image'}</button>}
          {asset && <a className={`pg-action ${canShareImage ? '' : 'pg-listing-share-primary'}`} href={asset.url} download={`pg-listing-${listingId}-${asset.format}.png`}><Download aria-hidden="true" />Save image</a>}
          <button className="pg-action" onClick={copyLink}><Copy aria-hidden="true" />Copy link</button>
        </div>
        <label className="pg-listing-share-link">Listing link<input readOnly value={data.url} onFocus={event => event.target.select()} /></label>
        <p className="pg-listing-share-note">Price and availability can change. The link checks the current listing when opened.</p>
        <p className="pg-listing-share-notice" role="status" aria-live="polite">{notice}</p>
      </>}
    </DialogContent>
  );
}
