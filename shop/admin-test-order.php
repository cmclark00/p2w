<?php
/**
 * ONE-TIME test: creates a single clearly-labelled TEST order in CrystalCommerce through the Admin API,
 * to learn what an order from the website needs (approved by the owner, Oct 2026). It runs once: the
 * result is stored in <home>/p2w-shop-data/test-order.json and every later visit just shows it.
 *
 * - Item: the cheapest in-stock Pokemon single, qty 1, in-store pickup, $0 shipping/tax.
 * - Tries the smallest order first and adds fields only when CrystalCommerce rejects it for a missing one;
 *   a rejected attempt creates nothing. Stops at the first success.
 * - Prints statuses, error messages, the new order's id/status/totals, and the shipping options
 *   CrystalCommerce offers for it. No customer data is printed.
 * Delete this file (and cancel the order in the CrystalCommerce admin) once the test is done.
 */

declare(strict_types=1);
require __DIR__ . '/lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

// v2: the first run (test-order.json) created nothing; CrystalCommerce listed the required fields.
// v4: v1-v3 created nothing. v3's 422 was most likely ship method 1, which doesn't exist in this store
// (its enabled methods are USPS static ones: 133 Ground Advantage, 114 Priority Flat Rate Envelope, ...;
// no custom methods, so in-store pickup is an order flag, not a ship method).
$done = shop_data_dir() . '/test-order-v5.json'; // v4: real USPS methods still 422 -> try an existing customer
$lock = fopen(shop_data_dir() . '/test-order.lock', 'c');
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

// Error text only (CrystalCommerce errors name fields, not customers); HTML error pages are shortened.
function err_text($json, string $raw): string {
  if (is_array($json)) {
    $e = $json['errors'] ?? $json['error'] ?? $json['message'] ?? $json;
    return substr(json_encode($e, JSON_UNESCAPED_SLASHES), 0, 1200);
  }
  return substr(trim(preg_replace('/\s+/', ' ', strip_tags($raw))), 0, 300);
}

$out = ['ranAt' => gmdate('c'), 'attempts' => []];

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
if (!$pick) { $out['error'] = 'No in-stock variant found to test with'; echo json_encode($out, JSON_PRETTY_PRINT); exit; }
$out['item'] = $pick;
$amount = number_format($pick['price'] / 100, 2, '.', '');

$note = 'TEST ORDER from play2wingames.com - please cancel. Not a real sale or payment.';
$order = [
  'origin' => 'play2wingames.com', 'employee_name' => 'Website (TEST)', 'status' => 'Payment Received',
  'customer_comments' => $note, 'vendor_comments' => $note, 'in_store_pickup' => true,
  'ship_price' => '0', 'tax' => '0',
  'payment_attributes' => ['status' => 'Received', 'amount' => $amount, 'description' => 'TEST - no money was taken'],
  // An object keyed "0" (CrystalCommerce wants a hash, and PHP would encode a plain [0 => ...] array as a list).
  'line_items_attributes' => (object)['0' => ['qty' => 1, 'variant_id' => (string)$pick['id'], 'price' => $amount]],
  // An existing customer (the owner's own account, approved for this test): the guide's example uses an id.
  'customer_attributes' => ['id' => '202607'],
];
// In-store pickup test: the store's own address for both.
$address = [
  'firstname' => 'TEST ORDER', 'lastname' => 'Play2Win Website', 'address1' => '3903 Western Avenue', 'address2' => 'In-store pickup', // CrystalCommerce rejects a blank address2
  'city' => 'Knoxville', 'state' => 'TN', 'postal_code' => '37921', 'country' => 'US', 'phone' => '8659108357',
];
$order['shipping_address_attributes'] = $address;
$order['billing_address_attributes'] = $address;
$extras = [
  'In Store (custom method 1) + pickup, customer 202607' => ['ship_rate_attributes' => ['method_id' => 1]],
  'In Store (method 1), no pickup flag' => ['ship_rate_attributes' => ['method_id' => 1], 'in_store_pickup' => null],
  'USPS Ground Advantage (133), customer 202607' => ['ship_rate_attributes' => ['method_id' => 133]],
];

$created = null;
foreach ($extras as $label => $extra) {
  foreach (['admin:read-orders'] as $scope) { // the documented scope; admin:write-orders is refused (insufficient_scope)
    $payload = array_filter($extra + $order, function ($v) { return $v !== null; });
    [$s, $j, $raw] = cc('POST', "$base/orders", $scope, $secret, $user, ['order' => $payload]);
    $out['attempts'][] = ['try' => $label, 'scope' => $scope, 'status' => $s, 'error' => $s < 300 ? null : err_text($j, $raw)];
    if ($s >= 200 && $s < 300) { $created = is_array($j) ? $j : ['unparsed' => substr($raw, 0, 300)]; break 2; }
    if ($s !== 401 && $s !== 403) break; // scope accepted; the payload is what failed, so try the next payload
  }
}

if ($created) {
  $o = $created['order'] ?? $created;
  $id = $o['id'] ?? null;
  $out['created'] = [
    'id' => $id, 'status' => $o['status'] ?? null, 'origin' => $o['origin'] ?? null,
    'total' => $o['total_price']['money']['cents'] ?? null, 'items' => array_map(function ($li) { return $li['line_item']['name'] ?? null; }, $o['line_items'] ?? []),
    'fields' => array_keys($o),
  ];
  if ($id) {
    [$s, $j, $raw] = cc('GET', "$base/orders/$id/available_shipping", 'admin:read-orders', $secret, $user);
    $out['availableShipping'] = ['status' => $s, 'body' => $s === 200 ? $j : err_text($j, $raw)];
  }
}

$json = json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
file_put_contents($done, $json);
echo $json;
