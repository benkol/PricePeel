// Compact versions of real mtop.aliexpress.pdp.pc.query results captured on he.aliexpress.com (ILS), 2026-11-07.
// Each variant: [skuId, valueId, name, salePriceString, imageFile]
const IMG = (f) => `https://ae-pic-a1.aliexpress-media.com/kf/${f}`;

function makePdp(variants, { shippingFee = 'charge', ship = '7.49', trace = 'NON', mainImage, salable = {} } = {}) {
  return {
    currency: 'ILS',
    SKU: {
      skuPaths: variants.map(([id, val, name]) => ({
        path: `14:${val}`, skuAttr: `14:${val}#${name}`, skuIdStr: id, salable: salable[id] === false ? 'false' : 'true',
      })),
      skuProperties: [{
        skuPropertyId: '14',
        skuPropertyValues: variants.map(([, val, name, , img]) => ({
          propertyValueIdLong: val, propertyValueDisplayName: name, skuPropertyImagePath: img ? IMG(img) : '',
        })),
      }],
    },
    PRICE: {
      skuIdStrPriceInfoMap: Object.fromEntries(variants.map(([id, , , price]) => {
        const [i, d] = price.replace(/[^\d.]/g, '').split('.');
        return [id, { salePriceString: price, salePriceLocal: `${price}|${i}|${d}` }];
      })),
    },
    HEADER_IMAGE_PC: { imagePathList: [mainImage ? IMG(mainImage) : ''] },
    SHIPPING: {
      originalLayoutResultList: [{
        bizData: { displayAmount: ship, shippingFee, displayCurrency: 'ILS', etaTraceId: `9#16#X#${trace}#` },
      }],
    },
  };
}

// https://he.aliexpress.com/item/1005013130557216.html — toy gun kit, advertised price is "20PCS bullets"
const toyGun = makePdp([
  ['12000060320477915', '10', '20PCS bullets', '₪3.74', 'S0de7d3160b894625ab2a626006ba1be9b.png'],
  ['12000060320477916', '200002984', '100PCS bullets', '₪8.90', 'S24ee0ca7d3d14a94aee079dd29486049v.png'],
  ['12000060320477917', '366', '6PCS bullet casings', '₪6.83', 'Sc652b725bb584349ad5ace40541e285dX.png'],
  ['12000060320477918', '350852', '1PCS orange magazine', '₪9.76', 'S194a33dbb4f34e0d8216e5c1d778e4d7a.jpg'],
  ['12000060320477919', '1254', '1PCS blue magazine', '₪9.76', 'Sf769845f019840508dafef4e70bce278P.jpg'],
  ['12000060320477920', '173', 'Blue Model A', '₪36.85', 'Sf2ac566711cc415bbbbb43a4dfbb879dI.jpg'],
  ['12000060320477921', '200006151', 'Grey Model A', '₪36.85', 'S8a17fa491ac84d86854a437d7ed5ff56t.jpg'],
  ['12000060320477922', '200004870', 'Blue Model B', '₪66.25', 'S8e2b65560d65417e819659a37cfa53b3H.jpg'],
  ['12000060320477923', '691', 'Grey Model B', '₪56.53', 'S502e039eaa7f48bfaf0b1604e0ca77793.jpg'],
], { mainImage: 'Sef4bfdc5851248dab9f59f994bc135c2g.jpg' });

// https://he.aliexpress.com/item/1005012910727845.html — advertised "10sets"
const example2 = makePdp([
  ['12000059751934907', '366', '5', '₪73.78', 'Sa1a2ec81fa4d4470ab430e207d9b5bfel.jpg'],
  ['12000059751934906', '173', '4', '₪73.78', 'S40c8ba80b1974641848cbca733c23ad3a.jpg'],
  ['12000059751934905', '691', '3', '₪62.90', 'S85b77051eeaf48aeb7a53559e5efc3e4G.jpg'],
  ['12000059751934904', '10', '10sets', '₪11.38', 'S494f19bb5d2948efb542924f375d21fb7.jpg'],
  ['12000059751934911', '350850', 'White-Gold', '₪62.05', 'Sbe185b1730814a58b5987116567e51a4n.jpeg'],
  ['12000059751934910', '350853', '12', '₪15.04', 'S1c584473230b4091a07d9b0432f0480aG.jpg'],
  ['12000059751934909', '496', '7', '₪55.97', 'S99654bac302443f48770428a9de15223m.jpg'],
  ['12000059751934908', '1052', '6', '₪68.30', 'S55d1325e1ed04237bf8f0143598cb4d3t.jpg'],
  ['12000059751934903', '175', '2', '₪55.97', 'Sdaf783d32d5f42a69ab5d0a076b9dfa0o.jpg'],
  ['12000059751934902', '193', '10', '₪55.97', 'Sa68616193ffd4eb68573e9c47d399c4a4.jpg'],
  ['12000059751934901', '29', '1', '₪55.26', 'S0e7664aa8fd14432b40a68eaf8186712N.jpg'],
], { mainImage: 'S6d6ea260c2014e3bb60b759576f8d7821.jpg' });

// https://he.aliexpress.com/item/1005011849049774.html — advertised "24pcs"
const example3 = makePdp([
  ['12000056782444519', '691', '24pcs', '₪13.79', 'Sdf9e875eba204e9899c38fdb37d31441W.jpg'],
  ['12000056782444518', '175', '8689E', '₪78.39', 'S469c7cf55b504597a75f05bf3cea85aaJ.jpg'],
], { mainImage: 'Seefb054217834845999117ae4c49402bu.jpg' });

// https://he.aliexpress.com/item/1005007011779260.html — honest listing; two unsalable SKUs at absurd prices
const honest = makePdp([
  ['12000039058843508', '10', 'Red', '₪131.81', 'S9c81193eef4e4c68b6fb69bf80e54645N.jpg'],
  ['12000039058843509', '173', 'Blue', '₪126.80', 'S5514175ff0714dd2a2b8074d1e887d58e.jpg'],
  ['12000039058843506', '100016350', 'X', '₪2083.90', ''],
  ['12000039058843507', '29', 'Black Red', '₪126.26', 'S0cf714220201446da6559ab3369d38cdZ.jpg'],
  ['12000061416976468', '193', 'Black Golden', '₪127.81', 'S44a41dfa015f4b7587e25cfed3002b77j.jpg'],
], { mainImage: 'S4fe7dc4e3c444e2491fbf075db48ded47.jpg', salable: { '12000039058843506': false } });

module.exports = { toyGun, example2, example3, honest, makePdp, IMG };
