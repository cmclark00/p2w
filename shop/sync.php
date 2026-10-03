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
 *   3. Variant ids (kiosk orders): when CC_API_PROXY_SECRET is set, the Admin API's variants for each
 *      top-level category, matched to the listings by product (variant product_catalog_id = Core2
 *      product id) and condition, into variants.json. Re-read with the listings.
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

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

$cli = PHP_SAPI === 'cli';
$budget = $cli ? 600 : 40;     // seconds for product details (web requests must finish quickly)
@set_time_limit($cli ? 0 : 90);
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
  foreach (array_merge([$first], array_values($rest)) as $i => $page) {
    if (!is_array($page) || !isset($page['listings'])) done(['status' => 'error', 'error' => 'A listings page failed; the old index was kept', 'page' => $i + 1]);
    // Listings come grouped by store location; flatten.
    $groups = is_array($page['listings']) ? $page['listings'] : [];
    foreach ((array_values($groups) === $groups ? [$groups] : $groups) as $group) {
      foreach ($group as $l) {
        $qty = !empty($l['infinite_quantity']) ? 99 : (int)($l['quantity'] ?? 0) - (int)($l['reserved_quantity'] ?? 0);
        $price = $l['ally_agreement_price'] ?? null;
        if ($qty <= 0 || !is_numeric($price) || $price <= 0 || (int)($l['organization_id'] ?? 0) !== (int)$org) continue;
        $d = is_array($l['descriptors'] ?? null) ? $l['descriptors'] : [];
        $cond = shop_condition_label((string)($d['condition'] ?? ''));
        unset($d['condition']);
        $listings[] = [
          'id' => (int)$l['id'], 'pid' => (int)$l['product_id'], 'name' => (string)($l['product_name'] ?? ''),
          'type' => trim((string)($l['product_type_name'] ?? '')), 'c' => $cond !== '' ? $cond : 'Standard',
          'v' => implode(' · ', array_filter(array_map('strval', array_values($d)))), 'q' => $qty, 'p' => (int)$price,
        ];
      }
    }
  }
  shop_write_json('listings.json', $listings);
  $state['listingsAt'] = time();
  $state['listingsCount'] = count($listings);
}

/* ---------------------------------------------------------------- variant ids (for kiosk orders) */

// The Admin API knows CrystalCommerce's own variant ids, which orders need; Core2 doesn't. Variants
// carry product_catalog_id (= the Core2 product id) and descriptors (Condition, ...), so each listing
// is matched to the variant of the same product with the same condition and other descriptors.
$variantStats = null;
$vfile = shop_read_json('variants.json');
if (shop_env('CC_API_PROXY_SECRET') !== '' && (!$fresh || !is_array($vfile) || (int)($vfile['at'] ?? 0) < (int)($state['listingsAt'] ?? 0))) {
  $variantStats = sync_variants($listings);
}

function sync_variants(array $listings): array {
  $headers = shop_cc_headers('admin:read-inventory');
  $base = shop_cc_base();
  [$s, $cats] = shop_cc('GET', '/categories', 'admin:read-inventory');
  $catIds = [];
  foreach ($cats['category']['children'] ?? [] as $c) if (!empty($c['category']['id'])) $catIds[] = (int)$c['category']['id'];
  if (!$catIds) return ['error' => "Could not read CrystalCommerce categories (HTTP $s)"];

  $url = function ($cat, $page) use ($base) { return "$base/variants?category_id=$cat&per_page=" . VARIANT_PER_PAGE . "&page=$page"; };
  $pages = [];
  $first = shop_fetch_json(array_map(function ($c) use ($url) { return $url($c, 1); }, $catIds), 6, 30, $headers);
  $more = [];
  foreach ($catIds as $c) {
    $r = $first[$url($c, 1)] ?? null;
    if (!is_array($r)) return ['error' => "A variants page failed (category $c); the old map was kept"];
    $pages[] = $r;
    for ($p = 2; $p <= (int)($r['paginated_collection']['total_pages'] ?? 1); $p++) $more[] = $url($c, $p);
  }
  foreach (shop_fetch_json($more, 6, 30, $headers) as $u => $r) {
    if (!is_array($r)) return ['error' => 'A variants page failed; the old map was kept'];
    $pages[] = $r;
  }

  $byPid = [];
  $count = 0;
  foreach ($pages as $r) {
    foreach ($r['paginated_collection']['entries'] ?? [] as $e) {
      $v = $e['variant'] ?? $e;
      if (empty($v['id']) || empty($v['product_catalog_id'])) continue;
      $cond = '';
      $other = [];
      foreach ($v['descriptors'] ?? [] as $d) {
        $d = $d['variant_descriptor'] ?? $d;
        if (strcasecmp((string)($d['name'] ?? ''), 'condition') === 0) $cond = shop_condition_label((string)($d['value'] ?? ''));
        elseif (($d['value'] ?? '') !== '') $other[] = shop_norm((string)$d['value']);
      }
      sort($other);
      $byPid[(int)$v['product_catalog_id']][] = ['id' => (int)$v['id'], 'c' => $cond !== '' ? $cond : 'Standard', 'v' => implode(' ', $other),
        'p' => (int)($v['sell_price']['money']['cents'] ?? 0)];
      $count++;
    }
  }

  $map = [];
  $loose = $missing = 0;
  foreach ($listings as $l) {
    $cands = $byPid[$l['pid']] ?? [];
    $v = explode(' · ', $l['v']);
    $v = array_map('shop_norm', array_filter($v, 'strlen'));
    sort($v);
    $same = array_values(array_filter($cands, function ($c) use ($l, $v) { return $c['c'] === $l['c'] && $c['v'] === implode(' ', $v); }));
    if (count($same) > 1) {
      $samePrice = array_values(array_filter($same, function ($c) use ($l) { return $c['p'] === $l['p']; }));
      if ($samePrice) $same = $samePrice;
    }
    if ($same) { $map[$l['id']] = $same[0]['id']; continue; }
    // A product with a single variant can only be that one, even if its descriptors are spelled differently.
    if (count($cands) === 1) { $map[$l['id']] = $cands[0]['id']; $loose++; continue; }
    $missing++;
  }
  $stats = ['at' => time(), 'variants' => $count, 'listings' => count($listings), 'matched' => count($map), 'loose' => $loose, 'unmatched' => $missing];
  shop_write_json('variants.json', $stats + ['map' => $map]);
  return $stats;
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
    if (!is_array($r) || empty($r['id'])) continue; // retried next run
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

done([
  'status' => 'ok', 'listings' => count($listings), 'products' => count($products), 'listingsRefreshed' => !$fresh,
  'detailsFetched' => $fetched, 'missing' => $state['missingDetails'], 'variants' => $variantStats, 'seconds' => round(microtime(true) - $t0, 1),
]);
