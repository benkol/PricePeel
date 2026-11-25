// Runs src/bridge.js in a tiny fake page to check lookup pacing, cancelling and the anti-bot pause.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'bridge.js'), 'utf8');

function makePage({ mtop, seed = {} }) {
  const listeners = [];
  const store = new Map(Object.entries(seed));
  const replies = [];
  const started = [];
  const limits = [];
  const window = {
    location: { origin: 'https://he.aliexpress.com', host: 'he.aliexpress.com' },
    addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); },
    postMessage: (data) => {
      if (data && data.src === 'pricepeel-bridge') {
        // "started" notices are progress updates, not replies.
        (data.type === 'started' ? started : data.type === 'limit' ? limits : replies).push({ ...data, at: Date.now() });
        return;
      }
      setImmediate(() => listeners.forEach((fn) => fn({ source: window, data })));
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    lib: { mtop },
  };
  const observers = [];
  let popup = null; // what document.querySelector('.J_MIDDLEWARE_FRAME_WIDGET') returns
  const document = {
    cookie: 'aep_usuc_f=site%3Disr%26c_tp%3DUSD%26region%3DIL%26b_locale%3Den_US',
    addEventListener() {},
    documentElement: {},
    querySelector: (sel) => (sel === '.J_MIDDLEWARE_FRAME_WIDGET' ? popup : null),
  };
  class MutationObserver { constructor(cb) { observers.push(cb); } observe() {} }
  const ctx = {
    window,
    document,
    MutationObserver,
    location: window.location,
    localStorage: window.localStorage,
    setTimeout, clearTimeout, setImmediate, URLSearchParams, JSON, Date, Math, Promise,
    XMLHttpRequest: undefined,
  };
  ctx.globalThis = ctx;
  window.window = window;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const send = (msg) => window.postMessage({ src: 'pricepeel-content', ...msg });
  const waitFor = async (pred, ms = 8000) => {
    const t0 = Date.now();
    while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 20)); }
  };
  const showPopup = () => {
    popup = { style: { display: 'block' }, querySelector: (sel) => (/punish/.test(sel) ? {} : null) };
    observers.forEach((cb) => cb([]));
  };
  return { send, replies, started, limits, store, waitFor, showPopup };
}

const okResult = { data: { result: { SKU: { skuPaths: [], skuProperties: [] }, PRICE: { skuIdStrPriceInfoMap: {} } } } };

function trackingMtop(ms) {
  const t = { running: 0, max: 0, starts: [] };
  t.mtop = { request: async () => {
    t.starts.push(Date.now()); t.running++; t.max = Math.max(t.max, t.running);
    await new Promise((r) => setTimeout(r, ms));
    t.running--; return okResult;
  } };
  return t;
}

test('a fresh page: lookups start quickly, at most 2 at a time, topmost card first', async () => {
  const t = trackingMtop(400);
  const page = makePage({ mtop: t.mtop });
  // Sent bottom-up; the bridge should start with the smallest rank (top of the page).
  for (let i = 6; i >= 1; i--) page.send({ id: 'r' + i, type: 'pdp', productId: '100' + i, rank: i * 100 });
  await page.waitFor(() => page.replies.length === 6, 8000);
  assert.equal(t.max, 2);
  const span = t.starts[t.starts.length - 1] - t.starts[0];
  assert.ok(span < 2500, 'six lookups took ' + span + 'ms to start');
  // The first request starts as soon as it arrives; the rest wait in the queue and go top-down.
  assert.equal(page.replies[0].id, 'r6');
  assert.deepEqual(page.replies.slice(1).map((r) => r.id), ['r1', 'r2', 'r3', 'r4', 'r5']);
});

test('limit: with 16 lookups in the last minute, the next one waits until the oldest is a minute old', async () => {
  const t = trackingMtop(20);
  const page = makePage({ mtop: t.mtop });
  const now = Date.now();
  // 16 recent lookups; the oldest is 58.5 s old, so a slot frees up in about 1.5 s.
  const starts = [now - 58500, ...Array.from({ length: 15 }, (_, i) => now - 30000 + i * 100)];
  page.store.set('pricepeel-window', JSON.stringify(starts));
  page.send({ id: 'w1', type: 'pdp', productId: '2001' });
  await page.waitFor(() => page.replies.length === 1, 5000);
  const waited = t.starts[0] - now;
  assert.ok(waited >= 1300 && waited <= 2500, 'waited ' + waited);
});

test('limit: never more than 16 starts in a minute', async () => {
  const t = trackingMtop(10);
  const page = makePage({ mtop: t.mtop });
  for (let i = 1; i <= 20; i++) page.send({ id: 'm' + i, type: 'pdp', productId: '400' + i });
  await page.waitFor(() => page.replies.length === 16, 12000);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(t.starts.length, 16, 'started ' + t.starts.length);
  assert.equal(JSON.parse(page.store.get('pricepeel-window')).length, 16);
});

test('lookups older than a minute no longer count', async () => {
  const t = trackingMtop(20);
  const page = makePage({ mtop: t.mtop });
  page.store.set('pricepeel-window', JSON.stringify(Array.from({ length: 16 }, (_, i) => Date.now() - 61000 - i)));
  for (let i = 1; i <= 4; i++) page.send({ id: 'b' + i, type: 'pdp', productId: '300' + i });
  await page.waitFor(() => page.replies.length === 4, 5000);
  assert.ok(t.starts[3] - t.starts[0] < 1500);
});

test('a queued lookup can be cancelled before it runs', async () => {
  const calls = [];
  const page = makePage({ mtop: { request: async (o) => { calls.push(o.data.productId); return okResult; } } });
  page.send({ id: 'a', type: 'pdp', productId: '1' });
  page.send({ id: 'b', type: 'pdp', productId: '2' });
  page.send({ id: 'b', type: 'cancel', productId: '0' });
  await page.waitFor(() => page.replies.length === 2);
  assert.deepEqual(calls, ['1']);
  assert.equal(page.replies.find((r) => r.id === 'b').error, 'cancelled');
});

test('robot check pauses for 10 minutes, rejects queued lookups, and doubles when repeated', async () => {
  const page = makePage({ mtop: { request: async () => { throw { ret: ['RGV587_ERROR::SM::哎哟喂,被挤爆啦'] }; } } });
  page.send({ id: 'x', type: 'pdp', productId: '1' });
  page.send({ id: 'y', type: 'pdp', productId: '2' });
  await page.waitFor(() => page.replies.length === 2, 5000);
  const until = +page.replies[0].error.split(':')[1];
  assert.ok(Math.abs(until - Date.now() - 10 * 60 * 1000) < 5000);
  assert.match(page.replies[1].error, /^paused:/);

  // Pretend the pause just ended and the check appears again: the next pause is 20 minutes.
  const p = JSON.parse(page.store.get('pricepeel-pause'));
  page.store.set('pricepeel-pause', JSON.stringify({ until: Date.now() - 1000, level: p.level }));
  page.send({ id: 'z', type: 'pdp', productId: '3' });
  await page.waitFor(() => page.replies.length === 3, 5000);
  const until2 = +page.replies[2].error.split(':')[1];
  assert.ok(Math.abs(until2 - Date.now() - 20 * 60 * 1000) < 5000);
});

test("AliExpress's robot-check popup pauses lookups and tells content.js", async () => {
  // The library keeps the triggering request waiting instead of failing it.
  const page = makePage({ mtop: { request: () => new Promise(() => {}) } });
  // Two stuck requests fill both slots, so the third is certainly still waiting in the queue.
  page.send({ id: 'hang1', type: 'pdp', productId: '1' });
  page.send({ id: 'hang2', type: 'pdp', productId: '2' });
  page.send({ id: 'queued', type: 'pdp', productId: '3' });
  await new Promise((r) => setTimeout(r, 700));
  page.showPopup();
  await page.waitFor(() => page.replies.some((r) => r.type === 'paused') && page.replies.some((r) => r.id === 'queued'), 3000);
  const note = page.replies.find((r) => r.type === 'paused');
  assert.ok(Math.abs(note.until - Date.now() - 10 * 60 * 1000) < 5000);
  assert.match(page.replies.find((r) => r.id === 'queued').error, /^paused:/);
  // The popup staying up (more DOM changes) must not escalate the pause.
  page.showPopup();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(JSON.parse(page.store.get('pricepeel-pause')).level, 0);
});

test('the bridge announces when a queued lookup actually starts', async () => {
  const t = trackingMtop(50);
  const page = makePage({ mtop: t.mtop });
  page.send({ id: 'one', type: 'pdp', productId: '5001' });
  await page.waitFor(() => page.replies.length === 1, 3000);
  assert.equal(page.started.length, 1);
  assert.equal(page.started[0].id, 'one');
  assert.ok(page.started[0].at <= page.replies[0].at);
});

test('the bridge announces when the per-minute limit holds lookups back, and when it lets go', async () => {
  const t = trackingMtop(20);
  const page = makePage({ mtop: t.mtop });
  const now = Date.now();
  page.store.set('pricepeel-window', JSON.stringify([now - 58800, ...Array.from({ length: 15 }, (_, i) => now - 20000 + i)]));
  page.send({ id: 'L1', type: 'pdp', productId: '6001' });
  await page.waitFor(() => page.replies.length === 1, 5000);
  assert.ok(page.limits.length >= 2, 'limit messages: ' + page.limits.length);
  const hold = page.limits[0];
  assert.ok(hold.until - hold.at > 700 && hold.until - hold.at < 2000, 'held for ' + (hold.until - hold.at));
  assert.equal(page.limits[page.limits.length - 1].until, 0);
  assert.ok(t.starts[0] >= hold.until - 100);
});

test('a running pause stored under the old key name carries over, and old keys are removed', async () => {
  const until = Date.now() + 5 * 60 * 1000;
  const page = makePage({
    mtop: { request: async () => okResult },
    seed: { 'aap-pause': JSON.stringify({ until, level: 0 }), 'aap-window': '[]', 'aap-bucket': '{}' },
  });
  assert.equal(JSON.parse(page.store.get('pricepeel-pause')).until, until);
  assert.ok(!page.store.has('aap-pause') && !page.store.has('aap-window') && !page.store.has('aap-bucket'));
  page.send({ id: 'p', type: 'pdp', productId: '7001' });
  await page.waitFor(() => page.replies.length === 1, 3000);
  assert.match(page.replies[0].error, /^paused:/);
});
