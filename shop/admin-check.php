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

$cache = shop_data_dir() . '/admin-check-v4.json';
if (is_file($cache) && time() - filemtime($cache) < 600) { readfile($cache); exit; }

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
