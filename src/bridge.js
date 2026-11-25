/*
 * Runs in the page's MAIN world. It
 *  - collects search-card data the page already has (window._dida_config_ and later XHR/fetch responses),
 *  - fetches product details through the page's own signed mtop client (window.lib.mtop),
 *  - answers requests from content.js via window.postMessage.
 */
(function () {
  'use strict';
  if (window.__pricepeelBridge) return;
  window.__pricepeelBridge = true;

  const FROM_CONTENT = 'pricepeel-content';
  const FROM_BRIDGE = 'pricepeel-bridge';
  // Stay under AliExpress's robot check: at most MAX_PER_WINDOW lookups in any WINDOW_MS, as fast
  // as that allows. Tests (Nov 2026) showed the check at about 19-21 lookups within 60 s, while 18
  // per minute passed twice, so 16 leaves a margin. The start times are kept in localStorage so
  // tabs and page reloads share the limit.
  const MAX_CONCURRENT = 2;
  const MAX_PER_WINDOW = 16;
  const WINDOW_MS = 60 * 1000;
  const START_JITTER_MS = [150, 450]; // small random spacing between starts
  const WINDOW_KEY = 'pricepeel-window';
  // When AliExpress does ask "are you a robot?", pause lookups: 10 min, doubling (up to 2 h)
  // if it happens again within an hour of the previous pause ending.
  const PAUSE_BASE_MS = 10 * 60 * 1000;
  const PAUSE_MAX_MS = 2 * 60 * 60 * 1000;
  const PAUSE_KEY = 'pricepeel-pause';

  // Storage keys were renamed from "aap-…" to "pricepeel-…": keep a running pause, drop the rest.
  try {
    const oldPause = localStorage.getItem('aap-pause');
    if (oldPause && !localStorage.getItem(PAUSE_KEY)) localStorage.setItem(PAUSE_KEY, oldPause);
    for (const k of ['aap-pause', 'aap-window', 'aap-note', 'aap-bucket']) localStorage.removeItem(k);
  } catch (e) { /* storage unavailable */ }

  const items = new Map(); // productId -> search card meta

  // ---------- search data harvesting ----------
  function addItem(o) {
    const prices = o.prices || {};
    const sale = prices.salePrice || {};
    const sps = Array.isArray(o.sellingPoints) ? o.sellingPoints : [];
    const sources = sps.map((s) => String(s && s.source || ''));
    const texts = sps.map((s) => String(s && s.tagContent && s.tagContent.tagText || ''));
    const rainbowUrl = String(o.rainbow && o.rainbow.url || '');
    items.set(String(o.productId), {
      productId: String(o.productId),
      thumb: o.image && o.image.imgUrl || '',
      skuId: prices.skuId ? String(prices.skuId) : null,
      price: typeof sale.minPrice === 'number' ? sale.minPrice : NaN,
      currency: sale.currencyCode || null,
      choice: sources.some((s) => /choice/i.test(s)),
      bundle: sources.some((s) => /bundle/i.test(s)) || /bundle/i.test(rainbowUrl) || texts.some((t) => /bundle/i.test(t)),
      freeShip: sources.some((s) => /free_?shipping/i.test(s)),
    });
  }

  function harvest(root) {
    const stack = [root];
    let n = 0;
    while (stack.length && n++ < 300000) {
      const o = stack.pop();
      if (!o || typeof o !== 'object') continue;
      if (Array.isArray(o)) { for (const x of o) if (x && typeof x === 'object') stack.push(x); continue; }
      if (o.productId && o.prices && typeof o.prices === 'object') { try { addItem(o); } catch (e) { /* ignore */ } }
      for (const k in o) { const v = o[k]; if (v && typeof v === 'object') stack.push(v); }
    }
  }

  function scanText(text) {
    if (typeof text !== 'string' || text.length > 8e6) return;
    if (text.indexOf('"productId"') < 0 || text.indexOf('"prices"') < 0) return;
    let json = null;
    try { json = JSON.parse(text); } catch (e) {
      const a = text.indexOf('('), b = text.lastIndexOf(')');
      if (a >= 0 && b > a) { try { json = JSON.parse(text.slice(a + 1, b)); } catch (e2) { /* ignore */ } }
    }
    if (json) harvest(json);
  }

  function harvestInitData() {
    try { if (window._dida_config_ && window._dida_config_._init_data_) harvest(window._dida_config_._init_data_); } catch (e) { /* ignore */ }
  }

  // Hook fetch / XHR so items loaded later (infinite scroll, SPA paging) are captured too.
  try {
    const origFetch = window.fetch;
    if (origFetch) {
      window.fetch = function () {
        const p = origFetch.apply(this, arguments);
        p.then((r) => {
          try {
            const ct = r.headers.get('content-type') || '';
            if (/json|javascript|text/.test(ct)) r.clone().text().then(scanText).catch(() => {});
          } catch (e) { /* ignore */ }
        }).catch(() => {});
        return p;
      };
    }
    const XHR = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (XHR) {
      const origSend = XHR.send;
      XHR.send = function () {
        this.addEventListener('load', function () {
          try {
            if (this.responseType === '' || this.responseType === 'text') scanText(this.responseText);
            else if (this.responseType === 'json' && this.response) harvest(this.response);
          } catch (e) { /* ignore */ }
        });
        return origSend.apply(this, arguments);
      };
    }
  } catch (e) { /* ignore */ }

  // ---------- product details via mtop ----------
  function locale() {
    const m = document.cookie.match(/(?:^|;\s*)aep_usuc_f=([^;]+)/);
    let raw = m ? m[1] : '';
    try { raw = decodeURIComponent(raw); } catch (e) { /* keep raw */ }
    const p = new URLSearchParams(raw);
    const country = p.get('region') || 'US';
    // The product page sends "<language>_<ship-to country>" (e.g. en_IL), not the cookie's b_locale
    // (e.g. en_US). Prices differ between the two, so match the page.
    const language = String(p.get('b_locale') || 'en_US').split(/[_-]/)[0] || 'en';
    return {
      site: p.get('site') || 'glo',
      currency: p.get('c_tp') || 'USD',
      country,
      lang: language + '_' + country,
    };
  }

  function waitForMtop(timeoutMs) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      (function check() {
        if (window.lib && window.lib.mtop && typeof window.lib.mtop.request === 'function') return resolve(window.lib.mtop);
        if (Date.now() - t0 > timeoutMs) return reject(new Error('mtop client not available'));
        setTimeout(check, 250);
      })();
    });
  }

  function trim(r, currency) {
    const sku = r.SKU || {};
    const price = r.PRICE || {};
    const ship = r.SHIPPING || {};
    const priceMap = {};
    for (const [k, v] of Object.entries(price.skuIdStrPriceInfoMap || {})) {
      priceMap[k] = { salePriceString: v.salePriceString, salePriceLocal: v.salePriceLocal };
    }
    return {
      currency,
      SKU: {
        skuPaths: (sku.skuPaths || []).map((p) => ({
          path: p.path, skuAttr: p.skuAttr, skuIdStr: p.skuIdStr || String(p.skuId), salable: p.salable, skuStock: p.skuStock,
        })),
        skuProperties: (sku.skuProperties || []).map((pr) => ({
          skuPropertyId: pr.skuPropertyId,
          skuPropertyValues: (pr.skuPropertyValues || []).map((v) => ({
            propertyValueIdLong: v.propertyValueIdLong,
            propertyValueDisplayName: v.propertyValueDisplayName || v.propertyValueName,
            skuPropertyImagePath: v.skuPropertyImagePath || '',
          })),
        })),
      },
      PRICE: { skuIdStrPriceInfoMap: priceMap },
      HEADER_IMAGE_PC: { imagePathList: ((r.HEADER_IMAGE_PC || {}).imagePathList || []).slice(0, 1) },
      SHIPPING: {
        originalLayoutResultList: (ship.originalLayoutResultList || []).slice(0, 1).map((x) => ({
          bizData: x.bizData && {
            displayAmount: x.bizData.displayAmount,
            shippingFee: x.bizData.shippingFee,
            displayCurrency: x.bizData.displayCurrency,
            etaTraceId: x.bizData.etaTraceId,
          },
        })),
      },
    };
  }

  // Pause state lives in this site's localStorage so it holds across tabs and page loads.
  function readPause() {
    try { return JSON.parse(localStorage.getItem(PAUSE_KEY)) || { until: 0, level: 0 }; } catch (e) { return { until: 0, level: 0 }; }
  }
  function startPause() {
    const prev = readPause();
    const now = Date.now();
    if (now < prev.until) return prev.until; // already paused: don't escalate twice for one check
    const recent = prev.until && now - prev.until < 60 * 60 * 1000;
    const level = recent ? Math.min(prev.level + 1, 10) : 0;
    const until = now + Math.min(PAUSE_BASE_MS * 2 ** level, PAUSE_MAX_MS);
    try { localStorage.setItem(PAUSE_KEY, JSON.stringify({ until, level })); } catch (e) { /* ignore */ }
    return until;
  }
  const pausedUntil = () => readPause().until;
  class PausedError extends Error {
    constructor(until) { super('paused:' + until); this.until = until; }
  }

  async function queryPdp(productId) {
    if (Date.now() < pausedUntil()) throw new PausedError(pausedUntil());
    const mtop = await waitForMtop(15000);
    const L = locale();
    const data = {
      productId: String(productId),
      _lang: L.lang, _currency: L.currency, country: L.country,
      province: '', city: '', channel: '', pdp_ext_f: '', pdpNPI: '', sourceType: '', clientType: 'pc',
      ext: JSON.stringify({ site: L.site, crawler: false, 'x-m-biz-bx-region': '', signedIn: false, host: location.host }),
    };
    let res;
    try {
      res = await mtop.request({ api: 'mtop.aliexpress.pdp.pc.query', v: '1.0', type: 'GET', dataType: 'jsonp', timeout: 15000, data });
    } catch (err) {
      const ret = String((err && err.ret) || (err && err.message) || err);
      if (/USER_VALIDATE|RGV587|punish|deny|captcha|baxia/i.test(ret)) throw new PausedError(startPause());
      throw new Error(ret);
    }
    const result = res && res.data && res.data.result;
    if (!result || !result.SKU || !result.PRICE) {
      const gd = result && result.GLOBAL_DATA && result.GLOBAL_DATA.globalData;
      throw new Error((gd && gd.errorCode) || 'no SKU data');
    }
    return trim(result, L.currency);
  }

  // ---------- paced queue ----------
  // Up to MAX_CONCURRENT lookups at a time, paced by the bucket above; cards nearer the top of the
  // page go first. During a pause, everything waiting is rejected with the pause end time, so
  // content.js can retry those cards later.
  /** Records a start if the rolling window has room; returns 0, or ms until a slot frees up. */
  let memStarts = []; // fallback if localStorage is unavailable
  function takeSlot() {
    const now = Date.now();
    let starts;
    try { starts = JSON.parse(localStorage.getItem(WINDOW_KEY)); } catch (e) { starts = memStarts; }
    starts = (Array.isArray(starts) ? starts : memStarts).filter((t) => isFinite(t) && now - t < WINDOW_MS && t <= now);
    if (starts.length >= MAX_PER_WINDOW) {
      return Math.max(50, Math.min(...starts) + WINDOW_MS - now + 50);
    }
    starts.push(now);
    memStarts = starts;
    try { localStorage.setItem(WINDOW_KEY, JSON.stringify(starts)); } catch (e) { /* ignore */ }
    return 0;
  }

  const queue = [];
  let running = 0;
  let wakeTimer = null;
  let lastStart = 0;
  function enqueue(fn, reqId, rank) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject, reqId, rank: isFinite(rank) ? rank : Infinity });
      pump();
    });
  }
  /** Drops a request that hasn't started yet (its card scrolled out of view). */
  function cancel(reqId) {
    const i = queue.findIndex((j) => j.reqId === reqId);
    if (i >= 0) queue.splice(i, 1)[0].reject(new Error('cancelled'));
  }
  // Tell content.js when the per-minute limit is holding lookups back (until = when the next slot
  // frees up; 0 = lookups flowing again), so waiting cards can show it.
  let limitUntil = 0;
  function announceLimit(until) {
    if (Math.abs(until - limitUntil) < 500) return;
    limitUntil = until;
    window.postMessage({ src: FROM_BRIDGE, type: 'limit', until }, location.origin);
  }

  function wake(ms) {
    if (wakeTimer) return;
    wakeTimer = setTimeout(() => { wakeTimer = null; pump(); }, ms);
  }
  function pump() {
    const until = pausedUntil();
    if (Date.now() < until) {
      while (queue.length) queue.shift().reject(new PausedError(until));
      return;
    }
    while (running < MAX_CONCURRENT && queue.length) {
      const jitter = START_JITTER_MS[0] + Math.random() * (START_JITTER_MS[1] - START_JITTER_MS[0]);
      const sinceLast = Date.now() - lastStart;
      if (sinceLast < jitter) return wake(jitter - sinceLast);
      const waitMs = takeSlot();
      if (waitMs) { announceLimit(Date.now() + waitMs); return wake(waitMs); }
      if (limitUntil) announceLimit(0);
      // Topmost card first.
      let best = 0;
      for (let i = 1; i < queue.length; i++) if (queue[i].rank < queue[best].rank) best = i;
      const job = queue.splice(best, 1)[0];
      running++;
      lastStart = Date.now();
      // Tell content.js the request is now in flight (its card switches from "queued" to "requesting").
      if (job.reqId) window.postMessage({ src: FROM_BRIDGE, type: 'started', id: job.reqId }, location.origin);
      job.fn().then(job.resolve, job.reject).finally(() => { running--; pump(); });
    }
  }

  // ---------- messaging ----------
  function reply(id, ok, payload) {
    window.postMessage({ src: FROM_BRIDGE, id, ok, data: ok ? payload : undefined, error: ok ? undefined : payload }, location.origin);
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.src !== FROM_CONTENT) return;
    const { id, type, productId, rank } = e.data;
    if (type === 'cancel') return cancel(id);
    if (!/^\d+$/.test(String(productId || ''))) return reply(id, false, 'bad productId');
    if (type === 'item') {
      if (!items.has(String(productId))) harvestInitData();
      return reply(id, true, items.get(String(productId)) || null);
    }
    if (type === 'pdp') {
      enqueue(() => queryPdp(productId), id, Number(rank)).then((d) => reply(id, true, d), (err) => reply(id, false, String(err && err.message || err)));
    }
  });

  // ---------- robot-check popup ----------
  // AliExpress's request library answers a rate-limited lookup by showing its own "are you a
  // robot?" popup (div.J_MIDDLEWARE_FRAME_WIDGET with a ".../punish?..." iframe) and keeping the
  // request waiting, instead of returning an error. So watch for the popup itself.
  let popupShown = false;
  function checkRobotPopup() {
    const w = document.querySelector('.J_MIDDLEWARE_FRAME_WIDGET');
    const visible = !!w && w.style.display !== 'none' && !!w.querySelector('iframe[src*="punish"], iframe[src*="captcha"]');
    if (visible && !popupShown) {
      popupShown = true;
      const until = startPause();
      while (queue.length) queue.shift().reject(new PausedError(until));
      window.postMessage({ src: FROM_BRIDGE, type: 'paused', until }, location.origin);
    } else if (!visible) {
      popupShown = false;
    }
  }
  let popupCheckScheduled = false;
  new MutationObserver(() => {
    if (popupCheckScheduled) return;
    popupCheckScheduled = true;
    setTimeout(() => { popupCheckScheduled = false; checkRobotPopup(); }, 200);
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });

  harvestInitData();
  document.addEventListener('DOMContentLoaded', harvestInitData);
  window.addEventListener('load', harvestInitData);
})();
