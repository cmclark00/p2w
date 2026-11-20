<?php
// Staff-only cache of normalized search cards. Original item checks still run in the browser.
const EBAY_SALES_FRESH_SECONDS = 300;
const EBAY_SALES_FULL_SECONDS = 86400;
const EBAY_SALES_MAX_ROWS = 1000;
const EBAY_SALES_MAX_BYTES = 1250000;
const EBAY_SALES_MAX_ENTRIES = 500;

function ebay_sales_cache_key(array $params): string {
  $id = $params['id'] ?? '';
  $condition = $params['condition'] ?? '';
  $query = $params['query'] ?? '';
  if (!is_string($id) || !preg_match('/^\d{1,10}$/D', $id)
    || !in_array($condition, ['loose', 'cib', 'new'], true)
    || !is_string($query) || strlen($query) < 3 || strlen($query) > 720
    || !preg_match('/^[^\x00-\x1f\x7f]+$/uD', $query)) {
    fail(400, 'Invalid eBay sales cache key.');
  }
  return hash('sha256', $id . '|' . $condition . '|' . $query);
}

function ebay_sales_cache_file(array $params, bool $progress = false): string {
  return data_path($progress ? 'ebay-search-progress-v1' : 'ebay-sales-v1') . '/' . ebay_sales_cache_key($params) . '.json';
}

function ebay_sales_cache_body(): string {
  $raw = (string)file_get_contents('php://input', false, null, 0, EBAY_SALES_MAX_BYTES + 1);
  if (strlen($raw) > EBAY_SALES_MAX_BYTES) fail(413, 'Shared eBay cache entry is too large.');
  return $raw;
}

function ebay_sales_cache_request(string $method, array $params, bool $progress = false): void {
  $file = ebay_sales_cache_file($params, $progress);
  $now = time();
  if ($method === 'GET') {
    $entry = ebay_sales_cache_read($file, $now);
    respond(200, ['now' => $now, 'fresh' => $entry !== null && $entry['checkedAt'] > $now - EBAY_SALES_FRESH_SECONDS, 'entry' => $entry]);
  }
  $input = json_decode(ebay_sales_cache_body(), true);
  if (!is_array($input)) fail(400, 'Expected a JSON object.');
  ebay_sales_cache_write($file, $input, $now, $progress);
}

function ebay_sales_cache_read(string $file, int $now): ?array {
  $json = @file_get_contents($file, false, null, 0, EBAY_SALES_MAX_BYTES + 1);
  if ($json === false || strlen($json) > EBAY_SALES_MAX_BYTES) return null;
  $entry = json_decode($json, true);
  $ttl = isset($entry['pages']) ? EBAY_SALES_FRESH_SECONDS : EBAY_SALES_FULL_SECONDS;
  return is_array($entry) && ($entry['fullAt'] ?? 0) > $now - $ttl ? $entry : null;
}

function ebay_sales_cache_rows(array $rows): array {
  if (count($rows) > EBAY_SALES_MAX_ROWS) fail(413, 'Too many eBay sales to cache.');
  $sales = [];
  foreach ($rows as $row) {
    if (!is_array($row)) fail(400, 'Invalid eBay sale.');
    $id = $row['id'] ?? '';
    $title = $row['title'] ?? '';
    $price = $row['price'] ?? null;
    $date = $row['date'] ?? '';
    $condition = $row['conditionText'] ?? '';
    $state = $row['state'] ?? '';
    $shipping = $row['shipping'] ?? null;
    $country = $row['sellerCountry'] ?? null;
    if (!is_string($id) || !preg_match('/^\d{9,15}$/D', $id) || isset($sales[$id])
      || !is_string($title) || $title === '' || strlen($title) > 1800
      || !is_int($price) || $price <= 0 || $price >= 100000000
      || !is_string($date) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/D', $date, $d)
      || !checkdate((int)$d[2], (int)$d[3], (int)$d[1])
      || !is_string($condition) || strlen($condition) > 400 || !in_array($state, ['sold', 'offer'], true)
      || ($shipping !== null && (!is_int($shipping) || $shipping < 0))
      || ($country !== null && (!is_string($country) || strlen($country) > 320 || ($row['locationSource'] ?? null) !== 'ebay-located-in'))) {
      fail(400, 'Invalid eBay sale.');
    }
    $sales[$id] = [
      'id' => $id, 'url' => 'https://www.ebay.com/itm/' . $id, 'title' => $title, 'price' => $price,
      'date' => $date, 'conditionText' => $condition, 'state' => $state, 'shipping' => $shipping,
      'sellerCountry' => $country, 'locationSource' => $country !== null ? 'ebay-located-in' : null,
      'source' => 'ebay-search',
    ];
  }
  return $sales;
}

function ebay_search_progress_fields(array $input): array {
  $pages = $input['pages'] ?? null;
  $issues = $input['issues'] ?? null;
  $retried = $input['retriedPages'] ?? null;
  if (!is_int($pages) || $pages < 1 || $pages >= 50 || !is_array($issues) || count($issues) > 150
    || !is_array($retried) || count($retried) > $pages || empty($input['sales'])) fail(400, 'Invalid ranked search progress.');
  $warnings = [];
  foreach ($issues as $issue) {
    $page = $issue['page'] ?? null;
    $code = $issue['code'] ?? null;
    if (!in_array($code, ['unreadable', 'unspecified', 'page-failed', 'page-unverified', 'helper'], true)
      || !is_int($page) || $page < 1 || $page > $pages) fail(400, 'Invalid ranked page warning.');
    $warnings[] = ['page' => $page, 'code' => $code];
  }
  foreach ($retried as $page) {
    if (!is_int($page) || $page < 1 || $page > $pages) fail(400, 'Invalid ranked page retry.');
  }
  return ['pages' => $pages, 'issues' => $warnings, 'retriedPages' => array_values($retried)];
}

function ebay_sales_cache_write(string $file, array $input, int $now, bool $progress = false): void {
  $startedAt = $input['startedAt'] ?? null;
  $mode = $input['mode'] ?? '';
  $revision = $input['revision'] ?? null;
  $coverageId = $input['coverageId'] ?? null;
  $more = $input['more'] ?? null;
  if (!is_int($startedAt) || $startedAt < $now - 600 || $startedAt > $now
    || !in_array($mode, ['full', 'recent'], true) || !is_array($input['sales'] ?? null)
    || ($revision !== null && (!is_string($revision) || !preg_match('/^[a-f0-9]{24}$/D', $revision)))
    || ($coverageId !== null && (!is_string($coverageId) || !preg_match('/^\d{9,15}$/D', $coverageId)))
    || !is_bool($more) || ($progress ? ($mode !== 'full' || !$more || $coverageId !== null
      || $startedAt <= $now - EBAY_SALES_FRESH_SECONDS) : ($more && $coverageId === null))) {
    fail(400, 'Invalid eBay sales cache update.');
  }
  $sales = ebay_sales_cache_rows($input['sales']);
  $progressFields = $progress ? ebay_search_progress_fields($input) : [];
  if ($coverageId !== null && ($sales[$coverageId]['state'] ?? null) !== 'sold') fail(400, 'Missing eBay sale used for search coverage.');

  $dir = dirname($file);
  if (!is_dir($dir) && !@mkdir($dir, 0700) && !is_dir($dir)) fail(503, 'Shared eBay cache unavailable.');
  $lock = @fopen($dir . '/write.lock', 'c');
  if (!$lock) fail(503, 'Shared eBay cache busy.');
  if (!flock($lock, LOCK_EX | LOCK_NB)) {
    fclose($lock);
    fail(503, 'Shared eBay cache busy.');
  }
  try {
    // Compare against the version read before searching. Slow scans cannot overwrite newer evidence.
    $previous = ebay_sales_cache_read($file, $now);
    if (($previous['revision'] ?? null) !== $revision || $startedAt < ($previous['checkedAt'] ?? 0)
      || ($mode === 'recent' && (!$previous || $more !== $previous['more'] || $coverageId !== $previous['coverageId']))) {
      fail(409, 'Shared eBay cache changed during the search.');
    }
    $entry = [
      'revision' => bin2hex(random_bytes(12)),
      'checkedAt' => $startedAt,
      'fullAt' => $mode === 'full' ? $startedAt : $previous['fullAt'],
      'coverageId' => $coverageId, 'more' => $more, 'sales' => array_values($sales),
    ] + $progressFields;
    $json = json_encode($entry, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($json === false || strlen($json) > EBAY_SALES_MAX_BYTES) fail(413, 'Shared eBay cache entry is too large.');
    $temp = $file . '.tmp';
    if (@file_put_contents($temp, $json) !== strlen($json) || !@rename($temp, $file)) {
      @unlink($temp);
      fail(503, 'Could not write shared eBay cache.');
    }

    $files = glob($dir . '/*.json') ?: [];
    if (count($files) > EBAY_SALES_MAX_ENTRIES || mt_rand(1, 50) === 1) {
      $times = [];
      foreach ($files as $path) {
        if ($path === $file) continue;
        $mtime = (int)@filemtime($path);
        if ($mtime < $now - ($progress ? EBAY_SALES_FRESH_SECONDS : EBAY_SALES_FULL_SECONDS)) @unlink($path);
        else $times[$path] = $mtime;
      }
      asort($times);
      foreach (array_slice(array_keys($times), 0, max(0, count($times) + 1 - EBAY_SALES_MAX_ENTRIES)) as $path) @unlink($path);
    }
  } finally {
    fclose($lock);
  }
  respond(200, ['ok' => true]);
}
