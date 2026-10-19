# Dead Games: staff use and maintenance

Both staff and managers can search the Dead Games tab and filter by console
and classification. Read the exact edition, effective date, evidence review,
sources and setup caveats. The initial 23-entry snapshot transcribes sequence 5
of the linked Play2Win register, reviewed October 19, 2026. This is a starter
register, not an exhaustive catalog or fresh shop hardware testing.

- Unplayable: confirmed no normal-console gameplay; do not shelve that edition
  as playable. PC revivals do not restore console discs.
- Conditional: unofficial console setups or closed playtests; hold from normal
  playable stock pending edition/setup verification.
- Offline exclusions: preserve offline/bot/LAN play and limitations. Evolve's
  Standard disc has offline modes; Twisted Metal: Black Online has LAN.
- Upcoming/uncertain: do not call a game unplayable merely because a date was
  announced. Destruction AllStars has returning-player Arcade caveats.

## Buying and shelf behavior

The guide's don't-buy rule applies only to exact confirmed unplayable aliases
on their listed consoles, when the guide is enabled. Existing manual trade
value/cash overrides keep working, with playability guidance visible. Empty
cases and hardware are not newly restricted. Conditional entries carry a
notice instead of being called completely unplayable.

Floor Pricing holds confirmed and conditional exact editions from Add to list,
including typed prices. Existing saved list prices are preserved with notices;
printing labels, printing lists and copying lists hold until those entries are
removed from the playable shelf list. A missing register blocks these shelf
outputs. Offline-playable and upcoming entries retain ordinary price math.
Dates never change classifications automatically. Unknown related editions
show review guidance instead of receiving a broad automatic block.

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
2. Append a changes event per changed entryId. Coverage means newly listed
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
       python .github/scripts/check_site.py
       node .github/scripts/check_javascript.mjs

6. Commit/integrate/push only within approved deployment scope. The normal
   main push runs site checks and publishes through the GoDaddy workflow.
   Publish HTML, app.js, styles.css, dead-games.js and dead-games.json together.
   Staff reload the calculator after deployment.
7. Install the revised scripts/shop-pc/Update-TradeInCalculator.ps1 on the shop
   PC once, then run it. The old updater does not fetch dead-games.js.
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
