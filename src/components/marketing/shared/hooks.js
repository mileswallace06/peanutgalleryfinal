/**
 * Shared hooks and utilities for marketing builder pages.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import html2canvas from 'html2canvas';

/**
 * Auto-scaling preview hook.
 * Measures the preview container and computes a scale factor that fits
 * the canvas within it, capped at maxScale.
 */
export function usePreviewScale(preset, maxScale = 0.5) {
  const previewRef = useRef(null);
  const [scale, setScale] = useState(0.35);

  useEffect(() => {
    const update = () => {
      if (previewRef.current) {
        const containerWidth = previewRef.current.offsetWidth - 32;
        const s = Math.min(containerWidth / preset.w, maxScale);
        setScale(Math.max(0.1, s));
      }
    };
    update();
    // Use ResizeObserver for responsive recalculation (more reliable than window resize)
    const ro = new ResizeObserver(update);
    if (previewRef.current) ro.observe(previewRef.current);
    return () => ro.disconnect();
  }, [preset.w, preset.h, maxScale]);

  return { previewRef, scale };
}

/**
 * Shared html2canvas options — single source of truth for all export paths.
 * Any change here propagates to the hook, ExportPanel, and exportCanvasToImage.
 */
const CAPTURE_OPTIONS = {
  backgroundColor: '#050308',
  useCORS: true,
  allowTaint: true,
  logging: false,
  imageTimeout: 15000,
};

/**
 * Capture a DOM element to a canvas at retina quality.
 * Used by the hook below and by standalone export functions.
 */
export async function captureCanvasElement(element, preset) {
  if (!element) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return await html2canvas(element, {
    width: preset.w,
    height: preset.h,
    scale: dpr,
    ...CAPTURE_OPTIONS,
  });
}

/**
 * High-fidelity canvas capture for export.
 * Uses devicePixelRatio for retina-quality output (2x on retina screens).
 */
export function useCanvasCapture(preset) {
  const capture = useCallback(async (canvasRef) => {
    if (!canvasRef?.current) return null;
    return await captureCanvasElement(canvasRef.current, preset);
  }, [preset.w, preset.h]);

  return capture;
}

/**
 * Download a canvas element as an image file.
 */
export function downloadCanvas(canvas, format, fileName) {
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const quality = format === 'jpeg' ? 0.95 : undefined;
  const dataUrl = canvas.toDataURL(mime, quality);
  const link = document.createElement('a');
  link.download = `${fileName}-${Date.now()}.${format}`;
  link.href = dataUrl;
  link.click();
}