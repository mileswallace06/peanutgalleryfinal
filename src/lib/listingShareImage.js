import QRCode from 'qrcode';
import { cleanShareText, getListingShareUrl } from './listingShare.js';

export const LISTING_SHARE_FORMATS = Object.freeze({
  square: Object.freeze({ width: 1080, height: 1080 }),
  story: Object.freeze({ width: 1080, height: 1920 }),
});

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wordsToLines(ctx, value, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of value.split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) { line = candidate; continue; }
    if (line) lines.push(line);
    line = '';
    // Handles very long words/identifiers without painting outside the ticket.
    for (const character of Array.from(word)) {
      if (line && ctx.measureText(line + character).width > maxWidth) { lines.push(line); line = ''; }
      line += character;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function textBlock(ctx, value, x, y, width, { size = 32, minSize = size, maxLines = 2, lineHeight = 1.2, weight = 400, color = '#e8dfd4' } = {}) {
  let fontSize = size;
  let lines;
  do {
    ctx.font = `${weight} ${fontSize}px Arial, sans-serif`;
    lines = wordsToLines(ctx, value, width);
    if (lines.length <= maxLines || fontSize <= minSize) break;
    fontSize -= 2;
  } while (fontSize >= minSize);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(`${last}…`).width > width) last = Array.from(last).slice(0, -1).join('');
    lines[maxLines - 1] = `${last}…`;
  }
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * fontSize * lineHeight));
  return lines.length * fontSize * lineHeight;
}

function grain(ctx, x, y, width, height, seed = 811) {
  // Deterministic paper flecks, generated locally; no images or network access.
  let n = seed;
  const random = () => { n = (n * 1664525 + 1013904223) >>> 0; return n / 4294967296; };
  ctx.save();
  for (let i = 0; i < width * height / 70; i += 1) {
    ctx.fillStyle = i % 2 ? 'rgba(255,245,225,0.055)' : 'rgba(0,0,0,0.075)';
    ctx.fillRect(x + random() * width, y + random() * height, 1 + random() * 1.5, 1);
  }
  ctx.restore();
}

function drawQR(ctx, url, x, y, boxSize) {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const quiet = 4;
  const modules = qr.modules.size;
  const scale = Math.floor(boxSize / (modules + quiet * 2));
  if (scale < 2) throw new Error('The listing link is too long for a readable share code.');
  const size = (modules + quiet * 2) * scale;
  const left = Math.round(x + (boxSize - size) / 2);
  const top = Math.round(y + (boxSize - size) / 2);
  ctx.fillStyle = '#faf7f0';
  ctx.fillRect(left, top, size, size);
  ctx.fillStyle = '#17151c';
  for (let row = 0; row < modules; row += 1) {
    for (let col = 0; col < modules; col += 1) {
      if (qr.modules.get(row, col)) ctx.fillRect(left + (col + quiet) * scale, top + (row + quiet) * scale, scale, scale);
    }
  }
}

/**
 * Local PNG export of the explicit public share model only.
 * canvasFactory(width,height) is optional for offline rendering tests; browsers use
 * document.createElement. No remote artwork, fonts, screenshot DOM, or ticket files.
 */
export async function createListingShareImage(data, format = 'square', { canvasFactory } = {}) {
  if (!LISTING_SHARE_FORMATS[format]) throw new Error('Choose a square post or story image.');
  if (!data || getListingShareUrl(data.id) !== data.url) throw new Error('The listing link could not be confirmed.');
  const { width, height } = LISTING_SHARE_FORMATS[format];
  const canvas = canvasFactory ? canvasFactory(width, height) : document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image creation is unavailable on this device.');
  const story = format === 'story';
  const ink = '#eee4d8';
  const muted = '#c7bdb4';
  const accent = data.isUpgrade ? '#8ad3b0' : '#e7af83';
  const face = data.isUpgrade ? '#263d36' : '#443531';
  const edge = data.isUpgrade ? '#354b42' : '#56423a';
  ctx.fillStyle = '#19161e';
  ctx.fillRect(0, 0, width, height);
  grain(ctx, 0, 0, width, height, 721);

  // Brand mark is original typography; colored rules keep the artwork recognizably PG.
  const brandY = story ? 264 : 71;
  ctx.fillStyle = '#ac89cf'; ctx.fillRect(70, brandY - 21, 5, 54);
  ctx.fillStyle = '#8ad3b0'; ctx.fillRect(77, brandY - 21, 5, 54);
  textBlock(ctx, 'PEANUT', 100, brandY, 340, { size: 27, weight: 900, maxLines: 1, color: ink });
  textBlock(ctx, 'GALLERY', 100, brandY + 30, 340, { size: 27, weight: 900, maxLines: 1, color: ink });
  textBlock(ctx, 'FANS MAKE THE MOMENT.', 619, brandY + 11, 390, { size: 20, weight: 700, maxLines: 1, color: muted });

  // The story composition keeps every essential element outside platform UI zones.
  const y = story ? 409 : 166;
  const h = story ? 1110 : 734;
  const x = 64;
  const w = 952;
  const split = 765;
  const r = 24;
  ctx.save();
  roundedRect(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.fillStyle = face; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = edge; ctx.fillRect(split, y, x + w - split, h);
  grain(ctx, x, y, w, h);
  ctx.fillStyle = accent; ctx.fillRect(x, y, 9, h);
  ctx.strokeStyle = data.isUpgrade ? 'rgba(138,211,176,0.10)' : 'rgba(231,175,131,0.10)';
  ctx.lineWidth = 1;
  for (let offset = -h; offset < w; offset += 26) {
    ctx.beginPath(); ctx.moveTo(x + offset, y); ctx.lineTo(x + offset + h, y + h); ctx.stroke();
  }
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = 'rgba(232,219,205,0.35)'; ctx.lineWidth = 2; ctx.setLineDash([4, 10]);
  ctx.beginPath(); ctx.moveTo(split, y + 32); ctx.lineTo(split, y + h - 32); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#19161e';
  for (const cy of [y, y + h]) { ctx.beginPath(); ctx.arc(split, cy, 23, 0, Math.PI * 2); ctx.fill(); }

  const left = 107;
  const mainWidth = 612;
  textBlock(ctx, cleanShareText(data.kindLabel, 40).toUpperCase(), left, y + 57, mainWidth, { size: 22, weight: 700, maxLines: 1, color: accent });
  const titleTop = y + (story ? 153 : 123);
  textBlock(ctx, cleanShareText(data.title, 150), left, titleTop, mainWidth, {
    size: story ? 72 : 63, minSize: story ? 54 : 42, maxLines: story ? 4 : 3, lineHeight: 1.08, weight: 900, color: ink,
  });
  const dateY = y + (story ? 488 : 316);
  textBlock(ctx, cleanShareText(data.dateLabel, 110), left, dateY, mainWidth, { size: 27, minSize: 24, maxLines: 2, color: ink });
  const venueY = dateY + (story ? 105 : 90);
  textBlock(ctx, cleanShareText(data.venue, 90), left, venueY, mainWidth, { size: 34, minSize: 28, maxLines: 2, weight: 700, color: ink });
  textBlock(ctx, cleanShareText(data.city, 82), left, venueY + 78, mainWidth, { size: 25, minSize: 22, maxLines: 1, color: muted });

  const seatY = y + (story ? 790 : 534);
  ctx.strokeStyle = 'rgba(232,219,205,0.23)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(left, seatY - 33); ctx.lineTo(left + mainWidth, seatY - 33); ctx.stroke();
  const fields = [['SECTION', cleanShareText(data.section, 32) || 'See listing'], ['ROW', cleanShareText(data.row, 24) || 'See listing'], ['TICKETS', `${data.quantity}`]];
  fields.forEach(([label, value], i) => {
    const colX = left + i * 210;
    textBlock(ctx, label, colX, seatY, 194, { size: 17, weight: 700, maxLines: 1, color: muted });
    textBlock(ctx, value, colX, seatY + 42, 192, { size: 34, minSize: 24, maxLines: 1, weight: 700, color: ink });
  });
  const priceY = y + h - (story ? 122 : 78);
  textBlock(ctx, cleanShareText(data.priceLabel, 40), left, priceY, mainWidth, { size: 57, minSize: 42, maxLines: 1, weight: 900, color: accent });
  textBlock(ctx, 'per ticket + fees · USD', left, priceY + 34, mainWidth, { size: 23, maxLines: 1, color: muted });
  if (data.isUpgrade) textBlock(ctx, 'Upgrade only. Event admission required.', left, priceY + 69, mainWidth, { size: 19, maxLines: 1, color: muted });

  const qrY = y + (story ? 414 : 235);
  textBlock(ctx, 'ON PG', 807, y + 60, 170, { size: 23, weight: 700, maxLines: 1, color: accent });
  drawQR(ctx, data.url, 785, qrY, 211);
  textBlock(ctx, 'VIEW LISTING', 798, qrY + 259, 206, { size: 22, weight: 700, maxLines: 1, color: ink });
  textBlock(ctx, 'Scan for current price & availability.', 798, qrY + 300, 189, { size: 20, maxLines: 3, color: muted });
  textBlock(ctx, 'PG', 800, y + h - 44, 195, { size: 96, weight: 900, maxLines: 1, color: 'rgba(232,219,205,0.15)' });

  const footerY = y + h + 51;
  textBlock(ctx, 'Listing preview · Not a ticket', 70, footerY, 940, { size: 24, weight: 700, maxLines: 1, color: ink });
  textBlock(ctx, 'peanutgallery.store', 70, footerY + 40, 940, { size: 25, weight: 700, maxLines: 1, color: '#ac89cf' });
  textBlock(ctx, 'Price and availability may change. Open the listing before buying.', 70, footerY + 75, 940, { size: 20, maxLines: 2, color: muted });

  if (typeof canvas.toBlob === 'function') {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The image could not be saved.')), 'image/png'));
  }
  if (typeof canvas.toBuffer === 'function') return new Blob([canvas.toBuffer('image/png')], { type: 'image/png' });
  throw new Error('Image export is unavailable on this device.');
}
