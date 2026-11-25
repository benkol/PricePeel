#!/usr/bin/env node
// Local test of the official AliExpress Open Platform (Dropshipping) product API, to compare its
// data with what the extension gets from the page's own product endpoint. Not used by the
// extension itself.
//
// Credentials come only from environment variables, never from files in this project:
//   AE_APP_KEY       your app's App Key
//   AE_APP_SECRET    your app's App Secret (keep it private)
//   AE_ACCESS_TOKEN  from step 2 below
//   AE_CALLBACK      your app's registered callback URL (for step 1)
// Optional: AE_COUNTRY (IL), AE_CURRENCY (USD),
//           AE_LANGUAGE (en)
//
// Steps:
//   1. node tools/ae-api-test.js auth-url        -> open the printed URL, approve, copy ?code= from the address bar
//   2. node tools/ae-api-test.js token <code>    -> prints an access token; set it as AE_ACCESS_TOKEN
//   3. node tools/ae-api-test.js products [id…]  -> fetches products, prints variants and the extension's verdict
//      (add --raw to also save the raw responses to tools/out/)
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const A = require('../src/analyze.js');

const GATEWAY = 'https://api-sg.aliexpress.com';
const env = (k, d) => process.env[k] || d;
const CALLBACK = () => need('AE_CALLBACK');
const COUNTRY = env('AE_COUNTRY', 'IL');
const CURRENCY = env('AE_CURRENCY', 'USD');
const LANGUAGE = env('AE_LANGUAGE', 'en');

// Items we already know from testing the extension.
const DEFAULT_IDS = [
  '1005009141787327', // SIG17 foam gun: thumbnail is variant "2"
  '1005013130557216', // toy gun kit: listed price is "20PCS bullets"
  '1005012910727845', // listed price is "10sets"
  '1005011849049774', // listed price is "24pcs"
  '1005013004626396', // 1pc vs 10pcs (not a trick)
];

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing environment variable ${name}. See the top of tools/ae-api-test.js.`);
    process.exit(1);
  }
  return v;
}

/**
 * Open Platform signature: sort params by name, concatenate name+value, prefix the API path for
 * "system" APIs (like /auth/token/create), HMAC-SHA256 with the App Secret, uppercase hex.
 */
function sign(params, secret, apiPath = '') {
  const base = apiPath + Object.keys(params).sort().map((k) => k + params[k]).join('');
  return crypto.createHmac('sha256', secret).update(base, 'utf8').digest('hex').toUpperCase();
}

async function call(urlPath, params, { apiPath = '' } = {}) {
  const secret = need('AE_APP_SECRET');
  const all = {
    app_key: need('AE_APP_KEY'),
    timestamp: String(Date.now()),
    sign_method: 'sha256',
    ...params,
  };
  all.sign = sign(all, secret, apiPath);
  const res = await fetch(GATEWAY + urlPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams(all).toString(),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { throw new Error(`HTTP ${res.status}, not JSON: ${text.slice(0, 300)}`); }
  if (json.error_response || (json.code && json.code !== '0')) {
    const e = json.error_response || json;
    throw new Error(`API error ${e.code || ''}: ${e.msg || e.message || JSON.stringify(e).slice(0, 300)}`);
  }
  return json;
}

// ---------- commands ----------
function authUrl() {
  const q = new URLSearchParams({
    response_type: 'code',
    force_auth: 'true',
    redirect_uri: CALLBACK(),
    client_id: need('AE_APP_KEY'),
  });
  console.log('Open this URL, sign in with your AliExpress account and approve the app:\n');
  console.log(`${GATEWAY}/oauth/authorize?${q}\n`);
  console.log(`You'll land on ${CALLBACK()}?code=... ; copy the code value and run:`);
  console.log('  node tools/ae-api-test.js token <code>');
}

async function token(code) {
  if (!code) { console.error('Usage: node tools/ae-api-test.js token <code>'); process.exit(1); }
  const apiPath = '/auth/token/create';
  const json = await call('/rest' + apiPath, { code }, { apiPath });
  const t = json.access_token ? json : (json.data || json);
  if (!t.access_token) throw new Error('No access_token in response: ' + JSON.stringify(json).slice(0, 300));
  const days = t.expires_in ? Math.round(Number(t.expires_in) / 86400) : '?';
  console.log('Access token (valid about ' + days + ' days). Set it for this terminal session:\n');
  console.log('  PowerShell:  $env:AE_ACCESS_TOKEN = "' + t.access_token + '"');
  console.log('  Git Bash:    export AE_ACCESS_TOKEN="' + t.access_token + '"');
  console.log('\nTreat it like a password: it lets this app act on your AliExpress account.');
}

const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);

/** Converts aliexpress.ds.product.get's SKU list to the shape src/analyze.js expects. */
function toPdpShape(result) {
  const skus = arr(result.ae_item_sku_info_dtos && result.ae_item_sku_info_dtos.ae_item_sku_info_d_t_o);
  const paths = [];
  const priceMap = {};
  const values = {}; // "propId:valueId" -> {name, image}
  for (const s of skus) {
    const props = arr(s.ae_sku_property_dtos && s.ae_sku_property_dtos.ae_sku_property_d_t_o);
    const segs = [];
    const names = [];
    for (const p of props) {
      const key = `${p.sku_property_id}:${p.property_value_id}`;
      const name = p.property_value_definition_name || p.sku_property_value || '';
      values[key] = values[key] || { name, image: p.sku_image || '' };
      segs.push(key);
      names.push(`${key}#${name}`);
    }
    const id = String(s.sku_id || s.id);
    const price = Number(s.offer_sale_price || s.sku_price);
    paths.push({
      path: segs.join(';'),
      skuAttr: names.join(';'),
      skuIdStr: id,
      salable: Number(s.sku_available_stock || s.ipm_sku_stock || 1) > 0 ? 'true' : 'false',
    });
    const [i, d = '00'] = price.toFixed(2).split('.');
    priceMap[id] = { salePriceString: `$${price.toFixed(2)}`, salePriceLocal: `$${price.toFixed(2)}|${i}|${d}` };
  }
  const byProp = {};
  for (const [key, v] of Object.entries(values)) {
    const [propId, valueId] = key.split(':');
    (byProp[propId] = byProp[propId] || []).push({
      propertyValueIdLong: valueId, propertyValueDisplayName: v.name, skuPropertyImagePath: v.image,
    });
  }
  const base = result.ae_item_base_info_dto || {};
  const mm = result.ae_multimedia_info_dto || {};
  return {
    currency: CURRENCY,
    SKU: { skuPaths: paths, skuProperties: Object.entries(byProp).map(([id, v]) => ({ skuPropertyId: id, skuPropertyValues: v })) },
    PRICE: { skuIdStrPriceInfoMap: priceMap },
    HEADER_IMAGE_PC: { imagePathList: String(mm.image_urls || '').split(';').filter(Boolean) },
    SHIPPING: { originalLayoutResultList: [] },
    _title: base.subject || '',
  };
}

async function products(ids, { raw, offline }) {
  const outDir = path.join(__dirname, 'out');
  if (!offline) need('AE_ACCESS_TOKEN');
  if (!ids.length) {
    ids = offline && fs.existsSync(outDir)
      ? fs.readdirSync(outDir).filter((f) => /^\d+\.json$/.test(f)).map((f) => f.slice(0, -5))
      : DEFAULT_IDS;
  }
  if (raw) fs.mkdirSync(outDir, { recursive: true });

  for (const id of ids) {
    console.log('\n' + '='.repeat(78));
    console.log(`Product ${id}  https://www.aliexpress.com/item/${id}.html`);
    let json;
    if (offline) {
      // Re-analyse a response saved earlier with --raw, without calling the API.
      try { json = JSON.parse(fs.readFileSync(path.join(outDir, `${id}.json`), 'utf8')); } catch (e) {
        console.log('  No saved response in tools/out/' + id + '.json');
        continue;
      }
    } else try {
      json = await call('/sync', {
        method: 'aliexpress.ds.product.get',
        access_token: process.env.AE_ACCESS_TOKEN,
        product_id: id,
        ship_to_country: COUNTRY,
        target_currency: CURRENCY,
        target_language: LANGUAGE,
      });
    } catch (e) {
      console.log('  ' + e.message);
      continue;
    }
    if (raw && !offline) fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify(json, null, 2));
    const resp = json.aliexpress_ds_product_get_response || json;
    const result = resp.result || resp;
    if (!result || !result.ae_item_sku_info_dtos) {
      console.log('  Unexpected response shape. Top-level keys:', Object.keys(resp).join(', '));
      console.log('  Re-run with --raw and look at tools/out/' + id + '.json');
      continue;
    }
    const pdp = toPdpShape(result);
    console.log('  ' + pdp._title.slice(0, 90));
    const variants = A.parseVariants(pdp).sort((a, b) => a.price - b.price);
    console.log(`  ${variants.length} variants (${CURRENCY}, ship to ${COUNTRY}):`);
    for (const v of variants) {
      console.log(`    ${v.salable ? ' ' : 'x'} ${v.priceText.padStart(10)}  ${v.name}`);
    }
    // The official API doesn't say which variant a search card advertises; assume the cheapest.
    const r = A.analyze({ item: { thumb: pdp.HEADER_IMAGE_PC.imagePathList[0] }, pdp });
    if (r) {
      console.log(r.isTrick
        ? `  Extension verdict: TRICK. Listed ${A.formatLike('$1', r.advertisedPrice)} is "${r.advertisedName}", real price ${r.realPriceText} for "${r.pickName}" (${r.method})`
        : `  Extension verdict: price is honest (${r.realPriceText})`);
    }
  }
  console.log('\nNote: aliexpress.ds.product.get takes one product per call; there is no bulk form.');
}

(async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  const raw = rest.includes('--raw');
  const offline = rest.includes('--offline');
  const args = rest.filter((a) => a !== '--raw' && a !== '--offline');
  try {
    if (cmd === 'auth-url') authUrl();
    else if (cmd === 'token') await token(args[0]);
    else if (cmd === 'products') await products(args, { raw, offline });
    else if (cmd === 'selftest') selftest();
    else {
      console.log('Usage:\n  node tools/ae-api-test.js auth-url\n  node tools/ae-api-test.js token <code>\n  node tools/ae-api-test.js products [productId ...] [--raw]');
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
})();

// Offline check of the signing and the response conversion (no network, fake keys).
function selftest() {
  const s1 = sign({ b: '2', a: '1' }, 'secret');
  const s2 = crypto.createHmac('sha256', 'secret').update('a1b2').digest('hex').toUpperCase();
  console.log('business API signature', s1 === s2 ? 'ok' : 'MISMATCH');
  const s3 = sign({ code: 'x' }, 'secret', '/auth/token/create');
  const s4 = crypto.createHmac('sha256', 'secret').update('/auth/token/createcodex').digest('hex').toUpperCase();
  console.log('system API signature  ', s3 === s4 ? 'ok' : 'MISMATCH');
  const fake = {
    ae_item_base_info_dto: { subject: 'Test gun kit' },
    ae_multimedia_info_dto: { image_urls: 'https://ae-pic-a1.aliexpress-media.com/kf/main.jpg' },
    ae_item_sku_info_dtos: { ae_item_sku_info_d_t_o: [
      { sku_id: 1, offer_sale_price: '1.25', sku_available_stock: 100, ae_sku_property_dtos: { ae_sku_property_d_t_o: [{ sku_property_id: 14, property_value_id: 10, property_value_definition_name: '20PCS bullets', sku_image: 'https://x/b.jpg' }] } },
      { sku_id: 2, offer_sale_price: '12.29', sku_available_stock: 100, ae_sku_property_dtos: { ae_sku_property_d_t_o: [{ sku_property_id: 14, property_value_id: 173, property_value_definition_name: 'Blue Model A', sku_image: 'https://x/g.jpg' }] } },
    ] },
  };
  const r = A.analyze({ item: {}, pdp: toPdpShape(fake) });
  console.log('conversion + analysis ', r && r.isTrick && r.realPrice === 12.29 ? 'ok' : 'UNEXPECTED ' + JSON.stringify(r));
}
