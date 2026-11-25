# PricePeel – real prices for AliExpress

**[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/pricepeel-%E2%80%93-real-prices-f/gmelcjdfagmgjphjnbemeioofkhoeocl)** · Website: https://pricepeel.benkol.com/ · [Privacy policy](https://pricepeel.benkol.com/privacy/) · [Contact](https://pricepeel.benkol.com/contact/)

A Chrome extension for AliExpress search results and the homepage product feed. Some listings show the price of a cheap accessory variant (bullets, a magazine, "24pcs") while the photo shows the main product. The extension peels back the top-right corner of the thumbnail to reveal the price of the item in the photo. AliExpress's own price stays where it is.

| Corner | Meaning |
|---|---|
| 🟧 Orange: **₪36.85** | The listed price belongs to a cheaper variant. This is the price of the pictured item. |
| ⬛ Dark: **₪134.29** | The listed price is honest, but shipping costs extra. This is the price with shipping. |
| *(no corner)* | The listed price is honest and there's no shipping fee to add (free shipping, Choice or Bundle). |

While a card is being checked, the same corner shows its progress in a small form: a tiny gray dog-ear (not checked yet), a slate one with three dots (waiting its turn), a slate one with a filling ring (waiting for AliExpress's per-minute limit; the ring completes when the next slot frees up), a gray-blue one with a pause sign (paused by a robot check), and an orange one that keeps lifting with pulsing dots (request in flight). When the check finishes it opens into the price corner, or folds away if there's nothing to show.

At rest the corner shows only the price, without a currency code ("$28.79", not "US $28.79"). Hover a card and the corner peels further, adds a "Real price" or "Total" title and shows details: the shipping and total, the variant in the photo, and the variant the listed price is really for. Shipping is left out for free-shipping, Choice and Bundle items, and when it couldn't be found.

## Install
Get it from the [Chrome Web Store](https://chromewebstore.google.com/detail/pricepeel-%E2%80%93-real-prices-f/gmelcjdfagmgjphjnbemeioofkhoeocl).

### From source (developer mode)
1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder (the one that contains `manifest.json`).
4. Open or reload an AliExpress search page, e.g. `https://he.aliexpress.com/w/wholesale-toy-gun.html`.

After editing any file, click the reload icon on the extension's card and refresh the AliExpress tab.

## How it decides
For each card, as it scrolls into view:
1. It reads the card data the page already holds: the advertised variant (SKU), the price, the thumbnail and the Choice/Bundle/free-shipping tags.
2. It fetches the product's variant list through the page's own `mtop.aliexpress.pdp.pc.query` client, in the page's own language and currency. A card is only looked up once it has been at least half visible for half a second; lookups run at most 2 at a time, topmost card first, and at most 16 in any 60 seconds (shared across tabs). That keeps under AliExpress's robot check, which tests showed at about 19-21 lookups per minute, so a fresh page fills its first 16 cards within seconds and a full 60-item page in about 3 minutes. Lookups are cancelled if the card scrolls away before its turn. Results are cached for 24 hours.
3. It picks the variant shown in the photo:
   - **Image match**: if the thumbnail is one of the variant photos, that variant wins. Otherwise the background worker compares small perceptual hashes (dHash) of the thumbnail and each variant photo, and a clear match is used.
   - **Price gap**: variant prices are sorted and split at the biggest jump (at least 2.5×). If the advertised price is in the cheap group, it shows the cheapest variant in the expensive group that isn't named like an accessory (bullets, balls, magazine, clip, battery, cable, "24pcs", …).
   - **Name**: when there's no big gap but the advertised variant is named like an accessory, it shows the cheapest clearly more expensive non-accessory variant.
4. Shipping is the listing's default shipping option. AliExpress only returns it for the default variant, so it can differ slightly for other variants.

## Files
- `manifest.json`: MV3 manifest
- `src/bridge.js`: runs in the page (MAIN world). Collects search data and calls the AliExpress product API.
- `src/content.js`: finds cards, runs the analysis and draws the labels
- `src/analyze.js`: pure decision logic, unit-tested
- `src/background.js`: service worker that hashes images
- `src/label.css`: the peeled-corner styles
- `test/`: Node tests built from real product data

## Tests
```bash
npm test
```

## Publishing
Everything for the Chrome Web Store is in `store/`:
- `store/CHECKLIST.md`: the steps, in order.
- `store/listing.md`: listing text, permission justifications and privacy-tab answers to paste into the dashboard.
- `store/site/`: the PricePeel website (home, privacy policy, contact form) for `pricepeel.benkol.com`; see the checklist for putting it online.

`npm run package` builds the upload, `dist/pricepeel-<version>.zip`, with only the files the extension needs.
`node tools/make-store-images.js` renders the store screenshots and promo tile into `store/images/` with headless Chrome, from demo pages that run the extension's real code.

## Limits
- It depends on AliExpress's current page and API structure. If AliExpress changes it, labels stop appearing. They don't show wrong data.
- Variant names come from sellers and are usually English. The accessory-word list covers common cases only.
- If AliExpress shows its "are you a robot?" check (the extension watches for AliExpress's own popup, since the request that triggers it is held open rather than failed), lookups pause for 10 minutes (doubling, up to 2 hours, if it happens again soon after) and a small note in the bottom-left corner says so. Cards still on screen are looked up after the pause.

## License
[MIT](LICENSE). PricePeel is an independent project and is not affiliated with, endorsed by or sponsored by AliExpress or Alibaba Group.
