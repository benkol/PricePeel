/*
 * Pure price-analysis logic (no DOM, no chrome APIs).
 * Loaded as a content script (exposes globalThis.PricePeel) and by node tests (module.exports).
 */
(function (root) {
  'use strict';

  const GAP_RATIO = 2.5;        // min jump between neighbouring prices to split accessories from the item
  const TRICK_RATIO = 1.5;      // picked price must exceed the advertised one by this much to count as a trick
  const SPREAD_FOR_IMAGES = 1.5; // only bother hashing images when prices spread at least this much
  const HASH_MAX_DIST = 10;     // of 64 bits
  const HASH_MIN_MARGIN = 4;    // best match must beat the runner-up by this many bits

  // Variant names that describe an add-on rather than the product itself (seller names are mostly English).
  const ACCESSORY_RE = /\b(bullets?|balls?|beads?|darts?|ammo|magazines?|mags?|clips?|shells?|casings?|refills?|batter(?:y|ies)|chargers?|cables?|straps?|stickers?|accessor(?:y|ies)|spares?|replacements?|protectors?|films?)\b/i;
  const QUANTITY_ONLY_RE = /^\s*\d+\s*(pcs|pc|pieces?|sets?|packs?|bags?|pairs?)\s*$/i;
  function looksLikeAccessory(name) {
    const n = String(name || '');
    return ACCESSORY_RE.test(n) || QUANTITY_ONLY_RE.test(n);
  }

  // How many pieces a variant name says it contains: "6pcs", "SET OF 6 PCS", "10sets", "pack of 3", "2x".
  const QTY_RES = [
    /\b(?:set|pack|lot|bag|box|kit)\s*of\s*(\d+)/i,
    /(\d+)\s*(?:pcs|pc|pieces?|packs?|sets?|pairs?|rolls?|bags?|units?|count|ct)\b/i,
    /\b(\d+)\s*x\b/i,
    /\bx\s*(\d+)\b/i,
  ];
  function quantityOf(name) {
    const n = String(name || '');
    for (const re of QTY_RES) {
      const m = n.match(re);
      if (m && +m[1] > 0 && +m[1] < 100000) return +m[1];
    }
    return 1;
  }
  const BULK_UNIT_RATIO = 2; // a bigger pack may cost up to this much more per piece and still be "just more of the same"

  /**
   * True when v is a bigger pack/set of the advertised variant rather than a different, pricier
   * product: e.g. "1pc" vs "10pcs", or single colours vs "SET OF 6 PCS" (thumbnails often show
   * the whole set just to display the variety).
   */
  function isBulkOf(v, advertised, advPrice) {
    const qv = quantityOf(v.name);
    const qa = quantityOf(advertised.name);
    if (qv <= qa) return false;
    return v.price / qv <= (advPrice / qa) * BULK_UNIT_RATIO;
  }

  /** "₪2,083.90|2083|90" -> 2083.9 ; falls back to parsing a display string. */
  function parsePrice(local, display) {
    if (typeof local === 'string') {
      const parts = local.split('|');
      if (parts.length >= 3 && /^\d+$/.test(parts[1]) && /^\d*$/.test(parts[2])) {
        return Number(parts[1] + '.' + (parts[2] || '0'));
      }
    }
    return parseDisplayPrice(display != null ? display : local);
  }

  /** Parses "₪1,234.56", "1.234,56 €", "US $12.29", "12,29 zł". */
  function parseDisplayPrice(s) {
    if (s == null) return NaN;
    if (typeof s === 'number') return s;
    const m = String(s).match(/\d[\d.,\s  ]*/);
    if (!m) return NaN;
    let n = m[0].replace(/[\s  ]/g, '').replace(/[.,]$/, '');
    const lastSep = Math.max(n.lastIndexOf('.'), n.lastIndexOf(','));
    if (lastSep >= 0 && n.length - lastSep - 1 <= 2) {
      n = n.slice(0, lastSep).replace(/[.,]/g, '') + '.' + n.slice(lastSep + 1);
    } else {
      n = n.replace(/[.,]/g, '');
    }
    return Number(n);
  }

  /** Formats n using a sample price string as the template (symbol position, decimal separator). */
  function formatLike(sample, n) {
    if (!isFinite(n)) return '';
    const s = String(sample || '');
    const m = s.match(/^([^\d]*)([\d.,\s  ]*\d)([^\d]*)$/);
    if (!m) return n.toFixed(2);
    const [, prefix, num, suffix] = m;
    const decComma = /,\d{1,2}$/.test(num);
    const thousands = decComma ? (/\./.test(num) ? '.' : '') : (/,/.test(num) ? ',' : '');
    let [int, dec] = n.toFixed(2).split('.');
    if (thousands) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
    return prefix + int + (decComma ? ',' : '.') + dec + suffix;
  }

  /** Strips AliExpress CDN size/format suffixes and protocol so URLs can be compared. */
  function normalizeImg(url) {
    if (!url) return '';
    let u = String(url).trim().replace(/^https?:/, '').replace(/^\/\//, '');
    u = u.replace(/\?.*$/, '');
    const m = u.match(/^(.*?\.(?:jpe?g|png|webp|avif|gif))(?:_.*)?$/i);
    if (m) u = m[1];
    u = u.replace(/^ae-pic-a\d\.aliexpress-media\.com/, 'ae-pic.aliexpress-media.com')
         .replace(/^ae\d{2}\.alicdn\.com/, 'ae-pic.aliexpress-media.com');
    return u.toLowerCase();
  }

  function hamming(a, b) {
    if (!a || !b || a.length !== b.length) return Infinity;
    let d = 0;
    for (let i = 0; i < a.length; i += 8) {
      let x = (parseInt(a.substr(i, 8), 16) ^ parseInt(b.substr(i, 8), 16)) >>> 0;
      while (x) { d += x & 1; x >>>= 1; }
    }
    return d;
  }

  /** Builds [{skuId, name, price, priceText, image, salable}] from a (trimmed) pdp result. */
  function parseVariants(pdp) {
    const sku = (pdp && pdp.SKU) || {};
    const priceMap = (pdp && pdp.PRICE && pdp.PRICE.skuIdStrPriceInfoMap) || {};
    const valueInfo = {}; // "propId:valueId" -> {name, image}
    for (const prop of sku.skuProperties || []) {
      for (const v of prop.skuPropertyValues || []) {
        valueInfo[prop.skuPropertyId + ':' + v.propertyValueIdLong] = {
          name: v.propertyValueDisplayName || v.propertyValueName || '',
          image: v.skuPropertyImagePath || '',
        };
      }
    }
    const out = [];
    for (const p of sku.skuPaths || []) {
      const id = String(p.skuIdStr || p.skuId);
      const info = priceMap[id];
      if (!info) continue;
      const price = parsePrice(info.salePriceLocal, info.salePriceString);
      if (!isFinite(price)) continue;
      const segs = String(p.path || '').split(';').filter(Boolean);
      const attrNames = String(p.skuAttr || '').split(';').map((a) => (a.split('#')[1] || '').trim());
      const names = segs.map((seg, i) => attrNames[i] || (valueInfo[seg] && valueInfo[seg].name) || '').filter(Boolean);
      const imgSeg = segs.find((seg) => valueInfo[seg] && valueInfo[seg].image);
      out.push({
        skuId: id,
        name: names.join(' / '),
        price,
        priceText: info.salePriceString || '',
        image: imgSeg ? valueInfo[imgSeg].image : '',
        salable: String(p.salable) !== 'false' && p.skuStock !== '0',
      });
    }
    return out;
  }

  function salableVariants(pdp) {
    const all = parseVariants(pdp);
    const s = all.filter((v) => v.salable);
    return s.length ? s : all;
  }

  /** True when image hashing could change the outcome. */
  function needsImageCheck(pdp) {
    const vs = salableVariants(pdp);
    if (vs.length < 2) return false;
    const prices = vs.map((v) => v.price);
    const imgs = new Set(vs.map((v) => normalizeImg(v.image)).filter(Boolean));
    return imgs.size >= 2 && Math.max(...prices) >= Math.min(...prices) * SPREAD_FOR_IMAGES;
  }

  /** Splits sorted distinct prices at the biggest ratio jump. */
  function priceGap(variants) {
    const prices = [...new Set(variants.map((v) => v.price))].filter((p) => p > 0).sort((a, b) => a - b);
    let best = { ratio: 1, low: Infinity };
    for (let i = 0; i < prices.length - 1; i++) {
      const r = prices[i + 1] / prices[i];
      if (r > best.ratio) best = { ratio: r, low: prices[i], high: prices[i + 1] };
    }
    return best;
  }

  /**
   * @param {object} args
   * @param {object} args.item   {skuId, price, thumb, choice, bundle, freeShip} from the search card
   * @param {object} args.pdp    trimmed pdp result
   * @param {object} [args.hashes] {url: hex dHash} for item.thumb and variant images
   */
  function analyze({ item, pdp, hashes }) {
    item = item || {};
    const variants = salableVariants(pdp);
    if (!variants.length) return null;

    const sorted = [...variants].sort((a, b) => a.price - b.price);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];

    // Advertised variant: the one the search card priced, else the cheapest.
    let advertised = item.skuId && variants.find((v) => v.skuId === String(item.skuId));
    if (!advertised) advertised = min;
    const advPrice = isFinite(item.price) && item.price > 0 ? Math.min(item.price, advertised.price) : advertised.price;

    // --- Image match ---
    let imagePick = null;
    let imageExact = false;
    const thumbN = normalizeImg(item.thumb);
    if (thumbN) {
      const exact = variants.filter((v) => normalizeImg(v.image) === thumbN);
      if (exact.length) {
        imagePick = exact.sort((a, b) => a.price - b.price)[0];
        imageExact = true;
      }
    }
    if (!imagePick && hashes && item.thumb && hashes[item.thumb]) {
      const th = hashes[item.thumb];
      const byImg = new Map(); // normalized image -> {dist, variants}
      for (const v of variants) {
        const h = v.image && hashes[v.image];
        if (!h) continue;
        const key = normalizeImg(v.image);
        if (!byImg.has(key)) byImg.set(key, { dist: hamming(th, h), variants: [] });
        byImg.get(key).variants.push(v);
      }
      const ranked = [...byImg.values()].sort((a, b) => a.dist - b.dist);
      if (ranked.length && ranked[0].dist <= HASH_MAX_DIST &&
          (ranked.length === 1 || ranked[1].dist - ranked[0].dist >= HASH_MIN_MARGIN)) {
        imagePick = ranked[0].variants.sort((a, b) => a.price - b.price)[0];
      }
    }
    // A photo of the whole set / a bigger pack isn't a different product: no trick.
    const bulk = (v) => isBulkOf(v, advertised, advPrice);
    if (imagePick && bulk(imagePick)) { imagePick = null; imageExact = false; }

    // --- Price gap ---
    const gap = priceGap(variants);
    let gapPick = null;
    let gapHigh = gap.high;
    let gapMethod = 'price-gap';
    if (gap.ratio >= GAP_RATIO && advPrice <= gap.low * 1.0001) {
      const high = sorted.filter((v) => v.price >= gap.high && !bulk(v));
      gapPick = high.find((v) => !looksLikeAccessory(v.name)) || high[0] || null;
      if (gapPick) gapHigh = gapPick.price;
    } else if (looksLikeAccessory(advertised.name)) {
      // No clear price gap, but the advertised variant is named like an accessory:
      // use the cheapest clearly-more-expensive variant that isn't.
      const cand = sorted.find((v) => v.price > advPrice * TRICK_RATIO && !looksLikeAccessory(v.name) && !bulk(v));
      if (cand) { gapPick = cand; gapHigh = cand.price; gapMethod = 'name'; }
    }

    // --- Combine ---
    let pick = advertised;
    let method = 'none';
    if (imagePick && imageExact) {
      pick = imagePick; method = 'image-exact';
    } else if (gapPick) {
      if (imagePick && imagePick.price >= gapHigh) { pick = imagePick; method = 'image+price-gap'; }
      else { pick = gapPick; method = gapMethod; }
    } else if (imagePick && imagePick.price > advPrice * TRICK_RATIO) {
      pick = imagePick; method = 'image';
    }
    const isTrick = pick.price > advPrice * TRICK_RATIO;
    if (!isTrick) { pick = advertised; }
    const realPrice = isTrick ? pick.price : advPrice;

    // --- Shipping ---
    const ship = shippingInfo(item, pdp);
    const sample = pick.priceText || advertised.priceText || min.priceText;
    const total = ship.status === 'charge' ? realPrice + ship.amount : (ship.status === 'free' ? realPrice : NaN);

    return {
      isTrick,
      method,
      variantCount: variants.length,
      advertisedPrice: advPrice,
      realPrice,
      realPriceText: isTrick ? (pick.priceText || formatLike(sample, realPrice)) : formatLike(sample, realPrice),
      pickName: pick.name,
      advertisedName: advertised.name,
      minText: min.priceText || formatLike(sample, min.price),
      maxText: max.priceText || formatLike(sample, max.price),
      shipping: ship,
      shipText: ship.status === 'charge' ? formatLike(sample, ship.amount) : '',
      total,
      totalText: isFinite(total) ? formatLike(sample, total) : '',
    };
  }

  function shippingInfo(item, pdp) {
    const opts = (pdp && pdp.SHIPPING && pdp.SHIPPING.originalLayoutResultList) || [];
    const biz = (opts[0] && opts[0].bizData) || null;
    const hasItemMeta = item && (item.choice !== undefined);
    const choice = hasItemMeta ? !!item.choice : !!(biz && /#CHOICE#/.test(biz.etaTraceId || ''));
    if (choice) return { status: 'skipped', reason: 'Choice', amount: 0 };
    if (item && item.bundle) return { status: 'skipped', reason: 'Bundle', amount: 0 };
    if (item && item.freeShip) return { status: 'free', amount: 0 };
    if (!biz) return { status: 'unknown', amount: 0 };
    if (String(biz.shippingFee).toLowerCase() === 'free') return { status: 'free', amount: 0 };
    const cur = pdp.currency;
    if (cur && biz.displayCurrency && biz.displayCurrency !== cur) return { status: 'unknown', amount: 0 };
    const amount = parseDisplayPrice(biz.displayAmount);
    if (!isFinite(amount)) return { status: 'unknown', amount: 0 };
    return amount === 0 ? { status: 'free', amount: 0 } : { status: 'charge', amount };
  }

  /** pdp_npi: "6@dis!ILS!260.16!126.80!!!528.89!257.77!@trace!12000039058843509!sea!IL!..." */
  function parseNpi(npi) {
    if (!npi) return null;
    const parts = String(npi).split('!');
    const at = parts.findIndex((p, i) => i > 0 && p.startsWith('@'));
    const skuId = at > 0 && /^\d{10,}$/.test(parts[at + 1] || '') ? parts[at + 1] : null;
    const sale = parseDisplayPrice(parts[3]);
    return { currency: parts[1] || null, price: isFinite(sale) ? sale : NaN, skuId };
  }

  const api = {
    parsePrice, parseDisplayPrice, formatLike, normalizeImg, hamming,
    parseVariants, needsImageCheck, priceGap, analyze, shippingInfo, parseNpi, looksLikeAccessory,
    quantityOf, isBulkOf,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PricePeel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
