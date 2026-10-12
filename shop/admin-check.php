<?php
/**
 * Read-only check of the classic CrystalCommerce Admin API with the shop's proxy secret
 * (CC_API_PROXY_SECRET in <home>/p2w-shop-data/.env). Only GET requests; nothing is created or changed.
 * It reports which parts of the API the secret can reach, with counts and field names only: no customer
 * names, emails, addresses, or order details are ever printed, and the secret never is. The result is
 * cached for 10 minutes so the URL can't be used to hammer CrystalCommerce.
 */

declare(strict_types=1);
require __DIR__ . '/lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

$cache = shop_data_dir() . '/admin-check-v6.json';
if (!isset($_GET['stock']) && !isset($_GET['pid']) && !isset($_GET['compare']) && is_file($cache) && time() - filemtime($cache) < 600) { readfile($cache); exit; }

$secret = shop_env('CC_API_PROXY_SECRET');
$base = rtrim(shop_env('CC_ADMIN_BASE_URL') ?: 'https://playtowingames-admin.crystalcommerce.com/api/v1', '/');
$user = shop_env('CC_API_USERNAME') ?: 'playtowingames';
if ($secret === '') {
  echo json_encode(['ok' => false, 'error' => 'No CC_API_PROXY_SECRET found in p2w-shop-data/.env (check the folder location and the file name).']);
  exit;
}

function cc_get(string $base, string $path, string $scope, string $secret, string $user): array {
  $ch = curl_init($base . $path);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_HTTPHEADER => ['Accept: application/json', 'X-API-PROXY-SECRET: ' . $secret, 'X-API-USERNAME: ' . $user, 'X-API-SCOPES: ' . $scope],
    CURLOPT_USERAGENT => 'Play2WinGames-Shop/1.0',
  ]);
  $body = (string)curl_exec($ch);
  $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  $json = json_decode($body, true);
  return [$status, $json, $json === null ? substr(preg_replace('/\s+/', ' ', strip_tags($body)), 0, 160) : null];
}

// Field names of the first record in a response, without any values.
function shape($json): array {
  $first = $json['paginated_collection']['entries'][0] ?? (is_array($json) && isset($json[0]) ? $json[0] : $json);
  if (!is_array($first)) return [];
  $inner = count($first) === 1 && is_array(reset($first)) ? reset($first) : $first;
  return array_keys($inner);
}

// ?compare=1: how Core2's stock compares with the store's own (the saved Admin catalog), from our data only.
if (isset($_GET['compare'])) {
  $db = new PDO('sqlite:' . shop_data_dir() . '/shop.sqlite', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
  $one = function (string $sql) use ($db) { return (int)$db->query($sql)->fetchColumn(); };
  $res = [
    'core2InStock' => $one('SELECT COUNT(*) FROM core2 WHERE live = 1'),
    'noStoreVariant' => $one('SELECT COUNT(*) FROM core2 WHERE live = 1 AND vid IS NULL'),
    'noStoreVariantQty1' => $one('SELECT COUNT(*) FROM core2 WHERE live = 1 AND vid IS NULL AND q = 1'),
    'storeSaysZero' => $one('SELECT COUNT(*) FROM core2 c JOIN variants v ON v.vid = c.vid WHERE c.live = 1 AND v.qty = 0'),
    'sameQty' => $one('SELECT COUNT(*) FROM core2 c JOIN variants v ON v.vid = c.vid WHERE c.live = 1 AND v.qty = c.q'),
    'core2Higher' => $one('SELECT COUNT(*) FROM core2 c JOIN variants v ON v.vid = c.vid WHERE c.live = 1 AND c.q > v.qty AND v.qty > 0'),
    'core2Lower' => $one('SELECT COUNT(*) FROM core2 c JOIN variants v ON v.vid = c.vid WHERE c.live = 1 AND c.q < v.qty'),
    'core2SoldOutStoreHas' => $one('SELECT COUNT(*) FROM core2 c JOIN variants v ON v.vid = c.vid WHERE c.live = 0 AND v.qty > 0'),
    'core2QtyHistogram' => $db->query('SELECT q, COUNT(*) AS n FROM core2 WHERE live = 1 GROUP BY q ORDER BY n DESC LIMIT 8')->fetchAll(),
    'storeQtyHistogram' => $db->query('SELECT qty, COUNT(*) AS n FROM variants WHERE qty > 0 GROUP BY qty ORDER BY n DESC LIMIT 8')->fetchAll(),
    'examplesNoStoreVariant' => $db->query('SELECT pid, name, c, q, p FROM core2 WHERE live = 1 AND vid IS NULL LIMIT 8')->fetchAll(),
    'examplesStoreZero' => $db->query('SELECT c.pid, c.name, c.c, c.q AS core2Qty, v.qty AS storeQty FROM core2 c JOIN variants v ON v.vid = c.vid WHERE c.live = 1 AND v.qty = 0 LIMIT 8')->fetchAll(),
  ];
  echo json_encode($res, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  exit;
}

// ?pid=<Core2 product id>: everything the shop knows about one product (our index, Core2's listings, the
// saved variants catalog) next to a live read of each of its CrystalCommerce variants. Product data only.
if (isset($_GET['pid'])) {
  $pid = (int)$_GET['pid'];
  $res = ['checkedAt' => gmdate('c'), 'pid' => $pid];
  $q = function (string $file, string $sql, array $args) {
    $path = shop_data_dir() . '/' . $file;
    if (!is_file($path)) return null;
    $db = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $st = $db->prepare($sql);
    $st->execute($args);
    return $st->fetchAll();
  };
  try {
    $res['index'] = $q('shop-index.sqlite', 'SELECT id, c, v, q, p, vid, src, name, type FROM listings WHERE pid = ?', [$pid]);
    $res['core2'] = $q('shop.sqlite', 'SELECT id, c, v, q, p, live, vid FROM core2 WHERE pid = ?', [$pid]);
    $res['catalog'] = $q('shop.sqlite', 'SELECT vid, name, cat, cond, shown, qty, cents FROM variants WHERE pid = ?', [$pid]);
    $res['catalogAt'] = gmdate('c', (int)($q('shop.sqlite', "SELECT v FROM kv WHERE k = 'catalogAt'", [])[0]['v'] ?? 0));
  } catch (Throwable $t) {
    $res['dbError'] = $t->getMessage();
  }
  $res['live'] = [];
  foreach (array_slice($res['catalog'] ?? [], 0, 12) as $row) {
    [$s, $d] = cc_get($base, '/variants/' . (int)$row['vid'], 'admin:read-inventory', $secret, $user);
    $v = is_array($d) ? ($d['variant'] ?? $d) : [];
    $live = ['vid' => (int)$row['vid'], 'status' => $s];
    foreach (['qty', 'available_qty', 'inventory_qty', 'reserved_qty', 'wtb_qty', 'is_infinite_qty'] as $k) $live[$k] = $v[$k] ?? null;
    $live['sell_cents'] = $v['sell_price']['money']['cents'] ?? null;
    $live['descriptors'] = array_map(function ($x) { $x = $x['variant_descriptor'] ?? $x; return ($x['name'] ?? '') . ': ' . ($x['value'] ?? ''); }, $v['descriptors'] ?? []);
    $res['live'][] = $live;
  }
  echo json_encode($res, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  exit;
}

// ?stock=1: which variant fields hold the stock count (Oct 2026: the variants list's `qty` showed out-of-stock
// cards as in stock). One list page from the middle of a category plus 6 single-variant reads, numbers and
// field names only. Cached separately, 10 minutes.
if (isset($_GET['stock'])) {
  $sc = shop_data_dir() . '/admin-check-stock.json';
  if (is_file($sc) && time() - filemtime($sc) < 600) { readfile($sc); exit; }
  $nums = function ($v) {
    $r = [];
    foreach ($v as $k => $x) {
      if (is_scalar($x) || $x === null) { if (preg_match('/qty|quantit|stock|avail|reserv|hold|count|track|infinite|active|hidden|sell/i', (string)$k)) $r[$k] = $x; }
      elseif (preg_match('/qty|quantit|stock|avail|price/i', (string)$k)) $r[$k] = $x;
    }
    return $r;
  };
  [$s, $cats] = cc_get($base, '/categories', 'admin:read-inventory', $secret, $user);
  $cat = null;
  foreach ($cats['category']['children'] ?? [] as $c) if (stripos($c['category']['name'] ?? '', 'pokemon singles') !== false) $cat = $c['category'];
  $res = ['checkedAt' => gmdate('c'), 'category' => $cat['name'] ?? null];
  if ($cat) {
    [$s, $j] = cc_get($base, '/variants?category_id=' . (int)$cat['id'] . '&per_page=50&page=1', 'admin:read-inventory', $secret, $user);
    $pages = (int)($j['paginated_collection']['total_pages'] ?? 1);
    $mid = max(1, intdiv($pages, 2));
    [$s, $j] = cc_get($base, '/variants?category_id=' . (int)$cat['id'] . "&per_page=50&page=$mid", 'admin:read-inventory', $secret, $user);
    $entries = $j['paginated_collection']['entries'] ?? [];
    $first = $entries[0]['variant'] ?? $entries[0] ?? [];
    $res['listPage'] = ['status' => $s, 'page' => $mid, 'of' => $pages, 'total' => $j['paginated_collection']['total_entries'] ?? null];
    $res['listFields'] = array_keys($first);
    $rows = [];
    foreach ($entries as $e) {
      $v = $e['variant'] ?? $e;
      $rows[] = ['id' => $v['id'] ?? null, 'name' => $v['product_name'] ?? null] + $nums($v);
    }
    $res['list'] = $rows;
    $res['single'] = [];
    foreach (array_slice($rows, 0, 6) as $r) {
      [$s, $d] = cc_get($base, '/variants/' . (int)$r['id'], 'admin:read-inventory', $secret, $user);
      $v = is_array($d) ? ($d['variant'] ?? $d) : [];
      $res['single'][] = ['id' => $r['id'], 'status' => $s] + $nums($v);
    }
    $res['singleFields'] = isset($v) && is_array($v) ? array_keys($v) : [];
  }
  $json = json_encode($res, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  @file_put_contents($sc, $json);
  echo $json;
  exit;
}

$out = ['ok' => true, 'checkedAt' => gmdate('c'), 'base' => $base, 'username' => $user, 'checks' => []];

// 1. Categories (inventory scope).
[$s, $j, $raw] = cc_get($base, '/categories', 'admin:read-inventory', $secret, $user);
$top = $j['category']['children'] ?? [];
$out['checks']['categories'] = ['status' => $s, 'topLevel' => array_map(function ($c) { return ['id' => $c['category']['id'] ?? null, 'name' => $c['category']['name'] ?? null]; }, array_slice($top, 0, 12)), 'raw' => $raw];

// 2. Variants and products in the first top-level category that has stock (Pokemon Singles first, the
//    shop's biggest): ids and the link to the storefront/catalog, to match against Core2's product ids.
$order = $top;
usort($order, function ($a, $b) { return (int)(stripos($b['category']['name'] ?? '', 'pokemon') !== false) - (int)(stripos($a['category']['name'] ?? '', 'pokemon') !== false); });
$catId = null;
foreach (array_slice($order, 0, 8) as $c) {
  $id = $c['category']['id'] ?? null;
  if (!$id) continue;
  [$s, $j] = cc_get($base, "/variants?category_id=$id&per_page=1&page=1", 'admin:read-inventory', $secret, $user);
  if (($j['paginated_collection']['total_entries'] ?? 0) > 0) { $catId = $id; $out['checks']['sampleCategory'] = $c['category']['name'] ?? $id; break; }
}
if ($catId) {
  [$s, $j, $raw] = cc_get($base, "/variants?category_id=$catId&per_page=3&page=1", 'admin:read-inventory', $secret, $user);
  $v = array_map(function ($e) {
    $x = $e['variant'] ?? [];
    return ['id' => $x['id'] ?? null, 'product_id' => $x['product_id'] ?? null, 'product_catalog_id' => $x['product_catalog_id'] ?? null,
      'product_name' => $x['product_name'] ?? null, 'qty' => $x['qty'] ?? null, 'sell_cents' => $x['sell_price']['money']['cents'] ?? null];
  }, $j['paginated_collection']['entries'] ?? []);
  $out['checks']['variants'] = ['status' => $s, 'total' => $j['paginated_collection']['total_entries'] ?? null, 'sample' => $v, 'raw' => $raw];

  [$s, $j, $raw] = cc_get($base, "/products?category_id=$catId&per_page=2&page=1", 'admin:read-inventory', $secret, $user);
  $p = array_map(function ($e) {
    $x = $e['product'] ?? [];
    return ['id' => $x['id'] ?? null, 'catalog_id' => $x['catalog_id'] ?? null, 'name' => $x['name'] ?? null, 'catalog_link' => $x['catalog_links']['en']['href'] ?? null];
  }, $j['paginated_collection']['entries'] ?? []);
  $out['checks']['products'] = ['status' => $s, 'total' => $j['paginated_collection']['total_entries'] ?? null, 'sample' => $p, 'raw' => $raw];
}

// 3. Orders (orders scope): only whether it works, how many, and the field names. No order contents.
[$s, $j, $raw] = cc_get($base, '/orders?per_page=1&page=1', 'admin:read-orders', $secret, $user);
$out['checks']['orders'] = ['status' => $s, 'total' => $j['paginated_collection']['total_entries'] ?? (is_array($j) ? count($j) : null), 'fields' => shape($j), 'raw' => $s === 200 ? null : $raw];

// 3b. Shipping methods on recent website orders (carrier/service/method fields only, no customer data),
//     to learn the store's ship-method ids for website orders. Defensive: CrystalCommerce's shapes vary.
try {
  $ship = [];
  $examples = [];
  for ($page = 1; $page <= 2; $page++) {
    [$s, $j] = cc_get($base, "/orders?per_page=50&page=$page", 'admin:read-orders', $secret, $user);
    $list = is_array($j) ? ($j['paginated_collection']['entries'] ?? (isset($j[0]) ? $j : [])) : [];
    foreach ($list as $e) {
      $o = is_array($e) ? ($e['order'] ?? $e) : null;
      if (!is_array($o) || !empty($o['is_pos'])) continue;
      foreach ((array)($o['shipping_lines'] ?? []) as $sl) {
        $l = is_array($sl) ? ($sl['shipping_line'] ?? $sl) : null;
        if (!is_array($l)) continue;
        $amt = $l['amount'] ?? null;
        $cents = is_array($amt) ? ($amt['money']['cents'] ?? null) : $amt;
        $key = json_encode([$l['carrier'] ?? null, $l['service'] ?? null]);
        $ids = [];
        foreach (['id', 'method_id', 'ship_method_id', 'ship_rate_id', 'shipping_method_id', 'code'] as $k) if (isset($l[$k]) && !is_array($l[$k])) $ids[$k] = $l[$k];
        $ship[$key] = ['carrier' => $l['carrier'] ?? null, 'service' => $l['service'] ?? null, 'amount_cents' => $cents, 'fields' => array_keys($l), 'ids' => $ids];
      }
      if (count($examples) < 1) $examples[] = array_values(array_diff(array_keys($o), ['line_items']));
    }
  }
  $out['checks']['shippingSeen'] = array_values($ship);
  $out['checks']['webOrderFields'] = $examples[0] ?? [];
} catch (Throwable $t) {
  $out['checks']['shippingSeen'] = ['error' => get_class($t) . ': ' . $t->getMessage() . ' line ' . $t->getLine()];
}
try {
  [$s, $j, $raw] = cc_get($base, '/prefs/store', 'admin:read-prefs', $secret, $user);
  $first = is_array($j) ? reset($j) : null;
  $out['checks']['prefsStore'] = ['status' => $s, 'fields' => is_array($first) ? array_keys($first) : (is_array($j) ? array_keys($j) : []), 'raw' => $s === 200 ? null : $raw];
} catch (Throwable $t) {
  $out['checks']['prefsStore'] = ['error' => get_class($t) . ': ' . $t->getMessage()];
}

// 3c. One recent web order in full detail, structure only: which nested records an order points at
//     (customer, addresses, ship rate, payment), with ids but no names, emails, addresses, or phones.
try {
  $detail = null;
  [$s, $j] = cc_get($base, '/orders?per_page=25&page=1', 'admin:read-orders', $secret, $user);
  $list = is_array($j) ? ($j['paginated_collection']['entries'] ?? (isset($j[0]) ? $j : [])) : [];
  foreach ($list as $e) {
    $o = is_array($e) ? ($e['order'] ?? $e) : null;
    if (!is_array($o) || !empty($o['is_pos']) || empty($o['id'])) continue;
    [$s2, $d] = cc_get($base, '/orders/' . (int)$o['id'], 'admin:read-orders', $secret, $user);
    $d = is_array($d) ? ($d['order'] ?? $d) : null;
    if (!is_array($d)) continue;
    $safe = function ($v, $k = '') use (&$safe) {
      if (is_array($v)) { $r = []; foreach ($v as $kk => $vv) $r[$kk] = $safe($vv, (string)$kk); return $r; }
      // Keep ids, flags, and short codes; blank out everything that could be personal.
      if (preg_match('/(^|_)id$|^(status|carrier|service|country|state|currency|origin|is_.*|in_store_pickup|method.*)$/', $k)) return $v;
      return is_numeric($v) || is_bool($v) || $v === null ? $v : '…';
    };
    unset($d['line_items']);
    $detail = ['httpStatus' => $s2, 'order' => $safe($d)];
    break;
  }
  $out['checks']['webOrderDetail'] = $detail;
} catch (Throwable $t) {
  $out['checks']['webOrderDetail'] = ['error' => get_class($t) . ': ' . $t->getMessage()];
}

// 3d. Which "origin" values orders use (the API only accepts some): counts per origin from the first page
//     and the newest pages. Labels only.
try {
  $origins = [];
  [$s, $j] = cc_get($base, '/orders?per_page=50&page=1', 'admin:read-orders', $secret, $user);
  $pc = is_array($j) ? ($j['paginated_collection'] ?? []) : [];
  $last = (int)($pc['total_pages'] ?? 1);
  $pages = array_unique([1, max(1, $last - 3), max(1, $last - 2), max(1, $last - 1), $last]);
  foreach ($pages as $pg) {
    [$s, $j] = cc_get($base, "/orders?per_page=50&page=$pg", 'admin:read-orders', $secret, $user);
    foreach ((is_array($j) ? ($j['paginated_collection']['entries'] ?? []) : []) as $e) {
      $o = $e['order'] ?? $e;
      $key = ($o['origin'] ?? '(none)') . (!empty($o['is_pos']) ? ' [POS]' : '');
      $origins[$key] = ($origins[$key] ?? 0) + 1;
    }
  }
  arsort($origins);
  $out['checks']['orderOrigins'] = ['pagesRead' => array_values($pages), 'counts' => $origins];
} catch (Throwable $t) {
  $out['checks']['orderOrigins'] = ['error' => get_class($t) . ': ' . $t->getMessage()];
}

// 4. Customers (customers scope): same, no customer data.
[$s, $j, $raw] = cc_get($base, '/customers?per_page=1&page=1', 'admin:read-customers', $secret, $user);
$out['checks']['customers'] = ['status' => $s, 'total' => $j['paginated_collection']['total_entries'] ?? (is_array($j) ? count($j) : null), 'fields' => shape($j), 'raw' => $s === 200 ? null : $raw];

// 5. Inventory changes in the last day (activity-logs scope): just the count.
$from = gmdate('Y-m-d', time() - 86400);
$to = gmdate('Y-m-d', time() + 86400);
[$s, $j, $raw] = cc_get($base, "/activity_logs?from=$from&to=$to", 'admin:read-activity-logs', $secret, $user);
$out['checks']['activityLogs'] = ['status' => $s, 'countLastDay' => is_array($j) ? count($j) : null, 'fields' => shape($j), 'raw' => $s === 200 ? null : $raw];

$json = json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
@file_put_contents($cache, $json);
echo $json;
