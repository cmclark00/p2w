<?php
/**
 * ONE-TIME test #5 (owner-approved, Oct 2026): can a kiosk order be a Preorder that is also flagged "on hold"?
 * Creates at most ONE clearly-labelled TEST order for the cheapest card with 2+ in stock: POST as Preorder
 * with on_hold: true (the create docs' field name). If the order doesn't read back as on hold, tries setting it
 * afterwards with PUT {on_hold: true}, then PUT {is_on_hold: true}. Reads the card's stock before and after.
 * Runs once (result kept in <home>/p2w-shop-data/test-order5.json). Delete this file after the test.
 */

declare(strict_types=1);
require __DIR__ . '/lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

$done = shop_data_dir() . '/test-order5.json';
$lock = fopen(shop_data_dir() . '/test-order5.lock', 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) { echo json_encode(['status' => 'busy']); exit; }
if (is_file($done)) { readfile($done); exit; }
if (shop_env('CC_API_PROXY_SECRET') === '') { echo json_encode(['error' => 'No CC_API_PROXY_SECRET']); exit; }

function finish(array $out): void {
  $json = json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  file_put_contents($GLOBALS['done'], $json);
  echo $json;
  exit;
}

function stock(int $vid): array {
  [$s, $j] = shop_cc('GET', "/variants/$vid", 'admin:read-inventory');
  $v = is_array($j) ? ($j['variant'] ?? $j) : [];
  return ['http' => $s, 'available_qty' => $v['available_qty'] ?? null, 'cents' => $v['sell_price']['money']['cents'] ?? null];
}

function read_order(int $id): array {
  [$s, $j] = shop_cc('GET', "/orders/$id", 'admin:read-orders');
  $o = is_array($j) ? ($j['order'] ?? $j) : [];
  return ['http' => $s, 'status' => $o['status'] ?? null, 'is_on_hold' => $o['is_on_hold'] ?? null];
}

function err($j, string $raw): string {
  return is_array($j) ? json_encode($j, JSON_UNESCAPED_SLASHES) : substr(trim(strip_tags($raw)), 0, 300);
}

$out = ['ranAt' => gmdate('c')];

// The cheapest listing with 2+ in stock and a mapped variant (not the cards from tests #3/#4), from saved data.
$map = (shop_read_json('variants.json') ?: [])['map'] ?? [];
$used = [7941735, 78369];
$pick = null;
foreach (shop_index()['products'] ?? [] as $p) {
  foreach ($p['l'] as $l) {
    if ($l['q'] >= 2 && isset($map[$l['id']]) && !in_array((int)$map[$l['id']], $used, true) && (!$pick || $l['p'] < $pick['cents'])) {
      $pick = ['variant' => (int)$map[$l['id']], 'name' => $p['name'], 'cond' => $l['c'], 'cents' => (int)$l['p']];
    }
  }
}
if (!$pick) finish($out + ['error' => 'No suitable card found']);
$out['item'] = $pick;
$out['stockBefore'] = stock($pick['variant']);
if (($out['stockBefore']['available_qty'] ?? 0) < 2) finish($out + ['error' => 'Card no longer has 2+ available; nothing created']);
$amount = number_format((int)($out['stockBefore']['cents'] ?: $pick['cents']) / 100, 2, '.', '');

$note = 'TEST ORDER #5 (kiosk Preorder + on hold test) from play2wingames.com - please void. Not a real sale.';
$address = ['firstname' => 'TEST ORDER', 'lastname' => 'Kiosk on-hold test', 'address1' => '3903 Western Avenue', 'address2' => 'In-store pickup',
  'city' => 'Knoxville', 'state' => 'TN', 'postal_code' => '37921', 'country' => 'US', 'phone' => '8659108357'];
$order = [
  'origin' => 'Direct', 'status' => 'Preorder', 'on_hold' => true, 'employee_name' => 'KIOSK TEST - NOT PAID',
  'customer_comments' => $note, 'vendor_comments' => $note, 'in_store_pickup' => true, 'ship_price' => '0', 'tax' => '0',
  'ship_rate_attributes' => ['method_id' => 1], 'customer_attributes' => ['id' => shop_env('KIOSK_CUSTOMER_ID') ?: '222309'],
  'shipping_address_attributes' => $address, 'billing_address_attributes' => $address,
  'payment_attributes' => ['status' => 'Received', 'amount' => $amount, 'description' => 'TEST - nothing collected'],
  'line_items_attributes' => (object)['0' => ['qty' => 1, 'variant_id' => (string)$pick['variant'], 'price' => $amount]],
];

[$s, $j, $raw] = shop_cc('POST', '/orders', 'admin:read-orders', ['order' => $order]);
$out['create'] = ['http' => $s, 'is_on_hold' => is_array($j) ? (($j['order'] ?? $j)['is_on_hold'] ?? null) : null, 'error' => $s < 300 ? null : err($j, $raw)];
$id = $s >= 200 && $s < 300 && is_array($j) ? (int)(($j['order'] ?? $j)['id'] ?? 0) : 0;
if (!$id) finish($out + ['result' => 'Refused; nothing created']);
$out['orderId'] = $id;
$out['readBack'] = read_order($id);

// Not on hold yet: try setting the flag on the same order.
foreach (['on_hold', 'is_on_hold'] as $field) {
  if ($out['readBack']['is_on_hold'] === true) break;
  [$s, $j, $raw] = shop_cc('PUT', "/orders/$id", 'admin:read-orders', ['order' => [$field => true]]);
  $out['set_' . $field] = ['http' => $s, 'error' => $s < 300 ? null : err($j, $raw)];
  $out['readBack'] = read_order($id);
}

$out['stockAfter'] = stock($pick['variant']);
$out['held'] = isset($out['stockBefore']['available_qty'], $out['stockAfter']['available_qty'])
  ? $out['stockAfter']['available_qty'] < $out['stockBefore']['available_qty'] : null;
finish($out);
