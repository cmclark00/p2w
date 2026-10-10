<?php
/**
 * Inventory sync for the shop: copies Play2Win's CrystalCommerce stock into the private index the
 * storefront reads (<home>/p2w-shop-data/shop-index.sqlite).
 *
 *   1. Core2 listings: every page of Core2 /api/listings for the shop's organization (prices, quantities,
 *      conditions), in stock and sold out. Re-read at most every SYNC_MIN_MINUTES.
 *   2. Product details (photo, set, game): Core2 /api/v2/products/{id}, one product per request (no
 *      batch endpoint), DETAILS_PER_RUN per run, kept for good. New products fill in over the next runs.
 *   3. The index the shop pages read: Core2's in-stock listings plus every in-stock Admin API variant
 *      Core2 doesn't list (see below), built into a new SQLite file and swapped in whole.
 *   4. The Admin API variants catalog (variant ids for orders, and the stock Core2 lacks), read slowly
 *      over many runs: a full pass at most every VARIANT_PASS_HOURS (see sync_variants).
 *
 * Why the Admin API too: Core2 only lists part of the store (Oct 9 2026: 4,901 Core2 listings, while the
 * Admin API had 47,393 variants, 46,627 in stock). Core2 still wins for anything it lists, because it's
 * refreshed every few minutes and the catalog only every few hours; checkout re-checks stock live anyway.
 *
 * Storage (all in the private data folder): shop.sqlite holds what the sync keeps between runs (Core2
 * listings, product details, the variants catalog); shop-index.sqlite is what the pages read. SQLite, not
 * JSON, because the whole store doesn't fit in PHP's 128 MB as arrays.
 *
 * Run it from cron (php sync.php) or over HTTP (GitHub Actions and the shop pages call /shop/sync.php).
 * Anyone may call it: it only reads public data, refuses to re-read listings more often than
 * SYNC_MIN_MINUTES, and only one run happens at a time. Prints a JSON status line.
 */

declare(strict_types=1);
require __DIR__ . '/lib.php';

const SYNC_MIN_MINUTES = 10;
const SYNC_PER_PAGE = 500;
const DETAILS_PER_RUN = 400;         // Core2 product details per run
const DETAILS_PARALLEL = 4;
const VARIANT_PER_PAGE = 200;
// Gentle pace for CrystalCommerce's Admin API (owner-approved Oct 2026; see sync_variants).
const VARIANT_PASS_HOURS = 6;        // a full variants pass (~256 pages) at most this often
const VARIANT_PAGES_PER_RUN = 20;    // pages per sync run
const VARIANT_PARALLEL = 2;          // pages at a time
const VARIANT_PAUSE_MS = 1000;       // pause between batches
// Listing ids for stock that only the Admin API knows: this + the CrystalCommerce variant id, so they can
// never clash with Core2 listing ids.
const ADMIN_LISTING_BASE = 1000000000;
const ADMIN_STOCK = true;            // list the Admin API's extra stock (false = Core2 only)
const STORE_DB = 'shop.sqlite';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

$cli = PHP_SAPI === 'cli';
@set_time_limit($cli ? 0 : 90);
// The shop pages kick this off in the background and hang up at once (shop_kick_sync in lib.php):
// keep going after the caller disconnects.
ignore_user_abort(true);
$t0 = microtime(true);

function done(array $status): void {
  echo json_encode($status, JSON_UNESCAPED_SLASHES), "\n";
  exit;
}

$lock = fopen(shop_data_dir() . '/sync.lock', 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) done(['status' => 'busy']);

$base = rtrim(shop_env('CC_CORE2_BASE'), '/');
$org = shop_env('CC_CORE2_ORG_ID');
$state = shop_read_json('state.json') ?: [];
$db = sync_store();
sync_migrate($db);

/* ---------------------------------------------------------------- 1. Core2 listings */

$fresh = time() - (int)($state['listingsAt'] ?? 0) < SYNC_MIN_MINUTES * 60 && (int)$db->query('SELECT COUNT(*) FROM core2')->fetchColumn() > 0;
if (!$fresh) {
  $first = array_values(shop_fetch_json(["$base/api/listings?organization_id=" . rawurlencode($org) . '&per_page=' . SYNC_PER_PAGE . '&page=1']))[0];
  if (!is_array($first) || !isset($first['listings'])) done(['status' => 'error', 'error' => 'Could not read listings from CrystalCommerce']);
  $pages = (int)($first['pages'] ?? 1);
  $urls = [];
  for ($p = 2; $p <= $pages; $p++) $urls[] = "$base/api/listings?organization_id=" . rawurlencode($org) . '&per_page=' . SYNC_PER_PAGE . "&page=$p";
  $rest = $urls ? shop_fetch_json($urls, 3, 60) : [];
  $rows = [];
  // What CrystalCommerce sent, before the in-stock filter (shown in the status, to spot missing pages).
  $raw = ['pages' => $pages, 'total' => $first['total_count'] ?? null, 'rows' => 0, 'skipped' => ['noStock' => 0, 'noPrice' => 0, 'otherOrg' => 0]];
  foreach (array_merge([$first], array_values($rest)) as $i => $page) {
    if (!is_array($page) || !isset($page['listings'])) done(['status' => 'error', 'error' => 'A listings page failed; the old index was kept', 'page' => $i + 1]);
    // Listings come grouped by store location; flatten.
    $groups = is_array($page['listings']) ? $page['listings'] : [];
    foreach ((array_values($groups) === $groups ? [$groups] : $groups) as $group) {
      foreach ($group as $l) {
        $raw['rows']++;
        if ((int)($l['organization_id'] ?? 0) !== (int)$org) { $raw['skipped']['otherOrg']++; continue; }
        $qty = !empty($l['infinite_quantity']) ? 99 : (int)($l['quantity'] ?? 0) - (int)($l['reserved_quantity'] ?? 0);
        $price = $l['ally_agreement_price'] ?? null;
        $live = $qty > 0 && is_numeric($price) && $price > 0;
        if (!$live) $raw['skipped'][$qty <= 0 ? 'noStock' : 'noPrice']++;
        $d = is_array($l['descriptors'] ?? null) ? $l['descriptors'] : [];
        $cond = shop_condition_label((string)($d['condition'] ?? ''));
        unset($d['condition']);
        $v = implode(' · ', array_filter(array_map('strval', array_values($d))));
        // Sold-out listings are kept too: their variants must not come back in from the (older) Admin catalog.
        $rows[] = [(int)$l['id'], (int)$l['product_id'], (string)($l['product_name'] ?? ''), trim((string)($l['product_type_name'] ?? '')),
          $cond !== '' ? $cond : 'Standard', $v, sync_descriptor_key($v), max(0, $qty), is_numeric($price) ? (int)$price : 0, $live ? 1 : 0];
      }
    }
  }
  $db->beginTransaction();
  $db->exec('DELETE FROM core2');
  $ins = $db->prepare('INSERT OR REPLACE INTO core2 (id, pid, name, type, c, v, dkey, q, p, live) VALUES (?,?,?,?,?,?,?,?,?,?)');
  foreach ($rows as $r) $ins->execute($r);
  $db->commit();
  unset($rows, $first, $rest);
  $state['listingsAt'] = time();
  $state['listingsRaw'] = $raw;
}

/* ---------------------------------------------------------------- 2. product details */

// Products in stock (Core2 or the Admin catalog) that have no details yet; a product Core2 doesn't know is
// given up after 3 tries (shown without a photo or set), so the sync can finish.
$needSql = 'SELECT pid FROM (SELECT pid FROM core2 WHERE live = 1' . (ADMIN_STOCK ? ' UNION SELECT pid FROM variants WHERE qty > 0 AND cents > 0' : '') . ')
  WHERE pid NOT IN (SELECT pid FROM details WHERE ok = 1 OR tries >= 3)';
$need = array_map('intval', $db->query("$needSql LIMIT " . DETAILS_PER_RUN)->fetchAll(PDO::FETCH_COLUMN));
$fetched = 0;
if ($need) {
  $res = shop_fetch_json(array_map(function ($id) use ($base) { return "$base/api/v2/products/$id"; }, $need), DETAILS_PARALLEL, 20);
  $ok = $db->prepare('INSERT OR REPLACE INTO details (pid, slug, img, thumb, set_name, set_slug, type_slug, type_name, descr, rel, ok, tries) VALUES (?,?,?,?,?,?,?,?,?,?,1,0)');
  $miss = $db->prepare('INSERT INTO details (pid, ok, tries) VALUES (?, 0, 1) ON CONFLICT(pid) DO UPDATE SET tries = tries + 1');
  $db->beginTransaction();
  foreach ($need as $id) {
    $r = $res["$base/api/v2/products/$id"] ?? null;
    if (!is_array($r) || empty($r['id'])) { $miss->execute([$id]); continue; }
    $ok->execute([$id, (string)($r['name_slug'] ?? ''), (string)($r['image'] ?? ''), (string)($r['image_thumb'] ?? ''),
      (string)($r['category_name'] ?? ''), (string)($r['category_slug'] ?? ''), (string)($r['product_type_slug'] ?? ''), (string)($r['product_type_name'] ?? ''),
      (string)($r['description'] ?? ''), is_numeric($r['release_date'] ?? null) ? (int)$r['release_date'] : (strtotime((string)($r['created_at'] ?? '')) ?: 0)]);
    $fetched++;
  }
  $db->commit();
  unset($res);
}
$missing = (int)$db->query("SELECT COUNT(*) FROM ($needSql)")->fetchColumn();

/* ---------------------------------------------------------------- 3. build the index */

$catalogAt = (int)sync_kv($db, 'catalogAt');
$indexPath = shop_data_dir() . '/' . SHOP_INDEX_DB;
$rebuild = !$fresh || $fetched > 0 || !is_file($indexPath) || (int)($state['indexCatalogAt'] ?? -1) !== $catalogAt
  || (bool)($state['indexAdmin'] ?? null) !== ADMIN_STOCK || ($state['indexVersion'] ?? 0) !== 2;
$built = null;
if ($rebuild) {
  $built = sync_build_index($db, $indexPath, (int)$state['listingsAt']);
  $state['indexCatalogAt'] = $catalogAt;
  $state['indexAdmin'] = ADMIN_STOCK;
  $state['indexVersion'] = 2;
  $state['indexStats'] = $built;
}
$state['missingDetails'] = $missing;
shop_write_json('state.json', $state);

/* ---------------------------------------------------------------- 4. variants catalog */

// Last, after the index is saved, so nothing here can hold up the shop's stock.
$variantStats = null;
if (shop_env('CC_API_PROXY_SECRET') !== '') {
  try {
    $variantStats = sync_variants($db, $t0 + ($cli ? 900 : 80));
  } catch (Throwable $e) {
    @unlink(shop_data_dir() . '/variants-progress.json');
    $variantStats = ['error' => get_class($e) . ': ' . $e->getMessage()];
  }
}

done([
  'status' => 'ok', 'listingsRefreshed' => !$fresh, 'indexRebuilt' => $rebuild, 'index' => $state['indexStats'] ?? null,
  'detailsFetched' => $fetched, 'missing' => $missing, 'raw' => $state['listingsRaw'] ?? null, 'variants' => $variantStats,
  'memoryMB' => round(memory_get_peak_usage() / 1048576), 'memoryLimit' => ini_get('memory_limit'),
  'seconds' => round(microtime(true) - $t0, 1),
]);

/* ================================================================== storage */

function sync_store(): PDO {
  $db = new PDO('sqlite:' . shop_data_dir() . '/' . STORE_DB, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
  $db->exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000');
  $db->exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)');
  $db->exec('CREATE TABLE IF NOT EXISTS core2 (id INTEGER PRIMARY KEY, pid INTEGER, name TEXT, type TEXT, c TEXT, v TEXT, dkey TEXT, q INTEGER, p INTEGER, live INTEGER, vid INTEGER)');
  $db->exec('CREATE TABLE IF NOT EXISTS details (pid INTEGER PRIMARY KEY, slug TEXT DEFAULT \'\', img TEXT DEFAULT \'\', thumb TEXT DEFAULT \'\', set_name TEXT DEFAULT \'\',
    set_slug TEXT DEFAULT \'\', type_slug TEXT DEFAULT \'\', type_name TEXT DEFAULT \'\', descr TEXT DEFAULT \'\', rel INTEGER DEFAULT 0, ok INTEGER DEFAULT 0, tries INTEGER DEFAULT 0)');
  sync_variants_table($db, 'variants');
  return $db;
}

// The variants catalog: every Admin API variant (in stock or not), by Core2 product id.
function sync_variants_table(PDO $db, string $name): void {
  $db->exec("CREATE TABLE IF NOT EXISTS $name (vid INTEGER PRIMARY KEY, pid INTEGER, name TEXT, cat INTEGER, cond TEXT, dkey TEXT, shown TEXT, qty INTEGER, cents INTEGER)");
  $db->exec("CREATE INDEX IF NOT EXISTS {$name}_pid ON $name (pid)");
}

function sync_kv(PDO $db, string $k, $set = null) {
  if ($set !== null) {
    $db->prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)')->execute([$k, is_scalar($set) ? (string)$set : json_encode($set)]);
    return $set;
  }
  $st = $db->prepare('SELECT v FROM kv WHERE k = ?');
  $st->execute([$k]);
  $v = $st->fetchColumn();
  return $v === false ? null : $v;
}

// One-time move from the JSON files used before Oct 9 2026 (products.json, variants-catalog.json), so no
// product details have to be fetched again and no extra variants pass is needed.
function sync_migrate(PDO $db): void {
  $dir = shop_data_dir();
  if (is_file("$dir/products.json")) {
    $details = shop_read_json('products.json') ?: [];
    $ins = $db->prepare('INSERT OR IGNORE INTO details (pid, slug, img, thumb, set_name, set_slug, type_slug, type_name, descr, rel, ok, tries) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
    $db->beginTransaction();
    foreach ($details as $id => $d) {
      $none = !empty($d['none']);
      $ins->execute([(int)$id, $d['slug'] ?? '', $d['img'] ?? '', $d['thumb'] ?? '', $d['set'] ?? '', $d['setSlug'] ?? '', $d['typeSlug'] ?? '', $d['typeName'] ?? '',
        $d['desc'] ?? '', (int)($d['rel'] ?? 0), $none ? 0 : 1, $none ? 3 : 0]);
    }
    $db->commit();
    unset($details);
    @rename("$dir/products.json", "$dir/products.json.migrated");
  }
  if (is_file("$dir/variants-catalog.json")) {
    $cat = shop_read_json('variants-catalog.json');
    if (is_array($cat) && isset($cat['byPid'])) {
      $db->beginTransaction();
      $db->exec('DELETE FROM variants');
      $ins = $db->prepare('INSERT OR REPLACE INTO variants (vid, pid, name, cat, cond, dkey, shown, qty, cents) VALUES (?,?,?,?,?,?,?,?,?)');
      $stock = [];
      foreach ($cat['stock'] ?? [] as $s) $stock[$s[0]] = $s;
      foreach ($cat['byPid'] as $pid => $rows) {
        foreach ($rows as $r) {
          $s = $stock[$r[0]] ?? null;
          $ins->execute([(int)$r[0], (int)$pid, $s[2] ?? '', $s[3] ?? 0, $r[1], $r[2], $s[5] ?? '', $s[6] ?? 0, (int)$r[3]]);
        }
      }
      sync_kv($db, 'catalogAt', (int)($cat['at'] ?? 0));
      sync_kv($db, 'catalog', ['variants' => $cat['variants'] ?? null, 'inStock' => $cat['inStock'] ?? null, 'noCatalogId' => $cat['noCatalogId'] ?? null,
        'pages' => $cat['pages'] ?? null, 'passMinutes' => $cat['passMinutes'] ?? null]);
      sync_kv($db, 'cats', $cat['cats'] ?? []);
      $db->commit();
      // A catalog from before stock was kept (no 'stock') starts a new pass right away.
      if (!isset($cat['stock'])) sync_kv($db, 'catalogAt', 0);
    }
    unset($cat);
    @rename("$dir/variants-catalog.json", "$dir/variants-catalog.json.migrated");
  }
  foreach (['index.json', 'listings.json', 'listings-soldout.json'] as $f) if (is_file("$dir/$f")) @rename("$dir/$f", "$dir/$f.old");
}

/* ================================================================== the index */

function sync_build_index(PDO $db, string $path, int $listingsAt): array {
  // Match Core2 listings (in stock and sold out) to catalog variants.
  $byPid = $db->prepare('SELECT vid, cond, dkey, cents FROM variants WHERE pid = ?');
  $setVid = $db->prepare('UPDATE core2 SET vid = ? WHERE id = ?');
  $loose = $unmatched = 0;
  $examples = [];
  $db->beginTransaction();
  foreach ($db->query('SELECT id, pid, c, dkey, p, live FROM core2')->fetchAll() as $l) {
    $byPid->execute([(int)$l['pid']]);
    $cands = $byPid->fetchAll(PDO::FETCH_NUM);
    $m = sync_match($l, $cands);
    $setVid->execute([$m[0] ?? null, (int)$l['id']]);
    if ($m && $m[1] && $l['live']) $loose++;
    if (!$m && $l['live']) {
      $unmatched++;
      if (count($examples) < 12) $examples[] = ['listing' => [$l['c'], $l['dkey']], 'variants' => array_map(function ($c) { return [$c[1], $c[2]]; }, array_slice($cands, 0, 6)), 'variantCount' => count($cands)];
    }
  }
  $db->commit();

  // Product type for Admin-only stock: the store's Core2 type most seen in that Admin category, else the category's own name.
  $catType = [];
  foreach ($db->query("SELECT v.cat, c.type, COUNT(*) AS n FROM core2 c JOIN variants v ON v.vid = c.vid WHERE c.type <> '' GROUP BY v.cat, c.type ORDER BY n DESC") as $r) {
    if (!isset($catType[(int)$r['cat']])) $catType[(int)$r['cat']] = $r['type'];
  }
  foreach (json_decode((string)sync_kv($db, 'cats'), true) ?: [] as $id => $name) if (!isset($catType[(int)$id])) $catType[(int)$id] = sync_category_type((string)$name);

  $tmp = $path . '.' . bin2hex(random_bytes(4)) . '.tmp';
  $ix = new PDO('sqlite:' . $tmp, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
  try {
    $ix->exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF');
    $ix->exec('CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT)');
    $ix->exec('CREATE TABLE types (slug TEXT PRIMARY KEY, name TEXT, game TEXT, kind TEXT, count INTEGER)');
    $ix->exec('CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, n TEXT, hay TEXT, slug TEXT, img TEXT, thumb TEXT, set_name TEXT, set_slug TEXT,
      type TEXT, type_slug TEXT, game TEXT, kind TEXT, rel INTEGER, descr TEXT, qty INTEGER, from_p INTEGER)');
    $ix->exec('CREATE TABLE listings (id INTEGER PRIMARY KEY, pid INTEGER, c TEXT, v TEXT, q INTEGER, p INTEGER, vid INTEGER, crank INTEGER, src INTEGER, name TEXT, type TEXT)');
    $ix->exec('ATTACH DATABASE ' . $ix->quote(shop_data_dir() . '/' . STORE_DB) . ' AS st');
    $ix->beginTransaction();
    $ix->exec('INSERT INTO listings (id, pid, c, v, q, p, vid, crank, src, name, type) SELECT id, pid, c, v, q, p, vid, 9, 0, name, type FROM st.core2 WHERE live = 1');
    $fromAdmin = 0;
    if (ADMIN_STOCK) {
      $add = $ix->prepare('INSERT INTO listings (id, pid, c, v, q, p, vid, crank, src, name, type)
        SELECT ? + vid, pid, cond, shown, qty, cents, vid, 9, 1, name, ? FROM st.variants
        WHERE cat = ? AND qty > 0 AND cents > 0 AND vid NOT IN (SELECT vid FROM st.core2 WHERE vid IS NOT NULL)');
      $cats = $ix->query('SELECT DISTINCT cat FROM st.variants WHERE qty > 0')->fetchAll(PDO::FETCH_COLUMN);
      foreach ($cats as $cat) {
        $add->execute([ADMIN_LISTING_BASE, $catType[(int)$cat] ?? 'Other', (int)$cat]);
        $fromAdmin += $add->rowCount();
      }
    }
    $rank = $ix->prepare('UPDATE listings SET crank = ? WHERE c = ?');
    foreach ($ix->query('SELECT DISTINCT c FROM listings')->fetchAll(PDO::FETCH_COLUMN) as $c) $rank->execute([shop_condition_rank((string)$c), $c]);
    $ix->exec('CREATE INDEX listings_pid ON listings (pid)');

    // The store's spelling of each product type, for listings that come without one.
    $typeNames = [];
    foreach ($ix->query("SELECT DISTINCT type FROM listings WHERE type <> ''")->fetchAll(PDO::FETCH_COLUMN) as $t) $typeNames[shop_slug((string)$t)] = $t;

    // One product per Core2 product id; its name and type come from a Core2 listing when there is one.
    $ins = $ix->prepare('INSERT INTO products (id, name, n, hay, slug, img, thumb, set_name, set_slug, type, type_slug, game, kind, rel, descr, qty, from_p)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    $rows = $ix->query('SELECT g.pid, g.qty, g.fp, (SELECT name FROM listings x WHERE x.pid = g.pid ORDER BY src, id LIMIT 1) AS name,
        (SELECT type FROM listings x WHERE x.pid = g.pid ORDER BY src, id LIMIT 1) AS ltype, d.slug, d.img, d.thumb, d.set_name, d.set_slug, d.type_slug, d.type_name, d.descr, d.rel
      FROM (SELECT pid, SUM(q) AS qty, MIN(p) AS fp FROM listings GROUP BY pid) g LEFT JOIN st.details d ON d.pid = g.pid');
    $count = 0;
    while ($r = $rows->fetch()) {
      $lt = (string)$r['ltype'];
      $dSlug = (string)($r['type_slug'] ?? '');
      // The store's own product type (on the listing) wins: Core2's catalog sometimes files a card under
      // another game (One Piece cards as "Dragon Ball Super"). Its set is only trusted when the two agree.
      $type = $lt !== '' ? $lt : ($typeNames[$dSlug] ?? ((string)($r['type_name'] ?? '') !== '' ? (string)$r['type_name'] : ucwords(str_replace('-', ' ', $dSlug !== '' ? $dSlug : 'Other'))));
      $typeSlug = shop_slug($type);
      $setOk = (string)($r['set_name'] ?? '') !== '' && ($dSlug === $typeSlug || $lt === '');
      $set = $setOk ? (string)$r['set_name'] : '';
      [$game, $kind] = shop_split_type($type);
      $name = (string)$r['name'];
      $n = shop_norm($name);
      $ins->execute([(int)$r['pid'], $name, $n, ' ' . trim("$n " . shop_norm($set) . ' ' . shop_norm($type)) . ' ',
        (string)($r['slug'] ?? '') !== '' ? $r['slug'] : shop_slug($name), (string)($r['img'] ?? ''), (string)($r['thumb'] ?? ''),
        $set, $setOk ? (string)$r['set_slug'] : '', $type, $typeSlug, $game, $kind, (int)($r['rel'] ?? 0), (string)($r['descr'] ?? ''), (int)$r['qty'], (int)$r['fp']]);
      $count++;
    }
    $rows->closeCursor();
    $ix->exec('INSERT INTO types (slug, name, game, kind, count) SELECT type_slug, MIN(type), MIN(game), MIN(kind), COUNT(*) FROM products GROUP BY type_slug');
    foreach (['built' => time(), 'listingsAt' => $listingsAt, 'products' => $count] as $k => $v) $ix->prepare('INSERT INTO meta (k, v) VALUES (?, ?)')->execute([$k, (string)$v]);
    $ix->exec('CREATE INDEX products_type ON products (type_slug); CREATE INDEX products_set ON products (set_slug); CREATE INDEX products_rel ON products (rel)');
    $listings = (int)$ix->query('SELECT COUNT(*) FROM listings')->fetchColumn();
    $orderable = (int)$ix->query('SELECT COUNT(*) FROM listings WHERE vid IS NOT NULL')->fetchColumn();
    $ix->commit();
    $ix->exec('DETACH DATABASE st');
  } catch (Throwable $e) {
    $ix = $ins = $add = $rank = $rows = null;
    @unlink($tmp);
    throw $e;
  }
  // Statements keep the connection (and the file) open until they're gone.
  $ix = $ins = $add = $rank = $rows = null;
  if (!@rename($tmp, $path)) { @unlink($tmp); throw new RuntimeException('Could not save the shop index'); }

  $stats = ['at' => time(), 'catalogAt' => (int)sync_kv($db, 'catalogAt'), 'products' => $count, 'listings' => $listings, 'fromAdmin' => $fromAdmin,
    'matched' => $orderable, 'loose' => $loose, 'unmatched' => $unmatched] + (json_decode((string)sync_kv($db, 'catalog'), true) ?: []);
  // For the kiosk status page.
  shop_write_json('variants.json', $stats + ['unmatchedExamples' => $examples]);
  return $stats;
}

// [variant id, matched loosely?] for a Core2 listing among its product's variants ([vid, cond, dkey, cents]):
// same condition and other descriptors (the price breaks a tie); a product with a single variant can only
// be that one, however it's spelled.
function sync_match(array $l, array $cands): ?array {
  $same = array_values(array_filter($cands, function ($c) use ($l) { return $c[1] === $l['c'] && $c[2] === $l['dkey']; }));
  if (count($same) > 1) {
    $samePrice = array_values(array_filter($same, function ($c) use ($l) { return (int)$c[3] === (int)$l['p']; }));
    if ($samePrice) $same = $samePrice;
  }
  if ($same) return [(int)$same[0][0], false];
  if (count($cands) === 1) return [(int)$cands[0][0], true];
  return null;
}

// Descriptors other than condition, normalized and sorted, so both APIs' spellings compare equal.
function sync_descriptor_key(string $v): string {
  $want = array_map('shop_norm', array_filter(explode(' · ', $v), 'strlen'));
  sort($want);
  return implode(' ', $want);
}

// An Admin API category name as a product type when no Core2 listing shows the store's own spelling:
// "Magic (Sealed)" -> "Magic Sealed" (shop_split_type then files it as Magic / Sealed).
function sync_category_type(string $cat): string {
  $t = trim(preg_replace('/\s+/', ' ', str_replace(['(', ')'], ' ', $cat)));
  return $t !== '' ? $t : 'Other';
}

/* ================================================================== variants catalog */

/**
 * The Admin API knows CrystalCommerce's own variant ids, which orders need, and the stock Core2 doesn't list.
 * Variants carry product_catalog_id (= the Core2 product id), descriptors (Condition, ...), qty and price.
 *
 * A full pass over every variants page (~256 slow pages) rebuilds the catalog at most every VARIANT_PASS_HOURS,
 * paced gently: VARIANT_PAGES_PER_RUN pages per sync run, VARIANT_PARALLEL at a time with a pause between.
 * Rows go into variants_new as they're read (progress in variants-progress.json); when the pass is done it
 * replaces the variants table, and the next run rebuilds the index from it.
 * (Oct 3 2026: back-to-back fast passes coincided with CrystalCommerce dropping connections; keep it slow.)
 */
function sync_variants(PDO $db, float $deadline): array {
  $progressFile = 'variants-progress.json';
  $prog = shop_read_json($progressFile);
  $passAge = time() - (int)sync_kv($db, 'catalogAt');

  if (!is_array($prog) || !isset($prog['queue'], $prog['v2'])) {
    if ($prog !== null) @unlink(shop_data_dir() . '/' . $progressFile); // a pass from the JSON-era code
    $prog = null;
    if ($passAge < VARIANT_PASS_HOURS * 3600) {
      return ['upToDate' => true, 'nextPassInMinutes' => max(0, (int)ceil((VARIANT_PASS_HOURS * 3600 - $passAge) / 60))];
    }
    [$s, $cats] = shop_cc('GET', '/categories', 'admin:read-inventory');
    $queue = [];
    $names = [];
    foreach ((is_array($cats) ? $cats['category']['children'] ?? [] : []) as $c) {
      if (empty($c['category']['id'])) continue;
      $queue[] = sync_variant_url((int)$c['category']['id'], 1);
      $names[(int)$c['category']['id']] = (string)($c['category']['name'] ?? '');
    }
    if (!$queue) return ['error' => "Could not read CrystalCommerce categories (HTTP $s)"];
    $db->exec('DROP TABLE IF EXISTS variants_new');
    sync_variants_table($db, 'variants_new');
    $prog = ['v2' => true, 'started' => time(), 'queue' => $queue, 'tries' => [], 'cats' => $names, 'count' => 0, 'inStock' => 0, 'pages' => 0, 'noCatalogId' => 0];
  }

  $headers = shop_cc_headers('admin:read-inventory');
  $ins = $db->prepare('INSERT OR REPLACE INTO variants_new (vid, pid, name, cat, cond, dkey, shown, qty, cents) VALUES (?,?,?,?,?,?,?,?,?)');
  $read = 0;
  // A batch can take up to the 30 s request timeout, so only start one with time to spare.
  while ($prog['queue'] && $read < VARIANT_PAGES_PER_RUN && microtime(true) < $deadline - 32) {
    if ($read > 0) usleep(VARIANT_PAUSE_MS * 1000);
    $batch = array_splice($prog['queue'], 0, VARIANT_PARALLEL);
    $res = shop_fetch_json($batch, VARIANT_PARALLEL, 30, $headers);
    $db->beginTransaction();
    foreach ($batch as $u) {
      $read++;
      $r = $res[$u] ?? null;
      if (!is_array($r) || !isset($r['paginated_collection'])) {
        $prog['tries'][$u] = ($prog['tries'][$u] ?? 0) + 1;
        if ($prog['tries'][$u] >= 3) {
          $db->commit();
          @unlink(shop_data_dir() . '/' . $progressFile);
          return ['error' => 'A variants page kept failing; the pass was dropped and the old catalog kept'];
        }
        $prog['queue'][] = $u;
        continue;
      }
      $pc = $r['paginated_collection'];
      preg_match('/[?&]category_id=(\d+)/', $u, $cm);
      $catId = (int)($cm[1] ?? 0);
      if (preg_match('/[?&]page=1$/', $u)) {
        for ($p = 2; $p <= (int)($pc['total_pages'] ?? 1); $p++) $prog['queue'][] = sync_variant_url($catId, $p);
      }
      foreach ($pc['entries'] ?? [] as $e) {
        $v = $e['variant'] ?? $e;
        if (empty($v['id'])) continue;
        $qty = max(0, (int)($v['available_qty'] ?? $v['qty'] ?? 0));
        if (empty($v['product_catalog_id'])) {
          if ($qty > 0) $prog['noCatalogId']++; // no Core2 product (photo, set, page id) to show it with
          continue;
        }
        $cond = '';
        $other = [];
        $shown = [];
        foreach ($v['descriptors'] ?? [] as $d) {
          $d = is_array($d) ? ($d['variant_descriptor'] ?? $d) : [];
          $value = is_scalar($d['value'] ?? null) ? (string)$d['value'] : '';
          if (strcasecmp((string)($d['name'] ?? ''), 'condition') === 0) $cond = shop_condition_label($value);
          elseif ($value !== '') { $other[] = shop_norm($value); $shown[] = $value; }
        }
        sort($other);
        $cents = (int)($v['sell_price']['money']['cents'] ?? 0);
        $ins->execute([(int)$v['id'], (int)$v['product_catalog_id'], (string)($v['product_name'] ?? ''), $catId, $cond !== '' ? $cond : 'Standard',
          implode(' ', $other), implode(' · ', $shown), $qty, $cents]);
        $prog['count']++;
        if ($qty > 0 && $cents > 0) $prog['inStock']++;
      }
      $prog['pages']++;
    }
    $db->commit();
    shop_write_json($progressFile, $prog);
  }
  if ($prog['queue']) {
    return ['pending' => count($prog['queue']), 'pagesRead' => $prog['pages'], 'variantsSoFar' => $prog['count'], 'inStockSoFar' => $prog['inStock']];
  }
  // Pass done: it replaces the catalog, and the next run rebuilds the index from it.
  $db->beginTransaction();
  $db->exec('DROP TABLE variants');
  $db->exec('ALTER TABLE variants_new RENAME TO variants');
  $db->exec('DROP INDEX IF EXISTS variants_new_pid');
  $db->exec('CREATE INDEX IF NOT EXISTS variants_pid ON variants (pid)');
  $info = ['variants' => $prog['count'], 'inStock' => $prog['inStock'], 'noCatalogId' => $prog['noCatalogId'], 'pages' => $prog['pages'],
    'passMinutes' => (int)round((time() - $prog['started']) / 60)];
  sync_kv($db, 'catalogAt', time());
  sync_kv($db, 'catalog', $info);
  sync_kv($db, 'cats', $prog['cats']);
  $db->commit();
  @unlink(shop_data_dir() . '/' . $progressFile);
  return ['passDone' => true] + $info;
}

function sync_variant_url(int $category, int $page): string {
  return shop_cc_base() . "/variants?category_id=$category&per_page=" . VARIANT_PER_PAGE . "&page=$page";
}
