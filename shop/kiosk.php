<?php
/**
 * In-store kiosk mode for the shop. The store's kiosks (locked-down Chrome) browse the normal /shop
 * pages, but with a cart, and every order is picked up in the store and paid at the register.
 *
 *  - A browser becomes a kiosk by opening /shop/kiosk/start?key=KIOSK_KEY once (a signed cookie).
 *    Without that cookie the kiosk pages are 404s and the shop looks as usual.
 *  - KIOSK_MODE=test (the default) runs the whole flow from any computer, including CrystalCommerce's
 *    live stock and price checks, but keeps the order on our side only (numbers start with "T").
 *    KIOSK_MODE=live sends each order to CrystalCommerce, and only from the store's IP (KIOSK_IPS).
 *  - CrystalCommerce's API can only create an order as "Payment Received" (verified Oct 2026: every
 *    unpaid status is refused, and it can't be changed back afterwards, even by hand). So a live kiosk
 *    order says "KIOSK - NOT PAID" in its employee name, comments, and payment line, and the staff list
 *    (/shop/kiosk/orders, opened once with /shop/kiosk/staff?key=KIOSK_STAFF_KEY) tracks which kiosk
 *    orders are still unpaid. Staff ring them up in Fulcrum as TCG singles, then complete the order in
 *    CrystalCommerce, which holds the stock.
 *  - Kiosk orders go under one shop-owned CrystalCommerce customer (KIOSK_CUSTOMER_ID), so the emails
 *    CrystalCommerce sends when staff change an order's status go to the shop, not to a stranger.
 */

declare(strict_types=1);

date_default_timezone_set('America/New_York'); // the store's time, for the staff list

const KIOSK_COOKIE = 'p2w_kiosk';
const KIOSK_STAFF_COOKIE = 'p2w_kstaff';
const KIOSK_CART_COOKIE = 'p2w_kcart';
const KIOSK_MAX_LINES = 40;
const KIOSK_MAX_QTY = 10;
const KIOSK_STALE_HOURS = 2;      // the staff list flags open orders older than this
const KIOSK_KEEP_CLOSED = 300;    // closed orders kept in kiosk-orders.json (open ones are always kept)
const KIOSK_STORE_ADDRESS = ['address1' => '3903 Western Avenue', 'city' => 'Knoxville', 'state' => 'TN', 'postal_code' => '37921', 'country' => 'US', 'phone' => '8659108357'];

/* ================================================================== settings + access */

function kiosk_cfg(): array {
  static $c = null;
  if ($c === null) {
    $c = [
      'key' => shop_env('KIOSK_KEY'),
      'staffKey' => shop_env('KIOSK_STAFF_KEY'),
      'ips' => array_values(array_filter(array_map('trim', explode(',', shop_env('KIOSK_IPS') ?: '162.81.197.116')))),
      'customer' => shop_env('KIOSK_CUSTOMER_ID') ?: '222309',
      'live' => strtolower(shop_env('KIOSK_MODE')) === 'live',
    ];
  }
  return $c;
}

// "data.signature" with an HMAC of the data; short keys are refused so a blank setting can't be used.
function kiosk_sign(string $data, string $key): string {
  return $data . '.' . hash_hmac('sha256', $data, $key);
}

function kiosk_unsign($token, string $key): ?string {
  if (!is_string($token) || strlen($key) < 16 || ($i = strrpos($token, '.')) === false) return null;
  $data = substr($token, 0, $i);
  return hash_equals(hash_hmac('sha256', $data, $key), substr($token, $i + 1)) ? $data : null;
}

function kiosk_https(): bool {
  return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_SSL'] ?? '') === 'on'
    || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
}

function kiosk_set_cookie(string $name, string $value, int $ttl): void {
  setcookie($name, $value, ['expires' => $value === '' ? 1 : time() + $ttl, 'path' => '/shop', 'secure' => kiosk_https(), 'httponly' => true, 'samesite' => 'Lax']);
  if ($value === '') unset($_COOKIE[$name]); else $_COOKIE[$name] = $value;
}

// This browser is a kiosk (it opened the start link).
function kiosk_active(): bool {
  return kiosk_unsign($_COOKIE[KIOSK_COOKIE] ?? null, kiosk_cfg()['key']) === 'kiosk1';
}

function kiosk_staff(): bool {
  return kiosk_unsign($_COOKIE[KIOSK_STAFF_COOKIE] ?? null, kiosk_cfg()['staffKey']) === 'staff1';
}

function kiosk_ip(): string {
  return (string)($_SERVER['REMOTE_ADDR'] ?? '');
}

// Why this kiosk can't place orders right now, or null when it can.
function kiosk_block_reason(): ?string {
  $cfg = kiosk_cfg();
  if (!kiosk_active()) return 'This browser isn’t set up as a kiosk.';
  if ($cfg['live'] && !in_array(kiosk_ip(), $cfg['ips'], true)) return 'Kiosk orders only work on the store’s network (this one is ' . kiosk_ip() . ').';
  if (shop_env('CC_API_PROXY_SECRET') === '') return 'The CrystalCommerce connection isn’t set up.';
  return null;
}

/* ================================================================== cart (a signed cookie) */

// [listing id => ['q' => qty, 'p' => price in cents confirmed at checkout, or null]]
function kiosk_cart(): array {
  if (isset($GLOBALS['kiosk_cart'])) return $GLOBALS['kiosk_cart'];
  $cart = [];
  $data = kiosk_unsign($_COOKIE[KIOSK_CART_COOKIE] ?? null, kiosk_cfg()['key']);
  $rows = $data !== null ? json_decode((string)base64_decode(strtr($data, '-_', '+/')), true) : null;
  foreach (is_array($rows) ? $rows : [] as $r) {
    if (is_array($r) && isset($r[0], $r[1]) && (int)$r[1] > 0) $cart[(int)$r[0]] = ['q' => min(KIOSK_MAX_QTY, (int)$r[1]), 'p' => isset($r[2]) ? (int)$r[2] : null];
  }
  return $GLOBALS['kiosk_cart'] = $cart;
}

function kiosk_cart_save(array $cart): void {
  $cart = array_slice($cart, 0, KIOSK_MAX_LINES, true);
  $GLOBALS['kiosk_cart'] = $cart;
  if (!$cart) { kiosk_set_cookie(KIOSK_CART_COOKIE, '', 0); return; }
  $rows = [];
  foreach ($cart as $lid => $c) $rows[] = $c['p'] === null ? [$lid, $c['q']] : [$lid, $c['q'], $c['p']];
  kiosk_set_cookie(KIOSK_CART_COOKIE, kiosk_sign(rtrim(strtr(base64_encode(json_encode($rows)), '+/', '-_'), '='), kiosk_cfg()['key']), 86400);
}

function kiosk_cart_count(): int {
  return array_sum(array_column(kiosk_cart(), 'q'));
}

// [product, listing] for a listing id in the index, or null when it's no longer in stock.
function kiosk_listing(int $lid): ?array {
  static $map = null;
  if ($map === null) {
    $map = [];
    foreach (shop_index()['products'] ?? [] as $p) foreach ($p['l'] as $l) $map[(int)$l['id']] = [$p, $l];
  }
  return $map[$lid] ?? null;
}

// CrystalCommerce's variant id for a listing (from sync.php's variants.json), or null.
function kiosk_variant_id(int $lid): ?int {
  $v = kiosk_variants();
  return isset($v['map'][$lid]) ? (int)$v['map'][$lid] : null;
}

function kiosk_variants(): array {
  static $v = null;
  if ($v === null) $v = shop_read_json('variants.json') ?: [];
  return $v;
}

// Cart lines with their product and listing; price is the one confirmed at checkout, else the shelf price.
function kiosk_cart_lines(): array {
  $lines = [];
  foreach (kiosk_cart() as $lid => $c) {
    $hit = kiosk_listing($lid);
    $lines[] = ['lid' => $lid, 'q' => $c['q'], 'p' => $c['p'] ?? ($hit ? (int)$hit[1]['p'] : 0), 'product' => $hit[0] ?? null, 'listing' => $hit[1] ?? null];
  }
  return $lines;
}

/* ================================================================== orders (our own list) */

// Runs $fn(&$data) with kiosk-orders.json locked, saves, and returns $fn's result.
function kiosk_orders_update(callable $fn) {
  $lock = fopen(shop_data_dir() . '/kiosk-orders.lock', 'c');
  if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('Could not lock the kiosk order list');
  try {
    $data = shop_read_json('kiosk-orders.json') ?: ['seq' => 0, 'orders' => []];
    $result = $fn($data);
    $open = array_values(array_filter($data['orders'], function ($o) { return $o['status'] === 'open'; }));
    $closed = array_values(array_filter($data['orders'], function ($o) { return $o['status'] !== 'open'; }));
    $data['orders'] = array_merge($open, array_slice($closed, -KIOSK_KEEP_CLOSED));
    shop_write_json('kiosk-orders.json', $data);
    return $result;
  } finally {
    flock($lock, LOCK_UN);
    fclose($lock);
  }
}

function kiosk_orders(): array {
  return (shop_read_json('kiosk-orders.json') ?: [])['orders'] ?? [];
}

function kiosk_find_order(string $num): ?array {
  foreach (kiosk_orders() as $o) if ((string)$o['num'] === $num) return $o;
  return null;
}

/* ================================================================== placing an order */

/**
 * Checks the cart against CrystalCommerce (live stock and price for each variant) and, if nothing changed,
 * creates the order: in CrystalCommerce when live, on our side only in test mode.
 * Returns ['order' => record] or ['problems' => [messages]] (the cart is updated to match what's available).
 */
function kiosk_place_order(string $name, string $token): array {
  // A double tap on "Place order" sends the same token twice: show the first order again.
  foreach (kiosk_orders() as $o) if (($o['token'] ?? '') === $token) return ['order' => $o];

  $cart = kiosk_cart();
  $lines = kiosk_cart_lines();
  if (!$lines) return ['problems' => ['Your cart is empty.']];

  $problems = [];
  $checks = [];
  foreach ($lines as $ln) {
    $label = $ln['product'] ? $ln['product']['name'] . ' (' . $ln['listing']['c'] . ')' : 'An item';
    if (!$ln['product']) { $problems[] = "$label sold out and was removed from your cart."; unset($cart[$ln['lid']]); continue; }
    $vid = kiosk_variant_id($ln['lid']);
    if (!$vid) { $problems[] = "$label can’t be ordered at the kiosk yet. It was removed from your cart; ask at the register."; unset($cart[$ln['lid']]); continue; }
    $checks[$ln['lid']] = shop_cc_base() . '/variants/' . $vid;
  }
  $current = $checks ? shop_fetch_json(array_values($checks), 6, 20, shop_cc_headers('admin:read-inventory')) : [];

  $items = [];
  foreach ($lines as $ln) {
    if (!isset($checks[$ln['lid']])) continue;
    $r = $current[$checks[$ln['lid']]] ?? null;
    $v = is_array($r) ? ($r['variant'] ?? $r) : null;
    if (!is_array($v) || empty($v['id'])) return ['problems' => ['We couldn’t reach our inventory system to check stock. Please try again in a moment, or ask at the register.']];
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
  kiosk_cart_save($cart);
  if ($problems) return ['problems' => $problems];

  $total = array_sum(array_map(function ($i) { return $i['qty'] * $i['cents']; }, $items));
  $live = kiosk_cfg()['live'];
  $ccId = null;
  if ($live) {
    [$ccId, $err] = kiosk_cc_order($items, $name, $total);
    if (!$ccId) return ['problems' => ['We couldn’t send your order to the register. Please ask a staff member for help. (' . $err . ')']];
  }
  $order = kiosk_orders_update(function (array &$data) use ($items, $name, $token, $total, $live, $ccId) {
    $data['seq'] = (int)($data['seq'] ?? 0) + 1;
    $o = ['num' => $live ? (string)$ccId : 'T' . $data['seq'], 'ccId' => $ccId, 'test' => !$live, 'token' => $token, 'name' => $name,
      'items' => $items, 'total' => $total, 'at' => time(), 'status' => 'open'];
    $data['orders'][] = $o;
    return $o;
  });
  kiosk_cart_save([]);
  return ['order' => $order];
}

// Creates the CrystalCommerce order (the shape proven by test orders #277127/#277128). Returns [id, error].
function kiosk_cc_order(array $items, string $name, int $total): array {
  $money = function (int $cents) { return number_format($cents / 100, 2, '.', ''); };
  $lineItems = [];
  foreach (array_values($items) as $i => $it) $lineItems[(string)$i] = ['qty' => $it['qty'], 'variant_id' => (string)$it['variant'], 'price' => $money($it['cents'])];
  $note = "KIOSK ORDER - NOT PAID. Customer: $name. Pay at the register: ring up in Fulcrum (TCG singles), then mark this order complete. If nobody picks it up, cancel it so the cards go back in stock.";
  $address = ['firstname' => $name, 'lastname' => 'Kiosk order', 'address2' => 'In-store pickup'] + KIOSK_STORE_ADDRESS;
  $order = [
    // CrystalCommerce only accepts new API orders as Payment Received; everything else says NOT PAID.
    'origin' => 'Direct', 'status' => 'Payment Received', 'employee_name' => 'KIOSK - NOT PAID',
    'customer_comments' => $note, 'vendor_comments' => $note, 'in_store_pickup' => true, 'ship_price' => '0', 'tax' => '0',
    'ship_rate_attributes' => ['method_id' => 1],
    'customer_attributes' => ['id' => kiosk_cfg()['customer']],
    'shipping_address_attributes' => $address, 'billing_address_attributes' => $address,
    'payment_attributes' => ['status' => 'Received', 'amount' => $money($total), 'description' => 'NOT PAID - kiosk order, pay at the register'],
    'line_items_attributes' => (object)$lineItems,
  ];
  [$s, $j, $raw] = shop_cc('POST', '/orders', 'admin:read-orders', ['order' => $order]);
  $o = is_array($j) ? ($j['order'] ?? $j) : [];
  if ($s >= 200 && $s < 300 && !empty($o['id'])) return [(int)$o['id'], null];
  $err = is_array($j) ? json_encode($j, JSON_UNESCAPED_SLASHES) : trim(preg_replace('/\s+/', ' ', strip_tags($raw)));
  return [null, "HTTP $s " . substr($err, 0, 200)];
}

/* ================================================================== routes: /shop/kiosk/... */

function kiosk_route(array $parts): void {
  $action = $parts[0] ?? '';
  $post = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';
  header('Cache-Control: no-store');
  header('X-Robots-Tag: noindex, nofollow');
  if ($post && ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') kiosk_404();
  $cfg = kiosk_cfg();

  switch ($action) {
    case 'start':   // the kiosk's start page: turns this browser into a kiosk and empties its cart
      kiosk_check_key('KIOSK_KEY', $cfg['key']);
      kiosk_set_cookie(KIOSK_COOKIE, kiosk_sign('kiosk1', $cfg['key']), 400 * 86400);
      kiosk_cart_save([]);
      kiosk_redirect('/shop');
    case 'exit':    // turns kiosk mode off in this browser (for testing on your own computer)
      kiosk_set_cookie(KIOSK_COOKIE, '', 0);
      kiosk_cart_save([]);
      kiosk_redirect('/shop');
    case 'staff':
      kiosk_check_key('KIOSK_STAFF_KEY', $cfg['staffKey']);
      kiosk_set_cookie(KIOSK_STAFF_COOKIE, kiosk_sign('staff1', $cfg['staffKey']), 30 * 86400);
      kiosk_redirect('/shop/kiosk/orders');
    case 'orders':
      if (!kiosk_staff() || count($parts) !== 1) kiosk_404();
      if ($post) kiosk_close_order();
      kiosk_orders_page();
    case 'status':
      if (!kiosk_active() && !kiosk_staff()) kiosk_404();
      kiosk_status_page();
  }

  if (!kiosk_active()) kiosk_404();
  switch ($action) {
    case 'reset':   // idle timeout: empty the cart and go back to the start
      kiosk_cart_save([]);
      kiosk_redirect('/shop');
    case 'cart':
      if ($post) kiosk_cart_post();
      kiosk_cart_page();
    case 'checkout':
      kiosk_checkout_page($post);
    case 'done':
      $o = kiosk_find_order((string)($parts[1] ?? ''));
      if (!$o || time() - $o['at'] > 1800) kiosk_redirect('/shop');
      kiosk_done_page($o);
  }
  kiosk_404();
}

// The ?key= on a start/staff link must match the setting. Says what's wrong (never the key itself), since a
// plain 404 left the owner guessing. A "+" in a key arrives as a space when the link isn't encoded.
function kiosk_check_key(string $setting, string $key): void {
  $given = trim((string)($_GET['key'] ?? ''));
  if (strlen($key) >= 16 && $given !== '' && (hash_equals($key, $given) || hash_equals($key, str_replace(' ', '+', $given)))) return;
  if ($key === '') {
    $why = "$setting isn’t set. Add a line <code>$setting=…</code> to the private <code>p2w-shop-data/.env</code> file (next to public_html, not inside it).";
  } elseif (strlen($key) < 16) {
    $why = "$setting is set but shorter than 16 characters, so it’s refused. Use a longer key.";
  } elseif ($given === '') {
    $why = 'This link has no key. Add <code>?key=</code> and the key to the end of it.';
  } else {
    $why = "The key in this link doesn’t match $setting (" . strlen($given) . ' characters in the link, ' . strlen($key) . ' in the setting). '
      . 'Use only letters and numbers in keys: symbols like + &amp; # % = ? change meaning in a web address and get cut off or altered.';
  }
  http_response_code(403);
  shop_page('Kiosk setup', 'Kiosk setup', '<section class="shop-section shop-state"><p class="eyebrow">Kiosk setup</p><h1>That link didn’t work.</h1>
    <p class="lead">' . $why . '</p><p><a class="button primary" href="/shop">Go to the shop</a></p></section>', ['crumbs' => []]);
}

function kiosk_redirect(string $to): void {
  header('Location: ' . $to, true, 303);
  exit;
}

function kiosk_404(): void {
  http_response_code(404);
  shop_not_found();
}

function kiosk_cart_post(): void {
  $cart = kiosk_cart();
  $lid = (int)($_POST['listing'] ?? 0);
  $q = max(0, min(KIOSK_MAX_QTY, (int)($_POST['qty'] ?? 1)));
  switch ($_POST['do'] ?? '') {
    case 'add':
      $hit = kiosk_listing($lid);
      if (!$hit) kiosk_redirect('/shop/kiosk/cart');
      $q = min((int)$hit[1]['q'], KIOSK_MAX_QTY, ($cart[$lid]['q'] ?? 0) + max(1, $q));
      $cart[$lid] = ['q' => $q, 'p' => null];
      kiosk_cart_save($cart);
      kiosk_redirect('/shop/kiosk/cart?added=' . $lid);
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
  kiosk_cart_save($cart);
  kiosk_redirect('/shop/kiosk/cart');
}

function kiosk_close_order(): void {
  $num = (string)($_POST['num'] ?? '');
  $as = ($_POST['as'] ?? '') === 'cancelled' ? 'cancelled' : 'paid';
  kiosk_orders_update(function (array &$data) use ($num, $as) {
    foreach ($data['orders'] as &$o) if ((string)$o['num'] === $num && $o['status'] === 'open') { $o['status'] = $as; $o['closedAt'] = time(); }
  });
  kiosk_redirect('/shop/kiosk/orders');
}

/* ================================================================== pages */

function kiosk_line_html(array $ln, bool $editable): string {
  $p = $ln['product'];
  if (!$p) {
    return '<li class="kiosk-line kiosk-line-gone"><div class="kiosk-line-info"><strong>No longer in stock</strong><p class="muted">This item sold out. It will be removed when you place your order.</p></div>'
      . ($editable ? kiosk_remove_form($ln['lid']) : '') . '</li>';
  }
  $l = $ln['listing'];
  $img = $p['img'] !== '' ? '<img src="' . h(shop_img($p['img'], 'medium')) . '" alt="" width="58" height="80">' : '<span class="kiosk-line-noimg" aria-hidden="true"></span>';
  $qty = '<span class="kiosk-line-qty">Qty ' . $ln['q'] . '</span>';
  if ($editable) {
    $opts = '';
    for ($i = 0; $i <= min(KIOSK_MAX_QTY, max((int)$l['q'], $ln['q'])); $i++) $opts .= '<option value="' . $i . '"' . ($i === $ln['q'] ? ' selected' : '') . '>' . ($i === 0 ? 'Remove' : $i) . '</option>';
    $qty = '<form class="kiosk-qty" action="/shop/kiosk/cart" method="post"><input type="hidden" name="do" value="set"><input type="hidden" name="listing" value="' . $ln['lid'] . '">
      <label>Qty <select name="qty" data-autosubmit>' . $opts . '</select></label><noscript><button class="button secondary" type="submit">Update</button></noscript></form>';
  }
  return '<li class="kiosk-line">' . $img . '<div class="kiosk-line-info"><strong>' . h($p['name']) . '</strong>
      <p class="muted">' . h(implode(' · ', array_filter([$l['c'] !== 'Standard' ? $l['c'] : '', $l['v'], $p['set']]))) . '</p>' . $qty . '</div>
      <div class="kiosk-line-price">' . shop_money($ln['p'] * $ln['q']) . ($ln['q'] > 1 ? '<small>' . shop_money($ln['p']) . ' each</small>' : '') . '</div>'
    . ($editable ? kiosk_remove_form($ln['lid']) : '') . '</li>';
}

function kiosk_remove_form(int $lid): string {
  return '<form action="/shop/kiosk/cart" method="post"><input type="hidden" name="do" value="remove"><input type="hidden" name="listing" value="' . $lid . '">
    <button class="kiosk-remove" type="submit" aria-label="Remove from cart">✕</button></form>';
}

function kiosk_total(array $lines): int {
  return array_sum(array_map(function ($ln) { return $ln['product'] ? $ln['p'] * $ln['q'] : 0; }, $lines));
}

function kiosk_cart_page(): void {
  $lines = kiosk_cart_lines();
  if (!$lines) {
    shop_page('Your cart', 'Kiosk cart', '<section class="shop-section shop-state"><p class="eyebrow">Your cart</p><h1>Your cart is empty.</h1>
      <p class="lead">Search for a card or browse by game, then tap “Add to cart”.</p><p><a class="button primary" href="/shop">Start shopping</a></p></section>', ['crumbs' => [['Shop', '/shop'], ['Cart', null]]]);
  }
  $added = (int)($_GET['added'] ?? 0);
  $addedName = $added && ($hit = kiosk_listing($added)) ? $hit[0]['name'] : '';
  $body = '<section class="shop-section kiosk-cart-page">
      ' . ($addedName !== '' ? '<p class="kiosk-flash" role="status">Added <strong>' . h($addedName) . '</strong> to your cart.</p>' : '') . '
      <div class="kiosk-cart-head"><h1>Your cart</h1><form action="/shop/kiosk/cart" method="post"><input type="hidden" name="do" value="clear"><button class="text-link kiosk-clear" type="submit">Empty cart</button></form></div>
      <ul class="kiosk-lines">' . implode('', array_map(function ($ln) { return kiosk_line_html($ln, true); }, $lines)) . '</ul>
      <div class="kiosk-summary">
        <p class="kiosk-total"><span>Subtotal</span> <strong>' . shop_money(kiosk_total($lines)) . '</strong></p>
        <p class="muted">Sales tax is added when you pay at the register.</p>
        <div class="kiosk-actions"><a class="button secondary" href="/shop">Keep shopping</a><a class="button primary" href="/shop/kiosk/checkout">Place order for pickup</a></div>
      </div>
    </section>';
  shop_page('Your cart', 'Kiosk cart', $body, ['crumbs' => [['Shop', '/shop'], ['Cart', null]]]);
}

function kiosk_checkout_page(bool $post): void {
  $problems = [];
  $name = trim(preg_replace('/[\x00-\x1F\x7F]+/u', ' ', (string)($_POST['name'] ?? '')));
  if ($post) {
    $token = preg_match('/^[a-f0-9]{32}$/', (string)($_POST['token'] ?? '')) ? (string)$_POST['token'] : '';
    $reason = kiosk_block_reason();
    if ($reason !== null) $problems[] = 'This kiosk can’t place orders right now. Please ask at the register. (' . $reason . ')';
    elseif ($token === '') $problems[] = 'Something went wrong. Please try again.';
    elseif ($name === '' || preg_match_all('/./us', $name) > 40) $problems[] = 'Please enter a name for your order (up to 40 letters).';
    else {
      try {
        $r = kiosk_place_order($name, $token);
      } catch (Throwable $t) {
        $r = ['problems' => ['Something went wrong saving your order. Please ask at the register.']];
      }
      if (isset($r['order'])) kiosk_redirect('/shop/kiosk/done/' . rawurlencode((string)$r['order']['num']));
      $problems = $r['problems'];
    }
  }
  $lines = kiosk_cart_lines();
  if (!$lines) kiosk_redirect('/shop/kiosk/cart');
  $notice = $problems ? '<div class="kiosk-problems" role="alert"><strong>Please check your order:</strong><ul><li>' . implode('</li><li>', array_map('h', $problems)) . '</li></ul></div>' : '';
  $body = '<section class="shop-section kiosk-checkout">
      <p class="eyebrow">In-store pickup</p>
      <h1>Place your order</h1>
      ' . $notice . '
      <ul class="kiosk-lines">' . implode('', array_map(function ($ln) { return kiosk_line_html($ln, false); }, $lines)) . '</ul>
      <div class="kiosk-summary">
        <p class="kiosk-total"><span>Subtotal</span> <strong>' . shop_money(kiosk_total($lines)) . '</strong></p>
        <p class="muted">Nothing is charged here. You’ll pay at the register (sales tax is added there), and we’ll hand you your cards.</p>
        <form class="kiosk-name-form" action="/shop/kiosk/checkout" method="post" data-once>
          <input type="hidden" name="token" value="' . bin2hex(random_bytes(16)) . '">
          <label for="kiosk-name">Your name <span class="muted">(so we can call you)</span></label>
          <input id="kiosk-name" name="name" value="' . h($name) . '" maxlength="40" autocomplete="off" required>
          <div class="kiosk-actions"><a class="button secondary" href="/shop/kiosk/cart">Back to cart</a><button class="button primary" type="submit">Place order</button></div>
        </form>
      </div>
    </section>';
  shop_page('Place your order', 'Kiosk checkout', $body, ['crumbs' => [['Shop', '/shop'], ['Cart', '/shop/kiosk/cart'], ['Place order', null]]]);
}

function kiosk_done_page(array $o): void {
  $items = '';
  foreach ($o['items'] as $it) $items .= '<li><span>' . $it['qty'] . ' × ' . h($it['name']) . ($it['cond'] !== 'Standard' ? ' <small>(' . h($it['cond']) . ')</small>' : '') . '</span><span>' . shop_money($it['qty'] * $it['cents']) . '</span></li>';
  $body = '<section class="shop-section kiosk-done">
      <p class="eyebrow">Order placed</p>
      <h1>Thanks, ' . h($o['name']) . '!</h1>
      <p class="kiosk-done-label">Your order number</p>
      <p class="kiosk-done-num">' . h($o['num']) . '</p>
      <p class="lead">Head to the register and give them this number. You’ll pay there and walk out with your cards.</p>
      ' . ($o['test'] ? '<p class="kiosk-done-test">Test order: it was not sent to CrystalCommerce.</p>' : '') . '
      <ul class="kiosk-done-items">' . $items . '<li class="kiosk-done-total"><span>Subtotal</span><span>' . shop_money($o['total']) . '</span></li></ul>
      <p><a class="button primary" href="/shop/kiosk/reset">Start a new order</a></p>
    </section>';
  shop_page('Order ' . $o['num'], 'Kiosk order placed', $body, ['crumbs' => [], 'idle' => 60, 'idlePrompt' => false]);
}

function kiosk_status_page(): void {
  $cfg = kiosk_cfg();
  $v = kiosk_variants();
  $reason = kiosk_active() ? kiosk_block_reason() : null;
  $row = function ($k, $val) { return '<tr><th scope="row">' . h($k) . '</th><td>' . $val . '</td></tr>'; };
  $mins = isset($v['at']) ? (int)floor((time() - (int)$v['at']) / 60) : null;
  $rows = $row('Mode', $cfg['live'] ? '<strong>Live</strong>: orders go to CrystalCommerce' : '<strong>Test</strong>: orders stay on our website')
    . $row('This browser', kiosk_active() ? 'Kiosk' . (kiosk_staff() ? ' + staff' : '') : 'Staff')
    . $row('Can place orders', kiosk_active() ? ($reason === null ? 'Yes' : 'No: ' . h($reason)) : '—')
    . $row('IP address seen', h(kiosk_ip()) . (in_array(kiosk_ip(), $cfg['ips'], true) ? ' (the store)' : ' (not the store)'))
    . $row('Store IP addresses', h(implode(', ', $cfg['ips'])))
    . $row('Kiosk customer', h($cfg['customer']))
    . $row('Item ids from CrystalCommerce', $mins === null ? 'Not built yet (the inventory sync builds them)'
      : number_format((int)$v['matched']) . ' of ' . number_format((int)$v['listings']) . ' listings matched, ' . $mins . ' min ago');
  // Why some listings have no CrystalCommerce variant: how each side describes the item (no customer data).
  $examples = '';
  foreach ($v['unmatchedExamples'] ?? [] as $ex) {
    $desc = function ($pair) { return h(trim($pair[0] . ($pair[1] !== '' ? ' · ' . $pair[1] : ''))); };
    $examples .= '<li>Listing: <strong>' . $desc($ex['listing']) . '</strong> → variants: ' . ($ex['variants'] ? implode(', ', array_map($desc, $ex['variants'])) : 'none for this product') . '</li>';
  }
  $body = '<section class="shop-section kiosk-status"><p class="eyebrow">Kiosk</p><h1>Kiosk status</h1>
      <table class="kiosk-status-table"><tbody>' . $rows . '</tbody></table>
      ' . ($examples !== '' ? '<details class="kiosk-howto"><summary>Examples of unmatched listings (' . number_format((int)($v['unmatched'] ?? 0)) . ')</summary><ul>' . $examples . '</ul></details>' : '') . '
      <p class="kiosk-actions"><a class="button primary" href="/shop">Go to the shop</a>' . (kiosk_staff() ? '<a class="button secondary" href="/shop/kiosk/orders">Kiosk orders</a>' : '')
      . (kiosk_active() ? '<a class="button secondary" href="/shop/kiosk/exit">Turn kiosk mode off</a>' : '') . '</p></section>';
  shop_page('Kiosk status', 'Kiosk status', $body, ['crumbs' => [], 'idle' => 0]);
}

function kiosk_orders_page(): void {
  $all = kiosk_orders();
  $open = array_values(array_filter($all, function ($o) { return $o['status'] === 'open'; }));
  $closed = array_reverse(array_values(array_filter($all, function ($o) { return $o['status'] !== 'open'; })));
  $admin = preg_replace('#/api/v1$#', '', shop_cc_base());
  $card = function (array $o, bool $isOpen) use ($admin) {
    $age = time() - (int)$o['at'];
    $stale = $isOpen && $age > KIOSK_STALE_HOURS * 3600;
    $items = '';
    foreach ($o['items'] as $it) $items .= '<li>' . $it['qty'] . ' × ' . h($it['name']) . ' <span class="muted">' . h(implode(' · ', array_filter([$it['cond'] !== 'Standard' ? $it['cond'] : '', $it['detail']]))) . '</span> <span class="kiosk-ord-price">' . shop_money($it['qty'] * $it['cents']) . '</span></li>';
    $when = date('D g:i a', (int)$o['at']) . ' · ' . ($age < 3600 ? max(1, (int)floor($age / 60)) . ' min ago' : floor($age / 3600) . ' h ' . floor($age % 3600 / 60) . ' min ago');
    $link = $o['ccId'] ? '<a href="' . h($admin . '/orders/' . $o['ccId']) . '" target="_blank" rel="noopener">Open in CrystalCommerce</a>' : '<span class="muted">Test order: not in CrystalCommerce</span>';
    $actions = $isOpen ? '<form action="/shop/kiosk/orders" method="post" class="kiosk-ord-actions"><input type="hidden" name="num" value="' . h($o['num']) . '">
        <button class="button primary" name="as" value="paid" type="submit">Paid &amp; picked up</button>
        <button class="button secondary" name="as" value="cancelled" type="submit">Cancelled</button></form>'
      : '<p class="kiosk-ord-closed">' . ($o['status'] === 'paid' ? 'Paid &amp; picked up' : 'Cancelled') . ' · ' . h(date('D g:i a', (int)($o['closedAt'] ?? $o['at']))) . '</p>';
    return '<article class="kiosk-ord' . ($stale ? ' kiosk-ord-stale' : '') . '">
        <header><span class="kiosk-ord-num">#' . h($o['num']) . '</span>' . ($o['test'] ? '<span class="kiosk-badge">TEST</span>' : '') . ($stale ? '<span class="kiosk-badge kiosk-badge-warn">Over ' . KIOSK_STALE_HOURS . ' h</span>' : '') . '
        <span class="kiosk-ord-name">' . h($o['name']) . '</span><span class="kiosk-ord-total">' . shop_money($o['total']) . '</span></header>
        <p class="muted">' . h($when) . ' · ' . $link . '</p><ul>' . $items . '</ul>' . $actions . '</article>';
  };
  $body = '<section class="shop-section kiosk-orders">
      <p class="eyebrow">Staff</p><h1>Kiosk orders</h1>
      <div class="kiosk-howto"><p><strong>At the register:</strong> ring the cards up in Fulcrum as TCG singles and take payment. Then open the order in CrystalCommerce and mark it complete, and tap <em>Paid &amp; picked up</em> here.</p>
      <p><strong>Never picked up?</strong> Cancel the order in CrystalCommerce so the cards go back in stock, then tap <em>Cancelled</em> here.</p>
      <p class="muted">CrystalCommerce lists kiosk orders as “Payment Received” (it can’t record unpaid orders). Its employee name says KIOSK - NOT PAID. This page is the real list of what’s unpaid.</p></div>
      <h2>Waiting at the register (' . count($open) . ')</h2>
      ' . ($open ? '<div class="kiosk-ord-list">' . implode('', array_map(function ($o) use ($card) { return $card($o, true); }, $open)) . '</div>' : '<p class="muted">No open kiosk orders.</p>') . '
      <h2>Recently closed</h2>
      ' . ($closed ? '<div class="kiosk-ord-list">' . implode('', array_map(function ($o) use ($card) { return $card($o, false); }, array_slice($closed, 0, 20))) . '</div>' : '<p class="muted">None yet.</p>') . '
    </section>';
  shop_page('Kiosk orders', 'Kiosk orders', $body, ['crumbs' => [], 'refresh' => 30, 'idle' => 0]);
}
