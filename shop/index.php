<?php
/**
 * Play2Win shop storefront. The root .htaccess sends /shop, /shop/search, /shop/category/<type>,
 * and /shop/product/<id>-<slug> here. Pages are rendered on the server from the private index that
 * sync.php builds, using the site's own header, footer, and styles. Buying hands off to the
 * CrystalCommerce storefront (see shop_buy_url in lib.php), except on the store's kiosks, which
 * have a cart and place pay-at-the-register pickup orders (/shop/kiosk/..., see kiosk.php).
 */

declare(strict_types=1);
require __DIR__ . '/lib.php';
require __DIR__ . '/kiosk.php';
require __DIR__ . '/checkout.php';

// While the owners review it: kept out of search engines and the site nav.
const SHOP_PREVIEW = true;

$path = trim(preg_replace('#^/shop#', '', (string)parse_url($_SERVER['REQUEST_URI'] ?? '/shop', PHP_URL_PATH)), '/');
$parts = $path === '' ? [] : explode('/', $path);
$idx = shop_index();

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache');
if (SHOP_PREVIEW) header('X-Robots-Tag: noindex, nofollow');

// While SHOP_PASSWORD is set, the shop asks for it first (kiosks and their /shop/kiosk/... links skip it).
if (($parts[0] ?? '') !== 'kiosk' && web_gate_on() && !kiosk_active()) {
  if (($parts[0] ?? '') === 'login') web_gate_page();
  if (!web_gate_passed()) kiosk_redirect('/shop/login?next=' . rawurlencode((string)($_SERVER['REQUEST_URI'] ?? '/shop')));
}

if (($parts[0] ?? '') === 'kiosk') {
  kiosk_route(array_slice($parts, 1));
} elseif (in_array($parts[0] ?? '', ['cart', 'checkout', 'order'], true) && !kiosk_active()) {
  web_route($parts);   // online cart + PayPal checkout (checkout.php)
} elseif (!$idx) {
  shop_page('Shop', 'Play2Win Games inventory.', shop_unavailable(), ['crumbs' => []]);
} elseif (!$parts) {
  shop_home($idx);
} elseif ($parts[0] === 'search' && count($parts) === 1) {
  shop_results($idx, $_GET, '/shop/search');
} elseif ($parts[0] === 'category' && count($parts) === 2 && isset($idx['types'][$parts[1]])) {
  shop_results($idx, ['type' => $parts[1]] + $_GET, '/shop/category/' . $parts[1]);
} elseif ($parts[0] === 'product' && count($parts) === 2 && preg_match('/^(\d+)/', $parts[1], $m) && isset($idx['products'][$m[1]])) {
  shop_product($idx, $idx['products'][$m[1]]);
} else {
  http_response_code(404);
  shop_not_found();
}

/* ================================================================== pages */

function shop_not_found(): void {
  shop_page('Not found', 'That page is not in the shop.', '<section class="shop-section shop-state">
    <p class="eyebrow">Not found</p><h1>That item isn’t in the shop right now.</h1>
    <p class="lead">It may have just sold. Try a search, or browse everything we have in stock.</p>
    <p><a class="button primary" href="/shop">Browse the shop</a></p></section>', ['crumbs' => [['Shop', '/shop']]]);
}

function shop_home(array $idx): void {
  $games = [];
  foreach ($idx['types'] as $slug => $t) $games[$t['game']][$slug] = $t;
  ksort($games);
  $tiles = '';
  foreach ($games as $game => $types) {
    $links = '';
    $kinds = array_count_values(array_column($types, 'kind'));
    foreach ($types as $slug => $t) {
      // "Singles" is enough under the game's name, unless two of its types are both singles.
      $label = $t['kind'] === 'Other' || $kinds[$t['kind']] > 1 ? $t['name'] : $t['kind'];
      $links .= '<a href="/shop/category/' . h($slug) . '">' . h($label) . ' <span>' . number_format($t['count']) . '</span></a>';
    }
    $tiles .= '<div class="shop-game"><h3>' . h($game) . '</h3><div class="shop-game-links">' . $links . '</div></div>';
  }
  $newest = $idx['products'];
  usort($newest, function ($a, $b) { return [$b['rel'] ?? 0, $a['n']] <=> [$a['rel'] ?? 0, $b['n']]; });
  $body = '<section class="page-hero shop-hero">
      <p class="eyebrow">' . (kiosk_active() ? 'Shop in store' : 'Shop online') . '</p>
      <h1>Shop Play2Win’s in-stock inventory.</h1>
      <p class="lead">' . (kiosk_active()
        ? 'Find your cards, add them to your cart, and place your order. Then pay at the register and we’ll hand them over.'
        : (web_checkout_on()
          ? 'Singles, sealed product, and more, straight from our shelves. Order and pay online, then pick it up at the store for free.'
          : 'Singles, sealed product, and more, straight from our shelves. Checkout happens on our secure online store, with shipping or in-store pickup.')) . '</p>
      ' . shop_search_form('') . '
    </section>
    <section class="shop-section">
      <div class="shop-section-head"><h2>Browse by game</h2><p class="muted">' . number_format(count($idx['products'])) . ' products in stock · ' . h(shop_fresh_text($idx)) . '</p></div>
      <div class="shop-games">' . $tiles . '</div>
    </section>
    <section class="shop-section">
      <div class="shop-section-head"><h2>Newest releases in stock</h2><a class="text-link" href="/shop/search?sort=newest">See all</a></div>
      <div class="shop-grid">' . implode('', array_map('shop_card', array_slice($newest, 0, 12))) . '</div>
    </section>';
  shop_page('Shop', 'Shop Play2Win Games in-stock trading cards, sealed product, and more.', $body, ['crumbs' => []]);
}

function shop_results(array $idx, array $q, string $basePath): void {
  $r = shop_query($q);
  $type = (string)($q['type'] ?? '');
  $typeInfo = $idx['types'][$type] ?? null;
  $title = $typeInfo ? $typeInfo['name'] : (trim((string)($q['q'] ?? '')) !== '' ? 'Search: ' . trim((string)$q['q']) : 'All products');

  $grid = $r['items']
    ? '<div class="shop-grid">' . implode('', array_map('shop_card', $r['items'])) . '</div>' . shop_pager($r, $q, $basePath)
    : '<div class="shop-state shop-empty"><h2>No matches in stock.</h2><p>Try fewer words or clear a filter. Looking for something we don’t have listed? Call us at <a href="tel:+18659108357">865-910-8357</a>; it may be in the store.</p>
        <p><a class="button secondary" href="' . h($basePath) . '">Clear filters</a></p></div>';

  $body = '<section class="shop-section shop-results-head">
      <p class="eyebrow">Shop</p>
      <h1>' . h($title) . '</h1>
      ' . shop_search_form((string)($q['q'] ?? ''), $type) . '
    </section>
    <section class="shop-section shop-layout">
      ' . shop_filters($idx, $r, $q, $basePath) . '
      <div class="shop-main">
        <p class="shop-count" role="status">' . number_format($r['total']) . ' product' . ($r['total'] === 1 ? '' : 's') . ' in stock</p>
        ' . $grid . '
      </div>
    </section>';
  $crumbs = [['Shop', '/shop']];
  if ($typeInfo) $crumbs[] = [$typeInfo['name'], '/shop/category/' . $type];
  shop_page($title . ' | Shop', 'Shop ' . $title . ' in stock at Play2Win Games.', $body, ['crumbs' => $crumbs]);
}

function shop_product(array $idx, array $p): void {
  $kiosk = kiosk_active();
  $web = !$kiosk && web_checkout_on(); // online cart + checkout (checkout.php)
  $rows = '';
  foreach ($p['l'] as $l) {
    $stock = $l['q'] === 1 ? 'Last one' : $l['q'] . ' in stock';
    $rows .= '<tr><td><strong>' . h($l['c']) . '</strong>' . ($l['v'] !== '' ? '<div class="muted">' . h($l['v']) . '</div>' : '') . '</td>
      <td>' . h($stock) . '</td><td class="shop-price">' . shop_money($l['p']) . '</td>'
      . ($kiosk ? '<td>' . kiosk_add_form($l) . '</td>' : ($web ? '<td>' . web_add_form($l) . '</td>' : '')) . '</tr>';
  }
  $more = array_values(array_filter($idx['products'], function ($o) use ($p) {
    return $o['id'] !== $p['id'] && $p['setSlug'] !== '' && $o['setSlug'] === $p['setSlug'];
  }));
  usort($more, function ($a, $b) { return $b['from'] <=> $a['from']; });
  $img = $p['img'] !== ''
    ? '<img src="' . h(shop_img($p['img'], 'large')) . '" srcset="' . h(shop_img($p['img'], 'large')) . ' 1x, ' . h($p['img']) . ' 2x" alt="' . h($p['name']) . '" width="460" height="640">'
    : shop_placeholder($p);
  $meta = array_filter([$p['set'], $p['type']]);
  $body = '<section class="shop-section shop-product">
      <div class="shop-product-media">' . $img . '</div>
      <div class="shop-product-info">
        <p class="eyebrow">' . h($p['game']) . '</p>
        <h1>' . h($p['name']) . '</h1>
        ' . ($meta ? '<p class="shop-product-meta">' . h(implode(' · ', $meta)) . '</p>' : '') . '
        <table class="shop-variants">
          <thead><tr><th>Condition</th><th>Available</th><th>Price</th>' . ($kiosk || $web ? '<th><span class="sr-only">Add to cart</span></th>' : '') . '</tr></thead>
          <tbody>' . $rows . '</tbody>
        </table>
        ' . ($kiosk
          ? '<p class="shop-note muted">Add it to your cart, place your order, and pay at the register to pick it up.</p>'
          : ($web
            ? '<p class="shop-note muted">Add it to your cart, pay online, and pick it up at the store for free. Stock and prices are checked again before you pay.</p>'
            : '<p><a class="button primary shop-buy" href="' . h(shop_buy_url($p)) . '">Buy on our online store</a></p>
        <p class="shop-note muted">Checkout happens on our secure CrystalCommerce store, where you can choose shipping or in-store pickup. Stock updates every few minutes, so the last copy can sell in between.</p>')) . '
        ' . ($p['desc'] !== '' ? '<div class="shop-desc">' . nl2br(h(strip_tags($p['desc']))) . '</div>' : '') . '
      </div>
    </section>' . ($more ? '<section class="shop-section">
      <div class="shop-section-head"><h2>More from ' . h($p['set']) . '</h2><a class="text-link" href="/shop/category/' . h($p['typeSlug']) . '?set=' . h(rawurlencode($p['setSlug'])) . '">See all</a></div>
      <div class="shop-grid">' . implode('', array_map('shop_card', array_slice($more, 0, 6))) . '</div></section>' : '');
  $ld = [
    '@context' => 'https://schema.org', '@type' => 'Product', 'name' => $p['name'], 'image' => $p['img'] ?: null,
    'category' => $p['type'],
    'offers' => ['@type' => 'AggregateOffer', 'priceCurrency' => 'USD', 'lowPrice' => number_format($p['from'] / 100, 2, '.', ''),
      'highPrice' => number_format(max(array_column($p['l'], 'p')) / 100, 2, '.', ''), 'offerCount' => count($p['l']),
      'availability' => 'https://schema.org/InStock'],
  ];
  $crumbs = [['Shop', '/shop'], [$p['type'], '/shop/category/' . $p['typeSlug']], [$p['name'], null]];
  shop_page($p['name'] . ' | Shop', $p['name'] . ' in stock at Play2Win Games' . ($p['set'] ? ' (' . $p['set'] . ')' : '') . ', from ' . shop_money($p['from']) . '.',
    $body, ['crumbs' => $crumbs, 'ld' => $ld, 'canonical' => '/shop/product/' . $p['id'] . '-' . $p['slug'], 'image' => $p['img']]);
}

function shop_unavailable(): string {
  return '<section class="shop-section shop-state">
      <p class="eyebrow">Shop</p><h1>Our online inventory is loading.</h1>
      ' . (kiosk_active() ? '<p class="lead">Check back in a few minutes, or ask at the register.</p>' : '<p class="lead">Check back in a few minutes. In the meantime you can browse everything on our CrystalCommerce store.</p>
      <p><a class="button primary" href="' . h(shop_env('CC_STOREFRONT_URL')) . '">Open our online store</a></p>') . '
    </section>';
}

/* ================================================================== pieces */

// Kiosk: "Add to cart" for one condition of a product.
function kiosk_add_form(array $l): string {
  $inCart = kiosk_cart()[(int)$l['id']]['q'] ?? 0;
  $left = min((int)$l['q'], KIOSK_MAX_QTY) - $inCart;
  if (kiosk_variants() && !kiosk_variant_id((int)$l['id'])) return '<span class="muted kiosk-ask">Ask at the register</span>';
  if ($left <= 0) return '<a class="kiosk-incart" href="/shop/kiosk/cart">In your cart (' . $inCart . ')</a>';
  $qty = '';
  if ($left > 1) {
    $opts = '';
    for ($i = 1; $i <= $left; $i++) $opts .= '<option value="' . $i . '">' . $i . '</option>';
    $qty = '<label><span class="sr-only">Quantity</span><select name="qty">' . $opts . '</select></label>';
  }
  return '<form class="kiosk-add" action="/shop/kiosk/cart" method="post" data-once><input type="hidden" name="do" value="add"><input type="hidden" name="listing" value="' . (int)$l['id'] . '">'
    . $qty . '<button class="button primary" type="submit">Add to cart</button></form>'
    . ($inCart ? '<a class="kiosk-incart" href="/shop/kiosk/cart">' . $inCart . ' in your cart</a>' : '');
}

function shop_search_form(string $value, string $type = ''): string {
  return '<form class="shop-search" action="/shop/search" method="get" role="search">
      <label class="sr-only" for="shop-q">Search the shop</label>
      <input id="shop-q" type="search" name="q" value="' . h($value) . '" placeholder="Search cards, sets, and sealed product" autocomplete="off">
      ' . ($type !== '' ? '<input type="hidden" name="type" value="' . h($type) . '">' : '') . '
      <button class="button primary" type="submit">Search</button>
    </form>';
}

function shop_card(array $p): string {
  $url = '/shop/product/' . $p['id'] . '-' . $p['slug'];
  // Medium photo, large on high-density screens (CrystalCommerce's own thumb is only 46px wide).
  $img = $p['img'] !== ''
    ? '<img src="' . h(shop_img($p['img'], 'medium')) . '" srcset="' . h(shop_img($p['img'], 'medium')) . ' 1x, ' . h(shop_img($p['img'], 'large')) . ' 2x" alt="" loading="lazy" decoding="async" width="173" height="240">'
    : shop_placeholder($p);
  $stock = $p['qty'] === 1 ? 'Last one' : $p['qty'] . ' in stock';
  // "Standard" just means the listing has no condition set; it's left off the card.
  $conds = count($p['l']) > 1 ? ' · ' . count($p['l']) . ' conditions' : ($p['l'][0]['c'] !== 'Standard' ? ' · ' . h($p['l'][0]['c']) : '');
  return '<a class="shop-card" href="' . h($url) . '">
      <div class="shop-card-img">' . $img . '</div>
      <div class="shop-card-body">
        <h3>' . h($p['name']) . '</h3>
        <p class="shop-card-meta">' . h($p['set'] !== '' ? $p['set'] : $p['type']) . '</p>
        <p class="shop-card-price">' . (count($p['l']) > 1 ? '<span>from</span> ' : '') . shop_money($p['_from'] ?? $p['from']) . '</p>
        <p class="shop-card-stock">' . h($stock) . $conds . '</p>
      </div>
    </a>';
}

function shop_placeholder(array $p): string {
  return '<div class="shop-noimg" aria-hidden="true"><span>' . h(preg_match('/./u', $p['game'] ?: $p['name'], $m) ? $m[0] : '?') . '</span><small>Photo coming soon</small></div>';
}

function shop_filters(array $idx, array $r, array $q, string $basePath): string {
  $type = (string)($q['type'] ?? '');
  $opt = function ($value, $label, $current) {
    return '<option value="' . h($value) . '"' . ((string)$value === (string)$current ? ' selected' : '') . '>' . h($label) . '</option>';
  };
  $typeOpts = $opt('', 'All games & types', $type);
  foreach ($idx['types'] as $slug => $t) {
    $typeOpts .= $opt($slug, $t['name'] . ' (' . number_format($r['facets']['types'][$slug] ?? 0) . ')', $type);
  }
  $setField = '';
  if ($type !== '' && $r['facets']['sets']) {
    $sets = [];
    foreach ($idx['products'] as $p) if ($p['typeSlug'] === $type && $p['setSlug'] !== '') $sets[$p['setSlug']] = $p['set'];
    asort($sets);
    $setOpts = $opt('', 'All sets', $q['set'] ?? '');
    foreach ($sets as $slug => $name) if (isset($r['facets']['sets'][$slug])) $setOpts .= $opt($slug, $name . ' (' . $r['facets']['sets'][$slug] . ')', $q['set'] ?? '');
    $setField = '<label>Set<select name="set" data-autosubmit>' . $setOpts . '</select></label>';
  }
  $condOpts = $opt('', 'Any condition', $q['cond'] ?? '');
  foreach ($r['facets']['conds'] as $c) $condOpts .= $opt($c, $c, $q['cond'] ?? '');
  $sortOpts = '';
  $sorts = ['name' => 'Name A–Z', 'price_asc' => 'Price: low to high', 'price_desc' => 'Price: high to low', 'newest' => 'Newest releases'];
  if (trim((string)($q['q'] ?? '')) !== '') $sorts = ['relevance' => 'Best match'] + $sorts;
  foreach ($sorts as $k => $label) $sortOpts .= $opt($k, $label, $r['sort']);
  // Category pages keep the game in the path; the search page carries it as a field.
  $action = $basePath === '/shop/search' ? '/shop/search' : $basePath;
  $typeField = $basePath === '/shop/search'
    ? '<label>Game &amp; type<select name="type" data-autosubmit>' . $typeOpts . '</select></label>'
    : '<p class="shop-filter-fixed"><a href="/shop/search' . (isset($q['q']) && $q['q'] !== '' ? '?q=' . h(rawurlencode((string)$q['q'])) : '') . '">All games</a> › ' . h($idx['types'][$type]['name'] ?? '') . '</p>';
  return '<details class="shop-filters" open>
      <summary>Filters &amp; sort</summary>
      <form action="' . h($action) . '" method="get">
        ' . (isset($q['q']) && $q['q'] !== '' ? '<input type="hidden" name="q" value="' . h($q['q']) . '">' : '') . '
        ' . $typeField . $setField . '
        <label>Condition<select name="cond" data-autosubmit>' . $condOpts . '</select></label>
        <fieldset class="shop-price-range"><legend>Price</legend>
          <label><span class="sr-only">Minimum price</span><input type="number" name="min" min="0" step="1" inputmode="decimal" placeholder="Min" value="' . h($q['min'] ?? '') . '"></label>
          <span aria-hidden="true">–</span>
          <label><span class="sr-only">Maximum price</span><input type="number" name="max" min="0" step="1" inputmode="decimal" placeholder="Max" value="' . h($q['max'] ?? '') . '"></label>
        </fieldset>
        <label>Sort<select name="sort" data-autosubmit>' . $sortOpts . '</select></label>
        <div class="shop-filter-actions"><button class="button primary" type="submit">Apply</button><a class="button secondary" href="' . h($basePath) . '">Clear</a></div>
      </form>
    </details>';
}

function shop_pager(array $r, array $q, string $basePath): string {
  if ($r['pages'] <= 1) return '';
  unset($q['page']);
  if ($basePath !== '/shop/search') unset($q['type']);
  $link = function ($page, $label, $cls = '') use ($q, $basePath) {
    $qs = http_build_query(array_filter($q + ['page' => $page > 1 ? $page : null], function ($v) { return $v !== '' && $v !== null; }));
    return '<a class="' . $cls . '" href="' . h($basePath . ($qs ? "?$qs" : '')) . '">' . $label . '</a>';
  };
  $out = $r['page'] > 1 ? $link($r['page'] - 1, '← Previous', 'shop-page-step') : '';
  $from = max(1, $r['page'] - 2);
  $to = min($r['pages'], $r['page'] + 2);
  if ($from > 1) $out .= $link(1, '1') . ($from > 2 ? '<span>…</span>' : '');
  for ($i = $from; $i <= $to; $i++) $out .= $i === $r['page'] ? '<span class="current" aria-current="page">' . $i . '</span>' : $link($i, (string)$i);
  if ($to < $r['pages']) $out .= ($to < $r['pages'] - 1 ? '<span>…</span>' : '') . $link($r['pages'], (string)$r['pages']);
  if ($r['page'] < $r['pages']) $out .= $link($r['page'] + 1, 'Next →', 'shop-page-step');
  return '<nav class="shop-pager" aria-label="Pages">' . $out . '</nav>';
}

function shop_fresh_text(array $idx): string {
  $mins = (int)floor((time() - (int)($idx['listingsAt'] ?? $idx['built'])) / 60);
  return $mins < 2 ? 'stock updated just now' : ($mins < 120 ? "stock updated $mins min ago" : 'stock updated ' . floor($mins / 60) . ' hours ago');
}

/* ================================================================== layout */

// Full page with the site's own header, nav, and footer. <base href="/"> lets the shared header,
// footer, nav.js, and konami.js keep their relative links (assets/..., about.html) on /shop/... paths.
function shop_page(string $title, string $description, string $body, array $opt): void {
  $self = (string)parse_url($_SERVER['REQUEST_URI'] ?? '/shop', PHP_URL_PATH);
  $canonical = 'https://play2wingames.com' . ($opt['canonical'] ?? $self);
  $crumbs = $opt['crumbs'] ?? [];
  $kiosk = kiosk_active();
  $crumbHtml = '';
  if ($crumbs) {
    $bits = $kiosk ? [] : ['<a href="/">Home</a>'];
    foreach ($crumbs as [$label, $href]) $bits[] = $href ? '<a href="' . h($href) . '">' . h($label) . '</a>' : '<span aria-current="page">' . h($label) . '</span>';
    $crumbHtml = '<nav class="shop-crumbs" aria-label="Breadcrumb">' . implode(' <span aria-hidden="true">›</span> ', $bits) . '</nav>';
  }
  $ld = isset($opt['ld']) ? '<script type="application/ld+json">' . json_encode($opt['ld'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . '</script>' : '';
  // Kiosks go back to the start after a quiet spell (seconds; 0 = never), asking "Still shopping?" first.
  // Nothing to reset on the shop's front page with an empty cart; without a cart there's nothing to ask about.
  $cartCount = $kiosk ? kiosk_cart_count() : 0;
  $idle = $kiosk && !($self === '/shop' && $cartCount === 0 && empty($_GET)) ? (int)($opt['idle'] ?? 120) : 0;
  $idlePrompt = $cartCount > 0 && ($opt['idlePrompt'] ?? true);
  $css = filemtime(__DIR__ . '/shop.css');
  $js = filemtime(__DIR__ . '/shop.js');
  ?><!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <base href="/">
    <meta name="theme-color" content="#111217">
    <?php if (SHOP_PREVIEW || $kiosk || !empty($opt['refresh'])): ?><meta name="robots" content="noindex, nofollow"><?php endif; ?>
    <?php if (!empty($opt['refresh'])): ?><meta http-equiv="refresh" content="<?= (int)$opt['refresh'] ?>"><?php endif; ?>
    <meta name="description" content="<?= h($description) ?>">
    <title><?= h($title) ?> | Play2Win Games</title>
    <link rel="stylesheet" href="styles.css">
    <link rel="stylesheet" href="shop/shop.css?v=<?= $css ?>">
    <link rel="icon" type="image/x-icon" href="favicon.ico">
    <link rel="icon" type="image/png" sizes="32x32" href="favicon-32.png">
    <link rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon.png">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Play2Win Games">
    <meta property="og:title" content="<?= h($title) ?> | Play2Win Games">
    <meta property="og:description" content="<?= h($description) ?>">
    <meta property="og:image" content="<?= h(($opt['image'] ?? '') ?: 'https://play2wingames.com/assets/og-image.jpg') ?>">
    <meta property="og:url" content="<?= h($canonical) ?>">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="canonical" href="<?= h($canonical) ?>">
    <?= $ld ?>
  </head>
  <body class="shop-body<?= $kiosk ? ' kiosk' : '' ?>"<?= $idle ? ' data-kiosk-idle="' . $idle . '" data-kiosk-prompt="' . ($idlePrompt ? '1' : '0') . '"' : '' ?>>
    <a class="skip-link" href="<?= h($self) ?>#main">Skip to content</a>
    <?php if ($kiosk): ?>
    <header class="site-header kiosk-header">
      <a class="brand" href="/shop" aria-label="Shop home">
        <img src="assets/play-to-win-logo.png" alt="Play2Win Games">
      </a>
      <span class="kiosk-pill">Pick up &amp; pay at the register</span>
      <a class="kiosk-cart-btn" href="/shop/kiosk/cart">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
        <span>Cart</span><span class="kiosk-cart-count"><?= $cartCount ?></span>
      </a>
    </header>
    <?php if (!kiosk_cfg()['live']): ?><p class="kiosk-test-banner">TEST MODE: kiosk orders stay on our website and are not sent to CrystalCommerce.</p><?php endif; ?>
    <?php else: ?>
    <header class="site-header">
      <a class="brand" href="index.html" aria-label="Play2Win Games home">
        <img src="assets/play-to-win-logo.png" alt="Play2Win Games">
      </a>
      <a class="header-cta" href="community-first.html">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>
        <span>Community First Program</span>
      </a>
      <a class="header-phone" href="tel:+18659108357" aria-label="Call Play2Win Games at 865-910-8357">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
        <span class="header-phone-number">865-910-8357</span>
      </a>
      <?php if (web_checkout_on()): ?>
      <a class="web-cart-btn" href="/shop/cart" aria-label="Cart, <?= web_cart_count() ?> items">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
        <span class="kiosk-cart-count"><?= web_cart_count() ?></span>
      </a>
      <?php endif; ?>
      <button class="nav-toggle" aria-label="Toggle navigation" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
      <nav class="nav" aria-label="Main navigation">
        <a href="index.html">Home</a>
        <a href="about.html">About</a>
        <a href="sell-trade.html">Sell/Trade</a>
        <a href="bulk-rates.html">Bulk Rates</a>
        <a href="events.html">Events</a>
        <a href="repairs.html">Repairs</a>
        <a href="upgrades.html">Upgrades</a>
        <a href="contact.html">Contact</a>
        <a class="nav-cta" href="shop" aria-current="page">Shop</a>
      </nav>
    </header>
    <?php endif; ?>
    <main id="main" tabindex="-1">
      <?= $crumbHtml ?>
      <?= $body ?>
    </main>
    <?php if ($kiosk): ?>
    <footer class="site-footer kiosk-footer"><p>Questions? Ask anyone at the counter. Whenever you play, Play 2 Win!</p></footer>
    <?php else: ?>
    <footer class="site-footer">
      <div class="footer-brand">
        <img class="footer-mascot" src="assets/bulky-mascot.webp" alt="" width="44" height="49" loading="lazy" aria-hidden="true">
        <img src="assets/play-to-win-logo.png" alt="Play2Win Games">
        <p>Whenever you play, Play 2 Win!</p>
      </div>
      <div class="footer-meta">
        <p class="footer-where">3903 Western Avenue, Knoxville, TN 37921 &middot; <a href="tel:+18659108357">865-910-8357</a> &middot; <a href="mailto:inquiries@play2wingames.com">inquiries@play2wingames.com</a></p>
        <p class="footer-hours">Sun 11&ndash;7 &middot; Mon&ndash;Thu 11&ndash;9 &middot; Fri&ndash;Sat 11&ndash;11</p>
        <nav class="footer-links" aria-label="Footer">
          <a href="https://www.facebook.com/P2WGames/">Facebook</a>
          <a href="https://discord.gg/m44gYFFSd8" target="_blank" rel="noopener">Discord</a>
          <a href="sell-trade.html">Sell/Trade</a>
          <a href="faq.html">FAQ</a>
          <a href="team.html">Team</a>
          <a href="about.html">About</a>
          <a href="careers.html">Careers</a>
          <a href="privacy.html">Privacy</a>
        </nav>
      </div>
    </footer>
    <script src="nav.js" defer></script>
    <script src="konami.js" defer></script>
    <?php endif; ?>
    <script src="shop/shop.js?v=<?= $js ?>" defer></script>
  </body>
</html>
<?php
  exit;
}
