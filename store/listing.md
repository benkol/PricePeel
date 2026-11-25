# PricePeel – Chrome Web Store listing

Copy these into the Chrome Web Store Developer Dashboard. Limits are noted where the dashboard enforces them.

## Store listing tab

**Name** (from the manifest, max 75): `PricePeel – real prices for AliExpress`

**Summary** (from the manifest's description, max 132):
> See the real price of the item in the photo on AliExpress search results, not the price of a cheap accessory variant.

**Category:** Shopping

**Language:** English

**Description:**

> Ever clicked an AliExpress listing for $2.15, only to find that's the price of a bag of bullets and the toy gun in the photo costs $12.29?
>
> Many listings show the price of their cheapest variant (an accessory, a refill, a single piece) next to a photo of the full product. PricePeel peels back the corner of each search result photo to reveal what the pictured item really costs.
>
> HOW IT WORKS
> • Looks at each product you scroll to and compares all its variants.
> • Works out which variant is the item in the photo, by matching the photo and spotting cheap accessory variants ("20PCS bullets", "1 magazine", "24pcs").
> • If the listed price belongs to something else, the photo's corner peels back to show the real price. Hover it for details: shipping, the total, and which variant the listed price was really for.
> • Shipping is added for regular items, not for Choice or Bundle deals.
> • Knows that a "10pcs" pack or a "set of 6" isn't a trick, just more of the same.
>
> PRIVATE BY DESIGN
> • Runs only on AliExpress pages.
> • Product details come straight from AliExpress, in your own browser.
> • Nothing is sent to us or to anyone else. No account, no tracking, no ads, no affiliate links.
>
> POLITE TO ALIEXPRESS
> PricePeel only checks products you actually look at, caches results for 24 hours, and stays under AliExpress's request limits. If AliExpress ever asks you to confirm you're not a robot, PricePeel pauses and tells you.
>
> PricePeel is an independent project and is not affiliated with, endorsed by or sponsored by AliExpress or Alibaba Group.

**Graphic assets:**
- Store icon 128×128: `icons/icon-128.png`
- Screenshots (1280×800), in this order:
  1. `store/images/screenshot-1-real-prices.png`: search results with real-price corners.
  2. `store/images/screenshot-2-details.png`: a hovered corner with the real price and variant names.
  3. `store/images/screenshot-3-progress.png`: the progress corners while products are checked.
- Small promo tile (440×280): `store/images/promo-tile-440x280.png`
- Marquee 1400×560: optional.

**Homepage URL:** `https://pricepeel.benkol.com/`  
**Support URL:** `https://pricepeel.benkol.com/contact/`

## Privacy practices tab

**Single purpose:**
> PricePeel shows the real price of the item pictured in AliExpress search results when a listing advertises the price of a cheaper variant, such as an accessory.

**Permission justifications:**

| Permission | Justification to paste |
|---|---|
| `storage` | Caches each product's variant and price data for 24 hours on the user's device, so the same product isn't requested from AliExpress again while browsing. |
| Host permission `https://*.aliexpress-media.com/*` | Downloads AliExpress product thumbnails and variant photos to compare them, so the extension can tell which variant is shown in a listing's photo. Images are processed in memory and not stored. |
| Host permission `https://*.alicdn.com/*` | The same as above, for product images served from AliExpress's other image domain. |
| Content scripts on `https://*.aliexpress.com/*` and `https://*.aliexpress.us/*` | Reads the product cards on AliExpress search and listing pages, requests each product's variants from AliExpress in the page, and draws the price label on the product photo. |
| Web accessible resource `icons/icon-32.png` | Shows the extension's icon in its on-page "paused" note, so users can tell the note comes from PricePeel. |

**Remote code:** No, I am not using remote code. (All code ships in the package; the extension only fetches data: product details and images.)

**Data usage:**

Chrome's form asks which kinds of user data the extension *collects*, meaning data sent off the user's device to the developer or third parties. PricePeel sends nothing to the developer or third parties; it reads AliExpress page content and requests product details from AliExpress itself, inside the user's browser.

Suggested answer: **tick none of the data types**. If you'd rather be conservative, tick **Website content** only (product information read from AliExpress pages); it's processed on the device.

Then tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** `https://pricepeel.benkol.com/privacy/`

## Distribution tab

- **Visibility:** Public, or Unlisted while you test with friends.
- **Regions:** all regions (AliExpress is global).
- **Pricing:** Free.
