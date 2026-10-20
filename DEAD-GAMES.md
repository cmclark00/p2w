# Dead Games: staff use and maintenance

Both staff and managers can search the Dead Games tab and filter by console
and classification. Read the exact edition, effective date, evidence review,
sources and setup caveats. The initial 23-entry snapshot transcribes sequence 5
of the linked Play2Win register, reviewed October 19, 2026. This is a starter
register, not an exhaustive catalog or fresh shop hardware testing.

Revision 3 adds one entry from source sequence 6, reviewed October 20, 2026:
the Japanese PS3 Monster Hunter Frontier G Beginner's Package disc
(BLJM-60577; JAN 4976219051682; PriceCharting 4562923). The 24-entry register
keeps this historical closure conditional because unofficial PS3 support
requires special setup and exact original-disc compatibility is unverified.
Other Monster Hunter games, Frontier editions and download-code-only packages
are outside this entry's coverage. The original 23 entries are unchanged.

Revision 4 adds the Japanese 2013 PS Vita Phantasy Star Online 2 Special
Package card from source sequence 7 (PCSG-00141 / VLJM-35031;
JAN 4974365821111; PriceCharting 1179918), bringing coverage to 25 entries.
The experimental patched-client/self-hosted server setup remains conditional;
gameplay completeness and original-card compatibility are unverified. Sega's
28 February 2013 release date takes precedence over PriceCharting's conflicting
date. Nova, PS4/PC, New Genesis and unverified packages are not matched.
The preceding 24 entries and staff handling policy are unchanged.

Revision 5 imports two independently verified Beginner's Packages from source
sequence 9, bringing website coverage to 27 entries: Wii U Monster Hunter
Frontier G (WUP-P-AMFJ; JAN 4976219051699; PriceCharting 4042087), and Xbox 360
Monster Hunter Frontier Online (JES1-00049; JAN 4976219034241; PriceCharting
4400119). Both historical services ended 1 August 2018. Wii U remains
conditional: Erupe support through Z2 requires unofficial setup and exact
original-disc compatibility is unverified. Xbox 360 has no verified public
restoration or ordinary offline play. Capcom's 24 June 2010 Xbox package release
date takes precedence over PriceCharting's incorrect 2007 metadata. Its initial
open-beta use does not make it the separate Online Trial Version Edition.
Only the full Xbox Beginner's Package alias matches; generic Frontier Online,
trial/beta, Season, Forward, Memorial and later G-number package names are
outside these additions. The preceding 25 entries and handling policy survive.

At revision 5 this was a reviewed subset of the 29-row source sequence 9.
Front Mission Online PS2 remained pending because the current
title/console matcher cannot distinguish retail SLPM-65981 from beta SLPM-68514
in its mixed catalog record. Monster Hunter Frontier G Vita (VLJM-35137;
JAN 4976219056304) also remained pending exact-edition catalog reconciliation:
candidate 2156539 has a Beginner's Package cover and matching release date,
but no model/JAN fields, and the live JAN lookup returned no product. Neither
pending row was imported or matched by that revision.

Revision 6 adds only that Vita Beginner's Package card, bringing coverage to
28 of source sequence 9's 29 rows. PriceCharting 2156539 is reconciled by its
Beginner's Package cover (matching AmiAmi GAME-0011553), 13 August 2014 release
date and sales-ledger links naming VLJM-35137 and eBay item 254561712823.
That listing identifies JAN 4976219056304; CDJapan independently joins the
serial, JAN and date. This is cross-source exact-edition inference, not a
populated model/JAN field in PriceCharting. The barcode lookup limitation
remains: use title search and verify the package when the JAN returns no
product. The normal catalog title and full Beginner's Package alias match
only on Vita; named beta/free trial, Memorial and later G-number packages do
not match. Existing PS3/Wii U entries keep their independent evidence.

Vita remains conditional after the 18 December 2019, 21:00 JST closure:
Erupe documents platform support requiring unofficial server/client setup;
exact original-card compatibility is unverified. Both staff warnings and
ordinary shelf holds remain. The prior 27 entries, pricing and trade math are
unchanged. Front Mission Online PS2 remains excluded pending safe retail/beta
matching approval; this is still a reviewed subset, not full Page synchronization.

- Unplayable: confirmed no normal-console gameplay; do not shelve that edition
  as playable. PC revivals do not restore console discs.
- Conditional: unofficial console setups or closed playtests; hold from normal
  playable stock pending edition/setup verification.
- Offline exclusions: preserve offline/bot/LAN play and limitations. Evolve's
  Standard disc has offline modes; Twisted Metal: Black Online has LAN.
  Revision 2 records a separate store-handling policy for the LAN-only disc;
  its research classification, evidence and review dates remain unchanged.
- Upcoming/uncertain: do not call a game unplayable merely because a date was
  announced. Destruction AllStars has returning-player Arcade caveats.

## Buying and shelf behavior

**Two staff checkpoints:** confirmed unplayable and unofficial/setup-dependent
exact editions receive prominent warnings in both Trade-In and Pricing:
**Do not buy or sell as ordinarily playable.** Conditional notices explicitly
say **not normally playable**, rather than declaring the game completely dead.
These warnings remain visible when the buying guide is disabled or a manual
trade offer is entered. No new trade-in cash/credit calculation is introduced.

The guide's numerical don't-buy rule still applies only to exact confirmed unplayable aliases
on their listed consoles, when the guide is enabled. Existing manual trade
value/cash overrides keep working, with playability guidance visible. Empty
cases and hardware are not newly restricted. Conditional entries carry a
warning instead of being called completely unplayable or automatically zeroed.

Floor Pricing holds confirmed and conditional exact editions from Add to list,
including typed prices. Existing saved list prices are preserved with notices;
printing labels, printing lists and copying lists hold until those entries are
removed from the playable shelf list. A missing register blocks these shelf
outputs. Evolve receives no automatic warning and retains ordinary price math.
Twisted Metal: Black Online remains a LAN-playable exclusion from the completely
dead category. Its separate normalPlay = requires-lan policy flags both
checkpoints and holds ordinary solo-play shelf output pending verification and
disclosure of the additional compatible systems/network setup. It is not
automatically zeroed in Trade-In.
Destruction AllStars receives a separate new-owner/setup caution at both
checkpoints; it is not confirmed dead, is not automatically zeroed or held,
and its future closure date never automatically changes its classification.
Stale saved recheck suggestions are held too: neither individual Use nor
Use all can replace a held game's saved price. Dates never change
classifications automatically. Unknown related editions
are not automatically flagged. Exact aliases only: title-prefix matching must
not warn on a successor such as The Crew 2 or Motorfest.

Settings v12 replaces only the entire untouched legacy default list on loading
an older save. That list incorrectly included Evolve and matched every console
for a title. Customized lists and deliberately saved v12 rules are preserved.
The Settings field is now **Independent don't-buy overrides (all platforms)**;
the register lists active overrides and flags conflicts with offline evidence.
Migration does not save settings automatically. Read-only inspection of the
existing live manager session showed the full legacy list and an enabled
buying guide; nothing was saved. Review active overrides again after release,
since another manager may have changed them since that session loaded.

## Reviewed update/import route

The authoritative project data is trade-in/dead-games.json.
trade-in/dead-games.js includes the identical generated snapshot plus validation,
matching, filtering and migration helpers; load it before app.js.

1. Download JSON from the tab or copy the project JSON. Review the current
   linked source register and evidence. Update a candidate JSON, increasing
   revision and setting updatedAt. Preserve every caveat and history event.
2. Append a changes event per changed entryId. A policy event records changes
   to store handling without claiming new evidence or a new shutdown.
   The optional normalPlay field currently accepts requires-lan only on an
   offline/LAN classification. Coverage means newly listed
   evidence, including old shutdowns. A shutdown event must name an unplayable
   entry and use its verified effective date. For removals, append a correction
   event whose summary includes the removed ID. Upcoming dates are not a
   substitute for verifying remaining modes and the exact edition.
3. Dry run and review every title/platform/edition/category/evidence change:

       node scripts/update-dead-games.cjs path/to/candidate.json

4. Apply using the current SHA256 printed by that dry run:

       node scripts/update-dead-games.cjs path/to/candidate.json --apply --expected SHA256

   The importer refuses stale baselines, unsafe URLs, ambiguous aliases,
   missing evidence, invalid dates, future confirmations and discarded history.
   It changes only the JSON/generated-JS pair in the local checkout. It does
   not change manager settings, saved prices, the source Page or production.
5. Validate and review the Git diff:

       node scripts/update-dead-games.cjs --check
       node scripts/test-dead-games.cjs
   node scripts/test-floor-pricing.cjs
   pwsh -File scripts/test-shop-pc-update.ps1
       python .github/scripts/check_site.py
       node .github/scripts/check_javascript.mjs

6. Commit/integrate/push only within approved deployment scope. The normal
   main push runs site checks and publishes through the GoDaddy workflow.
   Publish HTML, app.js, styles.css, dead-games.js and dead-games.json together.
   Staff reload the calculator after deployment.
7. Install the revised scripts/shop-pc/Update-TradeInCalculator.ps1 on the shop
   PC before publication if its startup shortcut runs an updater automatically.
   Run it after publication. The old updater does not fetch dead-games.js.
   The revised updater stages and validates the complete compatible set before
   replacing files, backs up every changed existing file, and rolls back an
   installation failure. Before publication it will refuse an incomplete
   download and keep the installed copy. Site deployment does not directly
   execute anything on the shop PC; a later updater run can pull site changes.
   With an old updater, a mixed frontend keeps ordinary calculator views
   working but holds shelf output until the register dependency is installed.
   The same frontend runs against the old server; no server.ps1 route changes
   are required. Do a real shop-PC smoke test after installation.

## Update boundaries

This is a reviewed snapshot, not automatic private-Page synchronization.
Editing the source Page alone does not update the website. A scheduled review
may prepare a candidate, but project import and deployment require separate
authorized execution. No credential or persistent Page access is provisioned.

Generated JSON and JavaScript must stay together. New coverage must not be
presented as a newly occurring shutdown. Aliases normalize punctuation, case
and PAL/JP console prefixes but never strip editions or sequel names.
Imports reject prototype-related keys recursively so JSON metadata cannot
change meaning when bundled into JavaScript.
