# Chrome Web Store release

Status: submission assets prepared; not yet submitted or published. No store item ID has been assigned. Do not tell staff that unpacked installations update automatically.

## Build and ownership

Use the shop-owned Google account for the publisher. The owner completes developer registration, payment, terms, email verification, and two-step verification. Never put credentials or payment details in this repository or the ZIP.

Run `python scripts/build-gamestop-helper.py --store-output <absolute-private-folder>/play2win-market-helper-1.1.4.zip`.
The store ZIP contains manifest.json at its root, six runtime files including the manifest, and four icons. It excludes installer notes, reviewer instructions, credentials, and store artwork. The ordinary downloadable ZIP retains its enclosing folder and manual installation guide.

Render icons and the 440×280 promotional tile with `node scripts/build-helper-store-art.cjs <absolute-private-folder>` (requires sharp). Store screenshots must show the actual extension workflow or its connection-check page, without staff/customer records. Supply a 1280×800 or 640×400 screenshot.

Before upload, run the GameStop and eBay helper tests, optional eBay verification tests, site link checker, and JavaScript syntax checker. Deploy the public support/privacy pages before submitting.

## Listing fields

- Name: Play2Win Market Helper
- Summary: Checks GameStop stock and verifies eBay sold prices for Play2Win floor pricing. Never buys, bids, or changes carts.
- Language: English (United States)
- Category: select the available productivity/tools category.
- Homepage/support: https://play2wingames.com/trade-in/helper.html
- Privacy: https://play2wingames.com/trade-in/helper-privacy.html
- Support email: inquiries@play2wingames.com
- Distribution: **Unlisted**, free. Unlisted is accessible to anyone with the link; it is not an access restriction. The staff pricing website retains its separate authentication.

Description:

Play2Win Market Helper connects market listing checks to the Play2Win Games floor-pricing tool.

• Check GameStop's matching pre-owned Ship to Home stock controls.
• Check one selected original eBay listing for a confirmed sale, an ended listing, or an accepted offer with an undisclosed final price.
• Return the listing evidence to the Play2Win page while keeping pricing available.

The helper uses temporary background tabs and closes only the tabs it creates. GameStop checks can run during pricing; eBay checks run for a selected sale or automatically for the price-driving sale when it is old or substantially above Amazon, with at most three sequential candidates per lookup and condition. Blocked or unclear listings remain unverified. The helper never buys, bids, submits offers, changes carts, or messages sellers.

This is a companion for Play2Win staff. The staff pricing tool requires an authorized Play2Win login. A public connection-check page is available at https://play2wingames.com/trade-in/helper.html without a staff login.

The helper is developed by Play2Win Games and is not affiliated with or endorsed by GameStop or eBay.

## Privacy practices

Single purpose: Provide stock and sale-status evidence from specific market listings to the Play2Win floor-pricing workflow.

Host access justification: Scoped content scripts run on Play2Win trade-in pages to receive listing-check requests and return results; on GameStop product pages to read matching pre-owned online-stock controls; and on eBay item pages to expand original listing details and read the original item's title, sale status, and displayed price. Only the bounded service worker creates temporary checking tabs. The extension does not need broad tabs, history, cookies, storage, or scripting permissions.

Remote code: No. All executable extension code is bundled. Website markup is read as data, not downloaded or executed as extension code. The Play2Win website remains a separate application.

Data disclosures: Disclose **Website content** (listing titles, item IDs, displayed stock/sale statuses and sold prices) and **Web history** (the specific product/item URLs requested for checks; not general browsing history). These are handled locally and returned to the requesting Play2Win page. Do not claim "no data handled" just because there is no extension analytics backend. No personally identifying, health, financial/payment, authentication, personal-communication, location, or interaction-analytics data is collected by extension code. Ordinary visits to GameStop/eBay still use the browser's normal request/session behavior, as disclosed in the policy.

Data-use certifications: Data is not sold, is used only for the stated listing-check purpose, and is not used to determine creditworthiness or for lending. Review the live form wording against the code and policy before certifying.

## Reviewer instructions (no credentials required)

1. Install this package in Chrome and open https://play2wingames.com/trade-in/helper.html. Reload the page if it was open before installation.
2. Click Check stock. A temporary GameStop product tab opens in the background and closes after a result or timeout. The page shows confirmed pre-owned online availability or an inconclusive result. Local-store availability is not inferred.
3. Click Check selected sale. One original eBay item tab opens and closes after a result or timeout. The helper may expand See original listing. It reports Sold with the displayed USD price, Ended, Accepted offer/hidden price, or Unverified. Listing availability can change, and vendor challenges are not bypassed. Another product/item URL can be entered in the corresponding field.
4. Merely loading this public page does not open any listing tabs. It needs no staff account and exposes no inventory, transaction, customer, or private pricing records.
5. The authenticated pricing tool uses the same bridge and parsers. Its specific pricing premiums are separate website rules; this extension does not contain or change those rules.

## Publish and migrate

Upload the ZIP once, finish the listing/privacy/test fields, choose Unlisted and submit for review. Record the real item ID and store URL here after creation. Keep the same store item for every subsequent release.

After Google approves publication, give staff the store link. On each Chrome profile remove/disable the old unpacked helper, install the store version, and reload all Play2Win pages. Keep only one helper enabled. Chrome can then deliver future published store versions automatically; review and rollout are not immediate.

For future extension changes: increment manifest.version, run tests, rebuild, upload the new package to the **existing** store item, and submit the update for review. GitHub/website deployment does not upload to the Chrome Web Store. No signing private key or self-hosted update URL is needed for this store distribution.
