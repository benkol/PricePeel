/*
 * Isolated-world content script: finds search result cards, gathers data for each visible card,
 * runs the analysis (analyze.js) and inserts a price label into the card.
 */
(function () {
  'use strict';
  const A = globalThis.PricePeel;
  if (!A || window.__pricepeelContent) return;
  window.__pricepeelContent = true;

  const FROM_CONTENT = 'pricepeel-content';
  const FROM_BRIDGE = 'pricepeel-bridge';
  const CACHE_PREFIX = 'pricepeel-pdp:';  // extension storage key: pricepeel-pdp:<productId>:<currency>
  const CACHE_TTL = 24 * 60 * 60 * 1000; // variant prices rarely change faster than this
  const DWELL_MS = 500;                   // a card must stay on screen this long before it's looked up
  const CARD_SELECTOR = 'a.search-card-item, a[href*="/item/"]';

  // ---------- bridge RPC ----------
  let seq = 0;
  const pending = new Map();
  const cardByRpc = new Map(); // pdp request id -> card, to show when its request starts
  let limitUntil = 0;          // while the per-minute limit holds lookups back: when the next slot frees
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.src !== FROM_BRIDGE) return;
    // The bridge saw AliExpress's robot-check popup and paused lookups.
    if (e.data.type === 'paused') { schedulePauseEnd(Number(e.data.until)); return; }
    // The bridge started a queued lookup: its card goes from "queued" to "requesting".
    if (e.data.type === 'started') {
      const card = cardByRpc.get(e.data.id);
      if (card) setPeelState(card, 'loading');
      return;
    }
    // The per-minute limit is holding lookups back until `until` (0 = flowing again).
    if (e.data.type === 'limit') {
      limitUntil = Number(e.data.until) || 0;
      for (const el of document.querySelectorAll('.pricepeel-peel.pricepeel-state-queued, .pricepeel-peel.pricepeel-state-limited')) {
        const card = el.closest('[data-pricepeel]');
        if (card) setPeelState(card, 'queued');
      }
      return;
    }
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    clearTimeout(p.timer);
    e.data.ok ? p.resolve(e.data.data) : p.reject(new Error(e.data.error || 'bridge error'));
  });
  function rpc(type, productId, timeoutMs = 60000, onId, extra) {
    return new Promise((resolve, reject) => {
      const id = 'c' + (++seq) + '-' + Math.random().toString(36).slice(2);
      if (onId) onId(id);
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout')); }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      window.postMessage({ src: FROM_CONTENT, id, type, productId, ...extra }, location.origin);
    });
  }

  // ---------- storage cache ----------
  const storage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  async function cacheGet(key) {
    if (!storage) return null;
    try {
      const o = await storage.get(key);
      const v = o[key];
      return v && Date.now() - v.ts < CACHE_TTL ? v.data : null;
    } catch (e) { return null; }
  }
  function cacheSet(key, data) {
    if (!storage) return;
    try { storage.set({ [key]: { ts: Date.now(), data } }); } catch (e) { /* ignore */ }
  }
  async function pruneCache() {
    if (!storage) return;
    try {
      const all = await storage.get(null);
      // Old key names ("pdp:…", "pdp2:…") are dropped; current ones once they've expired.
      const old = Object.keys(all).filter((k) => k.startsWith('pdp') || (k.startsWith(CACHE_PREFIX) && !(all[k] && Date.now() - all[k].ts < CACHE_TTL)));
      if (old.length) await storage.remove(old);
    } catch (e) { /* ignore */ }
  }

  function hashImages(urls) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'hash', urls }, (res) => {
          void chrome.runtime.lastError;
          resolve((res && res.hashes) || {});
        });
      } catch (e) { resolve({}); }
    });
  }

  // ---------- card parsing ----------
  function cardInfo(card) {
    const href = card.getAttribute('href') || '';
    let url = null;
    try { url = new URL(href, location.href); } catch (e) { return null; }
    let productId = (href.match(/\/item\/(\d+)\.html/) || [])[1];
    let npi = A.parseNpi(url.searchParams.get('pdp_npi'));
    if (!productId) {
      // Bundle-deal cards link to ".../BundleDeals2?productIds=<productId>:<skuId>"
      const bm = (url.searchParams.get('productIds') || '').match(/^(\d+)(?::(\d+))?/);
      if (!bm) return null;
      productId = bm[1];
      npi = { skuId: bm[2] || null, price: NaN, currency: null, bundle: true };
    }
    const img = card.querySelector('img[class*="images--item"]') ||
      [...card.querySelectorAll('img')].find((i) => /\/kf\//.test(i.getAttribute('src') || ''));
    const priceEl = card.querySelector('[class*="price-sale"]') || card.querySelector('[class*="price"]');
    let domPrice = NaN;
    if (priceEl) domPrice = A.parseDisplayPrice(priceEl.getAttribute('aria-label') || (priceEl.closest('[aria-label]') || {}).ariaLabel || priceEl.textContent);
    else { const m = (card.textContent || '').match(PRICE_TEXT_RE); if (m) domPrice = A.parseDisplayPrice(card.textContent.slice(m.index, m.index + 24)); }
    return {
      productId,
      skuId: npi && npi.skuId,
      price: npi && isFinite(npi.price) ? npi.price : domPrice,
      currency: npi && npi.currency,
      // Bundle deals ("Max Combo" / "Bundle deals" strip under the card) ship free.
      bundle: !!(npi && npi.bundle) || !!card.querySelector('[class*="rainbow"], a[href*="BundleDeals"]') ||
        /\b(max combo|bundle deals?)\b/i.test(card.textContent || ''),
      thumb: img ? img.getAttribute('src') : '',
    };
  }

  // A currency next to a number: "US $3.37", "₪12.50", "12,99 €", "R$ 5", "15 zł".
  const PRICE_TEXT_RE = /(?:[$€£₪¥₩₹₽]|\bUS|\bCN|R\$|zł|kr)\s?\d|\d[\d.,]*\s?(?:€|zł|kr|₽|Kč|lei)/;

  function isProductCard(a) {
    if (a.classList.contains('search-card-item')) return true;
    // Other layouts (homepage feed, recommendations) use scrambled class names, so recognise a card
    // by its content: an item link with a photo-sized image area and a price.
    if (!/\/item\/\d+/.test(a.getAttribute('href') || '')) return false;
    if (!a.querySelector('img')) return false;
    if (a.getBoundingClientRect().width < 100) return false; // tiny thumbnails (cart panel, etc.)
    return !!a.querySelector('[class*="price"]') || PRICE_TEXT_RE.test(a.textContent || '');
  }

  // ---------- rendering ----------
  // The label is a "peeled corner" in the top-right of the thumbnail: the paper curls down and
  // reveals the real price underneath. Hovering the card peels it further to show details.
  function imageBoxFor(card) {
    let box = card.querySelector('[class*="--image--"], [class*="imagesGallery"]');
    if (!box) {
      // Generic cards: the photo box is the shortest element that spans (almost) the card's width
      // and is at least ~square-ish. Found by size because class names are scrambled, and because
      // lazy-loaded photos may not have their <img> yet.
      const cw = card.getBoundingClientRect().width;
      let best = null;
      let bestH = Infinity;
      for (const el of card.querySelectorAll('div, picture, span')) {
        const r = el.getBoundingClientRect();
        if (r.width >= cw * 0.85 && r.height >= cw * 0.6 && r.height < bestH) { best = el; bestH = r.height; }
      }
      box = best;
    }
    if (!box) {
      const imgs = [...card.querySelectorAll('img')];
      const big = imgs.sort((x, y) => y.getBoundingClientRect().width - x.getBoundingClientRect().width)[0];
      box = big && big.parentElement;
    }
    if (!box || box === card) return null;
    if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
    return box;
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // "US $28.79" -> "$28.79", "CN¥55.84" -> "¥55.84": the symbol is enough in a small corner.
  const short = (p) => String(p || '').replace(/^[A-Z]{1,3}\s*(?=[^\w\s])/, '');
  // "$28.79" -> "$28" + small ".79" (also "28,79 zł" -> "28" + small ",79" + " zł"), so the
  // whole-number part can be bigger in the little corner.
  // The currency symbol ("$", "₪", " zł") is also shown small and faded.
  function priceHtml(p) {
    const m = String(p || '').match(/^(\D*)(\d[\d.,\s ]*?)([.,]\d{1,2})?(\D*)$/);
    if (!m) return esc(p);
    const [, pre, whole, dec, post] = m;
    const cur = (s) => (s.trim() ? `<span class="pricepeel-peel-cur">${esc(s.trim())}</span>` : '');
    return cur(pre) + esc(whole) + (dec ? `<span class="pricepeel-peel-dec">${esc(dec)}</span>` : '') + cur(post);
  }
  const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  function peelHtml(r) {
    const charge = r.shipping.status === 'charge';
    let title, price;
    const more = [];
    if (r.isTrick) {
      title = 'Real price';
      price = short(r.realPriceText);
      if (charge) more.push(`+ ${esc(short(r.shipText))} ship = <b>${esc(short(r.totalText))}</b>`);
      if (r.pickName) more.push(`“${esc(clip(r.pickName, 18))}”`);
      if (r.advertisedName) more.push(`<span class="pricepeel-dim">not</span> “${esc(clip(r.advertisedName, 16))}”`);
    } else {
      // Price is already correct; only the shipping is news.
      title = 'Total';
      price = short(r.totalText);
      more.push(`${esc(short(r.realPriceText))} + ${esc(short(r.shipText))} ship`);
    }
    return `
      <div class="pricepeel-peel-under"><div class="pricepeel-peel-text">
        <div class="pricepeel-peel-title">${esc(title)}</div>
        <div class="pricepeel-peel-price">${priceHtml(price)}</div>
        <div class="pricepeel-peel-more">${more.map((m) => `<div>${m}</div>`).join('')}</div>
      </div></div>
      ${flapSvg()}`;
  }

  // The curled-back paper, modelled on a realistic page curl: the fold is a curve (not a straight
  // crease) from the square's top-left to bottom-right corner, and the flap is a leaf shape whose
  // pointed tip is the original corner, rolled back toward the photo. Drawn in a 100x100 box
  // stretched over the corner, so it scales with the peel. The fold curve must match
  // .pricepeel-peel-under's clip-path in label.css.
  let flapSeq = 0;
  function flapSvg() {
    const id = 'pricepeel-flap-' + (++flapSeq);
    return `<svg class="pricepeel-peel-flap" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="30" y1="70" x2="59" y2="41">
          <stop offset="0" stop-color="#f2f2f2"/>
          <stop offset="0.35" stop-color="#ffffff"/>
          <stop offset="0.68" stop-color="#e4e4e4"/>
          <stop offset="0.9" stop-color="#ababab"/>
          <stop offset="1" stop-color="#8c8c8c"/>
        </linearGradient>
      </defs>
      <path fill="url(#${id})" d="M0 0 C24 0 100 76 100 100 C96 84 70 71 30 70 C29 30 16 4 0 0 Z"/>
    </svg>`;
  }

  // ---------- progress: a mini peel in the photo's corner ----------
  // idle (not checked yet) -> queued (waiting its turn) -> loading (request in flight) -> done:
  // the same element then opens into the price corner (render) or folds away (clearPeel).
  function peelElement(card, create) {
    const box = imageBoxFor(card);
    if (!box) return null;
    let el = box.querySelector(':scope > .pricepeel-peel');
    if (!el && create) {
      el = document.createElement('div');
      box.appendChild(el);
    }
    return el;
  }
  const PEEL_TITLES = {
    idle: 'PricePeel: not checked yet',
    queued: 'PricePeel: waiting to check the real price',
    loading: 'PricePeel: checking the real price…',
    paused: 'PricePeel: paused because AliExpress asked to check you’re not a robot; this card is checked when the pause ends',
  };
  const LIMIT_WINDOW_MS = 60 * 1000; // must match the bridge's rolling window
  function setPeelState(card, state) {
    const el = peelElement(card, true);
    if (!el) return;
    // "Waiting its turn" while the per-minute limit holds lookups back is shown as "limited".
    let until = 0;
    if (state === 'queued' && limitUntil > Date.now() + 300) { state = 'limited'; until = limitUntil; }
    if (el.classList.contains('pricepeel-state-' + state) && (state !== 'limited' || el.dataset.until === String(until))) return;
    if (!el.classList.contains('pricepeel-mini') || !el.querySelector('.pricepeel-peel-ring')) {
      el.innerHTML = `<div class="pricepeel-peel-under"><div class="pricepeel-peel-dots"><i></i><i></i><i></i></div>` +
        `<svg class="pricepeel-peel-ring" viewBox="0 0 12 12" aria-hidden="true"><circle class="pricepeel-ring-track" cx="6" cy="6" r="4.5"/>` +
        `<circle class="pricepeel-ring-fill" cx="6" cy="6" r="4.5" pathLength="100"/></svg></div>${flapSvg()}`;
    }
    el.className = 'pricepeel-peel pricepeel-mini pricepeel-state-' + state;
    if (state === 'limited') {
      // The ring fills over the limit's minute and completes when the next slot frees up.
      el.dataset.until = String(until);
      const left = Math.max(0, until - Date.now());
      el.style.setProperty('--pricepeel-ring-delay', -(LIMIT_WINDOW_MS - Math.min(LIMIT_WINDOW_MS, left)) + 'ms');
      const ring = el.querySelector('.pricepeel-ring-fill');
      ring.style.animation = 'none'; void ring.getBoundingClientRect(); ring.style.animation = ''; // restart
      el.title = `PricePeel: AliExpress allows about 16 checks a minute; this one starts in about ${Math.ceil(left / 1000)} s`;
    } else {
      delete el.dataset.until;
      el.title = PEEL_TITLES[state] || '';
    }
  }
  /** Checked, nothing to show: the mini peel folds shut and disappears. */
  function clearPeel(card) {
    const el = peelElement(card, false);
    if (!el || !el.classList.contains('pricepeel-mini')) return;
    // Fold down from its current size (it may be mid-"peek"), fading out; see .pricepeel-closing.
    el.style.setProperty('--pricepeel-fold-from', el.getBoundingClientRect().width + 'px');
    el.className = 'pricepeel-peel pricepeel-mini pricepeel-closing';
    setTimeout(() => { if (el.classList.contains('pricepeel-closing')) el.remove(); }, 550);
  }

  function render(card, r) {
    const el = peelElement(card, true);
    if (!el) return;
    el.removeAttribute('title');
    // Coming from the mini progress corner: open from its current size (see .pricepeel-opening) instead of
    // restarting the appear animation, which grows from zero.
    const fromMini = el.classList.contains('pricepeel-mini');
    if (fromMini) el.style.setProperty('--pricepeel-open-from', el.getBoundingClientRect().width + 'px');
    el.className = 'pricepeel-peel ' + (r.isTrick ? 'pricepeel-trick' : 'pricepeel-ship-only') + (fromMini ? ' pricepeel-opening' : '');
    el.innerHTML = peelHtml(r);
    card.classList.add('pricepeel-card');
  }

  // ---------- processing ----------
  async function processCard(card) {
    const info = cardInfo(card);
    if (!info) return;
    const st0 = stateOf(card);
    // Search pagination reuses card elements for new products; drop results for a product the
    // card no longer shows (resetCard() gives the card a fresh state object).
    const stale = () => states.get(card) !== st0 || productIdOf(card) !== info.productId;
    try {
      const meta = await rpc('item', info.productId, 5000).catch(() => null);
      const item = {
        skuId: (meta && meta.skuId) || info.skuId,
        price: meta && isFinite(meta.price) ? meta.price : info.price,
        thumb: (meta && meta.thumb) || info.thumb || '',
      };
      if (meta) { item.choice = meta.choice; item.bundle = meta.bundle; item.freeShip = meta.freeShip; }
      if (info.bundle) item.bundle = true;

      const cur = (meta && meta.currency) || info.currency || '';
      const key = `${CACHE_PREFIX}${info.productId}:${cur}`;
      let pdp = await cacheGet(key);
      if (!pdp) {
        // The lookup waits in the bridge's paced queue (mini peel: "queued"); the bridge says when it
        // starts ("loading"). If the card scrolls away meanwhile it's cancelled.
        setPeelState(card, 'queued');
        let rpcId = null;
        try {
          // rank = position on the page, so cards nearer the top are checked first.
          const r0 = card.getBoundingClientRect();
          const rank = Math.round(r0.top + window.scrollY) * 10 + Math.round(r0.left / 100);
          pdp = await rpc('pdp', info.productId, 10 * 60 * 1000, (id) => { rpcId = id; stateOf(card).rpcId = id; cardByRpc.set(id, card); }, { rank });
        } finally {
          cardByRpc.delete(rpcId);
        }
        stateOf(card).rpcId = null;
        cacheSet(key, pdp);
      }

      let hashes = null;
      if (A.needsImageCheck(pdp) && item.thumb) {
        const imgs = new Set([item.thumb]);
        for (const v of A.parseVariants(pdp)) if (v.salable && v.image) imgs.add(v.image);
        hashes = await hashImages([...imgs]);
      }

      if (stale()) return;
      const r = A.analyze({ item, pdp, hashes });
      // Correct price and nothing to add for shipping: no label needed.
      if (r && (r.isTrick || r.shipping.status === 'charge')) render(card, r);
      else clearPeel(card);
      finish(card);
    } catch (e) {
      if (stale()) return;
      const msg = String(e && e.message || e);
      const st = stateOf(card);
      st.rpcId = null;
      if (msg === 'cancelled') { st.phase = 'idle'; setPeelState(card, 'idle'); return; }             // scrolled away: retry when visible
      const pm = msg.match(/^paused:(\d+)/);
      if (pm) { st.phase = 'idle'; setPeelState(card, 'paused'); schedulePauseEnd(+pm[1]); return; } // robot-check pause: retry afterwards
      clearPeel(card);
      card.setAttribute('data-pricepeel', 'error');
      card.setAttribute('data-pricepeel-error', msg.slice(0, 200));
      finish(card);
    }
  }

  // ---------- when to look a card up ----------
  // Only cards that are at least half visible for DWELL_MS, so fast scrolling past results costs nothing.
  const states = new WeakMap(); // card -> {phase: 'idle'|'waiting'|'working'|'done', timer, rpcId}
  const stateOf = (card) => { let s = states.get(card); if (!s) states.set(card, (s = { phase: 'idle' })); return s; };

  function finish(card) {
    stateOf(card).phase = 'done';
    io.unobserve(card);
  }

  function onVisible(card) {
    const st = stateOf(card);
    if (st.phase !== 'idle') return;
    st.phase = 'waiting';
    st.timer = setTimeout(() => { st.phase = 'working'; processCard(card); }, DWELL_MS);
  }
  function onHidden(card) {
    const st = stateOf(card);
    if (st.phase === 'waiting') { clearTimeout(st.timer); st.phase = 'idle'; }
    else if (st.phase === 'working' && st.rpcId) {
      window.postMessage({ src: FROM_CONTENT, type: 'cancel', id: st.rpcId, productId: '0' }, location.origin);
    }
  }

  // ---------- anti-bot pause ----------
  let pauseTimer = null;
  function schedulePauseEnd(until) {
    showPausedNote(until);
    if (pauseTimer) return;
    pauseTimer = setTimeout(() => {
      pauseTimer = null;
      hidePausedNote();
      // Paused cards go back to "not checked yet"; re-observing fires the observer again for the
      // ones still on screen, so they're checked now.
      for (const card of document.querySelectorAll('[data-pricepeel="1"]')) {
        if (stateOf(card).phase === 'idle') {
          const el = peelElement(card, false);
          if (el && el.classList.contains('pricepeel-state-paused')) setPeelState(card, 'idle');
          io.unobserve(card); io.observe(card);
        }
      }
    }, Math.max(1000, until - Date.now() + 2000 + Math.random() * 3000));
  }
  // The note can be collapsed to a small pill (remembered for next time) or closed until the
  // current pause ends. Its state is kept in this site's localStorage.
  const NOTE_KEY = 'pricepeel-note';
  let noteTicker = null;
  function readNote() {
    try { return JSON.parse(localStorage.getItem(NOTE_KEY)) || {}; } catch (e) { return {}; }
  }
  function writeNote(patch) {
    try { localStorage.setItem(NOTE_KEY, JSON.stringify({ ...readNote(), ...patch })); } catch (e) { /* ignore */ }
  }

  function showPausedNote(until) {
    const pref = readNote();
    if (pref.hiddenUntil && pref.hiddenUntil >= until) return; // closed for this pause
    let el = document.getElementById('pricepeel-paused-note');
    if (!el) {
      el = document.createElement('div');
      el.id = 'pricepeel-paused-note';
      el.innerHTML = `
        <img class="pricepeel-note-logo" alt="PricePeel" width="18" height="18">
        <span class="pricepeel-note-text"></span>
        <span class="pricepeel-note-mins"></span>
        <button type="button" class="pricepeel-note-btn pricepeel-note-collapse" title="Collapse">–</button>
        <button type="button" class="pricepeel-note-btn pricepeel-note-close" title="Hide until the pause ends">×</button>`;
      el.addEventListener('click', (e) => {
        if (e.target.closest('.pricepeel-note-close')) {
          writeNote({ hiddenUntil: Number(el.dataset.until) });
          hidePausedNote();
        } else if (e.target.closest('.pricepeel-note-collapse')) {
          writeNote({ collapsed: true });
          el.classList.add('pricepeel-collapsed');
        } else if (el.classList.contains('pricepeel-collapsed')) {
          writeNote({ collapsed: false });
          el.classList.remove('pricepeel-collapsed');
        }
      });
      // The extension's own icon, so it's clear the note comes from this extension.
      const logo = el.querySelector('.pricepeel-note-logo');
      try { logo.src = chrome.runtime.getURL('icons/icon-32.png'); } catch (e) { logo.remove(); }
      logo.addEventListener('error', () => logo.remove());
      document.body.appendChild(el);
    }
    el.dataset.until = String(until);
    el.classList.toggle('pricepeel-collapsed', !!pref.collapsed);
    el.title = 'PricePeel lookups are paused';
    const update = () => {
      const mins = Math.max(1, Math.ceil((Number(el.dataset.until) - Date.now()) / 60000));
      el.querySelector('.pricepeel-note-text').textContent =
        `PricePeel is paused for ${mins} min: AliExpress asked to check you're not a robot, so price lookups wait.`;
      el.querySelector('.pricepeel-note-mins').textContent = `⏸ ${mins} min`;
    };
    update();
    clearInterval(noteTicker);
    noteTicker = setInterval(update, 30000);
  }
  function hidePausedNote() {
    clearInterval(noteTicker);
    const el = document.getElementById('pricepeel-paused-note');
    if (el) el.remove();
  }

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting && e.intersectionRatio >= 0.5) onVisible(e.target);
      else onHidden(e.target);
    }
  }, { threshold: [0, 0.5] });

  function productIdOf(card) {
    const href = card.getAttribute('href') || '';
    const m = href.match(/\/item\/(\d+)/) || href.match(/[?&]productIds=(\d+)/);
    return m ? m[1] : '';
  }

  /** The card now shows a different product (e.g. after changing search page): start over. */
  function resetCard(card) {
    const st = states.get(card);
    if (st) {
      clearTimeout(st.timer);
      if (st.rpcId) window.postMessage({ src: FROM_CONTENT, type: 'cancel', id: st.rpcId, productId: '0' }, location.origin);
      states.delete(card);
    }
    for (const el of card.querySelectorAll('.pricepeel-peel')) el.remove();
    card.classList.remove('pricepeel-card');
    card.removeAttribute('data-pricepeel-error');
    card.setAttribute('data-pricepeel', '1');
    card.setAttribute('data-pricepeel-pid', productIdOf(card));
    setPeelState(card, 'idle');
    io.unobserve(card);
    io.observe(card);
  }

  function scan(root) {
    const scope = root && root.querySelectorAll ? root : document;
    const list = scope.querySelectorAll(CARD_SELECTOR);
    for (const a of list) {
      if (a.hasAttribute('data-pricepeel')) {
        if (a.getAttribute('data-pricepeel-pid') !== productIdOf(a)) resetCard(a);
        continue;
      }
      // One label per card, even if a layout nests item links inside each other.
      if ((a.parentElement && a.parentElement.closest('[data-pricepeel]')) || a.querySelector('[data-pricepeel]')) continue;
      if (!isProductCard(a)) continue;
      a.setAttribute('data-pricepeel', '1');
      a.setAttribute('data-pricepeel-pid', productIdOf(a));
      setPeelState(a, 'idle');
      io.observe(a);
    }
  }

  let scheduled = false;
  const mo = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; scan(document); }, 300);
  });

  if (/\/item\//.test(location.pathname)) return; // product pages: nothing to do
  scan(document);
  // href changes catch cards that are reused for a different product.
  mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  pruneCache();
})();
