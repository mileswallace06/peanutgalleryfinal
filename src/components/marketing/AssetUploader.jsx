/**
 * AssetUploader — image upload using UploadFile integration.
 * Styled with the same dashed-border pattern as CreateListing.
 */
import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, ImagePlus, X } from 'lucide-react';

export default function AssetUploader({ value, onChange, label = 'Image / Screenshot' }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      onChange(file_url);
    } catch (err) {
      setError(err.message || 'Upload failed');
    }
    setUploading(false);
  };

  return (
    <div>
      <label className="text-[10px] font-black tracking-widest uppercase text-muted-foreground block mb-2">{label}</label>
      {value ? (
        <div className="relative">
          <img src={value} alt="" className="w-full rounded-xl" style={{ maxHeight: 140, objectFit: 'cover' }} />
          <button
            onClick={() => onChange('')}
            className="absolute top-1 right-1 w-7 h-7 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.7)' }}
          >
            <X className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
      ) : (
        <label
          className="flex flex-col items-center justify-center gap-1 py-6 rounded-xl cursor-pointer transition-colors hover:bg-muted/50"
          style={{ border: '1px dashed hsl(var(--border))' }}
        >
          {uploading ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          ) : (
            <ImagePlus className="w-5 h-5 text-muted-foreground" />
          )}
          <span className="text-[10px] text-muted-foreground">
            {uploading ? 'Uploading...' : 'Upload image'}
          </span>
          <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
        </label>
      )}
      {error && <p className="text-[10px] text-destructive mt-1">{error}</p>}
    </div>
  );
}