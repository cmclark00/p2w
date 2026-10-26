# Play2Win managed helper releases

Prepared October 26, 2026. The self-hosted signing and hosting are ready; **Google
Admin account setup, browser enrollment, force-install policy and an actual Chrome
automatic-update test are still required**. Do not claim all computers are enrolled.

- Staff/manager setup: https://play2wingames.com/trade-in/helper-setup.html
- Update feed: https://play2wingames.com/trade-in/helper-updates/updates.xml
- Managed extension ID: `kmjnkeabmpcibanlailmcblbjmjibonl`
- First managed version: 1.1.5. Same runtime/permissions as source, with `update_url`
  added only to the signed managed package. It has a separate ID from the Store copy.
- `Connected` measures the bridge/version, not enrollment. Confirm the managed ID
  and policies in Chrome; disable other copies only after the managed copy appears.
- Manual ZIP remains available, with no automatic updater. Store distribution is
  historical/optional; see WEB-STORE.md. Nothing here unpublishes the existing item.

## Owner setup and pilot

Use Chrome Enterprise Core with the shop-controlled administrator account. Scope the
helper policy to a dedicated shop-computer organizational unit. Follow the public
setup page for enrollment and Add by ID / custom URL / Force install. Keep enrollment
tokens and downloaded enrollment files private. Do not reset existing management or
change unrelated browser policies. Test on one Windows computer before enrolling all.

Validate installed managed ID, helper connection, GameStop/eBay behavior, then release
a subsequent version and confirm Chrome actually upgrades the pilot automatically.
Record the result here before calling the rollout complete. A published feed alone
does not prove browser installation or updates. Chrome checks periodically, not instantly.

## Signing and release process

The private P-256 signing key is stored outside the repository in the originating
chat's private `helper-managed-private` directory. Its folder is restricted to the
Windows user and SYSTEM. Never paste the key into chat, commit it, include it in ZIPs,
or place it in any website directory. The owner must back it up in secure storage;
losing it requires a new extension ID and a policy migration. `.gitignore` and deploy
exclude PEM/key files as defense in depth. Public release.json contains only hashes,
ID, version and URLs.

1. Update reviewed source in `trade-in/browser-helper/` and increase manifest.version.
2. Run the helper/verification/pricing tests relevant to the change.
3. `python scripts/build-gamestop-helper.py` updates the manual ZIP.
4. `node scripts/build-managed-helper.cjs --key <absolute-private-signing-key.pem>`
   builds a CRX3 using the existing key. Node and Python are the only dependencies.
   The builder refuses identity changes, version downgrades and same-version code
   changes. Rebuilding an unchanged version verifies and retains its existing package.
5. `node scripts/test-managed-helper.cjs` verifies the signature, rejects tampering,
   checks public metadata and compares the entire archived runtime with source.
6. Review and commit the versioned CRX, release.json, updates.xml, source and manual
   ZIP. Keep prior versioned packages; update checks can already be downloading them.
7. Push main. The existing deploy workflow validates and publishes these public files.
   No Store upload or Google review is needed for this managed channel. Changing only
   website code does not require an extension version bump or package rebuild.
8. Verify HTTPS feed and package HTTP 200, CRX MIME type, signature and version live.
   Check the pilot before wider rollout. Roll back code by publishing a higher version
   containing the last good runtime; Chrome does not normally install version downgrades.

`--init-key` is for the very first setup only and refuses overwriting an existing key.
Do not generate a new key for updates. Preserve the same update URL and managed ID.
Signing is a local release step; no private signing key is stored in GitHub Actions.

## References

- https://developer.chrome.com/docs/extensions/how-to/distribute
- https://support.google.com/chrome/a/answer/9301420
- https://support.google.com/chrome/a/answer/9301891
- https://support.google.com/chrome/a/answer/6177447
- https://chromium.googlesource.com/chromium/src/+/HEAD/components/crx_file/crx3.proto
