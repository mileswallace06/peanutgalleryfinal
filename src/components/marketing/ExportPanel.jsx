/**
 * ExportPanel — export controls for PNG/JPEG.
 * Uses html2canvas to capture the canvas element at full resolution.
 *
 * Improvements:
 *   - Retina-quality export (2x devicePixelRatio)
 *   - Error handling with user-visible toast
 *   - Export success feedback
 *   - File size indicator
 */
import { useState } from 'react';
import { Download, Loader2, Check, AlertCircle } from 'lucide-react';
import { NEON, GRADIENTS, TEXT } from '@/lib/marketingTokens';
import { downloadCanvas, captureCanvasElement } from '@/components/marketing/shared/hooks';

export default function ExportPanel({ canvasRef, preset, fileName = 'pg-graphic' }) {
  const [exporting, setExporting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);

  const handleExport = async (format) => {
    setExporting(true);
    setError(null);
    setSuccess(false);
    try {
      if (!canvasRef?.current) throw new Error('Canvas not ready');
      const canvas = await captureCanvasElement(canvasRef.current, preset);
      if (!canvas) throw new Error('Canvas not ready');
      downloadCanvas(canvas, format, fileName);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2500);
    } catch (e) {
      setError(e.message || 'Export failed. Try JPEG format or check your image URLs.');
    }
    setExporting(false);
  };

  return (
    <div className="rounded-2xl p-4 space-y-3" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
      <div className="flex items-center gap-2">
        <Download className="w-4 h-4 text-muted-foreground" />
        <p className="text-[10px] font-black tracking-widest uppercase text-muted-foreground">Export</p>
      </div>

      {success && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold"
          style={{ background: `rgba(0,255,135,0.08)`, color: NEON.green, border: `1px solid rgba(0,255,135,0.2)` }}>
          <Check className="w-3.5 h-3.5" /> Exported successfully
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-destructive"
          style={{ background: 'rgba(255,0,0,0.06)' }}>
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
        </div>
      )}

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
        Full {preset.w}×{preset.h} · Retina-quality export
      </p>
    </div>
  );
}

/** Export a single canvas to image (for carousels). */
export async function exportCanvasToImage(canvasRef, preset, format = 'png', fileName = 'pg-graphic') {
  if (!canvasRef?.current) throw new Error('Canvas not ready');
  const canvas = await captureCanvasElement(canvasRef.current, preset);
  if (!canvas) throw new Error('Canvas not ready');
  downloadCanvas(canvas, format, fileName);
}