/**
 * ExportPanel — export controls for PNG/JPEG.
 * Uses html2canvas to capture the canvas element at full resolution.
 * Styled with the same card + button patterns as the rest of the app.
 */
import { useState } from 'react';
import html2canvas from 'html2canvas';
import { Download, Loader2 } from 'lucide-react';
import { NEON, NEON_RGB, GRADIENTS, TEXT } from '@/lib/marketingTokens';

export default function ExportPanel({ canvasRef, preset, fileName = 'pg-graphic' }) {
  const [exporting, setExporting] = useState(false);

  const captureCanvas = async () => {
    if (!canvasRef.current) return null;
    return await html2canvas(canvasRef.current, {
      width: preset.w,
      height: preset.h,
      scale: 1,
      backgroundColor: '#050308',
      useCORS: true,
      logging: false,
    });
  };

  const handleExport = async (format) => {
    setExporting(true);
    try {
      const canvas = await captureCanvas();
      if (!canvas) return;
      const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
      const quality = format === 'jpeg' ? 0.95 : undefined;
      const dataUrl = canvas.toDataURL(mime, quality);
      const link = document.createElement('a');
      link.download = `${fileName}-${Date.now()}.${format}`;
      link.href = dataUrl;
      link.click();
    } catch (e) {
      console.error('Export failed:', e);
    }
    setExporting(false);
  };

  return (
    <div className="rounded-2xl p-4 space-y-3" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
      <div className="flex items-center gap-2">
        <Download className="w-4 h-4 text-muted-foreground" />
        <p className="text-[10px] font-black tracking-widest uppercase text-muted-foreground">Export</p>
      </div>
      {exporting ? (
        <div className="flex items-center justify-center gap-2 py-4">
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: NEON.cyan }} />
          <span className="text-xs text-muted-foreground">Rendering at {preset.w}×{preset.h}...</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => handleExport('png')}
            className="flex items-center justify-center gap-1.5 py-3 rounded-xl text-xs font-black transition-all active:scale-95"
            style={{ background: GRADIENTS.cta_primary, color: TEXT.dark }}
          >
            <Download className="w-3.5 h-3.5" /> PNG
          </button>
          <button
            onClick={() => handleExport('jpeg')}
            className="flex items-center justify-center gap-1.5 py-3 rounded-xl text-xs font-black transition-all active:scale-95"
            style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--foreground))', border: '1px solid hsl(var(--border))' }}
          >
            <Download className="w-3.5 h-3.5" /> JPEG
          </button>
        </div>
      )}
      <p className="text-[9px] text-muted-foreground text-center">
        Exports at full {preset.w}×{preset.h} resolution
      </p>
    </div>
  );
}

/** Export multiple canvases (for carousels). */
export async function exportCanvasToImage(canvasRef, preset, format = 'png', fileName = 'pg-graphic') {
  if (!canvasRef.current) return;
  const canvas = await html2canvas(canvasRef.current, {
    width: preset.w, height: preset.h, scale: 1,
    backgroundColor: '#050308', useCORS: true, logging: false,
  });
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const dataUrl = canvas.toDataURL(mime, format === 'jpeg' ? 0.95 : undefined);
  const link = document.createElement('a');
  link.download = `${fileName}-${Date.now()}.${format}`;
  link.href = dataUrl;
  link.click();
}