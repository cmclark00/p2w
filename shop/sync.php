<?php
/**
 * Inventory sync for the shop: copies Play2Win's CrystalCommerce listings into the private index the
 * storefront reads (<home>/p2w-shop-data/index.json).
 *
 *   1. Listings: every page of Core2 /api/listings for the shop's organization (prices, quantities,
 *      conditions). Re-read at most every SYNC_MIN_MINUTES.
 *   2. Product details (photo, set, game): Core2 /api/v2/products/{id}, one product per request (no
 *      batch endpoint), fetched in parallel within a time budget and cached in products.json for good.
 *      New products get filled in on the next runs; the shop works meanwhile.
 *   3. The index (index.json) the shop pages read.
 *   4. Variant ids (kiosk orders), last: when CC_API_PROXY_SECRET is set, the Admin API's variants for
 *      each top-level category, matched to the listings by product (variant product_catalog_id = Core2
 *      product id) and condition, into variants.json. Read slowly over several runs (see sync_variants).
 *
 * Run it from cron (php sync.php) or over HTTP (GitHub Actions calls /shop/sync.php on a schedule).
 * Anyone may call it: it only reads public data, refuses to re-read listings more often than
 * SYNC_MIN_MINUTES, and only one run happens at a time. Prints a JSON status line.
 */

declare(strict_types=1);
require __DIR__ . '/lib.php';

const SYNC_MIN_MINUTES = 10;
const SYNC_PER_PAGE = 500;
const VARIANT_PER_PAGE = 200;
// Gentle pace for CrystalCommerce's Admin API (owner-approved Oct 2026; see sync_variants).
const VARIANT_PASS_HOURS = 6;        // a full variants pass (~256 pages) at most this often
const VARIANT_PAGES_PER_RUN = 20;    // pages per sync run
const VARIANT_PARALLEL = 2;          // pages at a time
const VARIANT_PAUSE_MS = 1000;       // pause between batches
// Listing ids for stock that only the Admin API knows: this + the CrystalCommerce variant id, so they can
// never clash with Core2 listing ids (and sync_variant_map maps them straight back to the variant).
const ADMIN_LISTING_BASE = 1000000000;
const ADMIN_STOCK = false; // step 1b on/off

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

$cli = PHP_SAPI === 'cli';
$budget = $cli ? 600 : 40;     // seconds for product details (web requests must finish quickly)
@set_time_limit($cli ? 0 : 90);
// The shop pages kick this off in the background and hang up at once (shop_kick_sync in lib.php):
// keep going after the caller disconnects.
ignore_user_abort(true);
$t0 = microtime(true);

function done(array $status): void {
  echo json_encode($status, JSON_UNESCAPED_SLASHES), "\n";
  exit;
}

$lock = fopen(shop_data_dir() . '/sync.lock', 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) done(['status' => 'busy']);

$base = rtrim(shop_env('CC_CORE2_BASE'), '/');
$org = shop_env('CC_CORE2_ORG_ID');
$state = shop_read_json('state.json') ?: [];
$details = shop_read_json('products.json') ?: [];

/* ---------------------------------------------------------------- 1. listings */

$listings = shop_read_json('listings.json');
$fresh = is_array($listings) && time() - (int)($state['listingsAt'] ?? 0) < SYNC_MIN_MINUTES * 60;
if (!$fresh) {
  $first = array_values(shop_fetch_json(["$base/api/listings?organization_id=" . rawurlencode($org) . '&per_page=' . SYNC_PER_PAGE . '&page=1']))[0];
  if (!is_array($first) || !isset($first['listings'])) done(['status' => 'error', 'error' => 'Could not read listings from CrystalCommerce']);
  $pages = (int)($first['pages'] ?? 1);
  $urls = [];
  for ($p = 2; $p <= $pages; $p++) $urls[] = "$base/api/listings?organization_id=" . rawurlencode($org) . '&per_page=' . SYNC_PER_PAGE . "&page=$p";
  $rest = $urls ? shop_fetch_json($urls, 3, 60) : [];
  $listings = [];
  $soldOut = []; // Core2 listings with no stock: their variants must not come back in from the (older) Admin catalog
  // What CrystalCommerce sent, before the in-stock filter (shown in the status, to spot missing pages).
  $raw = ['pages' => $pages, 'meta' => array_diff_key($first, ['listings' => 1]), 'perPage' => [], 'rows' => 0, 'skipped' => ['noStock' => 0, 'noPrice' => 0, 'otherOrg' => 0]];
  foreach (array_merge([$first], array_values($rest)) as $i => $page) {
    if (!is_array($page) || !isset($page['listings'])) done(['status' => 'error', 'error' => 'A listings page failed; the old index was kept', 'page' => $i + 1]);
    // Listings come grouped by store location; flatten.
    $groups = is_array($page['listings']) ? $page['listings'] : [];
    $n = 0;
    foreach ((array_values($groups) === $groups ? [$groups] : $groups) as $group) {
      foreach ($group as $l) {
        $n++;
        $qty = !empty($l['infinite_quantity']) ? 99 : (int)($l['quantity'] ?? 0) - (int)($l['reserved_quantity'] ?? 0);
        $price = $l['ally_agreement_price'] ?? null;
        if ((int)($l['organization_id'] ?? 0) !== (int)$org) $raw['skipped']['otherOrg']++;
        elseif ($qty <= 0) $raw['skipped']['noStock']++;
        elseif (!is_numeric($price) || $price <= 0) $raw['skipped']['noPrice']++;
        if ((int)($l['organization_id'] ?? 0) !== (int)$org) continue;
        $d = is_array($l['descriptors'] ?? null) ? $l['descriptors'] : [];
        $cond = shop_condition_label((string)($d['condition'] ?? ''));
        unset($d['condition']);
        if ($qty <= 0 || !is_numeric($price) || $price <= 0) {
          $soldOut[] = ['id' => (int)$l['id'], 'pid' => (int)$l['product_id'], 'c' => $cond !== '' ? $cond : 'Standard',
            'v' => implode(' · ', array_filter(array_map('strval', array_values($d)))), 'p' => is_numeric($price) ? (int)$price : 0];
          continue;
        }
        $listings[] = [
          'id' => (int)$l['id'], 'pid' => (int)$l['product_id'], 'name' => (string)($l['product_name'] ?? ''),
          'type' => trim((string)($l['product_type_name'] ?? '')), 'c' => $cond !== '' ? $cond : 'Standard',
          'v' => implode(' · ', array_filter(array_map('strval', array_values($d)))), 'q' => $qty, 'p' => (int)$price,
        ];
      }
    }
    $raw['perPage'][] = $n;
    $raw['rows'] += $n;
  }
  shop_write_json('listings.json', $listings);
  shop_write_json('listings-soldout.json', $soldOut);
  $state['listingsAt'] = time();
  $state['listingsCount'] = count($listings);
  $state['listingsRaw'] = $raw;
}

/* ---------------------------------------------------------------- 1b. stock only the Admin API knows */

// Core2's listings are only part of the store (Oct 9 2026: 4,901 listings, while the Admin API has 47k
// variants). The saved variants catalog (step 4) lists every in-stock variant, so anything Core2 doesn't
// cover is added from it. Core2 stays first: it's refreshed every few minutes, the catalog every few hours,
// so a variant Core2 lists (in stock or sold out) always comes from Core2. Checkout re-checks stock live.
$adminAdded = 0;
// Off for now: with the whole store (46k in-stock variants, Oct 9 2026) this ran out of memory (HTTP 500)
// and the index would be too big for every shop page to load. Back on once the index is stored in pieces.
$catalog = ADMIN_STOCK ? shop_read_json('variants-catalog.json') : null;
if (is_array($catalog) && isset($catalog['stock'], $catalog['byPid'])) {
  $stockCat = [];
  foreach ($catalog['stock'] as $s) $stockCat[$s[0]] = $s[3];
  $taken = [];
  $typeVotes = []; // Admin category -> the store's Core2 product type names seen for it
  foreach (array_merge($listings, shop_read_json('listings-soldout.json') ?: []) as $l) {
    $m = sync_match_listing($l, $catalog);
    if ($m === null) continue;
    $taken[$m[0]] = true;
    if (($l['type'] ?? '') !== '' && isset($stockCat[$m[0]])) {
      $cat = $stockCat[$m[0]];
      $typeVotes[$cat][$l['type']] = ($typeVotes[$cat][$l['type']] ?? 0) + 1;
    }
  }
  $catType = [];
  foreach ($catalog['stock'] as [$vid, $pid, $name, $cat, $cond, $v, $qty, $cents]) {
    if (isset($taken[$vid]) || $qty <= 0 || $cents <= 0) continue;
    if (!isset($catType[$cat])) {
      $votes = $typeVotes[$cat] ?? [];
      arsort($votes);
      $catType[$cat] = $votes ? (string)array_key_first($votes) : sync_category_type((string)($catalog['cats'][$cat] ?? ''));
    }
    $listings[] = ['id' => ADMIN_LISTING_BASE + $vid, 'pid' => $pid, 'name' => $name, 'type' => $catType[$cat], 'c' => $cond, 'v' => $v, 'q' => $qty, 'p' => $cents];
    $adminAdded++;
  }
}

/* ---------------------------------------------------------------- 2. product details */

$need = array_values(array_unique(array_filter(array_map(function ($l) use ($details) {
  return isset($details[$l['pid']]) ? null : $l['pid'];
}, $listings))));
$fetched = 0;
while ($need && microtime(true) - $t0 < $budget - 8) {
  $batch = array_splice($need, 0, 24);
  $res = shop_fetch_json(array_map(function ($id) use ($base) { return "$base/api/v2/products/$id"; }, $batch), 6, 20);
  foreach ($batch as $id) {
    $r = $res["$base/api/v2/products/$id"] ?? null;
    if (!is_array($r) || empty($r['id'])) {
      // Retried next run; after 3 misses it's shown without a photo or set, so the sync can finish.
      $state['detailTries'][$id] = ($state['detailTries'][$id] ?? 0) + 1;
      if ($state['detailTries'][$id] >= 3) { $details[$id] = ['none' => true]; unset($state['detailTries'][$id]); }
      continue;
    }
    $details[$id] = [
      'slug' => (string)($r['name_slug'] ?? ''), 'img' => (string)($r['image'] ?? ''), 'thumb' => (string)($r['image_thumb'] ?? ''),
      'set' => (string)($r['category_name'] ?? ''), 'setSlug' => (string)($r['category_slug'] ?? ''),
      'typeSlug' => (string)($r['product_type_slug'] ?? ''), 'typeName' => (string)($r['product_type_name'] ?? ''),
      'desc' => (string)($r['description'] ?? ''),
      'rel' => is_numeric($r['release_date'] ?? null) ? (int)$r['release_date'] : (strtotime((string)($r['created_at'] ?? '')) ?: 0),
    ];
    $fetched++;
  }
  shop_write_json('products.json', $details);
}

/* ---------------------------------------------------------------- 3. build the index */

$products = [];
$types = [];
// The store's spelling of each product type, for listings that come without one.
$typeNames = [];
foreach ($listings as $l) if ($l['type'] !== '') $typeNames[shop_slug($l['type'])] = $l['type'];
foreach ($listings as $l) {
  $id = $l['pid'];
  if (!isset($products[$id])) {
    $d = $details[$id] ?? [];
    // The store's own product type (on the listing) wins: Core2's catalog sometimes files a card under
    // another game (One Piece cards as "Dragon Ball Super"). Its set is only trusted when the two agree.
    $type = $l['type'] !== '' ? $l['type']
      : ($typeNames[$d['typeSlug'] ?? ''] ?? (($d['typeName'] ?? '') !== '' ? $d['typeName'] : ucwords(str_replace('-', ' ', (string)($d['typeSlug'] ?? 'Other')))));
    $typeSlug = shop_slug($type);
    $setOk = ($d['set'] ?? '') !== '' && (($d['typeSlug'] ?? '') === $typeSlug || $l['type'] === '');
    [$game, $kind] = shop_split_type($type);
    $products[$id] = [
      'id' => $id, 'name' => $l['name'], 'n' => shop_norm($l['name']), 'slug' => ($d['slug'] ?? '') !== '' ? $d['slug'] : shop_slug($l['name']),
      'img' => $d['img'] ?? '', 'thumb' => $d['thumb'] ?? '', 'set' => $setOk ? $d['set'] : '', 'setSlug' => $setOk ? (string)$d['setSlug'] : '',
      'type' => $type, 'typeSlug' => $typeSlug, 'game' => $game, 'kind' => $kind, 'rel' => $d['rel'] ?? 0,
      'desc' => $d['desc'] ?? '', 'l' => [],
    ];
    $types[$typeSlug] = $types[$typeSlug] ?? ['name' => $type, 'game' => $game, 'kind' => $kind, 'count' => 0];
    $types[$typeSlug]['count']++;
  }
  $products[$id]['l'][] = ['id' => $l['id'], 'c' => $l['c'], 'v' => $l['v'], 'q' => $l['q'], 'p' => $l['p']];
}
foreach ($products as &$p) {
  usort($p['l'], function ($a, $b) { return shop_condition_order($a['c'], $b['c']) ?: $a['p'] <=> $b['p']; });
  $p['qty'] = array_sum(array_column($p['l'], 'q'));
  $p['from'] = min(array_column($p['l'], 'p'));
}
unset($p);
ksort($types);
shop_write_json('index.json', ['built' => time(), 'listingsAt' => $state['listingsAt'] ?? time(), 'products' => $products, 'types' => $types]);

$state['missingDetails'] = count(array_filter(array_keys($products), function ($id) use ($details) { return !isset($details[$id]); }));
shop_write_json('state.json', $state);

/* ---------------------------------------------------------------- 4. variant ids (for kiosk orders) */

// Last, after the index is saved, so nothing here can hold up the shop's stock.
$variantStats = null;
if (shop_env('CC_API_PROXY_SECRET') !== '') {
  try {
    $variantStats = sync_variants($listings, !$fresh, $t0 + ($cli ? 900 : 80));
  } catch (Throwable $e) {
    @unlink(shop_data_dir() . '/variants-progress.json');
    $variantStats = ['error' => get_class($e) . ': ' . $e->getMessage()];
  }
}

/**
 * The Admin API knows CrystalCommerce's own variant ids, which orders need; Core2 doesn't. Variants carry
 * product_catalog_id (= the Core2 product id) and descriptors (Condition, ...), so each listing is matched
 * to the variant of the same product with the same condition and other descriptors.
 *
 * Two parts, so CrystalCommerce is asked as little as possible:
 *  - A full pass over every variants page (~256 slow pages, out-of-stock variants included) rebuilds
 *    variants-catalog.json at most every VARIANT_PASS_HOURS. It's paced gently: VARIANT_PAGES_PER_RUN pages
 *    per sync run, VARIANT_PARALLEL at a time with a pause between, progress saved in variants-progress.json.
 *    (Oct 3 2026: back-to-back fast passes coincided with CrystalCommerce dropping connections; keep it slow.)
 *  - The listings are matched against the saved catalog whenever the listings change or a pass finishes,
 *    with no API calls, so a restocked card of a known product can be ordered right away.
 */
function sync_variants(array $listings, bool $listingsChanged, float $deadline): array {
  $progressFile = 'variants-progress.json';
  $prog = shop_read_json($progressFile);
  $catalog = shop_read_json('variants-catalog.json');
  $passAge = time() - (int)($catalog['at'] ?? 0);
  $out = [];

  // A pass started before the catalog kept stock (Oct 9 2026) can't feed the shop: start over.
  if (!is_array($prog) || !isset($prog['queue'], $prog['stock'])) {
    $prog = null;
    if (!is_array($catalog) || $passAge >= VARIANT_PASS_HOURS * 3600 || !isset($catalog['stock'])) {
      [$s, $cats] = shop_cc('GET', '/categories', 'admin:read-inventory');
      $queue = [];
      $names = [];
      foreach ((is_array($cats) ? $cats['category']['children'] ?? [] : []) as $c) {
        if (empty($c['category']['id'])) continue;
        $queue[] = sync_variant_url((int)$c['category']['id'], 1);
        $names[(int)$c['category']['id']] = (string)($c['category']['name'] ?? '');
      }
      if (!$queue) return ['error' => "Could not read CrystalCommerce categories (HTTP $s)"];
      $prog = ['started' => time(), 'queue' => $queue, 'tries' => [], 'byPid' => [], 'stock' => [], 'cats' => $names,
        'count' => 0, 'pages' => 0, 'noCatalogId' => 0];
    }
  }

  $passDone = false;
  $ranPass = (bool)$prog;
  if ($prog) {
    $headers = shop_cc_headers('admin:read-inventory');
    $read = 0;
    // A batch can take up to the 30 s request timeout, so only start one with time to spare.
    while ($prog['queue'] && $read < VARIANT_PAGES_PER_RUN && microtime(true) < $deadline - 32) {
      if ($read > 0) usleep(VARIANT_PAUSE_MS * 1000);
      $batch = array_splice($prog['queue'], 0, VARIANT_PARALLEL);
      $res = shop_fetch_json($batch, VARIANT_PARALLEL, 30, $headers);
      foreach ($batch as $u) {
        $read++;
        $r = $res[$u] ?? null;
        unset($res[$u]);
        if (!is_array($r) || !isset($r['paginated_collection'])) {
          $prog['tries'][$u] = ($prog['tries'][$u] ?? 0) + 1;
          if ($prog['tries'][$u] >= 3) {
            @unlink(shop_data_dir() . '/' . $progressFile);
            return ['error' => 'A variants page kept failing; the pass was dropped and the old catalog kept'];
          }
          $prog['queue'][] = $u;
          continue;
        }
        $pc = $r['paginated_collection'];
        preg_match('/[?&]category_id=(\d+)/', $u, $cm);
        $catId = (int)($cm[1] ?? 0);
        if (preg_match('/[?&]page=1$/', $u)) {
          for ($p = 2; $p <= (int)($pc['total_pages'] ?? 1); $p++) $prog['queue'][] = sync_variant_url($catId, $p);
        }
        foreach ($pc['entries'] ?? [] as $e) {
          $v = $e['variant'] ?? $e;
          if (empty($v['id'])) continue;
          $qty = (int)($v['available_qty'] ?? $v['qty'] ?? 0);
          if (empty($v['product_catalog_id'])) {
            if ($qty > 0) $prog['noCatalogId']++; // no Core2 product (photo, set, page id) to show it with
            continue;
          }
          $cond = '';
          $other = [];
          $shown = [];
          foreach ($v['descriptors'] ?? [] as $d) {
            $d = is_array($d) ? ($d['variant_descriptor'] ?? $d) : [];
            $value = is_scalar($d['value'] ?? null) ? (string)$d['value'] : '';
            if (strcasecmp((string)($d['name'] ?? ''), 'condition') === 0) $cond = shop_condition_label($value);
            elseif ($value !== '') { $other[] = shop_norm($value); $shown[] = $value; }
          }
          sort($other);
          $cond = $cond !== '' ? $cond : 'Standard';
          $cents = (int)($v['sell_price']['money']['cents'] ?? 0);
          $pid = (int)$v['product_catalog_id'];
          $prog['byPid'][(string)$pid][] = [(int)$v['id'], $cond, implode(' ', $other), $cents];
          $prog['count']++;
          // In stock: everything the shop needs to list it (step 1b).
          if ($qty > 0 && $cents > 0) {
            $prog['stock'][] = [(int)$v['id'], $pid, (string)($v['product_name'] ?? ''), $catId, $cond, implode(' · ', $shown), $qty, $cents];
          }
        }
        $prog['pages']++;
      }
      shop_write_json($progressFile, $prog);
    }
    if ($prog['queue']) {
      $out = ['pending' => count($prog['queue']), 'pagesRead' => $prog['pages'], 'variantsSoFar' => $prog['count'], 'inStockSoFar' => count($prog['stock'])];
    } else {
      $catalog = ['at' => time(), 'variants' => $prog['count'], 'inStock' => count($prog['stock']), 'noCatalogId' => $prog['noCatalogId'],
        'pages' => $prog['pages'], 'passMinutes' => (int)round((time() - $prog['started']) / 60),
        'cats' => $prog['cats'], 'byPid' => $prog['byPid'], 'stock' => $prog['stock']];
      shop_write_json('variants-catalog.json', $catalog);
      @unlink(shop_data_dir() . '/' . $progressFile);
      $passDone = true;
    }
    unset($prog);
  }

  // Match the listings against the saved catalog (no API calls) every run: the listings now include the
  // catalog's own stock (step 1b), which changes whenever either side does.
  if (is_array($catalog) && isset($catalog['byPid'])) {
    $out = sync_variant_map($listings, $catalog) + $out;
    if (!$ranPass) $out['nextPassInMinutes'] = max(0, (int)ceil((VARIANT_PASS_HOURS * 3600 - $passAge) / 60));
  }
  return $out;
}

// Matches each listing to a catalog variant and saves variants.json (what the kiosk reads).
function sync_variant_map(array $listings, array $catalog): array {
  $map = [];
  $examples = [];
  $loose = $missing = $fromAdmin = 0;
  foreach ($listings as $l) {
    // Added from the catalog in step 1b: the id is the variant id.
    if ($l['id'] >= ADMIN_LISTING_BASE) { $map[$l['id']] = $l['id'] - ADMIN_LISTING_BASE; $fromAdmin++; continue; }
    $m = sync_match_listing($l, $catalog);
    if ($m !== null) { $map[$l['id']] = $m[0]; if ($m[1]) $loose++; continue; }
    $missing++;
    // A few examples for the status check: how the listing and its candidate variants are described.
    $cands = $catalog['byPid'][(string)$l['pid']] ?? [];
    if (count($examples) < 12) $examples[] = ['listing' => [$l['c'], sync_descriptor_key($l['v'])], 'variants' => array_map(function ($c) { return [$c[1], $c[2]]; }, array_slice($cands, 0, 6)), 'variantCount' => count($cands)];
  }
  $stats = ['at' => time(), 'catalogAt' => (int)$catalog['at'], 'variants' => (int)($catalog['variants'] ?? 0),
    'variantsInStock' => $catalog['inStock'] ?? null, 'noCatalogId' => $catalog['noCatalogId'] ?? null, 'listings' => count($listings),
    'matched' => count($map), 'fromAdmin' => $fromAdmin, 'loose' => $loose, 'unmatched' => $missing];
  shop_write_json('variants.json', $stats + ['unmatchedExamples' => $examples, 'map' => $map]);
  return $stats;
}

// [variant id, matched loosely?] for a Core2 listing: same product, condition and other descriptors (the
// price breaks a tie); a product with a single variant can only be that one, however it's spelled.
function sync_match_listing(array $l, array $catalog): ?array {
  $cands = $catalog['byPid'][(string)$l['pid']] ?? [];
  $want = sync_descriptor_key($l['v']);
  $same = array_values(array_filter($cands, function ($c) use ($l, $want) { return $c[1] === $l['c'] && $c[2] === $want; }));
  if (count($same) > 1) {
    $samePrice = array_values(array_filter($same, function ($c) use ($l) { return $c[3] === $l['p']; }));
    if ($samePrice) $same = $samePrice;
  }
  if ($same) return [$same[0][0], false];
  if (count($cands) === 1) return [$cands[0][0], true];
  return null;
}

function sync_descriptor_key(string $v): string {
  $want = array_map('shop_norm', array_filter(explode(' · ', $v), 'strlen'));
  sort($want);
  return implode(' ', $want);
}

// An Admin API category name as a product type when no Core2 listing shows the store's own spelling:
// "Magic (Sealed)" -> "Magic Sealed" (shop_split_type then files it as Magic / Sealed).
function sync_category_type(string $cat): string {
  $t = trim(preg_replace('/\s+/', ' ', str_replace(['(', ')'], ' ', $cat)));
  return $t !== '' ? $t : 'Other';
}

function sync_variant_url(int $category, int $page): string {
  return shop_cc_base() . "/variants?category_id=$category&per_page=" . VARIANT_PER_PAGE . "&page=$page";
}


done([
  'status' => 'ok', 'listings' => count($listings), 'fromAdmin' => $adminAdded, 'products' => count($products), 'listingsRefreshed' => !$fresh,
  'detailsFetched' => $fetched, 'missing' => $state['missingDetails'], 'raw' => $state['listingsRaw'] ?? null, 'variants' => $variantStats,
  'memoryMB' => round(memory_get_peak_usage() / 1048576), 'memoryLimit' => ini_get('memory_limit'), 'seconds' => round(microtime(true) - $t0, 1),
]);
