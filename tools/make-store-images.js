// Renders the Chrome Web Store images into store/images/ with headless Chrome:
//   screenshot-1-real-prices.png  1280x800  search results with real-price corners
//   screenshot-2-details.png      1280x800  a hovered corner with shipping and variant details
//   screenshot-3-progress.png     1280x800  the progress corners while cards are being checked
//   promo-tile-440x280.png         440x280  small promo tile
// Each scene is a demo page that runs the extension's real src/analyze.js, src/content.js and
// src/label.css against a scripted stand-in for src/bridge.js, so the corners are the genuine UI.
// Product photos and titles are real AliExpress listings; trick prices come from the README examples.
// Usage: node tools/make-store-images.js   (needs Google Chrome installed)
//        node tools/make-store-images.js --serve   (serve the demo pages for inspection instead)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'store', 'images');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const CHROME = [
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.error('Google Chrome not found.'); process.exit(1); }

const IMG = (id) => `https://ae-pic-a1.aliexpress-media.com/kf/${id}_480x480.jpg`;

// ---------- demo products ----------
// trick: [listed variant, listed price, real variant, real price]; ship: shipping fee (0 = free / not added)
const P = {
  toyKit: { id: '1005013130557216', img: IMG('Sef4bfdc5851248dab9f59f994bc135c2g.jpg'), title: 'Creative Building Blocks Soft Bullet Toy Pistol, DIY Foam Dart Gun Kit', sold: '1,000+ sold', choice: true, trick: ['20PCS bullets', 2.15, 'Blue Model A', 12.29] },
  pistol: { id: '1005011849049774', img: IMG('Seefb054217834845999117ae4c49402bu.jpg'), title: 'Toy Pistol Manual Handgun Foam Dart Blaster Shooting Model', sold: '600+ sold', choice: true, trick: ['24pcs', 4.22, '8689E', 23.99] },
  eagle: { id: '1005012910727845', img: IMG('S6d6ea260c2014e3bb60b759576f8d7821.jpg'), title: 'Desert Eagle Soft Bullet Toy Gun, Shell Ejection Foam Darts Pistol', sold: '300+ sold', ship: 1.99, trick: ['10sets', 4.49, 'White-Gold', 20.05] },
  m416a: { id: '1005007011779261', img: IMG('S52c41434103f4ab5be67de1dd27fdcfbx.jpg'), title: 'M416 Electric Gel Blaster Rifle, Manual/Auto Mode', sold: '202 sold', price: 40.19 },
  tec9: { id: '1005007011779262', img: IMG('S784d2c479aa449a487171f51beb49ab4W.jpg'), title: 'High-performance TEC-9 Gel Ball Toy Gun, Modular Battery', sold: '130 sold', price: 47.57, ship: 2.99 },
  blaster: { id: '1005007011779263', img: IMG('S8bdecd982b41443584add007392f07921.png'), title: 'Gel Blaster Electric Gun M416, Outdoor Shooting Toy', sold: '1,000+ sold', price: 34.16 },
  rifle: { id: '1005007011779264', img: IMG('S0e1760261a934556ac6d250239825bf5a.jpg'), title: 'M416 Electric Blaster Gun Toy, Rechargeable Automatic', sold: '500+ sold', price: 13.95 },
  m416b: { id: '1005007011779265', img: IMG('S4fe7dc4e3c444e2491fbf075db48ded47.jpg'), title: 'M416 Gun Toy Outdoor Electric Blaster, Gel Bullet Shooting', sold: '1,000+ sold', price: 37.18, ship: 3.49 },
  slr: { id: '1005007011779266', img: IMG('S8cb1d0c370ff43cd9b18049631c28852N.png'), title: 'SLR Nylon Electric Gel Ball Blasting Toy Gun', sold: '237 sold', price: 48.26 },
  ebb: { id: '1005007011779267', img: IMG('Sabfe6b8ed3e74aee9d559f399d4153d6E.jpg'), title: 'M416 Ultimate EBB Auto Gel Blaster, High Speed', sold: '600+ sold', price: 39.14 },
  plasma: { id: '1005007011779268', img: IMG('S8ef67a0604a040078bb2463d9e8d5ded8.jpg'), title: 'High Power Plasma Auto Gel Blaster with Scope', sold: '11 sold', price: 97.55 },
  m416c: { id: '1005007011779269', img: IMG('S1e357bd078744d9cb82ea0760f162bebd.jpg'), title: 'M416 Electric Gel Ball Blaster, High-Speed Summer Toy', sold: '124 sold', price: 30.46 },
};
const listed = (p) => (p.trick ? p.trick[1] : p.price);
const money = (n) => `US $${n.toFixed(2)}`;

/** Product data in the shape the bridge returns (see trim() in src/bridge.js). */
function pdpFor(p) {
  const variants = p.trick ? [[p.trick[0], p.trick[1]], [p.trick[2], p.trick[3]]] : [['Default', p.price]];
  return {
    currency: 'USD',
    SKU: {
      skuPaths: variants.map(([name], i) => ({ path: `14:${i + 1}`, skuAttr: `14:${i + 1}#${name}`, skuIdStr: `${p.id}${i + 1}`, salable: 'true' })),
      skuProperties: [],
    },
    PRICE: {
      skuIdStrPriceInfoMap: Object.fromEntries(variants.map(([, price], i) => {
        const [a, b] = price.toFixed(2).split('.');
        return [`${p.id}${i + 1}`, { salePriceString: money(price), salePriceLocal: `${money(price)}|${a}|${b}` }];
      })),
    },
    HEADER_IMAGE_PC: { imagePathList: [] },
    SHIPPING: { originalLayoutResultList: [{ bizData: p.ship ? { shippingFee: 'charge', displayAmount: String(p.ship), displayCurrency: 'USD' } : { shippingFee: 'free' } }] },
  };
}
const metaFor = (p) => ({ productId: p.id, skuId: `${p.id}1`, price: listed(p), currency: 'USD', choice: !!p.choice, bundle: false, freeShip: !p.ship, thumb: p.img });

// ---------- page pieces ----------
function card(p, size, extra = '') {
  return `<a class="search-card-item demo-card ${extra}" href="/item/${p.id}.html" style="width:${size}px">
    <div class="us--image--x demo-img" style="width:${size}px;height:${size}px"><img src="/img/${p.id}.jpg" alt=""></div>
    <div class="demo-title">${p.title}</div>
    <div class="us--price--x demo-price">${money(listed(p))}</div>
    <div class="demo-sold">★ 4.${(p.id.length * 7) % 9} · ${p.sold}</div>
  </a>`;
}

// Hover styles for a forced ".demo-hover" card (headless Chrome can't hover).
const labelCss = read('src/label.css');
const hoverCss = labelCss.replace(/\/\*[\s\S]*?\*\//g, '').split('}').filter((r) => r.includes('.pricepeel-card:hover'))
  .map((r) => r.replace(/\.pricepeel-card:hover/g, '.pricepeel-card.demo-hover') + '}').join('\n');

const BASE_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
  body { font-family: "Segoe UI", system-ui, -apple-system, sans-serif; background: #f2f3f5; color: #1d2530; }
  .scene { display: flex; width: 1280px; height: 800px; }
  .side { width: 400px; flex: none; padding: 64px 40px 48px 56px; background: linear-gradient(160deg, #3d5164, #26343f); color: #fff; display: flex; flex-direction: column; }
  .brand { display: flex; align-items: center; gap: 14px; font-size: 26px; font-weight: 700; letter-spacing: -0.01em; }
  .brand img { width: 52px; height: 52px; }
  .side h1 { font-size: 38px; line-height: 1.15; margin: 48px 0 18px; letter-spacing: -0.02em; }
  .side h1 em { font-style: normal; color: #ff9a2e; }
  .side p { font-size: 17px; line-height: 1.5; color: #d4dbe2; margin: 0 0 14px; }
  .side .foot { margin-top: auto; font-size: 12px; color: #9aa7b3; }
  .stage { flex: 1; display: flex; align-items: center; justify-content: center; position: relative; }
  .grid { display: grid; gap: 18px; }
  .demo-card { display: block; text-decoration: none; color: inherit; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .demo-img { position: relative; background: #eee; }
  .demo-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .demo-title { padding: 10px 12px 2px; font-size: 13px; line-height: 1.3; height: 40px; overflow: hidden; color: #333; }
  .demo-price { padding: 4px 12px 0; font-size: 19px; font-weight: 700; }
  .demo-sold { padding: 2px 12px 12px; font-size: 12px; color: #888; }
  .legend { display: grid; grid-template-columns: auto 1fr; gap: 10px 12px; align-items: center; font-size: 14px; color: #d4dbe2; margin-top: 8px; }
  .chip { width: 28px; height: 28px; position: relative; border-radius: 4px; background: #c9d6e2; overflow: hidden; }
  .chip .pricepeel-peel { width: 70% !important; animation: none !important; }
  /* Headless screenshots freeze CSS animations at their first frame, so show every corner in its
     final state: no animations or transitions, and a ring fixed at about half full. */
  *, *::before, *::after { animation: none !important; transition: none !important; }
  .pricepeel-ring-fill { stroke-dashoffset: 45 !important; }
`;

function page(title, body, script) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>${labelCss}</style><style>${hoverCss}</style><style>${BASE_CSS}</style></head>
<body>${body}
<script>${script}</script>
<script>${read('src/analyze.js')}</script>
<script>${read('src/content.js')}</script>
</body></html>`;
}

// Scripted stand-in for the bridge. plan[productId] = { meta, pdp, mode }:
//   mode 'done' (answer), 'loading' (start, never answer), 'queued' (never start), 'idle' (never answer "item"),
//   'paused' (answer "paused").
function bridgeScript(plan, { limitFor = 0 } = {}) {
  return `
const PLAN = ${JSON.stringify(plan)};
const send = (m) => window.postMessage(Object.assign({ src: 'pricepeel-bridge' }, m), location.origin);
${limitFor ? `setTimeout(() => send({ type: 'limit', until: Date.now() + ${limitFor} }), 50);` : ''}
window.addEventListener('message', (e) => {
  const d = e.data; if (!d || d.src !== 'pricepeel-content') return;
  const p = PLAN[d.productId]; if (!p) return;
  if (d.type === 'item') { if (p.mode !== 'idle') send({ id: d.id, ok: true, data: p.meta }); return; }
  if (d.type !== 'pdp') return;
  if (p.mode === 'done') { send({ type: 'started', id: d.id }); setTimeout(() => send({ id: d.id, ok: true, data: p.pdp }), 100); }
  else if (p.mode === 'loading') send({ type: 'started', id: d.id });
  else if (p.mode === 'paused') send({ id: d.id, ok: false, error: 'paused:' + (Date.now() + 9 * 60000) });
});`;
}
const planOf = (list, modes = {}) => Object.fromEntries(list.map((p) => [p.id, { meta: metaFor(p), pdp: pdpFor(p), mode: modes[p.id] || 'done' }]));
const icon = 'icons/icon-128.png';

// ---------- scenes ----------
const scenes = [];

{ // 1. results grid with real-price corners
  const cards = [P.toyKit, P.m416a, P.pistol, P.tec9, P.eagle, P.blaster];
  scenes.push({
    file: 'screenshot-1-real-prices.png', size: [1280, 800],
    html: page('PricePeel', `<div class="scene">
      <div class="side">
        <div class="brand"><img src="/${icon}">PricePeel</div>
        <h1>See what the photo <em>really</em> costs</h1>
        <p>Many AliExpress listings show the price of a cheap accessory next to a photo of the full product.</p>
        <p>PricePeel peels back the corner of each search result to reveal the real price of the item in the photo, plus shipping.</p>
        <div class="foot">Independent project, not affiliated with AliExpress.</div>
      </div>
      <div class="stage"><div class="grid" style="grid-template-columns: repeat(3, 250px)">${cards.map((p) => card(p, 250)).join('')}</div></div>
    </div>`, bridgeScript(planOf(cards))),
  });
}

{ // 2. hovered corner with details
  const cards = [P.m416a, P.toyKit, P.tec9];
  scenes.push({
    file: 'screenshot-2-details.png', size: [1280, 800],
    html: page('PricePeel', `<div class="scene">
      <div class="side">
        <div class="brand"><img src="/${icon}">PricePeel</div>
        <h1>Hover for the <em>details</em></h1>
        <p>The corner peels further to show the real price, the shipping and the total, and which variant the listed price was actually for.</p>
        <p>Knows the difference between a trick and a bigger pack: "10pcs" or a "set of 6" is just more of the same.</p>
        <div class="foot">Shipping is added for regular items, not for Choice or Bundle deals.</div>
      </div>
      <div class="stage"><div class="grid" style="grid-template-columns: repeat(3, 250px)">${
        cards.map((p) => card(p, 250, p === P.toyKit ? 'demo-hover-target' : '')).join('')}</div></div>
    </div>`, bridgeScript(planOf(cards)) + `
setTimeout(() => { const c = document.querySelector('.demo-hover-target'); if (c) c.classList.add('demo-hover'); }, 1500);`),
  });
}

{ // 3. progress corners
  const cards = [P.toyKit, P.slr, P.ebb, P.plasma, P.m416c, P.rifle];
  const modes = { [P.slr.id]: 'loading', [P.ebb.id]: 'queued', [P.plasma.id]: 'queued', [P.m416c.id]: 'queued', [P.rifle.id]: 'idle', [P.m416b.id]: 'idle' };
  const chip = (cls) => `<div class="chip"><div class="pricepeel-peel ${cls}"><div class="pricepeel-peel-under"><div class="pricepeel-peel-dots"><i></i><i></i><i></i></div><svg class="pricepeel-peel-ring" viewBox="0 0 12 12"><circle class="pricepeel-ring-track" cx="6" cy="6" r="4.5"/><circle class="pricepeel-ring-fill" cx="6" cy="6" r="4.5" pathLength="100" style="stroke-dashoffset:45;animation:none"/></svg></div><svg class="pricepeel-peel-flap" viewBox="0 0 100 100" preserveAspectRatio="none"><path fill="#eee" d="M0 0 C24 0 100 76 100 100 C96 84 70 71 30 70 C29 30 16 4 0 0 Z"/></svg></div></div>`;
  scenes.push({
    file: 'screenshot-3-progress.png', size: [1280, 800],
    html: page('PricePeel', `<div class="scene">
      <div class="side">
        <div class="brand"><img src="/${icon}">PricePeel</div>
        <h1>Checks what you <em>look at</em></h1>
        <p>Only products you scroll to are checked, results are cached for a day, and PricePeel stays within AliExpress's request limits.</p>
        <div class="legend">
          ${chip('pricepeel-mini pricepeel-state-idle')}<span>Not checked yet</span>
          ${chip('pricepeel-mini pricepeel-state-queued')}<span>Waiting its turn</span>
          ${chip('pricepeel-mini pricepeel-state-limited')}<span>Waiting for AliExpress's per-minute limit</span>
          ${chip('pricepeel-mini pricepeel-state-loading')}<span>Checking now</span>
        </div>
        <div class="foot">Product details come straight from AliExpress, in your browser. Nothing is sent anywhere else.</div>
      </div>
      <div class="stage"><div class="grid" style="grid-template-columns: repeat(3, 250px)">${cards.map((p) => card(p, 250)).join('')}</div></div>
    </div>`, bridgeScript(planOf(cards, modes), { limitFor: 34000 })),
  });
}

{ // promo tile
  scenes.push({
    file: 'promo-tile-440x280.png', size: [440, 280],
    html: `<!doctype html><html><head><meta charset="utf-8"><style>
      html, body { margin: 0; width: 440px; height: 280px; overflow: hidden; }
      body { font-family: "Segoe UI", system-ui, sans-serif; background: linear-gradient(150deg, #43586c, #26343f); color: #fff;
             display: flex; align-items: center; gap: 24px; padding: 0 34px; box-sizing: border-box; }
      img { width: 128px; height: 128px; flex: none; filter: drop-shadow(0 6px 14px rgba(0,0,0,0.35)); }
      h1 { margin: 0 0 8px; font-size: 42px; letter-spacing: -0.02em; }
      p { margin: 0; font-size: 19px; line-height: 1.3; color: #ffb25e; font-weight: 600; }
    </style></head><body><img src="/${icon}"><div><h1>PricePeel</h1><p>Real prices for<br>AliExpress</p></div></body></html>`,
  });
}

// ---------- render ----------
// AliExpress's image servers only answer requests that come from AliExpress pages, so fetch each
// product photo once (with AliExpress as the referrer) and serve it from the local server.
async function loadImages() {
  const imgs = new Map();
  for (const p of Object.values(P)) {
    const res = await fetch(p.img, { headers: { Referer: 'https://www.aliexpress.com/' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${p.img}`);
    imgs.set(`/img/${p.id}.jpg`, Buffer.from(await res.arrayBuffer()));
  }
  return imgs;
}
fs.mkdirSync(outDir, { recursive: true });
const pages = new Map(scenes.map((s, i) => [`/scene-${i}.html`, s.html]));
let images = new Map();
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (images.has(url)) { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(images.get(url)); }
  if (pages.has(url)) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(pages.get(url)); }
  const file = path.join(root, url);
  if (url.startsWith('/icons/') && fs.existsSync(file)) { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(fs.readFileSync(file)); }
  res.writeHead(404); res.end();
});
// Chrome is launched asynchronously: this same process serves the demo pages it loads.
const runChrome = (args) => new Promise((resolve, reject) => {
  execFile(CHROME, args, { timeout: 60000 }, (err) => (err ? reject(err) : resolve()));
});
server.listen(0, '127.0.0.1', async () => {
  images = await loadImages();
  const port = server.address().port;
  // --serve: keep the demo pages running for inspection in a browser instead of rendering.
  if (process.argv.includes('--serve')) {
    console.log(`Demo pages: ${[...pages.keys()].map((p) => `http://127.0.0.1:${port}${p}`).join('  ')}`);
    return;
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pricepeel-chrome-'));
  for (const [i, s] of scenes.entries()) {
    const out = path.join(outDir, s.file);
    await runChrome([
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${profile}`, `--window-size=${s.size[0]},${s.size[1]}`, '--force-device-scale-factor=1',
      '--virtual-time-budget=4000', `--screenshot=${out}`, `http://127.0.0.1:${port}/scene-${i}.html`,
    ]);
    console.log('wrote', path.relative(root, out));
  }
  server.close();
  fs.rmSync(profile, { recursive: true, force: true });
});
