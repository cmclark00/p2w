<?php
/**
 * Play2Win shop: shared code for the storefront (index.php) and the inventory sync (sync.php).
 *
 * Inventory comes from CrystalCommerce, which stays the source of truth. Right now it's read from
 * CrystalCommerce's Core2 API (the shop is marketplace "Playtowingames", organization 2020), whose
 * listing and product endpoints answer without a login. sync.php copies the in-stock listings plus
 * each product's photo/set into a private index; the storefront searches that index, because
 * neither CrystalCommerce API offers search by name.
 *
 * Private data (the index and settings) lives OUTSIDE the website folder in <home>/p2w-shop-data/,
 * next to public_html, for the same reasons as the trade-in calculator's data: the repo is public
 * and the deploy's mirror --delete would wipe anything in public_html that isn't in the repo.
 */

declare(strict_types=1);

const SHOP_PER_PAGE = 24;
const SHOP_DEFAULTS = [
  'CC_CORE2_BASE' => 'https://core2-api.crystalcommerce.com',
  'CC_CORE2_ORG_ID' => '2020',
  'CC_STOREFRONT_URL' => 'https://playtowingames.crystalcommerce.com',
  'CC_ADMIN_BASE_URL' => 'https://playtowingames-admin.crystalcommerce.com/api/v1',
  'CC_API_USERNAME' => 'playtowingames',
];

/* ------------------------------------------------------------------ settings + storage */

function shop_data_dir(): string {
  static $dir = null;
  if ($dir !== null) return $dir;
  // <home>/public_html/shop/lib.php -> <home>/p2w-shop-data (works from the web and from cron).
  $dir = getenv('P2W_SHOP_DATA') ?: dirname(__DIR__, 2) . '/p2w-shop-data';
  if (!is_dir($dir)) @mkdir($dir, 0700, true);
  return $dir;
}

// Setting value: a real environment variable first, then <data dir>/.env (KEY=VALUE lines), then the default.
function shop_env(string $key): string {
  static $file = null;
  $v = getenv($key);
  if ($v !== false && $v !== '') return $v;
  if ($file === null) {
    $file = [];
    $path = shop_data_dir() . '/.env';
    if (is_file($path)) {
      foreach (file($path, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
        if (preg_match('/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/', $line, $m) && $m[1][0] !== '#') $file[$m[1]] = trim($m[2], "\"'");
      }
    }
  }
  return $file[$key] ?? SHOP_DEFAULTS[$key] ?? '';
}

function shop_read_json(string $name) {
  $path = shop_data_dir() . '/' . $name;
  return is_file($path) ? json_decode((string)file_get_contents($path), true) : null;
}

// Temp file + rename, so a page never reads half-written data.
function shop_write_json(string $name, $data): void {
  $path = shop_data_dir() . '/' . $name;
  $tmp = $path . '.' . bin2hex(random_bytes(4)) . '.tmp';
  file_put_contents($tmp, json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
  if (!@rename($tmp, $path)) { @unlink($tmp); throw new RuntimeException("Could not save $name"); }
}

/* ------------------------------------------------------------------ HTTP */

// GET several URLs at once (up to $parallel at a time). Returns [url => decoded JSON or null].
function shop_fetch_json(array $urls, int $parallel = 6, int $timeout = 25, array $headers = []): array {
  $out = [];
  $queue = array_values($urls);
  $mh = curl_multi_init();
  $active = [];
  $start = function (string $url) use ($mh, &$active, $timeout, $headers) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
      CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 10,
      CURLOPT_HTTPHEADER => array_merge(['Accept: application/json'], $headers), CURLOPT_USERAGENT => 'Play2WinGames-Shop/1.0 (+https://play2wingames.com)',
    ]);
    curl_multi_add_handle($mh, $ch);
    $active[(int)$ch] = [$ch, $url];
  };
  while ($queue && count($active) < $parallel) $start(array_shift($queue));
  do {
    curl_multi_exec($mh, $running);
    curl_multi_select($mh, 1.0);
    while ($info = curl_multi_info_read($mh)) {
      $ch = $info['handle'];
      [, $url] = $active[(int)$ch];
      $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
      $body = curl_multi_getcontent($ch);
      $out[$url] = $code === 200 ? json_decode((string)$body, true) : null;
      curl_multi_remove_handle($mh, $ch);
      curl_close($ch);
      unset($active[(int)$ch]);
      if ($queue) $start(array_shift($queue));
    }
  } while ($active);
  curl_multi_close($mh);
  return $out;
}

/* ------------------------------------------------------------------ CrystalCommerce Admin API */

// The classic Admin API (store-specific; needs CC_API_PROXY_SECRET). Used for the kiosk: variant ids,
// live stock/price checks, and creating orders. Order creation uses the admin:read-orders scope
// (admin:write-orders is refused), as verified with test orders in Oct 2026.
function shop_cc_base(): string {
  return rtrim(shop_env('CC_ADMIN_BASE_URL'), '/');
}

function shop_cc_headers(string $scope): array {
  return ['X-API-PROXY-SECRET: ' . shop_env('CC_API_PROXY_SECRET'), 'X-API-USERNAME: ' . shop_env('CC_API_USERNAME'), 'X-API-SCOPES: ' . $scope];
}

// One request. Returns [HTTP status, decoded JSON or null, raw body].
function shop_cc(string $method, string $path, string $scope, $body = null): array {
  $ch = curl_init(shop_cc_base() . $path);
  $headers = array_merge(['Accept: application/json'], shop_cc_headers($scope));
  if ($body !== null) $headers[] = 'Content-Type: application/json';
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 45, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_HTTPHEADER => $headers, CURLOPT_USERAGENT => 'Play2WinGames-Shop/1.0 (+https://play2wingames.com)',
  ]);
  if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
  $raw = (string)curl_exec($ch);
  $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  return [$status, json_decode($raw, true), $raw];
}

/* ------------------------------------------------------------------ keeping the index fresh */

// GitHub's "every 15 minutes" schedule for the sync actually ran only every 4–6 hours (Oct 2026: GitHub delays
// and drops frequent scheduled jobs), so the shop kicks the sync itself: when someone opens a shop page and the
// listings are over SYNC_STALE_MINUTES old, it starts /shop/sync.php in the background (at most once every
// SYNC_KICK_MINUTES) and doesn't wait for it. sync.php keeps running after the caller hangs up, refuses to
// re-read listings more often than every 10 minutes, and runs one at a time, so extra kicks are harmless.
const SYNC_STALE_MINUTES = 12;
const SYNC_KICK_MINUTES = 5;

function shop_kick_sync(?array $idx): void {
  $age = time() - (int)($idx['listingsAt'] ?? $idx['built'] ?? 0);
  if ($age < SYNC_STALE_MINUTES * 60) return;
  $kick = shop_data_dir() . '/sync-kick.txt';
  $last = is_file($kick) ? (int)file_get_contents($kick) : 0;
  if (time() - $last < SYNC_KICK_MINUTES * 60) return;
  @file_put_contents($kick, (string)time());
  $url = shop_env('SHOP_SYNC_URL') ?: 'https://play2wingames.com/shop/sync.php';
  $ch = curl_init($url);
  // Long enough to connect and send the request; then hang up and let sync.php work on its own.
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT_MS => 1500, CURLOPT_NOSIGNAL => true,
    CURLOPT_USERAGENT => 'Play2WinGames-Shop/1.0 (sync kick)']);
  @curl_exec($ch);
  curl_close($ch);
}

/* ------------------------------------------------------------------ the index */

// The index is an SQLite file (shop-index.sqlite) that sync.php rebuilds and swaps in whole. With the
// full store (~40k products, Oct 2026) a JSON index needed ~170 MB on every page, over the host's 128 MB
// limit; SQLite lets each page read only the rows it shows.
const SHOP_INDEX_DB = 'shop-index.sqlite';

function shop_db(): ?PDO {
  static $db = false;
  if ($db === false) {
    $db = null;
    $path = shop_data_dir() . '/' . SHOP_INDEX_DB;
    if (is_file($path)) {
      try {
        $db = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
          PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::SQLITE_ATTR_OPEN_FLAGS => PDO::SQLITE_OPEN_READONLY]);
      } catch (Throwable $e) {
        $db = null;
      }
    }
  }
  return $db;
}

// Loaded once per request: { built, listingsAt, count (products), types: { slug: { name, game, kind, count } } }.
function shop_index(): ?array {
  static $idx = false;
  if ($idx === false) {
    $idx = null;
    try {
      $db = shop_db();
      if ($db) {
        $meta = [];
        foreach ($db->query('SELECT k, v FROM meta') as $r) $meta[$r['k']] = $r['v'];
        $types = [];
        foreach ($db->query('SELECT slug, name, game, kind, count FROM types ORDER BY slug') as $r) {
          $types[$r['slug']] = ['name' => $r['name'], 'game' => $r['game'], 'kind' => $r['kind'], 'count' => (int)$r['count']];
        }
        $idx = ['built' => (int)($meta['built'] ?? 0), 'listingsAt' => (int)($meta['listingsAt'] ?? 0), 'count' => (int)($meta['products'] ?? 0), 'types' => $types];
      }
    } catch (Throwable $e) {
      $idx = null;
    }
  }
  return $idx;
}

// Products by id, in the order given, each with its listings ('l', best condition first), in the shape the
// pages use: id, name, n, slug, img, thumb, set, setSlug, type, typeSlug, game, kind, rel, desc, qty, from, l.
function shop_products(array $ids): array {
  $ids = array_values(array_unique(array_map('intval', $ids)));
  $db = shop_db();
  if (!$ids || !$db) return [];
  $in = implode(',', array_fill(0, count($ids), '?'));
  $st = $db->prepare("SELECT * FROM products WHERE id IN ($in)");
  $st->execute($ids);
  $rows = [];
  foreach ($st as $r) {
    $rows[(int)$r['id']] = ['id' => (int)$r['id'], 'name' => $r['name'], 'n' => $r['n'], 'slug' => $r['slug'], 'img' => $r['img'], 'thumb' => $r['thumb'],
      'set' => $r['set_name'], 'setSlug' => $r['set_slug'], 'type' => $r['type'], 'typeSlug' => $r['type_slug'], 'game' => $r['game'], 'kind' => $r['kind'],
      'rel' => (int)$r['rel'], 'desc' => $r['descr'], 'qty' => (int)$r['qty'], 'from' => (int)$r['from_p'], 'l' => []];
  }
  $st = $db->prepare("SELECT id, pid, c, v, q, p, vid FROM listings WHERE pid IN ($in) ORDER BY pid, crank, c, p, id");
  $st->execute($ids);
  foreach ($st as $l) {
    if (isset($rows[(int)$l['pid']])) $rows[(int)$l['pid']]['l'][] = ['id' => (int)$l['id'], 'c' => $l['c'], 'v' => $l['v'], 'q' => (int)$l['q'], 'p' => (int)$l['p'],
      'vid' => $l['vid'] !== null ? (int)$l['vid'] : null];
  }
  $out = [];
  foreach ($ids as $id) if (isset($rows[$id]) && $rows[$id]['l']) $out[$id] = $rows[$id];
  return $out;
}

function shop_product_get(int $id): ?array {
  return shop_products([$id])[$id] ?? null;
}

// [product, listing] for a listing id, or null when it's no longer in stock.
function shop_listing_get(int $lid): ?array {
  $db = shop_db();
  if (!$db) return null;
  $st = $db->prepare('SELECT pid FROM listings WHERE id = ?');
  $st->execute([$lid]);
  $pid = $st->fetchColumn();
  $p = $pid !== false ? shop_product_get((int)$pid) : null;
  foreach ($p['l'] ?? [] as $l) if ($l['id'] === $lid) return [$p, $l];
  return null;
}

// Product ids from a query on the products table (no user input in $sql; values go in $args).
function shop_product_ids(string $sql, array $args = []): array {
  $db = shop_db();
  if (!$db) return [];
  $st = $db->prepare($sql);
  $st->execute($args);
  return array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN));
}

function shop_newest(int $n): array {
  return array_values(shop_products(shop_product_ids('SELECT id FROM products ORDER BY rel DESC, n, id LIMIT ?', [$n])));
}

// Other products from the same set, priciest first.
function shop_set_more(array $p, int $n): array {
  if ($p['setSlug'] === '') return [];
  return array_values(shop_products(shop_product_ids('SELECT id FROM products WHERE set_slug = ? AND id <> ? ORDER BY from_p DESC, id LIMIT ?', [$p['setSlug'], $p['id'], $n])));
}

// slug => name of the sets in a product type.
function shop_type_sets(string $type): array {
  $db = shop_db();
  if (!$db) return [];
  $st = $db->prepare("SELECT DISTINCT set_slug, set_name FROM products WHERE type_slug = ? AND set_slug <> ''");
  $st->execute([$type]);
  return $st->fetchAll(PDO::FETCH_KEY_PAIR);
}

function shop_norm(string $s): string {
  $s = strtolower(iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $s) ?: $s);
  return trim(preg_replace('/[^a-z0-9]+/', ' ', $s));
}

function shop_slug(string $s): string {
  return trim(preg_replace('/[^a-z0-9]+/', '-', shop_norm($s)), '-') ?: 'item';
}

// The store's product type -> [game, kind]: "Pokemon Singles" -> ["Pokemon", "Singles"],
// "Disney Lorcana TCG Sealed Products" -> ["Disney Lorcana TCG", "Sealed"]. Used to group the shop's front page.
function shop_split_type(string $type): array {
  if (preg_match('/\b(misc|supplies|accessor)/i', $type)) return ['Supplies & accessories', 'Supplies'];
  if (preg_match('/^(.*?)\s+(Singles|Sealed(?: Products?)?|Products?)$/i', $type, $m)) {
    $kind = stripos($m[2], 'sealed') === 0 ? 'Sealed' : (stripos($m[2], 'single') === 0 ? 'Singles' : 'Products');
    $game = preg_replace('/^Magic:? The Gathering$/i', 'Magic', trim($m[1]));
    return [$game, $kind];
  }
  return [$type, 'Other'];
}

/**
 * Search, filter, sort, and page the index. $q: q, type (product type slug), set (set slug),
 * cond, min, max (dollars), sort (relevance|name|price_asc|price_desc|newest), page.
 * Returns { items, total, page, pages, facets: { types, sets, conds } }.
 */
function shop_query(array $q): array {
  $words = array_values(array_filter(explode(' ', shop_norm((string)($q['q'] ?? '')))));
  $type = (string)($q['type'] ?? '');
  $set = (string)($q['set'] ?? '');
  $cond = (string)($q['cond'] ?? '');
  $min = is_numeric($q['min'] ?? null) ? (int)round($q['min'] * 100) : null;
  $max = is_numeric($q['max'] ?? null) ? (int)round($q['max'] * 100) : null;
  $sort = (string)($q['sort'] ?? ($words ? 'relevance' : 'name'));
  $empty = ['items' => [], 'total' => 0, 'page' => 1, 'pages' => 1, 'sort' => $sort, 'facets' => ['types' => [], 'sets' => [], 'conds' => []]];
  $db = shop_db();
  if (!$db) return $empty;

  // m: products matching the words, with their cheapest listing among those the condition and price allow.
  // Words are shop_norm()ed (a-z, 0-9 only), so they're safe inside LIKE patterns. hay = " name set type ".
  $where = [];
  $args = [];
  foreach ($words as $w) { $where[] = 'p.hay LIKE ?'; $args[] = "%$w%"; }
  if ($cond !== '') { $where[] = 'l.c = ?'; $args[] = $cond; }
  if ($min !== null) { $where[] = 'l.p >= ?'; $args[] = $min; }
  if ($max !== null) { $where[] = 'l.p <= ?'; $args[] = $max; }
  $m = 'WITH m AS (SELECT p.id, p.type_slug AS t, p.set_slug AS s, MIN(l.p) AS fp FROM products p JOIN listings l ON l.pid = p.id'
    . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' GROUP BY p.id) ';
  $run = function (string $sql, array $more) use ($db, $m, $args) {
    $st = $db->prepare($m . $sql);
    $st->execute(array_merge($args, $more));
    return $st;
  };

  // Facet counts ignore their own filter, so the menus keep offering the other choices.
  $facetTypes = array_map('intval', $run("SELECT t, COUNT(*) FROM m WHERE (? = '' OR s = ?) GROUP BY t", [$set, $set])->fetchAll(PDO::FETCH_KEY_PAIR));
  $facetSets = array_map('intval', $run("SELECT s, COUNT(*) FROM m WHERE (? = '' OR t = ?) AND s <> '' GROUP BY s", [$type, $type])->fetchAll(PDO::FETCH_KEY_PAIR));
  $conds = $run("SELECT DISTINCT l.c FROM m JOIN listings l ON l.pid = m.id WHERE (? = '' OR m.t = ?)", [$type, $type])->fetchAll(PDO::FETCH_COLUMN);
  usort($conds, 'shop_condition_order');

  $filter = "(? = '' OR m.t = ?) AND (? = '' OR m.s = ?)";
  $fargs = [$type, $type, $set, $set];
  $total = (int)$run("SELECT COUNT(*) FROM m WHERE $filter", $fargs)->fetchColumn();
  $pages = max(1, (int)ceil($total / SHOP_PER_PAGE));
  $page = min($pages, max(1, (int)($q['page'] ?? 1)));

  // Best match: the name starts with the search (3), contains it as whole words (2), plus 1 per word in the name.
  $score = '0';
  $sargs = [];
  if ($words) {
    $joined = implode(' ', $words);
    $score = "(instr(p.n, ?) = 1) * 3 + (instr(' ' || p.n || ' ', ?) > 0) * 2";
    $sargs = [$joined, " $joined "];
    foreach ($words as $w) { $score .= ' + (instr(p.n, ?) > 0)'; $sargs[] = $w; }
  }
  $order = ['price_asc' => 'm.fp, p.n', 'price_desc' => 'm.fp DESC, p.n', 'newest' => 'p.rel DESC, p.n', 'relevance' => 'sc DESC, p.n'][$sort] ?? 'p.n';
  $rows = $run("SELECT m.id, m.fp, $score AS sc FROM m JOIN products p ON p.id = m.id WHERE $filter ORDER BY $order, p.id LIMIT ? OFFSET ?",
    array_merge($sargs, $fargs, [SHOP_PER_PAGE, ($page - 1) * SHOP_PER_PAGE]))->fetchAll();
  $products = shop_products(array_column($rows, 'id'));
  $items = [];
  foreach ($rows as $r) {
    if (!isset($products[(int)$r['id']])) continue;
    $items[] = $products[(int)$r['id']] + ['_from' => (int)$r['fp'], '_score' => (int)$r['sc']];
  }
  return [
    'items' => $items, 'total' => $total, 'page' => $page, 'pages' => $pages, 'sort' => $sort,
    'facets' => ['types' => $facetTypes, 'sets' => $facetSets, 'conds' => $conds],
  ];
}

// One name per condition, so the filter doesn't offer "NM-Mint" and "Near Mint" separately.
function shop_condition_label(string $c): string {
  $n = shop_norm($c);
  $map = ['nm mint' => 'Near Mint', 'nm' => 'Near Mint', 'near mint' => 'Near Mint', 'mint' => 'Near Mint',
    'light play' => 'Lightly Played', 'lightly played' => 'Lightly Played', 'lp' => 'Lightly Played',
    'moderate play' => 'Moderately Played', 'moderately played' => 'Moderately Played', 'mp' => 'Moderately Played',
    'heavy play' => 'Heavily Played', 'heavily played' => 'Heavily Played', 'hp' => 'Heavily Played',
    'damaged' => 'Damaged', 'dmg' => 'Damaged', 'brand new' => 'New', 'new' => 'New', 'sealed' => 'Sealed'];
  return $map[$n] ?? trim($c);
}

// Conditions best first; anything unrecognized after, alphabetically.
function shop_condition_order(string $a, string $b): int {
  return [shop_condition_rank($a), $a] <=> [shop_condition_rank($b), $b];
}

// 0 new/sealed … 5 damaged, 9 unrecognized (sync.php stores it as listings.crank for sorting).
function shop_condition_rank(string $c): int {
  $n = shop_norm($c);
  foreach (['new' => 0, 'sealed' => 0, 'mint' => 1, 'nm' => 1, 'near mint' => 1, 'lightly' => 2, 'lp' => 2, 'moderately' => 3, 'mp' => 3,
    'heavily' => 4, 'hp' => 4, 'damaged' => 5, 'dmg' => 5] as $k => $r) {
    if (strpos(" $n ", " $k") !== false) return $r;
  }
  return 9;
}

// CrystalCommerce keeps each photo in several sizes beside the original:
// thumb 46x64 (too small to use), medium 173x240, large 460x640, original ~736x1024.
function shop_img(string $url, string $size): string {
  return $size === '' ? $url : preg_replace('#(/photos/\d+/)(?:(?:thumb|medium|large)/)?([^/]+)$#', '${1}' . $size . '/${2}', $url);
}

function shop_money(?int $cents): string {
  return $cents === null ? '—' : '$' . number_format($cents / 100, 2);
}

function h($s): string {
  return htmlspecialchars((string)$s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

// Where a customer buys an item: the CrystalCommerce storefront's search for that exact product,
// which lists it with its add-to-cart button. (Core2 doesn't know the storefront's own item ids;
// the classic Admin API does, for a one-click cart handoff later.)
function shop_buy_url(array $p): string {
  return rtrim(shop_env('CC_STOREFRONT_URL'), '/') . '/products/search?q=' . rawurlencode($p['name']);
}
