<?php
/**
 * ONE-TIME test #2 (owner-approved, Oct 2026): find CrystalCommerce's "not paid yet" order status, for kiosk
 * orders that are paid at the register. Creates at most ONE clearly-labelled TEST order (cheapest in-stock
 * Pokemon single, In Store pickup = ship method 1, origin Direct, the owner's customer 202607, NO payment).
 *  1. Reads which statuses existing orders use (labels and counts only).
 *  2. Tries unpaid-sounding statuses one by one; a rejected attempt creates nothing; stops at the first success.
 *  3. Retries GET /orders/{id}/available_shipping (503 last time).
 * Runs once (result kept in <home>/p2w-shop-data/test-order2.json). Delete this file after the test.
 */

declare(strict_types=1);
require __DIR__ . '/lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

$done = shop_data_dir() . '/test-order2b.json';
$lock = fopen(shop_data_dir() . '/test-order2.lock', 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) { echo json_encode(['status' => 'busy']); exit; }
if (is_file($done)) { readfile($done); exit; }

$secret = shop_env('CC_API_PROXY_SECRET');
$base = rtrim(shop_env('CC_ADMIN_BASE_URL') ?: 'https://playtowingames-admin.crystalcommerce.com/api/v1', '/');
$user = shop_env('CC_API_USERNAME') ?: 'playtowingames';
if ($secret === '') { echo json_encode(['ok' => false, 'error' => 'No CC_API_PROXY_SECRET in p2w-shop-data/.env']); exit; }

function cc(string $method, string $url, string $scope, string $secret, string $user, $body = null): array {
  $ch = curl_init($url);
  $headers = ['Accept: application/json', 'X-API-PROXY-SECRET: ' . $secret, 'X-API-USERNAME: ' . $user, 'X-API-SCOPES: ' . $scope];
  if ($body !== null) $headers[] = 'Content-Type: application/json';
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 45, CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_HTTPHEADER => $headers, CURLOPT_USERAGENT => 'Play2WinGames-Shop/1.0']);
  if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
  $raw = (string)curl_exec($ch);
  $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  return [$status, json_decode($raw, true), $raw];
}

function err_text($json, string $raw): string {
  if (is_array($json)) return substr(json_encode($json, JSON_UNESCAPED_SLASHES), 0, 1500);
  return substr(trim(preg_replace('/\s+/', ' ', strip_tags($raw))), 0, 300);
}

$out = ['ranAt' => gmdate('c')];

// 1. Statuses in use (first page + newest pages), labels and counts only.
$statuses = [];
$awaitingIds = [];
[$s, $j] = cc('GET', "$base/orders?per_page=50&page=1", 'admin:read-orders', $secret, $user);
$last = (int)($j['paginated_collection']['total_pages'] ?? 1);
foreach (array_unique([1, max(1, $last - 5), max(1, $last - 4), max(1, $last - 3), max(1, $last - 2), max(1, $last - 1), $last]) as $pg) {
  [$s, $j] = cc('GET', "$base/orders?per_page=50&page=$pg", 'admin:read-orders', $secret, $user);
  foreach ((is_array($j) ? ($j['paginated_collection']['entries'] ?? []) : []) as $e) {
    $o = $e['order'] ?? $e;
    $k = ($o['status'] ?? '(none)') . ' / ' . ($o['origin'] ?? '?') . (!empty($o['is_pos']) ? ' [POS]' : '');
    $statuses[$k] = ($statuses[$k] ?? 0) + 1;
    if (($o['status'] ?? '') === 'Awaiting Payment' && isset($o['id'])) $awaitingIds[] = $o['id'];
  }
}
arsort($statuses);
$out['statusesInUse'] = $statuses;

// How existing "Awaiting Payment" orders record their payment: payment-related keys, and only
// status/amount/method-like values (no names, emails or addresses).
$keep = '/status|amount|method|type|kind|gateway|state|received|paid/i';
$skip = '/name|email|address|phone|card|number|token|transaction/i';
$scrub = function ($v) use (&$scrub, $keep, $skip) {
  if (!is_array($v)) return null;
  $r = [];
  foreach ($v as $k => $x) {
    if (is_string($k) && preg_match($skip, $k)) continue;
    if (is_array($x)) { $y = $scrub($x); if ($y) $r[$k] = $y; }
    elseif (is_int($k) || preg_match($keep, (string)$k)) $r[$k] = $x;
  }
  return $r;
};
$out['awaitingPaymentExamples'] = [];
foreach (array_slice($awaitingIds, 0, 2) as $aid) {
  [$s, $j] = cc('GET', "$base/orders/$aid", 'admin:read-orders', $secret, $user);
  $o = is_array($j) ? ($j['order'] ?? $j) : [];
  $pay = [];
  foreach ($o as $k => $x) if (stripos((string)$k, 'payment') !== false) $pay[$k] = is_array($x) ? $scrub($x) : $x;
  $out['awaitingPaymentExamples'][] = ['http' => $s, 'origin' => $o['origin'] ?? null, 'orderKeys' => array_keys($o), 'payment' => $pay];
}
$seen = [];
array_walk_recursive($out['awaitingPaymentExamples'], function ($x, $k) use (&$seen) {
  if ($k === 'status' && is_string($x) && $x !== '' && $x !== 'Awaiting Payment') $seen[] = $x;
});

// The cheapest in-stock Pokemon single.
[$s, $cats] = cc('GET', "$base/categories", 'admin:read-inventory', $secret, $user);
$cat = null;
foreach ($cats['category']['children'] ?? [] as $c) if (stripos($c['category']['name'] ?? '', 'pokemon singles') !== false) { $cat = $c['category']['id']; break; }
$pick = null;
for ($page = 1; $page <= 5 && $cat; $page++) {
  [$s, $v] = cc('GET', "$base/variants?category_id=$cat&per_page=200&page=$page", 'admin:read-inventory', $secret, $user);
  foreach ($v['paginated_collection']['entries'] ?? [] as $e) {
    $x = $e['variant'];
    $price = $x['sell_price']['money']['cents'] ?? 0;
    $avail = $x['available_qty'] ?? $x['qty'] ?? 0;
    if ($avail > 0 && $price > 0 && (!$pick || $price < $pick['price'])) $pick = ['id' => $x['id'], 'name' => $x['product_name'], 'price' => $price, 'qty' => $avail];
  }
}
if (!$pick) { $out['error'] = 'No in-stock variant found to test with'; file_put_contents($done, json_encode($out)); echo json_encode($out, JSON_PRETTY_PRINT); exit; }
$out['item'] = $pick;
$amount = number_format($pick['price'] / 100, 2, '.', '');

$note = 'TEST ORDER #2 (kiosk / pay at register) from play2wingames.com - please cancel. Not a real sale.';
$address = [
  'firstname' => 'TEST ORDER', 'lastname' => 'Play2Win Kiosk', 'address1' => '3903 Western Avenue', 'address2' => 'In-store pickup',
  'city' => 'Knoxville', 'state' => 'TN', 'postal_code' => '37921', 'country' => 'US', 'phone' => '8659108357',
];
$order = [
  'origin' => 'Direct', 'employee_name' => 'Website kiosk (TEST)',
  'customer_comments' => $note, 'vendor_comments' => $note, 'in_store_pickup' => true,
  'ship_price' => '0', 'tax' => '0', 'ship_rate_attributes' => ['method_id' => 1],
  'customer_attributes' => ['id' => '202607'],
  'shipping_address_attributes' => $address, 'billing_address_attributes' => $address,
  'line_items_attributes' => (object)['0' => ['qty' => 1, 'variant_id' => (string)$pick['id'], 'price' => $amount]],
];

// 2. Order status "Awaiting Payment" (seen on live orders; run 1 showed a payment record is required).
// Payment statuses: whatever the live Awaiting Payment orders use first, then likely names. Stops at the first accepted.
$payStatuses = array_values(array_unique(array_merge($seen, ['Pending', 'Awaiting Payment', 'Unpaid', 'Not Received', 'Authorized'])));
$out['attempts'] = [];
$created = null;
foreach ($payStatuses as $pst) {
  $payment = ['status' => $pst, 'amount' => $amount, 'description' => 'TEST - pay at register, nothing collected'];
  [$s, $j, $raw] = cc('POST', "$base/orders", 'admin:read-orders', $secret, $user,
    ['order' => ['status' => 'Awaiting Payment', 'payment_attributes' => $payment] + $order]);
  $out['attempts'][] = ['paymentStatus' => $pst, 'http' => $s, 'error' => $s < 300 ? null : err_text($j, $raw)];
  if ($s >= 200 && $s < 300) { $created = is_array($j) ? $j : ['unparsed' => substr($raw, 0, 300)]; break; }
}

if ($created) {
  $o = $created['order'] ?? $created;
  $id = $o['id'] ?? null;
  $out['created'] = ['id' => $id, 'status' => $o['status'] ?? null, 'origin' => $o['origin'] ?? null,
    'total' => $o['total_price']['money']['cents'] ?? null, 'is_on_hold' => $o['is_on_hold'] ?? null,
    'payment' => $scrub($o['payment'] ?? $o['payments'] ?? []),
    'items' => array_map(function ($li) { return $li['line_item']['name'] ?? null; }, $o['line_items'] ?? [])];
  if ($id) {
    [$s, $j, $raw] = cc('GET', "$base/orders/$id/available_shipping", 'admin:read-orders', $secret, $user);
    $out['availableShipping'] = ['http' => $s, 'body' => $s === 200 ? $j : err_text($j, $raw)];
  }
}

$json = json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
file_put_contents($done, $json);
echo $json;
