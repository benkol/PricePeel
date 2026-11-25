// Draws the extension icon (a slate tile whose top-right corner curls back to reveal an orange
// layer, like the price label, with a shopping bag on the gray) and writes PNGs with no dependencies:
//   icons/icon-16.png, icon-32.png, icon-48.png, icon-128.png  (extension icons)
//   icons/app-logo-100.png                                      (AliExpress Open Platform app logo)
// Usage: node tools/make-icons.js            (or --preview <file.png> for a 512 px check)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------- geometry (unit square, y down) ----------
function bezier(p0, p1, p2, p3, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return pts;
}
function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// The peel lives in a square of side S at the tile's top-right corner, in the same 0..100
// coordinates as the label's SVG flap (see src/content.js) and clip-path (src/label.css).
const S = 0.68; // size of the peeled corner, as a share of the tile
const toTile = ([u, v]) => [1 - S + (u / 100) * S, (v / 100) * S];
const fold = bezier([0, 0], [24, 0], [100, 76], [100, 100], 40);
const revealed = [[0, 0], [100, 0], [100, 100], ...fold.slice().reverse()].map(toTile);
const flap = [
  ...fold,
  ...bezier([100, 100], [96, 84], [70, 71], [30, 70], 30).slice(1),
  ...bezier([30, 70], [29, 30], [16, 4], [0, 0], 30).slice(1),
].map(toTile);

const foldTile = fold.map(toTile);
const R = 0.2; // tile corner radius
function inRoundRect(x, y) {
  const m = 0.03;
  const lo = m, hi = 1 - m;
  if (x < lo || x > hi || y < lo || y > hi) return false;
  const cx = Math.min(Math.max(x, lo + R), hi - R);
  const cy = Math.min(Math.max(y, lo + R), hi - R);
  return (x - cx) ** 2 + (y - cy) ** 2 <= R * R;
}

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => c1.map((v, i) => lerp(v, c2[i], t));
function gradStops(stops, t) {
  t = Math.min(1, Math.max(0, t));
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
      return mix(c0, c1, (t - t0) / (t1 - t0 || 1));
    }
  }
  return stops[stops.length - 1][1];
}
const ORANGE_A = [255, 160, 60], ORANGE_B = [235, 100, 0];
const DARK_A = [86, 107, 128], DARK_B = [38, 52, 66];
const FLAP = [[0, [242, 242, 242]], [0.35, [255, 255, 255]], [0.68, [228, 228, 228]], [0.9, [171, 171, 171]], [1, [140, 140, 140]]];
// flap gradient axis: tip (30,70) -> fold middle (59,41), in tile coordinates
const [fx0, fy0] = toTile([30, 70]), [fx1, fy1] = toTile([59, 41]);

// ---------- a shopping bag on the gray tile ----------
// A white bag (body with softly rounded corners, slightly wider at the bottom) and a loop handle,
// centred on the tile; the curl overlaps its top-right a little.
const BAG = { cx: 0.5, top: 0.37, bottom: 0.79, halfTop: 0.2, halfBottom: 0.225, radius: 0.044 };
const HANDLE = { r: 0.1, stroke: 0.04 };
function inBagBody(x, y) {
  const { cx, top, bottom, halfTop, halfBottom, radius } = BAG;
  if (y < top || y > bottom) return false;
  const half = halfTop + ((halfBottom - halfTop) * (y - top)) / (bottom - top); // gentle taper
  const dx = Math.abs(x - cx);
  if (dx > half) return false;
  // round the four corners
  const ry = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y;
  const rx = dx > half - radius ? half - radius : dx;
  return (dx - rx) ** 2 + (y - ry) ** 2 <= radius * radius;
}
function inBagHandle(x, y) {
  if (y > BAG.top + 0.01) return false; // only the arch above the bag
  const d = Math.hypot(x - BAG.cx, y - BAG.top);
  return Math.abs(d - HANDLE.r) <= HANDLE.stroke / 2;
}

// ---------- the curl's shadow ----------
// The lifted paper casts a soft shadow down and to the left, onto the tile and the bag: the flap's
// shape shifted by SHADOW_OFFSET and blurred over SHADOW_BLUR. Along the fold, the curl also shades
// the revealed orange a little.
const SHADOW_OFFSET = [-0.022, 0.03];
const SHADOW_BLUR = 0.045;
const SHADOW_STRENGTH = 0.45;
const flapClosed = [...flap, flap[0]];
const flapMinX = Math.min(...flap.map((p) => p[0])), flapMaxY = Math.max(...flap.map((p) => p[1]));
function shadowAt(x, y) {
  const sx = x - SHADOW_OFFSET[0], sy = y - SHADOW_OFFSET[1]; // where the shadow-casting flap would be
  if (sx < flapMinX - SHADOW_BLUR || sy > flapMaxY + SHADOW_BLUR) return 0; // far away: skip the maths
  if (inPoly(sx, sy, flap)) return 1;
  const d = distToPolyline(sx, sy, flapClosed);
  return d >= SHADOW_BLUR ? 0 : (1 - d / SHADOW_BLUR) ** 2;
}
function distToPolyline(px, py, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
    const dx = x2 - x1, dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy)));
  }
  return best;
}
const darken = (c, k) => c.map((v) => v * (1 - k));

function shade(x, y) {
  if (!inRoundRect(x, y)) return null;
  if (inPoly(x, y, flap)) {
    const dx = fx1 - fx0, dy = fy1 - fy0;
    const t = ((x - fx0) * dx + (y - fy0) * dy) / (dx * dx + dy * dy);
    return gradStops(FLAP, t);
  }
  if (inPoly(x, y, revealed)) {
    // The revealed price layer is orange, like the label's price corners, a little darker at the fold.
    const d = Math.hypot(1 - x, y) / (S * 1.1);
    const c = mix(ORANGE_A, ORANGE_B, Math.min(1, d));
    const nearFold = distToPolyline(x, y, foldTile);
    return nearFold < 0.04 ? darken(c, 0.22 * (1 - nearFold / 0.04) ** 2) : c;
  }
  // The tile itself is slate gray, like a photo with its corner peeled back, with a shopping bag.
  const base = inBagBody(x, y) || inBagHandle(x, y) ? [246, 247, 249] : mix(DARK_A, DARK_B, (x + y) / 2);
  const sh = shadowAt(x, y);
  return sh ? darken(base, SHADOW_STRENGTH * sh) : base;
}

function render(size) {
  const SS = 4; // supersampling per axis
  const px = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = shade((pxl + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 1; }
        }
      }
      const i = (py * size + pxl) * 4;
      if (a) { px[i] = Math.round(r / a); px[i + 1] = Math.round(g / a); px[i + 2] = Math.round(b / a); }
      px[i + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  return encodePng(size, size, px);
}

// ---------- minimal PNG encoder (RGBA, 8-bit) ----------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// node tools/make-icons.js --preview <file.png>  -> writes a 512 px copy for checking the design
const pi = process.argv.indexOf('--preview');
if (pi > 0) {
  fs.writeFileSync(process.argv[pi + 1], render(512));
  console.log('wrote preview', process.argv[pi + 1]);
  process.exit(0);
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const s of [16, 32, 48, 128]) fs.writeFileSync(path.join(outDir, `icon-${s}.png`), render(s));
fs.writeFileSync(path.join(outDir, 'app-logo-100.png'), render(100));
console.log('wrote icons to', outDir);
