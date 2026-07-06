/**
 * AssetUploader — image upload using UploadFile integration.
 *
 * Improvements:
 *   - File size validation (10MB max)
 *   - File type validation
 *   - Drag-and-drop support
 *   - Better loading and error states
 *   - Replace image option (not just remove)
 */
import { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, ImagePlus, X, Upload, AlertCircle } from 'lucide-react';
import { NEON, NEON_RGB } from '@/lib/marketingTokens';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];

export default function AssetUploader({ value, onChange, label = 'Image / Screenshot' }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const validateFile = (file) => {
    if (!file) return 'No file selected';
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return 'Please use PNG, JPEG, WebP, or GIF';
    }
    if (file.size > MAX_FILE_SIZE) {
      return 'File too large (max 10MB)';
    }
    return null;
  };

  const handleUpload = async (file) => {
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      onChange(file_url);
    } catch (err) {
      setError(err.message || 'Upload failed. Please try again.');
    }
    setUploading(false);
  };

  const handleInputChange = (e) => {
    const file = e.target.files[0];
    if (file) handleUpload(file);
    // Reset so re-selecting the same file still fires onChange
    e.target.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  };

  if (value) {
    return (
      <div>
        <label className="text-[10px] font-black tracking-widest uppercase text-muted-foreground block mb-2">{label}</label>
        <div className="relative group">
          <img src={value} alt="Uploaded asset" className="w-full rounded-xl" style={{ maxHeight: 160, objectFit: 'cover' }} />
          <div className="absolute inset-0 rounded-xl flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: 'rgba(0,0,0,0.6)' }}>
            <button onClick={() => inputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold text-white"
              style={{ background: `rgba(${NEON_RGB.cyan}, 0.3)`, border: `1px solid rgba(${NEON_RGB.cyan}, 0.5)` }}>
              <Upload className="w-3 h-3" /> Replace
            </button>
            <button onClick={() => onChange('')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold text-white"
              style={{ background: 'rgba(255,45,120,0.3)', border: '1px solid rgba(255,45,120,0.5)' }}>
              <X className="w-3 h-3" /> Remove
            </button>
          </div>
          <input ref={inputRef} type="file" accept={ACCEPTED_TYPES.join(',')} className="hidden" onChange={handleInputChange} />
        </div>
        {error && (
          <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-destructive">
            <AlertCircle className="w-3 h-3" /> {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <label className="text-[10px] font-black tracking-widest uppercase text-muted-foreground block mb-2">{label}</label>
      <div
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className="flex flex-col items-center justify-center gap-1.5 py-8 rounded-xl cursor-pointer transition-all"
        style={{
          border: `2px dashed ${dragOver ? NEON.cyan : 'hsl(var(--border))'}`,
          background: dragOver ? `rgba(${NEON_RGB.cyan}, 0.06)` : 'transparent',
        }}
      >
        {uploading ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: NEON.cyan }} />
            <span className="text-[10px] text-muted-foreground">Uploading...</span>
          </>
        ) : (
          <>
            <ImagePlus className="w-6 h-6 text-muted-foreground" />
            <span className="text-[10px] font-bold text-foreground">Tap to upload or drag & drop</span>
            <span className="text-[9px] text-muted-foreground">PNG, JPEG, WebP · max 10MB</span>
          </>
        )}
        <input ref={inputRef} type="file" accept={ACCEPTED_TYPES.join(',')} className="hidden" onChange={handleInputChange} />
      </div>
      {error && (
        <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-destructive">
          <AlertCircle className="w-3 h-3" /> {error}
        </div>
      )}
    </div>
  );
}