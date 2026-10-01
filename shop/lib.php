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
function shop_fetch_json(array $urls, int $parallel = 6, int $timeout = 25): array {
  $out = [];
  $queue = array_values($urls);
  $mh = curl_multi_init();
  $active = [];
  $start = function (string $url) use ($mh, &$active, $timeout) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
      CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 10,
      CURLOPT_HTTPHEADER => ['Accept: application/json'], CURLOPT_USERAGENT => 'Play2WinGames-Shop/1.0 (+https://play2wingames.com)',
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

/* ------------------------------------------------------------------ the index */

// Loaded once per request. Shape: { built, products: { id: {...} }, types: {...} } (see sync.php).
function shop_index(): ?array {
  static $idx = false;
  if ($idx === false) {
    $idx = shop_read_json('index.json');
    if (!is_array($idx) || !isset($idx['products'])) $idx = null;
  }
  return $idx;
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
  $idx = shop_index();
  $all = $idx['products'] ?? [];
  $words = array_values(array_filter(explode(' ', shop_norm((string)($q['q'] ?? '')))));
  $type = (string)($q['type'] ?? '');
  $set = (string)($q['set'] ?? '');
  $cond = (string)($q['cond'] ?? '');
  $min = is_numeric($q['min'] ?? null) ? (int)round($q['min'] * 100) : null;
  $max = is_numeric($q['max'] ?? null) ? (int)round($q['max'] * 100) : null;

  $hits = [];
  $facetTypes = $facetSets = $facetConds = [];
  foreach ($all as $p) {
    $score = 0;
    if ($words) {
      $name = $p['n'];
      $hay = $name . ' ' . shop_norm($p['set'] ?? '') . ' ' . shop_norm($p['type'] ?? '');
      foreach ($words as $w) if (strpos(" $hay ", $w) === false) continue 2;
      $joined = implode(' ', $words);
      $score = (strpos($name, $joined) === 0 ? 3 : 0) + (strpos(" $name ", " $joined ") !== false ? 2 : 0)
        + count(array_filter($words, function ($w) use ($name) { return strpos($name, $w) !== false; }));
    }
    // Price range and condition narrow the listings considered for this product.
    $listings = array_values(array_filter($p['l'], function ($l) use ($cond, $min, $max) {
      return ($cond === '' || $l['c'] === $cond) && ($min === null || $l['p'] >= $min) && ($max === null || $l['p'] <= $max);
    }));
    if (!$listings) continue;
    // Facet counts ignore their own filter, so the menus keep offering the other choices.
    if ($set === '' || ($p['setSlug'] ?? '') === $set) $facetTypes[$p['typeSlug']] = ($facetTypes[$p['typeSlug']] ?? 0) + 1;
    if ($type !== '' && $p['typeSlug'] !== $type) continue;
    if (!empty($p['setSlug'])) $facetSets[$p['setSlug']] = ($facetSets[$p['setSlug']] ?? 0) + 1;
    foreach ($p['l'] as $l) $facetConds[$l['c']] = true;
    if ($set !== '' && ($p['setSlug'] ?? '') !== $set) continue;
    $p['_score'] = $score;
    $p['_from'] = min(array_column($listings, 'p'));
    $hits[] = $p;
  }

  $sort = (string)($q['sort'] ?? ($words ? 'relevance' : 'name'));
  usort($hits, function ($a, $b) use ($sort) {
    switch ($sort) {
      case 'price_asc': return [$a['_from'], $a['n']] <=> [$b['_from'], $b['n']];
      case 'price_desc': return [$b['_from'], $a['n']] <=> [$a['_from'], $b['n']];
      case 'newest': return [$b['rel'] ?? 0, $a['n']] <=> [$a['rel'] ?? 0, $b['n']];
      case 'relevance': return [$b['_score'], $a['n']] <=> [$a['_score'], $b['n']];
      default: return $a['n'] <=> $b['n'];
    }
  });

  $total = count($hits);
  $pages = max(1, (int)ceil($total / SHOP_PER_PAGE));
  $page = min($pages, max(1, (int)($q['page'] ?? 1)));
  $conds = array_keys($facetConds);
  usort($conds, 'shop_condition_order');
  return [
    'items' => array_slice($hits, ($page - 1) * SHOP_PER_PAGE, SHOP_PER_PAGE),
    'total' => $total, 'page' => $page, 'pages' => $pages, 'sort' => $sort,
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
  $rank = function ($c) {
    $n = shop_norm($c);
    foreach (['new' => 0, 'sealed' => 0, 'mint' => 1, 'nm' => 1, 'near mint' => 1, 'lightly' => 2, 'lp' => 2, 'moderately' => 3, 'mp' => 3,
      'heavily' => 4, 'hp' => 4, 'damaged' => 5, 'dmg' => 5] as $k => $r) {
      if (strpos(" $n ", " $k") !== false) return $r;
    }
    return 9;
  };
  return [$rank($a), $a] <=> [$rank($b), $b];
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
