# Publishing PricePeel to the Chrome Web Store

## One-time setup
- [ ] Register a Chrome Web Store developer account at https://chrome.google.com/webstore/devconsole (one-time US$5 fee, paid by you).
- [ ] Verify the contact email on the account (the dashboard asks for this before publishing).

## Before each submission
- [ ] Bump `version` in `manifest.json` (and `package.json`) for any update after the first.
- [ ] `npm test`: all tests pass.
- [ ] `npm run package`: builds `dist/pricepeel-<version>.zip`.
- [ ] Load the ZIP's contents unpacked once in Chrome and check a search page works.

## Website: privacy policy and contact form (needed before the first submission)
The site is in `store/site/`: home, privacy policy, contact form and a thanks page. It's hosted for free on
Netlify at `pricepeel.benkol.com`; see "Putting the website online" below.
- [x] Put the site online (steps below): live at https://pricepeel.benkol.com/
- [x] The privacy page is public (checked 2026-11-25).
- [x] A test message through the contact form reached Netlify. Still to do: turn on email notifications for new messages (Netlify → Notifications → Form submission notifications).

## Images
All made; regenerate with `node tools/make-store-images.js` after changing the look (needs Google Chrome).
- [x] Store icon: `icons/icon-128.png`
- [x] Screenshots, 1280×800: `store/images/screenshot-1-real-prices.png`, `screenshot-2-details.png`, `screenshot-3-progress.png`
- [x] Small promo tile, 440×280: `store/images/promo-tile-440x280.png`
- [ ] Optional: marquee, 1400×560

## Dashboard
- [ ] **Package:** upload `dist/pricepeel-<version>.zip`.
- [ ] **Store listing:** paste the text from `store/listing.md`, category Shopping, language English, add the images.
- [ ] **Privacy practices:** single purpose, permission justifications, remote code = No, data usage and certifications, privacy policy URL; all in `store/listing.md`.
- [ ] **Distribution:** Public (or Unlisted to test first), all regions, free.
- [ ] Submit for review. First reviews usually take a few days; extensions with host permissions can take longer.

## Things reviewers often flag
- The name or icon looking official: the listing says PricePeel is independent and not affiliated with AliExpress; keep "AliExpress" out of the first word of the name.
- Permissions not explained: every permission has a justification in `listing.md`.
- Privacy policy not matching the form: the policy and the data-usage answers both say no data is sent anywhere.

## Putting the website online (Netlify + GoDaddy)
1. Sign up at https://www.netlify.com (free).
2. In Netlify: **Add new site → Deploy manually**, then drag the `store/site` folder onto the page.
3. **Site configuration → Forms:** enable form detection, then redeploy (drag the folder again) so the contact form is picked up. Under **Forms → Form notifications**, add an email notification to your own address (it stays private).
4. **Domain management → Add a domain:** enter `pricepeel.benkol.com`. Netlify shows the target, like `your-site.netlify.app`.
5. In GoDaddy: **My Products → benkol.com → DNS → Add record:** type **CNAME**, name `pricepeel`, value `your-site.netlify.app`, TTL default.
6. Wait for DNS (minutes to an hour). Netlify then issues the HTTPS certificate automatically.
7. Check `https://pricepeel.benkol.com/privacy/` and send a test message from `/contact/`.
