/*
 * Service worker: computes 64-bit difference hashes (dHash) of product images so the content
 * script can tell which variant photo looks like the search thumbnail.
 * Runs here because the extension's host permissions let it read CDN images without CORS tainting.
 */
'use strict';

const cache = new Map(); // url -> Promise<string|null>
const MAX_CACHE = 3000;

function smallUrl(url) {
  let u = String(url || '').trim();
  if (!u) return null;
  if (u.startsWith('//')) u = 'https:' + u;
  u = u.replace(/^http:/, 'https:').replace(/\?.*$/, '');
  const m = u.match(/^(.*?\.(jpe?g|png|webp|gif))(?:_.*)?$/i);
  if (!m) return u;
  const ext = m[2].toLowerCase() === 'png' ? 'png' : 'jpg';
  return `${m[1]}_120x120.${ext}`;
}

async function dHash(url) {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const bmp = await createImageBitmap(await res.blob());
  const W = 9, H = 8;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(bmp, 0, 0, W, H);
  bmp.close && bmp.close();
  const px = ctx.getImageData(0, 0, W, H).data;
  const gray = (x, y) => { const i = (y * W + x) * 4; return px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114; };
  let hex = '';
  for (let y = 0; y < H; y++) {
    let byte = 0;
    for (let x = 0; x < 8; x++) byte = (byte << 1) | (gray(x, y) < gray(x + 1, y) ? 1 : 0);
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

function hashUrl(url) {
  if (cache.has(url)) return cache.get(url);
  const small = smallUrl(url);
  const p = !small ? Promise.resolve(null)
    : dHash(small).catch(() => (small !== url ? dHash(url.startsWith('//') ? 'https:' + url : url) : null)).catch(() => null);
  if (cache.size > MAX_CACHE) cache.clear();
  cache.set(url, p);
  return p;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'hash' || !Array.isArray(msg.urls)) return false;
  const urls = msg.urls.filter((u) => typeof u === 'string' && /aliexpress-media\.com|alicdn\.com/.test(u)).slice(0, 60);
  Promise.all(urls.map(hashUrl)).then((hs) => {
    const hashes = {};
    urls.forEach((u, i) => { if (hs[i]) hashes[u] = hs[i]; });
    sendResponse({ hashes });
  });
  return true; // async response
});
