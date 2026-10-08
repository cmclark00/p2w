<?php
/**
 * Online checkout for the shop (everyone except the kiosks): a cart, free in-store pickup, payment
 * with PayPal, an order in CrystalCommerce, and a confirmation email to the customer.
 *
 *  - Password gate: while SHOP_PASSWORD is set, every /shop page asks for it first (the kiosks and the
 *    /shop/kiosk/... links skip it). Changing the password signs everyone out.
 *  - Checkout is on once the PayPal keys for PAYPAL_MODE (sandbox, the default, or live) are set.
 *    Until then, product pages keep the "Buy on our online store" hand-off to CrystalCommerce.
 *  - SHOP_ORDERS=test (the default): PayPal takes the payment (use sandbox keys), but no CrystalCommerce
 *    order is made; order numbers start with "W" and say TEST. SHOP_ORDERS=live: every paid order becomes a
 *    CrystalCommerce **Preorder** (the one status the API accepts that holds the cards; see kiosk.php)
 *    under SHOP_CC_CUSTOMER_ID, in-store pickup, with the PayPal capture id in its payment line.
 *  - Order of operations, so nobody pays for cards we don't have: stock and price are re-checked live in
 *    CrystalCommerce when the PayPal order is created and again just before the payment is captured. If
 *    CrystalCommerce then refuses the order anyway, the payment is refunded on the spot.
 *  - Tax: SHOP_TAX_RATE (9.25% by default, Knoxville) on everything, since every order is picked up here.
 *  - Emails go to the customer's address (SMTP settings if given, else PHP's mail()), with an optional
 *    copy to SHOP_ORDER_BCC.
 */

declare(strict_types=1);

const WEB_GATE_COOKIE = 'p2w_shopgate';
const WEB_CART_COOKIE = 'p2w_cart';
const WEB_EMPLOYEE = 'WEBSITE - PAID ONLINE';

/* ================================================================== settings */

function web_cfg(): array {
  static $c = null;
  if ($c === null) {
    $live = strtolower(shop_env('PAYPAL_MODE')) === 'live';
    $p = $live ? 'PAYPAL_LIVE_' : 'PAYPAL_SANDBOX_';
    $rate = shop_env('SHOP_TAX_RATE');
    $c = [
      'password' => shop_env('SHOP_PASSWORD'),
      'ppLive' => $live,
      'ppClient' => shop_env($p . 'CLIENT_ID'),
      'ppSecret' => shop_env($p . 'SECRET'),
      'ordersLive' => strtolower(shop_env('SHOP_ORDERS')) === 'live',
      'customer' => shop_env('SHOP_CC_CUSTOMER_ID') ?: '202607',
      'taxRate' => is_numeric($rate) ? (float)$rate : 9.25,
      'from' => shop_env('SHOP_MAIL_FROM') ?: 'orders@play2wingames.com',
      'bcc' => shop_env('SHOP_ORDER_BCC'),
    ];
  }
  return $c;
}

// Online checkout is available (PayPal keys for the current mode are set).
function web_checkout_on(): bool {
  $c = web_cfg();
  return $c['ppClient'] !== '' && $c['ppSecret'] !== '';
}

// Signs the shop's own cookies (cart, password gate, order links). Made once, kept in the private data folder.
function web_secret(): string {
  static $s = null;
  if ($s !== null) return $s;
  $path = shop_data_dir() . '/shop-secret.key';
  $s = is_file($path) ? trim((string)file_get_contents($path)) : '';
  if (strlen($s) < 32) {
    $s = bin2hex(random_bytes(32));
    file_put_contents($path, $s);
    @chmod($path, 0600);
  }
  return $s;
}

/* ================================================================== password gate */

function web_gate_on(): bool {
  return web_cfg()['password'] !== '';
}

// Tied to the password, so changing it signs everyone out.
function web_gate_value(): string {
  return 'gate:' . substr(hash('sha256', web_cfg()['password']), 0, 16);
}

function web_gate_passed(): bool {
  return !web_gate_on() || kiosk_unsign($_COOKIE[WEB_GATE_COOKIE] ?? null, web_secret()) === web_gate_value();
}

// /shop/login: the password page (and its form post). Sends people back where they were going.
function web_gate_page(): void {
  $post = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';
  $next = (string)($_POST['next'] ?? $_GET['next'] ?? '/shop');
  if (!preg_match('#^/shop(/[^\s]*)?$#', $next)) $next = '/shop';
  $error = '';
  if ($post) {
    if (hash_equals(web_cfg()['password'], (string)($_POST['password'] ?? ''))) {
      kiosk_set_cookie(WEB_GATE_COOKIE, kiosk_sign(web_gate_value(), web_secret()), 30 * 86400);
      kiosk_redirect($next);
    }
    sleep(1); // slows down guessing
    $error = '<p class="kiosk-problems" role="alert">That password isn’t right.</p>';
  }
  http_response_code($post ? 403 : 401);
  header('Cache-Control: no-store');
  shop_page('Shop preview', 'Play2Win shop preview.', '<section class="shop-section shop-state web-gate">
      <p class="eyebrow">Shop preview</p><h1>The online shop is being tested.</h1>
      <p class="lead">Enter the preview password to continue.</p>' . $error . '
      <form action="/shop/login" method="post" class="web-gate-form">
        <input type="hidden" name="next" value="' . h($next) . '">
        <label for="web-pass">Password</label>
        <input id="web-pass" name="password" type="password" autocomplete="current-password" required autofocus>
        <button class="button primary" type="submit">Enter</button>
      </form></section>', ['crumbs' => []]);
}

/* ================================================================== cart (a signed cookie, like the kiosk's) */

// [listing id => ['q' => qty, 'p' => price in cents confirmed at checkout, or null]]
function web_cart(): array {
  if (isset($GLOBALS['web_cart'])) return $GLOBALS['web_cart'];
  $cart = [];
  $data = kiosk_unsign($_COOKIE[WEB_CART_COOKIE] ?? null, web_secret());
  $rows = $data !== null ? json_decode((string)base64_decode(strtr($data, '-_', '+/')), true) : null;
  foreach (is_array($rows) ? $rows : [] as $r) {
    if (is_array($r) && isset($r[0], $r[1]) && (int)$r[1] > 0) $cart[(int)$r[0]] = ['q' => min(KIOSK_MAX_QTY, (int)$r[1]), 'p' => isset($r[2]) ? (int)$r[2] : null];
  }
  return $GLOBALS['web_cart'] = $cart;
}

function web_cart_save(array $cart): void {
  $cart = array_slice($cart, 0, KIOSK_MAX_LINES, true);
  $GLOBALS['web_cart'] = $cart;
  if (!$cart) { kiosk_set_cookie(WEB_CART_COOKIE, '', 0); return; }
  $rows = [];
  foreach ($cart as $lid => $c) $rows[] = $c['p'] === null ? [$lid, $c['q']] : [$lid, $c['q'], $c['p']];
  kiosk_set_cookie(WEB_CART_COOKIE, kiosk_sign(rtrim(strtr(base64_encode(json_encode($rows)), '+/', '-_'), '='), web_secret()), 14 * 86400);
}

function web_cart_count(): int {
  return array_sum(array_column(web_cart(), 'q'));
}

// Cart lines with their product and listing; price is the one confirmed at checkout, else the shelf price.
function web_cart_lines(): array {
  $lines = [];
  foreach (web_cart() as $lid => $c) {
    $hit = kiosk_listing($lid);
    $lines[] = ['lid' => $lid, 'q' => $c['q'], 'p' => $c['p'] ?? ($hit ? (int)$hit[1]['p'] : 0), 'product' => $hit[0] ?? null, 'listing' => $hit[1] ?? null];
  }
  return $lines;
}

function web_tax(int $subtotal): int {
  return (int)round($subtotal * web_cfg()['taxRate'] / 100);
}

/* ================================================================== live stock + price check */

/**
 * Checks the cart against CrystalCommerce (stock and price of each item's variant, all at once). Updates the
 * cart to what's available. Returns ['items' => [...]] when nothing changed, or ['problems' => [messages]].
 */
function web_check_cart(): array {
  $cart = web_cart();
  $lines = web_cart_lines();
  if (!$lines) return ['problems' => ['Your cart is empty.']];
  if (shop_env('CC_API_PROXY_SECRET') === '') return ['problems' => ['Online checkout isn’t connected to our inventory yet. Please try again later.']];
  $problems = [];
  $checks = [];
  foreach ($lines as $ln) {
    $label = $ln['product'] ? $ln['product']['name'] . ' (' . $ln['listing']['c'] . ')' : 'An item';
    if (!$ln['product']) { $problems[] = "$label sold out and was removed from your cart."; unset($cart[$ln['lid']]); continue; }
    $vid = kiosk_variant_id($ln['lid']);
    if (!$vid) { $problems[] = "$label can’t be ordered online yet. It was removed from your cart; call or visit the store for it."; unset($cart[$ln['lid']]); continue; }
    $checks[$ln['lid']] = shop_cc_base() . '/variants/' . $vid;
  }
  $current = $checks ? shop_fetch_json(array_values($checks), 6, 20, shop_cc_headers('admin:read-inventory')) : [];
  $items = [];
  foreach ($lines as $ln) {
    if (!isset($checks[$ln['lid']])) continue;
    $r = $current[$checks[$ln['lid']]] ?? null;
    $v = is_array($r) ? ($r['variant'] ?? $r) : null;
    if (!is_array($v) || empty($v['id'])) return ['problems' => ['We couldn’t reach our inventory system to check stock. Please try again in a minute.']];
    $label = $ln['product']['name'] . ' (' . $ln['listing']['c'] . ')';
    $avail = !empty($v['is_infinite_qty']) ? KIOSK_MAX_QTY : (int)($v['available_qty'] ?? $v['qty'] ?? 0);
    $cents = (int)($v['sell_price']['money']['cents'] ?? 0);
    if ($avail <= 0 || $cents <= 0) { $problems[] = "$label just sold out and was removed from your cart."; unset($cart[$ln['lid']]); continue; }
    $q = $ln['q'];
    if ($avail < $q) { $problems[] = "Only $avail of $label left. Your cart was updated."; $q = $avail; }
    if ($cents !== $ln['p']) $problems[] = "$label is now " . shop_money($cents) . ' (was ' . shop_money($ln['p']) . ').';
    $cart[$ln['lid']] = ['q' => $q, 'p' => $cents];
    $items[] = ['lid' => $ln['lid'], 'variant' => (int)$v['id'], 'pid' => (int)$ln['product']['id'], 'name' => $ln['product']['name'],
      'cond' => $ln['listing']['c'], 'detail' => $ln['listing']['v'], 'qty' => $q, 'cents' => $cents];
  }
  web_cart_save($cart);
  return $problems ? ['problems' => $problems] : ['items' => $items];
}

/* ================================================================== our order list (shop-orders.json) */

// Runs $fn(&$data) with shop-orders.json locked, saves, and returns $fn's result.
function web_orders_update(callable $fn) {
  $lock = fopen(shop_data_dir() . '/shop-orders.lock', 'c');
  if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('Could not lock the order list');
  try {
    $data = shop_read_json('shop-orders.json') ?: ['seq' => 1000, 'orders' => []];
    $result = $fn($data);
    $data['orders'] = array_slice($data['orders'], -2000); // plenty; CrystalCommerce keeps the real record
    shop_write_json('shop-orders.json', $data);
    return $result;
  } finally {
    flock($lock, LOCK_UN);
    fclose($lock);
  }
}

function web_find_order(callable $match): ?array {
  foreach ((shop_read_json('shop-orders.json') ?: [])['orders'] ?? [] as $o) if ($match($o)) return $o;
  return null;
}

// Link to an order's confirmation page; the signature keeps strangers from reading other people's orders.
function web_order_url(array $o): string {
  return '/shop/order/' . rawurlencode($o['num']) . '?k=' . substr(hash_hmac('sha256', 'order:' . $o['num'], web_secret()), 0, 24);
}

/* ================================================================== PayPal (REST, Orders v2) */

function pp_base(): string {
  $test = getenv('P2W_PAYPAL_API_BASE'); // local testing only: a fake PayPal (a real environment variable, never the .env)
  if ($test) return rtrim($test, '/');
  return web_cfg()['ppLive'] ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

// [HTTP status, decoded JSON]. $auth = 'Bearer …' or 'Basic …'.
function pp_http(string $method, string $url, string $auth, $body, array $headers = []): array {
  $ch = curl_init($url);
  $form = is_string($body);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 45, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_HTTPHEADER => array_merge(['Accept: application/json', 'Authorization: ' . $auth,
      'Content-Type: ' . ($form ? 'application/x-www-form-urlencoded' : 'application/json')], $headers),
    CURLOPT_USERAGENT => 'Play2WinGames-Shop/1.0 (+https://play2wingames.com)',
  ]);
  if (PHP_OS_FAMILY === 'Windows' && defined('CURLSSLOPT_NATIVE_CA')) curl_setopt($ch, CURLOPT_SSL_OPTIONS, CURLSSLOPT_NATIVE_CA); // local testing
  if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $form ? $body : json_encode($body, JSON_UNESCAPED_SLASHES));
  $raw = (string)curl_exec($ch);
  $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  return [$status, json_decode($raw, true)];
}

// An access token, cached in the private folder until a minute before it expires.
function pp_token(): string {
  $c = web_cfg();
  $mode = $c['ppLive'] ? 'live' : 'sandbox';
  $cached = shop_read_json('paypal-token.json');
  if (is_array($cached) && ($cached['mode'] ?? '') === $mode && ($cached['client'] ?? '') === substr($c['ppClient'], 0, 12) && ($cached['exp'] ?? 0) > time() + 60) return (string)$cached['token'];
  [$s, $j] = pp_http('POST', pp_base() . '/v1/oauth2/token', 'Basic ' . base64_encode($c['ppClient'] . ':' . $c['ppSecret']), 'grant_type=client_credentials');
  if ($s !== 200 || empty($j['access_token'])) throw new RuntimeException("PayPal sign-in failed (HTTP $s)");
  shop_write_json('paypal-token.json', ['mode' => $mode, 'client' => substr($c['ppClient'], 0, 12), 'token' => $j['access_token'], 'exp' => time() + (int)($j['expires_in'] ?? 300)]);
  return (string)$j['access_token'];
}

function pp_api(string $method, string $path, $body = null, array $headers = []): array {
  return pp_http($method, pp_base() . $path, 'Bearer ' . pp_token(), $body, $headers);
}

function pp_money(int $cents): array {
  return ['currency_code' => 'USD', 'value' => number_format($cents / 100, 2, '.', '')];
}

/* ================================================================== checkout steps (JSON, called by shop.js) */

function web_json(array $out, int $status = 200): void {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  exit;
}

function web_json_body(): array {
  if (($_SERVER['HTTP_SEC_FETCH_SITE'] ?? 'same-origin') === 'cross-site') web_json(['problems' => ['Refused.']], 403);
  $in = json_decode((string)file_get_contents('php://input'), true);
  return is_array($in) ? $in : [];
}

// Step 1 (PayPal's createOrder): check the details and the cart, then open a PayPal order for the total.
function web_checkout_create(): void {
  $in = web_json_body();
  $clean = function ($v, int $max): string { return mb_substr(trim(preg_replace('/[\x00-\x1F\x7F]+/u', ' ', is_scalar($v) ? (string)$v : '')), 0, $max); };
  $name = $clean($in['name'] ?? '', 60);
  $email = $clean($in['email'] ?? '', 120);
  $phone = $clean($in['phone'] ?? '', 30);
  $problems = [];
  if ($name === '') $problems[] = 'Please enter your name (for picking the order up).';
  if (!filter_var($email, FILTER_VALIDATE_EMAIL)) $problems[] = 'Please enter a valid email address (your confirmation goes there).';
  if ($problems) web_json(['problems' => $problems, 'fix' => true]);
  if (!web_checkout_on()) web_json(['problems' => ['Online checkout isn’t switched on yet.']]);

  $check = web_check_cart();
  if (isset($check['problems'])) web_json(['problems' => $check['problems'], 'reload' => true]);
  $items = $check['items'];
  $subtotal = array_sum(array_map(function ($i) { return $i['qty'] * $i['cents']; }, $items));
  $tax = web_tax($subtotal);
  $total = $subtotal + $tax;

  $ref = web_orders_update(function (array &$d) { $d['seq'] = (int)($d['seq'] ?? 1000) + 1; return 'W' . $d['seq']; });
  $ppItems = array_map(function ($i) {
    return ['name' => mb_substr($i['name'], 0, 127), 'description' => mb_substr(trim($i['cond'] . ($i['detail'] !== '' ? ' · ' . $i['detail'] : '')), 0, 127),
      'sku' => (string)$i['variant'], 'quantity' => (string)$i['qty'], 'unit_amount' => pp_money($i['cents']), 'category' => 'PHYSICAL_GOODS'];
  }, $items);
  try {
    [$s, $j] = pp_api('POST', '/v2/checkout/orders', [
      'intent' => 'CAPTURE',
      'purchase_units' => [[
        'reference_id' => $ref, 'invoice_id' => $ref . '-' . bin2hex(random_bytes(3)), 'description' => 'Play2Win Games order ' . $ref . ' (in-store pickup)',
        'amount' => pp_money($total) + ['breakdown' => ['item_total' => pp_money($subtotal), 'tax_total' => pp_money($tax)]],
        'items' => $ppItems,
      ]],
      'payer' => ['email_address' => $email],
      'application_context' => ['brand_name' => 'Play2Win Games', 'shipping_preference' => 'NO_SHIPPING', 'user_action' => 'PAY_NOW'],
    ], ['PayPal-Request-Id: create-' . $ref]);
  } catch (Throwable $t) {
    web_json(['problems' => ['We couldn’t reach PayPal. Please try again in a minute.']]);
  }
  if ($s < 200 || $s >= 300 || empty($j['id'])) web_json(['problems' => ['PayPal couldn’t start the payment (HTTP ' . $s . '). Please try again.']]);

  web_orders_update(function (array &$d) use ($ref, $j, $items, $name, $email, $phone, $subtotal, $tax, $total) {
    $d['orders'][] = ['ref' => $ref, 'num' => $ref, 'pp' => $j['id'], 'items' => $items, 'name' => $name, 'email' => $email, 'phone' => $phone,
      'subtotal' => $subtotal, 'tax' => $tax, 'total' => $total, 'at' => time(), 'status' => 'pending', 'test' => !web_cfg()['ordersLive'],
      'paypal' => web_cfg()['ppLive'] ? 'live' : 'sandbox'];
  });
  web_json(['id' => $j['id']]);
}

// Step 2 (PayPal's onApprove): check the stock once more, take the payment, then make the CrystalCommerce
// order (refunding at once if CrystalCommerce refuses), email the customer, and send them to the confirmation.
function web_checkout_capture(): void {
  $in = web_json_body();
  $ppId = is_string($in['id'] ?? null) ? $in['id'] : '';
  $o = $ppId !== '' ? web_find_order(function ($o) use ($ppId) { return ($o['pp'] ?? '') === $ppId; }) : null;
  if (!$o) web_json(['problems' => ['We couldn’t find that payment. Nothing was charged.']]);
  if ($o['status'] === 'paid') web_json(['redirect' => web_order_url($o)]); // a repeated click: show the order again
  if ($o['status'] !== 'pending') web_json(['problems' => ['This checkout was already closed. Please start again from your cart.']]);

  // Nothing is charged until the cards are confirmed still here at the same price.
  $check = web_check_cart();
  $same = isset($check['items']) && array_map(function ($i) { return [$i['variant'], $i['qty'], $i['cents']]; }, $check['items'])
    === array_map(function ($i) { return [$i['variant'], $i['qty'], $i['cents']]; }, $o['items']);
  if (!$same) {
    web_order_set($o['ref'], ['status' => 'abandoned']);
    web_json(['problems' => array_merge($check['problems'] ?? [], ['Your cart changed while you were paying, so nothing was charged. Please review your order and pay again.']), 'reload' => true]);
  }

  [$s, $j] = pp_api('POST', '/v2/checkout/orders/' . rawurlencode($ppId) . '/capture', new stdClass(), ['PayPal-Request-Id: capture-' . $o['ref'], 'Prefer: return=representation']);
  $cap = $j['purchase_units'][0]['payments']['captures'][0] ?? null;
  $paid = $s >= 200 && $s < 300 && ($j['status'] ?? '') === 'COMPLETED' && is_array($cap) && ($cap['status'] ?? '') === 'COMPLETED'
    && (int)round(((float)($cap['amount']['value'] ?? 0)) * 100) === (int)$o['total'];
  if (!$paid) {
    $declined = ($j['details'][0]['issue'] ?? '') === 'INSTRUMENT_DECLINED';
    if (is_array($cap) && in_array($cap['status'] ?? '', ['COMPLETED', 'PENDING'], true)) {
      // Money moved but not as expected (pending, or a different amount): never leave it hanging.
      web_pp_refund((string)$cap['id']);
      web_order_set($o['ref'], ['status' => 'refunded', 'capture' => $cap['id'], 'why' => 'capture ' . ($cap['status'] ?? '?')]);
      web_json(['problems' => ['PayPal didn’t complete the payment normally, so it was refunded. Please try again or use a different payment method.']]);
    }
    web_json(['problems' => [$declined ? 'Your payment method was declined. Please try another one.' : 'PayPal couldn’t complete the payment (HTTP ' . $s . '). You weren’t charged.'], 'retry' => $declined]);
  }

  $ccId = null;
  if (web_cfg()['ordersLive']) {
    [$ccId, $err] = web_cc_order($o, (string)$cap['id']);
    if (!$ccId) {
      $refunded = web_pp_refund((string)$cap['id']);
      web_order_set($o['ref'], ['status' => $refunded ? 'refunded' : 'refund-failed', 'capture' => $cap['id'], 'why' => $err]);
      web_mail_staff_problem($o, (string)$cap['id'], $err, $refunded);
      web_json(['problems' => [$refunded
        ? 'We took your payment but couldn’t place the order in our system, so the payment was refunded. Please call us at 865-910-8357 and we’ll sort it out.'
        : 'We took your payment but couldn’t place the order in our system. We’re refunding it; please call us at 865-910-8357.']]);
    }
  }
  $num = $ccId ? (string)$ccId : $o['ref'];
  $o = web_order_set($o['ref'], ['status' => 'paid', 'capture' => $cap['id'], 'ccId' => $ccId, 'num' => $num, 'paidAt' => time()]);
  web_cart_save([]);
  try { web_mail_confirmation($o); } catch (Throwable $t) { /* the order stands; the page shows everything the email would */ }
  web_json(['redirect' => web_order_url($o)]);
}

function web_order_set(string $ref, array $fields): array {
  return web_orders_update(function (array &$d) use ($ref, $fields) {
    foreach ($d['orders'] as &$o) if ($o['ref'] === $ref) { $o = $fields + $o; return $o; }
    return [];
  });
}

function web_pp_refund(string $captureId): bool {
  try {
    [$s] = pp_api('POST', '/v2/payments/captures/' . rawurlencode($captureId) . '/refund', new stdClass(), ['PayPal-Request-Id: refund-' . $captureId]);
    return $s >= 200 && $s < 300;
  } catch (Throwable $t) {
    return false;
  }
}

// The CrystalCommerce order: a Preorder (holds the cards; staff move it on at pickup) in the shape the kiosk
// proved, but paid: the payment line carries the PayPal capture id. Returns [id, error].
function web_cc_order(array $o, string $captureId): array {
  $money = function (int $cents) { return number_format($cents / 100, 2, '.', ''); };
  $lineItems = [];
  foreach (array_values($o['items']) as $i => $it) $lineItems[(string)$i] = ['qty' => $it['qty'], 'variant_id' => (string)$it['variant'], 'price' => $money($it['cents'])];
  $contact = $o['name'] . ', ' . $o['email'] . ($o['phone'] !== '' ? ', ' . $o['phone'] : '');
  $note = "WEBSITE ORDER {$o['ref']} - PAID ONLINE (PayPal capture $captureId, " . shop_money($o['total']) . ' incl. ' . shop_money($o['tax']) . " tax). IN-STORE PICKUP for $contact. "
    . 'When they pick it up, move this order to Payment Received, then Shipped. Don’t charge again.';
  [$first, $last] = array_pad(explode(' ', $o['name'], 2), 2, '');
  $address = ['firstname' => $first, 'lastname' => $last !== '' ? $last : 'Website order', 'address2' => 'In-store pickup'] + KIOSK_STORE_ADDRESS;
  $order = [
    'origin' => 'Direct', 'status' => KIOSK_CC_STATUS, 'employee_name' => WEB_EMPLOYEE,
    'customer_comments' => $note, 'vendor_comments' => $note, 'in_store_pickup' => true, 'ship_price' => '0', 'tax' => $money($o['tax']),
    'ship_rate_attributes' => ['method_id' => 1],
    'customer_attributes' => ['id' => web_cfg()['customer']],
    'shipping_address_attributes' => $address, 'billing_address_attributes' => $address,
    'payment_attributes' => ['status' => 'Received', 'amount' => $money($o['total']), 'description' => "PayPal $captureId (paid online, website order {$o['ref']})"],
    'line_items_attributes' => (object)$lineItems,
  ];
  [$s, $j, $raw] = shop_cc('POST', '/orders', 'admin:read-orders', ['order' => $order]);
  $r = is_array($j) ? ($j['order'] ?? $j) : [];
  if ($s >= 200 && $s < 300 && !empty($r['id'])) {
    // Read it back: CrystalCommerce once answered "success" for an order it never saved (see kiosk_cc_order).
    $id = (int)$r['id'];
    [$s2, $j2] = shop_cc('GET', "/orders/$id", 'admin:read-orders');
    $back = is_array($j2) ? ($j2['order'] ?? $j2) : [];
    if ($s2 === 200 && (int)($back['id'] ?? 0) === $id && ($back['status'] ?? '') === KIOSK_CC_STATUS) return [$id, null];
    return [null, "order $id could not be confirmed (HTTP $s2, status " . (($back['status'] ?? '') !== '' ? $back['status'] : 'missing') . ')'];
  }
  $err = is_array($j) ? json_encode($j, JSON_UNESCAPED_SLASHES) : trim(preg_replace('/\s+/', ' ', strip_tags($raw)));
  return [null, "HTTP $s " . substr($err, 0, 200)];
}

/* ================================================================== email */

// Sends an HTML + plain-text email. SMTP when SHOP_SMTP_HOST is set (port 465 = SSL, else STARTTLS), else mail().
function web_send_mail(string $to, string $subject, string $html, string $text, string $bcc = ''): bool {
  $from = web_cfg()['from'];
  $boundary = 'p2w' . bin2hex(random_bytes(8));
  $headers = ['From: Play2Win Games <' . $from . '>', 'Reply-To: inquiries@play2wingames.com', 'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' . $boundary . '"'];
  $body = "--$boundary\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($text))
    . "--$boundary\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($html)) . "--$boundary--\r\n";
  $subj = '=?UTF-8?B?' . base64_encode($subject) . '?=';
  $host = shop_env('SHOP_SMTP_HOST');
  if ($host === '') {
    if ($bcc !== '') $headers[] = 'Bcc: ' . $bcc;
    return @mail($to, $subj, $body, implode("\r\n", $headers), '-f' . $from);
  }
  $rcpts = array_filter([$to, $bcc]);
  return web_smtp($host, (int)(shop_env('SHOP_SMTP_PORT') ?: 465), shop_env('SHOP_SMTP_USER') ?: $from, shop_env('SHOP_SMTP_PASSWORD'), $from, $rcpts,
    implode("\r\n", array_merge(['To: ' . $to, 'Subject: ' . $subj, 'Date: ' . date('r'), 'Message-ID: <' . bin2hex(random_bytes(12)) . '@play2wingames.com>'], $headers)) . "\r\n\r\n" . $body);
}

function web_smtp(string $host, int $port, string $user, string $pass, string $from, array $rcpts, string $data): bool {
  $fp = @stream_socket_client(($port === 465 ? 'ssl://' : 'tcp://') . "$host:$port", $errno, $errstr, 20);
  if (!$fp) return false;
  stream_set_timeout($fp, 20);
  $read = function () use ($fp) { $out = ''; while (($line = fgets($fp, 515)) !== false) { $out .= $line; if (strlen($line) < 4 || $line[3] === ' ') break; } return $out; };
  $cmd = function (string $c, array $ok) use ($fp, $read) { fwrite($fp, $c . "\r\n"); $r = $read(); return in_array((int)substr($r, 0, 3), $ok, true); };
  try {
    if ((int)substr($read(), 0, 3) !== 220 || !$cmd('EHLO play2wingames.com', [250])) return false;
    if ($port !== 465) {
      if (!$cmd('STARTTLS', [220]) || !stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT) || !$cmd('EHLO play2wingames.com', [250])) return false;
    }
    if ($pass !== '' && (!$cmd('AUTH LOGIN', [334]) || !$cmd(base64_encode($user), [334]) || !$cmd(base64_encode($pass), [235]))) return false;
    if (!$cmd("MAIL FROM:<$from>", [250])) return false;
    foreach ($rcpts as $r) if (!$cmd("RCPT TO:<$r>", [250, 251])) return false;
    if (!$cmd('DATA', [354])) return false;
    $data = preg_replace('/^\./m', '..', str_replace(["\r\n", "\n"], ["\n", "\r\n"], $data)); // dot-stuffing
    return $cmd($data . "\r\n.", [250]);
  } finally {
    @fwrite($fp, "QUIT\r\n");
    fclose($fp);
  }
}

function web_mail_confirmation(array $o): void {
  $rows = '';
  $textRows = '';
  foreach ($o['items'] as $it) {
    $desc = trim(($it['cond'] !== 'Standard' ? $it['cond'] : '') . ($it['detail'] !== '' ? ' · ' . $it['detail'] : ''), ' ·');
    $rows .= '<tr><td style="padding:6px 8px;border-bottom:1px solid #ddd">' . $it['qty'] . ' × ' . h($it['name']) . ($desc !== '' ? '<br><small style="color:#666">' . h($desc) . '</small>' : '')
      . '</td><td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:right">' . shop_money($it['qty'] * $it['cents']) . '</td></tr>';
    $textRows .= $it['qty'] . ' x ' . $it['name'] . ($desc !== '' ? " ($desc)" : '') . '  ' . shop_money($it['qty'] * $it['cents']) . "\n";
  }
  $test = $o['test'] ? '<p style="background:#fff3cd;padding:8px 12px;border-radius:6px"><strong>TEST ORDER:</strong> this order was not sent to our inventory system.</p>' : '';
  $html = '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111">
    <h1 style="font-size:22px">Thanks for your order, ' . h($o['name']) . '!</h1>' . $test . '
    <p>Order <strong>#' . h($o['num']) . '</strong> is paid and we’re pulling your cards. Pick it up at the store whenever we’re open; just give us your name or this order number.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">' . $rows . '
      <tr><td style="padding:6px 8px">Subtotal</td><td style="padding:6px 8px;text-align:right">' . shop_money($o['subtotal']) . '</td></tr>
      <tr><td style="padding:6px 8px">Sales tax</td><td style="padding:6px 8px;text-align:right">' . shop_money($o['tax']) . '</td></tr>
      <tr><td style="padding:6px 8px"><strong>Total paid</strong></td><td style="padding:6px 8px;text-align:right"><strong>' . shop_money($o['total']) . '</strong></td></tr></table>
    <p><strong>Pickup:</strong> Play2Win Games, 3903 Western Avenue, Knoxville, TN 37921<br>Sun 11–7 · Mon–Thu 11–9 · Fri–Sat 11–11 · 865-910-8357</p>
    <p style="color:#666;font-size:13px">Questions? Reply to this email or call us. Whenever you play, Play 2 Win!</p></div>';
  $text = "Thanks for your order, {$o['name']}!\n" . ($o['test'] ? "TEST ORDER: not sent to our inventory system.\n" : '') . "\nOrder #{$o['num']} is paid. Pick it up at the store whenever we're open.\n\n"
    . $textRows . "\nSubtotal " . shop_money($o['subtotal']) . "\nSales tax " . shop_money($o['tax']) . "\nTotal paid " . shop_money($o['total'])
    . "\n\nPlay2Win Games, 3903 Western Avenue, Knoxville, TN 37921\nSun 11-7, Mon-Thu 11-9, Fri-Sat 11-11, 865-910-8357\n";
  web_send_mail($o['email'], ($o['test'] ? '[TEST] ' : '') . 'Your Play2Win order #' . $o['num'] . ' (in-store pickup)', $html, $text, web_cfg()['bcc']);
}

// When a paid order couldn't go into CrystalCommerce: tell the shop (SHOP_ORDER_BCC) so someone follows up.
function web_mail_staff_problem(array $o, string $captureId, ?string $err, bool $refunded): void {
  $to = web_cfg()['bcc'];
  if ($to === '') return;
  $text = "Website order {$o['ref']} for {$o['name']} ({$o['email']} {$o['phone']}), " . shop_money($o['total']) . ", PayPal capture $captureId, couldn't be created in CrystalCommerce: $err\n"
    . ($refunded ? "The payment was refunded automatically.\n" : "THE REFUND FAILED: refund it by hand in PayPal.\n");
  try { web_send_mail($to, 'Website order problem: ' . $o['ref'], '<pre>' . h($text) . '</pre>', $text); } catch (Throwable $t) { /* nothing more to do */ }
}

/* ================================================================== routes: /shop/cart, /shop/checkout, /shop/order */

function web_route(array $parts): void {
  $post = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';
  header('Cache-Control: no-store');
  if ($post && ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') kiosk_404();
  switch ($parts[0]) {
    case 'cart':
      if (!web_checkout_on()) kiosk_404();
      if ($post) web_cart_post();
      web_cart_page();
    case 'checkout':
      if (!web_checkout_on()) kiosk_404();
      if (($parts[1] ?? '') === 'create' && $post) web_checkout_create();
      if (($parts[1] ?? '') === 'capture' && $post) web_checkout_capture();
      if (count($parts) !== 1) kiosk_404();
      web_checkout_page();
    case 'order':
      $num = (string)($parts[1] ?? '');
      $o = web_find_order(function ($o) use ($num) { return $o['num'] === $num && $o['status'] === 'paid'; });
      if (!$o || !hash_equals(substr(hash_hmac('sha256', 'order:' . $o['num'], web_secret()), 0, 24), (string)($_GET['k'] ?? ''))) kiosk_404();
      web_done_page($o);
  }
  kiosk_404();
}

function web_cart_post(): void {
  $cart = web_cart();
  $lid = (int)($_POST['listing'] ?? 0);
  $q = max(0, min(KIOSK_MAX_QTY, (int)($_POST['qty'] ?? 1)));
  switch ($_POST['do'] ?? '') {
    case 'add':
      $hit = kiosk_listing($lid);
      if (!$hit) kiosk_redirect('/shop/cart');
      $cart[$lid] = ['q' => min((int)$hit[1]['q'], KIOSK_MAX_QTY, ($cart[$lid]['q'] ?? 0) + max(1, $q)), 'p' => null];
      web_cart_save($cart);
      kiosk_redirect('/shop/cart?added=' . $lid);
    case 'set':
      if ($q === 0) unset($cart[$lid]); elseif (isset($cart[$lid])) $cart[$lid]['q'] = $q;
      break;
    case 'remove':
      unset($cart[$lid]);
      break;
    case 'clear':
      $cart = [];
      break;
  }
  web_cart_save($cart);
  kiosk_redirect('/shop/cart');
}

// "Add to cart" for one condition of a product (online shoppers).
function web_add_form(array $l): string {
  $inCart = web_cart()[(int)$l['id']]['q'] ?? 0;
  $left = min((int)$l['q'], KIOSK_MAX_QTY) - $inCart;
  if (kiosk_variants() && !kiosk_variant_id((int)$l['id'])) return '<span class="muted kiosk-ask">In store only</span>';
  if ($left <= 0) return '<a class="kiosk-incart" href="/shop/cart">In your cart (' . $inCart . ')</a>';
  $qty = '';
  if ($left > 1) {
    $opts = '';
    for ($i = 1; $i <= $left; $i++) $opts .= '<option value="' . $i . '">' . $i . '</option>';
    $qty = '<label><span class="sr-only">Quantity</span><select name="qty">' . $opts . '</select></label>';
  }
  return '<form class="kiosk-add" action="/shop/cart" method="post" data-once><input type="hidden" name="do" value="add"><input type="hidden" name="listing" value="' . (int)$l['id'] . '">'
    . $qty . '<button class="button primary" type="submit">Add to cart</button></form>'
    . ($inCart ? '<a class="kiosk-incart" href="/shop/cart">' . $inCart . ' in your cart</a>' : '');
}

function web_line_html(array $ln, bool $editable): string {
  $html = kiosk_line_html($ln, $editable);
  // The kiosk's line markup, pointed at the online cart.
  return str_replace('action="/shop/kiosk/cart"', 'action="/shop/cart"', $html);
}

function web_totals_html(int $subtotal): string {
  $tax = web_tax($subtotal);
  return '<p class="kiosk-total web-subline"><span>Subtotal</span> <span>' . shop_money($subtotal) . '</span></p>
    <p class="kiosk-total web-subline"><span>Sales tax (' . rtrim(rtrim(number_format(web_cfg()['taxRate'], 2), '0'), '.') . '%)</span> <span>' . shop_money($tax) . '</span></p>
    <p class="kiosk-total"><span>Total</span> <strong>' . shop_money($subtotal + $tax) . '</strong></p>';
}

function web_test_notice(): string {
  $c = web_cfg();
  $bits = [];
  if (!$c['ppLive']) $bits[] = 'payments use PayPal’s sandbox (test money)';
  if (!$c['ordersLive']) $bits[] = 'orders are not sent to CrystalCommerce';
  return $bits ? '<p class="kiosk-test-banner web-test-banner">TEST MODE: ' . h(implode(', and ', $bits)) . '.</p>' : '';
}

function web_cart_page(): void {
  $lines = web_cart_lines();
  if (!$lines) {
    shop_page('Your cart', 'Your cart', '<section class="shop-section shop-state"><p class="eyebrow">Your cart</p><h1>Your cart is empty.</h1>
      <p class="lead">Find a card or browse by game, then choose “Add to cart”.</p><p><a class="button primary" href="/shop">Start shopping</a></p></section>', ['crumbs' => [['Shop', '/shop'], ['Cart', null]]]);
  }
  $added = (int)($_GET['added'] ?? 0);
  $addedName = $added && ($hit = kiosk_listing($added)) ? $hit[0]['name'] : '';
  $body = web_test_notice() . '<section class="shop-section kiosk-cart-page">
      ' . ($addedName !== '' ? '<p class="kiosk-flash" role="status">Added <strong>' . h($addedName) . '</strong> to your cart.</p>' : '') . '
      <div class="kiosk-cart-head"><h1>Your cart</h1><form action="/shop/cart" method="post"><input type="hidden" name="do" value="clear"><button class="text-link kiosk-clear" type="submit">Empty cart</button></form></div>
      <ul class="kiosk-lines">' . implode('', array_map(function ($ln) { return web_line_html($ln, true); }, $lines)) . '</ul>
      <div class="kiosk-summary">' . web_totals_html(kiosk_total($lines)) . '
        <p class="muted">Free in-store pickup at 3903 Western Avenue, Knoxville. Pay online now, pick up any time we’re open.</p>
        <div class="kiosk-actions"><a class="button secondary" href="/shop">Keep shopping</a><a class="button primary" href="/shop/checkout">Check out</a></div>
      </div>
    </section>';
  shop_page('Your cart', 'Your cart', $body, ['crumbs' => [['Shop', '/shop'], ['Cart', null]]]);
}

function web_checkout_page(): void {
  $lines = web_cart_lines();
  if (!$lines) kiosk_redirect('/shop/cart');
  $c = web_cfg();
  $body = web_test_notice() . '<section class="shop-section kiosk-checkout web-checkout">
      <p class="eyebrow">Free in-store pickup</p>
      <h1>Check out</h1>
      <div class="kiosk-problems" data-checkout-problems role="alert" hidden></div>
      <ul class="kiosk-lines">' . implode('', array_map(function ($ln) { return web_line_html($ln, false); }, $lines)) . '</ul>
      <div class="kiosk-summary">' . web_totals_html(kiosk_total($lines)) . '
        <p class="muted">Prices and stock are checked again with our inventory before you pay. Pick your order up at Play2Win Games, 3903 Western Avenue, Knoxville, TN 37921.</p>
        <form class="web-details" data-checkout-form novalidate>
          <label for="web-name">Name for pickup</label>
          <input id="web-name" name="name" maxlength="60" autocomplete="name" required>
          <label for="web-email">Email <span class="muted">(your receipt goes here)</span></label>
          <input id="web-email" name="email" type="email" maxlength="120" autocomplete="email" required>
          <label for="web-phone">Phone <span class="muted">(optional)</span></label>
          <input id="web-phone" name="phone" type="tel" maxlength="30" autocomplete="tel">
        </form>
        <div id="paypal-buttons" class="web-paypal" data-client="' . h($c['ppClient']) . '"><p class="muted">Loading PayPal…</p></div>
        <noscript><p class="kiosk-problems">Checkout needs JavaScript turned on (it runs PayPal’s secure payment window).</p></noscript>
        <p><a class="text-link" href="/shop/cart">← Back to cart</a></p>
      </div>
    </section>';
  shop_page('Check out', 'Check out', $body, ['crumbs' => [['Shop', '/shop'], ['Cart', '/shop/cart'], ['Check out', null]]]);
}

function web_done_page(array $o): void {
  $items = '';
  foreach ($o['items'] as $it) $items .= '<li><span>' . $it['qty'] . ' × ' . h($it['name']) . ($it['cond'] !== 'Standard' ? ' <small>(' . h($it['cond']) . ')</small>' : '') . '</span><span>' . shop_money($it['qty'] * $it['cents']) . '</span></li>';
  $body = '<section class="shop-section kiosk-done web-done">
      <p class="eyebrow">Order placed</p>
      <h1>Thanks, ' . h($o['name']) . '!</h1>
      <p class="kiosk-done-label">Your order number</p>
      <p class="kiosk-done-num">' . h($o['num']) . '</p>
      <p class="lead">You’re paid up. We sent a receipt to ' . h($o['email']) . '. Pick your order up at the store whenever we’re open; just give us your name or this number.</p>
      ' . ($o['test'] ? '<p class="kiosk-done-test">Test order: it was not sent to CrystalCommerce.</p>' : '') . '
      <ul class="kiosk-done-items">' . $items . '
        <li><span>Sales tax</span><span>' . shop_money($o['tax']) . '</span></li>
        <li class="kiosk-done-total"><span>Total paid</span><span>' . shop_money($o['total']) . '</span></li></ul>
      <p class="muted">Play2Win Games · 3903 Western Avenue, Knoxville, TN 37921 · Sun 11–7 · Mon–Thu 11–9 · Fri–Sat 11–11 · <a href="tel:+18659108357">865-910-8357</a></p>
      <p><a class="button primary" href="/shop">Keep shopping</a></p>
    </section>';
  shop_page('Order ' . $o['num'], 'Order placed', $body, ['crumbs' => []]);
}
