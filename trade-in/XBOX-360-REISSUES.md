# Xbox 360 discs in Xbox One packaging

Checked November 3, 2026. This is a documented release allowlist, not every
backwards-compatible game and not a claim that no other regional reissue exists.

The physical packaging catalog and collector photographs are in the
[Video Game Sage release list](https://www.videogamesage.com/forums/topic/10902-master-list-plays-on-xbox-one-xbox-360-subset/).
It records 34 releases in Xbox One-style cases and nine in Xbox 360-style DVD
cases, with six overlapping: 37 distinct releases. Its later replies document
additions and packaging variations. Microsoft's
[backwards-compatibility explanation](https://news.xbox.com/en-us/2018/02/27/new-enhanced-xbox-360-titles-feature-come-xbox-one-backward-compatibility/)
confirms that these remain Xbox 360 games, rather than native Xbox One ports.
PriceCharting separately catalogs
[Oblivion GOTY as Xbox One](https://www.pricecharting.com/game/xbox-one/elder-scrolls-iv-oblivion-game-of-the-year-edition)
and [Xbox 360](https://www.pricecharting.com/game/xbox-360/elder-scrolls-iv-oblivion-game-of-the-year).

## Matching policy

- `FLOOR_XBOX_360_REISSUES` in `app.js` is the executable release list.
- For an eligible Xbox One catalog item, Amazon checks both platform labels
  (including Renewed fallback). This is an Amazon catalog exception only.
- Sold listings must explicitly identify the selected generation in their title:
  Xbox One for Xbox One inventory, 360 for Xbox 360 inventory. Dual-labeled
  titles can qualify, but a 360-only title cannot price Xbox One packaging.
  This applies to direct eBay, PriceCharting and recovered sales, even when
  the source catalog or helper says they match. Direct eBay searches use the
  selected platform; they no longer substitute Xbox 360 for Xbox One.
- This changes listing discovery and platform identity only. It does not move
  inventory to another catalog entry, replace the selected PriceCharting market
  value, merge different editions, or change any pricing rule or premium.
- Title, edition, language/region, condition, bundles, sale verification and
  outlier filters still run. GOTY does not mean standard, and a remaster is not
  the original. Original listing text remains visible.
- Four ambiguous titles below also have native Xbox One versions. A plain
  Xbox One catalog name does **not** activate the exception for them. They need
  explicit Xbox 360 catalog identity (Xbox 360 system or `[Xbox 360]` marker).
  Do not guess from backwards compatibility or a seller's Xbox One label.
- Oblivion GOTY's shortened Amazon title and Black Ops/Black Ops 1 are scoped
  naming aliases. No generic franchise or sequel words are discarded.
- French-Canadian packaging, other language editions, digital-code releases
  and seller-created bundles are not automatically equated with a US disc.
- The Xbox One-branded Fallout 3 GOTY/Rage two-pack remains a separate bundle.
  Black Ops II Greatest Hits still needs its existing edition checks.

## Documented releases

An asterisk marks titles requiring explicit Xbox 360 identity because of a
separate native Xbox One release. Case style alone is not enough to choose one.

| Release | Packaging documented |
| --- | --- |
| Assassin's Creed Rogue | Xbox One-style |
| BioShock Infinite | Xbox One-style |
| Borderlands Game of the Year Edition * | Xbox One-style |
| Bully Scholarship Edition | Both |
| Call of Duty Advanced Warfare * | Xbox One-style |
| Call of Duty Black Ops | Xbox One-style |
| Call of Duty Black Ops II (Greatest Hits) | Xbox One-style |
| Call of Duty Ghosts * | Xbox One-style |
| Call of Duty World at War | Xbox One-style |
| Call of Duty 4 Modern Warfare | Xbox One-style |
| Call of Duty Black Ops / Black Ops II Combo Pack | Xbox One-style |
| Crysis 3 | Xbox One-style |
| Dead Space 3 | Xbox One-style |
| Doom 3 BFG Edition | Both |
| Elder Scrolls IV Oblivion Game of the Year Edition | Both |
| Fallout New Vegas Ultimate Edition | Xbox One-style |
| Fallout 3 Game of the Year Edition | Both |
| Fight Night Champion | Xbox One-style |
| Grand Theft Auto IV | Xbox One-style |
| Grand Theft Auto IV & Episodes from Liberty City | Both |
| Grand Theft Auto Episodes from Liberty City | Xbox One-style |
| Grand Theft Auto San Andreas | Xbox One-style |
| Injustice Gods Among Us Ultimate Edition | Xbox One-style |
| Kingdoms of Amalur Reckoning | Xbox One-style |
| LEGO Batman The Videogame | Xbox One-style |
| Midnight Club Los Angeles Complete Edition | Xbox One-style |
| MX vs ATV Reflex | Xbox One-style |
| Rayman Legends * | Xbox One-style |
| Rayman Origins | Xbox One-style |
| Red Dead Redemption Game of the Year Edition | Both |
| Red Dead Redemption Undead Nightmare | Xbox One-style |
| Sid Meier's Civilization Revolution | Xbox One-style |
| Skate 3 | Xbox One-style |
| Sonic & All-Stars Racing Transformed | Xbox One-style |
| Call of Duty Modern Warfare Trilogy | Xbox 360 DVD-style |
| Mirror's Edge | Xbox 360 DVD-style |
| Rage | Xbox 360 DVD-style |

Regression coverage is in `scripts/test-amazon-matching.cjs`: every release,
ambiguous native ports, real Oblivion candidate identity, dual-platform search,
separate Used/New prices, imports, bundles, remasters and condition restrictions.
