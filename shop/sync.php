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
 *      product id) and condition, into variants.json. Spread over several runs (see sync_variants).
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
const VARIANT_MIN_MINUTES = 60;   // a full variants pass is ~250 slow Admin API pages, so at most hourly

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

/* ---------------------------------------------------------------- 4. variant ids (for kiosk orders) */

// Last, after the index is saved, so nothing here can hold up the shop's stock.
$variantStats = null;
if (shop_env('CC_API_PROXY_SECRET') !== '') {
  try {
    $variantStats = sync_variants($listings, (int)($state['listingsAt'] ?? 0), $t0 + ($cli ? 900 : 80));
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
 * The store has many variants pages and the Admin API is slow, so one pass is spread over several runs:
 * pages are read 6 at a time, slimmed down right away, and the progress is saved in variants-progress.json
 * until the queue is empty. Then the listings are matched and variants.json is replaced. A new pass starts
 * once the listings are newer than the last finished map and it's at least VARIANT_MIN_MINUTES old.
 */
function sync_variants(array $listings, int $listingsAt, float $deadline): ?array {
  $progressFile = 'variants-progress.json';
  $prog = shop_read_json($progressFile);
  if (!is_array($prog) || !isset($prog['queue'])) {
    $old = shop_read_json('variants.json');
    // Up to date, or refreshed recently enough (checkout re-checks stock and price live anyway).
    if (is_array($old) && ((int)($old['at'] ?? 0) >= $listingsAt || time() - (int)($old['at'] ?? 0) < VARIANT_MIN_MINUTES * 60)) return null;
    [$s, $cats] = shop_cc('GET', '/categories', 'admin:read-inventory');
    $queue = [];
    foreach ((is_array($cats) ? $cats['category']['children'] ?? [] : []) as $c) {
      if (!empty($c['category']['id'])) $queue[] = sync_variant_url((int)$c['category']['id'], 1);
    }
    if (!$queue) return ['error' => "Could not read CrystalCommerce categories (HTTP $s)"];
    $prog = ['started' => time(), 'queue' => $queue, 'tries' => [], 'byPid' => [], 'count' => 0, 'pages' => 0];
  }

  $headers = shop_cc_headers('admin:read-inventory');
  // A batch can take up to the 30 s request timeout, so only start one with time to spare.
  while ($prog['queue'] && microtime(true) < $deadline - 32) {
    $batch = array_splice($prog['queue'], 0, 6);
    $res = shop_fetch_json($batch, 6, 30, $headers);
    foreach ($batch as $u) {
      $r = $res[$u] ?? null;
      unset($res[$u]);
      if (!is_array($r) || !isset($r['paginated_collection'])) {
        $prog['tries'][$u] = ($prog['tries'][$u] ?? 0) + 1;
        if ($prog['tries'][$u] >= 3) {
          @unlink(shop_data_dir() . '/' . $progressFile);
          return ['error' => 'A variants page kept failing; the old map was kept'];
        }
        $prog['queue'][] = $u;
        continue;
      }
      $pc = $r['paginated_collection'];
      if (preg_match('/[?&]category_id=(\d+).*[?&]page=1$/', $u, $m)) {
        for ($p = 2; $p <= (int)($pc['total_pages'] ?? 1); $p++) $prog['queue'][] = sync_variant_url((int)$m[1], $p);
      }
      foreach ($pc['entries'] ?? [] as $e) {
        $v = $e['variant'] ?? $e;
        if (empty($v['id']) || empty($v['product_catalog_id'])) continue;
        $cond = '';
        $other = [];
        foreach ($v['descriptors'] ?? [] as $d) {
          $d = is_array($d) ? ($d['variant_descriptor'] ?? $d) : [];
          $value = is_scalar($d['value'] ?? null) ? (string)$d['value'] : '';
          if (strcasecmp((string)($d['name'] ?? ''), 'condition') === 0) $cond = shop_condition_label($value);
          elseif ($value !== '') $other[] = shop_norm($value);
        }
        sort($other);
        $prog['byPid'][(string)(int)$v['product_catalog_id']][] = [(int)$v['id'], $cond !== '' ? $cond : 'Standard', implode(' ', $other),
          (int)($v['sell_price']['money']['cents'] ?? 0)];
        $prog['count']++;
      }
      $prog['pages']++;
    }
    shop_write_json($progressFile, $prog);
  }
  if ($prog['queue']) return ['pending' => count($prog['queue']), 'pagesRead' => $prog['pages'], 'variantsSoFar' => $prog['count']];

  $map = [];
  $examples = [];
  $loose = $missing = 0;
  foreach ($listings as $l) {
    $cands = $prog['byPid'][(string)$l['pid']] ?? [];
    $want = array_map('shop_norm', array_filter(explode(' · ', $l['v']), 'strlen'));
    sort($want);
    $want = implode(' ', $want);
    $same = array_values(array_filter($cands, function ($c) use ($l, $want) { return $c[1] === $l['c'] && $c[2] === $want; }));
    if (count($same) > 1) {
      $samePrice = array_values(array_filter($same, function ($c) use ($l) { return $c[3] === $l['p']; }));
      if ($samePrice) $same = $samePrice;
    }
    if ($same) { $map[$l['id']] = $same[0][0]; continue; }
    // A product with a single variant can only be that one, even if its descriptors are spelled differently.
    if (count($cands) === 1) { $map[$l['id']] = $cands[0][0]; $loose++; continue; }
    $missing++;
    // A few examples for the status check: how the listing and its candidate variants are described.
    if (count($examples) < 12) $examples[] = ['listing' => [$l['c'], $want], 'variants' => array_map(function ($c) { return [$c[1], $c[2]]; }, array_slice($cands, 0, 6)), 'variantCount' => count($cands)];
  }
  $stats = ['at' => time(), 'variants' => $prog['count'], 'pages' => $prog['pages'], 'listings' => count($listings),
    'matched' => count($map), 'loose' => $loose, 'unmatched' => $missing, 'passMinutes' => (int)round((time() - $prog['started']) / 60)];
  shop_write_json('variants.json', $stats + ['unmatchedExamples' => $examples, 'map' => $map]);
  @unlink(shop_data_dir() . '/' . $progressFile);
  return $stats;
}

function sync_variant_url(int $category, int $page): string {
  return shop_cc_base() . "/variants?category_id=$category&per_page=" . VARIANT_PER_PAGE . "&page=$page";
}


done([
  'status' => 'ok', 'listings' => count($listings), 'products' => count($products), 'listingsRefreshed' => !$fresh,
  'detailsFetched' => $fetched, 'missing' => $state['missingDetails'], 'variants' => $variantStats, 'seconds' => round(microtime(true) - $t0, 1),
]);
