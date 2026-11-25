const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/analyze.js');
const F = require('./fixtures.cjs');

const thumb = (pdp) => pdp.HEADER_IMAGE_PC.imagePathList[0] + '_480x480q75.jpg_.avif';

test('toy gun: bullets price is a trick, real price is cheapest gun', () => {
  const r = A.analyze({ item: { skuId: '12000060320477915', price: 3.74, thumb: thumb(F.toyGun), choice: false }, pdp: F.toyGun });
  assert.equal(r.isTrick, true);
  assert.equal(r.realPrice, 36.85);
  assert.equal(r.realPriceText, '₪36.85');
  assert.equal(r.method, 'price-gap');
  assert.equal(r.shipText, '₪7.49');
  assert.equal(r.totalText, '₪44.34');
});

test('example 2: "10sets" is a trick', () => {
  const r = A.analyze({ item: { skuId: '12000059751934904', price: 11.38 }, pdp: F.example2 });
  assert.equal(r.isTrick, true);
  assert.equal(r.realPrice, 55.26);
});

test('example 3: "24pcs" is a trick', () => {
  const r = A.analyze({ item: { skuId: '12000056782444519', price: 13.79 }, pdp: F.example3 });
  assert.equal(r.isTrick, true);
  assert.equal(r.realPrice, 78.39);
});

test('honest listing is not a trick and ignores unsalable SKUs', () => {
  const r = A.analyze({ item: { skuId: '12000039058843509', price: 126.8, choice: false }, pdp: F.honest });
  assert.equal(r.isTrick, false);
  assert.equal(r.realPrice, 126.8);
  assert.equal(r.maxText, '₪131.81');
  assert.equal(r.totalText, '₪134.29');
});

test('Choice and Bundle items skip shipping', () => {
  const c = A.analyze({ item: { skuId: '12000060320477915', price: 3.74, choice: true }, pdp: F.toyGun });
  assert.equal(c.shipping.status, 'skipped');
  assert.equal(c.shipping.reason, 'Choice');
  assert.equal(c.totalText, '');
  const b = A.analyze({ item: { skuId: '12000060320477915', price: 3.74, choice: false, bundle: true }, pdp: F.toyGun });
  assert.equal(b.shipping.reason, 'Bundle');
});

test('without search metadata, pdp CHOICE trace marks Choice', () => {
  const pdp = F.makePdp([['1', '1', 'a', '₪5.00', ''], ['2', '2', 'b', '₪50.00', '']], { trace: 'CHOICE' });
  const r = A.analyze({ item: { skuId: '1' }, pdp });
  assert.equal(r.shipping.reason, 'Choice');
});

test('free shipping', () => {
  const r = A.analyze({ item: { skuId: '12000039058843509', price: 126.8, choice: false, freeShip: true }, pdp: F.honest });
  assert.equal(r.shipping.status, 'free');
  assert.equal(r.totalText, '₪126.80');
});

test('exact thumbnail match on an expensive variant wins', () => {
  const item = { skuId: '12000060320477915', price: 3.74, thumb: F.IMG('S8e2b65560d65417e819659a37cfa53b3H.jpg') + '_480x480q75.jpg_.avif' };
  const r = A.analyze({ item, pdp: F.toyGun });
  assert.equal(r.method, 'image-exact');
  assert.equal(r.pickName, 'Blue Model B');
  assert.equal(r.realPrice, 66.25);
});

test('exact thumbnail match on the advertised accessory means no trick', () => {
  const item = { skuId: '12000060320477915', price: 3.74, thumb: '//ae-pic-a1.aliexpress-media.com/kf/S0de7d3160b894625ab2a626006ba1be9b.png_480x480.png' };
  const r = A.analyze({ item, pdp: F.toyGun });
  assert.equal(r.isTrick, false);
});

test('fuzzy hash match picks the matching high-group variant', () => {
  const item = { skuId: '12000060320477915', price: 3.74, thumb: thumb(F.toyGun) };
  const hashes = { [item.thumb]: 'ffff0000ffff0000' };
  for (const v of A.parseVariants(F.toyGun)) hashes[v.image] = '0000ffff0000ffff';
  hashes[F.IMG('S502e039eaa7f48bfaf0b1604e0ca77793.jpg')] = 'ffff0000ffff0001'; // Grey Model B
  const r = A.analyze({ item, pdp: F.toyGun, hashes });
  assert.equal(r.method, 'image+price-gap');
  assert.equal(r.pickName, 'Grey Model B');
  assert.equal(r.realPrice, 56.53);
});

test('helpers', () => {
  assert.equal(A.parseDisplayPrice('1.234,56 €'), 1234.56);
  assert.equal(A.parseDisplayPrice('US $12.29'), 12.29);
  assert.equal(A.parsePrice('₪2,083.90|2083|90'), 2083.9);
  assert.equal(A.formatLike('12,29 €', 1234.5), '1234,50 €');
  assert.equal(A.formatLike('US $1,012.29', 1234.5), 'US $1,234.50');
  assert.equal(A.hamming('ffffffffffffffff', '0000000000000000'), 64);
  const npi = A.parseNpi('6@dis!ILS!260.16!126.80!!!528.89!257.77!@0be71e1917940849029137417e0ffb!12000039058843509!sea!IL!0!ABX!1!0!n_tag');
  assert.deepEqual(npi, { currency: 'ILS', price: 126.8, skuId: '12000039058843509' });
  assert.equal(A.needsImageCheck(F.toyGun), true);
  assert.equal(A.needsImageCheck(F.honest), false);
});

test('high group starting with a bigger accessory pack picks the first real item', () => {
  // live: https://he.aliexpress.com/item/1005013286529548.html
  const pdp = F.makePdp([
    ['1', '1', 'bullet 1000Pcs', '₪21.45', 'a.jpg'],
    ['2', '2', 'bullet 2000pcs', '₪56.28', 'b.jpg'],
    ['3', '3', 'bullet 300Pcs', '₪60.42', 'a.jpg'],
    ['4', '4', 'Medium Version', '₪91.70', 'c.jpg'],
    ['5', '5', 'Low Version', '₪93.10', 'd.jpg'],
  ]);
  const r = A.analyze({ item: { skuId: '1', price: 21.45, choice: true }, pdp });
  assert.equal(r.isTrick, true);
  assert.equal(r.pickName, 'Medium Version');
  assert.equal(r.realPriceText, '₪91.70');
});

test('no price gap but accessory-named advertised variant', () => {
  const pdp = F.makePdp([
    ['1', '1', '1 toy magazine', '₪7.74', ''],
    ['2', '2', '5 packs toy balls', '₪9.00', ''],
    ['3', '3', 'Standard', '₪16.00', ''],
    ['4', '4', 'Deluxe', '₪26.28', ''],
  ]);
  const r = A.analyze({ item: { skuId: '1', price: 7.74 }, pdp });
  assert.equal(r.isTrick, true);
  assert.equal(r.method, 'name');
  assert.equal(r.realPrice, 16);
});

test('gradual prices with a non-accessory advertised variant are left alone', () => {
  // live: 1005013205040335 — "Low Version" 5.26 among 3.61..26.28
  const pdp = F.makePdp([
    ['1', '1', '1 pack toy balls', '₪3.61', ''],
    ['2', '2', 'Low Version', '₪5.26', ''],
    ['3', '3', 'High Version', '₪9.55', ''],
    ['4', '4', 'Medium Version', '₪11.18', ''],
    ['5', '5', 'Full Version', '₪26.28', ''],
  ]);
  const r = A.analyze({ item: { skuId: '2', price: 5.26 }, pdp });
  assert.equal(r.isTrick, false);
});

// ---- bigger packs / full sets are not tricks (live items, 2026-11-10) ----
const thumbOf = (pdp) => pdp.HEADER_IMAGE_PC.imagePathList[0];

test('single colours vs a 6pcs set shown in the thumbnail: no trick', () => {
  // https://he.aliexpress.com/item/1005012097576589.html
  const pdp = F.makePdp([
    ['1', '1', '6pcs', '$8.53', 'set.jpg'],
    ['2', '2', 'Green', '$2.00', 'g.jpg'],
    ['3', '3', 'Purple', '$1.97', 'p.jpg'],
    ['4', '4', 'Blue', '$2.07', 'b.jpg'],
    ['5', '5', 'Black', '$2.00', 'k.jpg'],
    ['6', '6', 'fawn', '$1.97', 'f.jpg'],
    ['7', '7', 'Red', '$2.16', 'r.jpg'],
  ], { mainImage: 'main.jpg' });
  const r = A.analyze({ item: { skuId: '3', price: 1.97, thumb: thumbOf(pdp) }, pdp });
  assert.equal(r.isTrick, false);
});

test('thumbnail is exactly the "SET OF 6 PCS" variant photo: no trick', () => {
  // https://he.aliexpress.com/item/1005012991255612.html
  const pdp = F.makePdp([
    ['1', '1', 'D', '$2.93', 'd.jpg'],
    ['2', '2', 'C', '$2.62', 'c.jpg'],
    ['3', '3', 'B', '$2.59', 'b.jpg'],
    ['4', '4', 'A', '$2.62', 'a.jpg'],
    ['5', '5', 'SET OF 6 PCS', '$12.97', 'main.jpg'],
    ['6', '6', 'F', '$2.71', 'f.jpg'],
    ['7', '7', 'E', '$2.52', 'e.jpg'],
  ], { mainImage: 'main.jpg' });
  const r = A.analyze({ item: { skuId: '7', price: 2.52, thumb: thumbOf(pdp) }, pdp });
  assert.equal(r.isTrick, false);
});

test('pack sizes only (4pcs .. 100pcs): no trick', () => {
  // https://he.aliexpress.com/item/1005013455569311.html
  const pdp = F.makePdp([
    ['1', '1', '80pcs', '$23.02', 'x.jpg'],
    ['2', '2', '100pcs', '$27.77', 'x.jpg'],
    ['3', '3', '4pcs', '$1.91', 'x.jpg'],
    ['4', '4', '8pcs', '$3.05', 'x.jpg'],
    ['5', '5', '20pcs', '$7.15', 'x.jpg'],
    ['6', '6', '40pcs', '$11.66', 'x.jpg'],
  ], { mainImage: 'main.jpg' });
  const hashes = { [thumbOf(pdp)]: 'ffff0000ffff0000', [F.IMG('x.jpg')]: 'ffff0000ffff0001' };
  const r = A.analyze({ item: { skuId: '3', price: 1.91, thumb: thumbOf(pdp) }, pdp, hashes });
  assert.equal(r.isTrick, false);
});

test('1pc vs 10pcs: no trick', () => {
  // https://he.aliexpress.com/item/1005013004626396.html
  const pdp = F.makePdp([
    ['1', '1', '10pcs', '$12.25', 'ten.jpg'],
    ['2', '2', '1pc', '$1.91', 'one.jpg'],
  ], { mainImage: 'ten.jpg' });
  const r = A.analyze({ item: { skuId: '2', price: 1.91, thumb: thumbOf(pdp) }, pdp });
  assert.equal(r.isTrick, false);
});

test('a set that costs far more per piece is still a different product', () => {
  const pdp = F.makePdp([
    ['1', '1', '1pc', '$2.00', ''],
    ['2', '2', 'Deluxe set 3pcs', '$30.00', ''],
  ]);
  const r = A.analyze({ item: { skuId: '1', price: 2 }, pdp });
  assert.equal(r.isTrick, true);
  assert.equal(r.realPrice, 30);
});

test('quantityOf', () => {
  assert.equal(A.quantityOf('SET OF 6 PCS'), 6);
  assert.equal(A.quantityOf('10sets'), 10);
  assert.equal(A.quantityOf('Electronic / 80pcs'), 80);
  assert.equal(A.quantityOf('pack of 3'), 3);
  assert.equal(A.quantityOf('Blue Model A'), 1);
  assert.equal(A.quantityOf('28CM ( White )'), 1);
});
