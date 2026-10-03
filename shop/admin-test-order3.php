<?php
/**
 * ONE-TIME test #3 (owner-approved, Oct 2026): can a kiosk order be created with status "Preorder", and does
 * that still hold the card in stock? Creates at most ONE clearly-labelled TEST order (the cheapest in-stock
 * card with 2+ copies and a known CrystalCommerce variant, In Store pickup, the shop's kiosk customer).
 * About 4 Admin API requests: read the card's stock, create the order, read the stock again, read the order.
 * Runs once (result kept in <home>/p2w-shop-data/test-order3.json). Delete this file after the test.
 */

declare(strict_types=1);
require __DIR__ . '/lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

$done = shop_data_dir() . '/test-order3.json';
$lock = fopen(shop_data_dir() . '/test-order3.lock', 'c');
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
  return ['http' => $s, 'available_qty' => $v['available_qty'] ?? null, 'qty' => $v['qty'] ?? null,
    'reserved_qty' => $v['reserved_qty'] ?? null, 'inventory_qty' => $v['inventory_qty'] ?? null, 'cents' => $v['sell_price']['money']['cents'] ?? null];
}

$out = ['ranAt' => gmdate('c')];

// The cheapest listing with 2+ in stock and a mapped variant, from our own saved data (no catalogue paging).
$map = (shop_read_json('variants.json') ?: [])['map'] ?? [];
$pick = null;
foreach (shop_index()['products'] ?? [] as $p) {
  foreach ($p['l'] as $l) {
    if ($l['q'] >= 2 && isset($map[$l['id']]) && (!$pick || $l['p'] < $pick['cents'])) {
      $pick = ['variant' => (int)$map[$l['id']], 'name' => $p['name'], 'cond' => $l['c'], 'cents' => (int)$l['p'], 'qtyInIndex' => $l['q']];
    }
  }
}
if (!$pick) finish($out + ['error' => 'No suitable card found']);
$out['item'] = $pick;
$out['stockBefore'] = stock($pick['variant']);
if (($out['stockBefore']['available_qty'] ?? 0) < 2) finish($out + ['error' => 'Card no longer has 2+ available; nothing created']);
$cents = (int)($out['stockBefore']['cents'] ?: $pick['cents']);
$amount = number_format($cents / 100, 2, '.', '');

$note = 'TEST ORDER #3 (kiosk Preorder test) from play2wingames.com - please cancel. Not a real sale.';
$address = ['firstname' => 'TEST ORDER', 'lastname' => 'Kiosk Preorder test', 'address1' => '3903 Western Avenue', 'address2' => 'In-store pickup',
  'city' => 'Knoxville', 'state' => 'TN', 'postal_code' => '37921', 'country' => 'US', 'phone' => '8659108357'];
$order = [
  'origin' => 'Direct', 'status' => 'Preorder', 'employee_name' => 'KIOSK TEST - NOT PAID',
  'customer_comments' => $note, 'vendor_comments' => $note, 'in_store_pickup' => true, 'ship_price' => '0', 'tax' => '0',
  'ship_rate_attributes' => ['method_id' => 1], 'customer_attributes' => ['id' => shop_env('KIOSK_CUSTOMER_ID') ?: '222309'],
  'shipping_address_attributes' => $address, 'billing_address_attributes' => $address,
  'line_items_attributes' => (object)['0' => ['qty' => 1, 'variant_id' => (string)$pick['variant'], 'price' => $amount]],
];

// Two tries at most (a refused attempt creates nothing): the payment record that works for Payment Received,
// then a pending one.
$out['attempts'] = [];
$created = null;
foreach ([['status' => 'Received', 'amount' => $amount], ['status' => 'Pending', 'amount' => $amount]] as $pay) {
  $pay['description'] = 'TEST - nothing collected';
  [$s, $j, $raw] = shop_cc('POST', '/orders', 'admin:read-orders', ['order' => $order + ['payment_attributes' => $pay]]);
  $out['attempts'][] = ['payment' => $pay['status'], 'http' => $s,
    'error' => $s < 300 ? null : (is_array($j) ? json_encode($j, JSON_UNESCAPED_SLASHES) : substr(trim(strip_tags($raw)), 0, 300))];
  if ($s >= 200 && $s < 300) { $created = is_array($j) ? ($j['order'] ?? $j) : []; break; }
}
if (!$created) finish($out + ['result' => 'Preorder refused; nothing created']);

$id = $created['id'] ?? null;
$out['created'] = ['id' => $id, 'statusReturned' => $created['status'] ?? null];
$out['stockAfter'] = stock($pick['variant']);
if ($id) {
  [$s, $j] = shop_cc('GET', "/orders/$id", 'admin:read-orders');
  $out['readBack'] = ['http' => $s, 'status' => is_array($j) ? (($j['order'] ?? $j)['status'] ?? null) : null];
}
$out['held'] = isset($out['stockBefore']['available_qty'], $out['stockAfter']['available_qty'])
  ? $out['stockAfter']['available_qty'] < $out['stockBefore']['available_qty'] : null;
finish($out);
