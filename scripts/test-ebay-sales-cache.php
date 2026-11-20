<?php
require __DIR__ . '/../trade-in/ebay-sales-cache.php';

class CacheResponse extends RuntimeException {
  public function __construct(public int $status, string $details = '') { parent::__construct("HTTP $status $details"); }
}
function respond(int $status, array $body): void { throw new CacheResponse($status); }
function fail(int $status, string $message): void { throw new CacheResponse($status, $message); }
function data_path(string $name): string { return $GLOBALS['directory'] . '/' . $name; }
function check(bool $passed, string $reason): void { if (!$passed) throw new RuntimeException($reason); }
function expect_status(int $status, callable $request): void {
  try { $request(); } catch (CacheResponse $response) {
    check($response->status === $status, "Expected HTTP $status, got {$response->getMessage()}");
    return;
  }
  throw new RuntimeException("No response, expected HTTP $status");
}

$directory = sys_get_temp_dir() . '/p2w-ebay-cache-test-' . bin2hex(random_bytes(8));
mkdir($directory, 0700);
try {
  $now = time();
  $key = ['id' => '1234', 'query' => 'WWE 2K20 PS4', 'condition' => 'cib'];
  $file = ebay_sales_cache_file($key);
  check($file !== ebay_sales_cache_file(array_replace($key, ['condition' => 'loose'])), 'Condition isolation');
  check($file !== ebay_sales_cache_file(array_replace($key, ['query' => 'WWE 2K20 Deluxe PS4'])), 'Edition query isolation');
  check($file !== ebay_sales_cache_file(array_replace($key, ['id' => '5678'])), 'Product isolation');
  expect_status(400, fn() => ebay_sales_cache_file(array_replace($key, ['id' => '../secret'])));
  check(ebay_sales_cache_read($file, $now) === null, 'First scan has no entry');
  $sale = ['id' => '100000000001', 'url' => 'https://other.example/', 'title' => 'WWE 2K20 PS4 CIB',
    'date' => gmdate('Y-m-d', $now), 'price' => 3000, 'shipping' => 400, 'conditionText' => 'Pre-Owned',
    'state' => 'sold', 'sellerCountry' => 'United States', 'locationSource' => 'ebay-located-in', 'extra' => 'discarded'];
  $full = ['startedAt' => $now, 'mode' => 'full', 'coverageId' => $sale['id'], 'more' => true, 'sales' => [$sale]];
  expect_status(400, fn() => ebay_sales_cache_write($file, array_replace($full, ['sales' => [$sale, $sale]]), $now));
  expect_status(400, fn() => ebay_sales_cache_write($file, array_replace($full, ['sales' => []]), $now));
  expect_status(200, fn() => ebay_sales_cache_write($file, $full, $now));
  $saved = ebay_sales_cache_read($file, $now);
  check($saved['sales'][0]['url'] === 'https://www.ebay.com/itm/100000000001', 'Canonical item URL');
  check($saved['sales'][0]['shipping'] === 400 && !isset($saved['sales'][0]['extra']), 'Only normalized listing fields persist');
  $later = $now + EBAY_SALES_FRESH_SECONDS + 1;
  $update = array_replace($full, ['startedAt' => $later, 'mode' => 'recent', 'revision' => $saved['revision'],
    'sales' => [$sale, array_replace($sale, ['id' => '100000000002'])]]);
  expect_status(409, fn() => ebay_sales_cache_write($file, array_replace($update, ['more' => false]), $later));
  expect_status(200, fn() => ebay_sales_cache_write($file, $update, $later));
  expect_status(409, fn() => ebay_sales_cache_write($file, $update, $later));
  $updated = ebay_sales_cache_read($file, $later);
  check($updated['fullAt'] === $now && $updated['checkedAt'] === $later, 'Recent checks preserve the ranked search expiry');
  check(count($updated['sales']) === 2, 'New evidence is available to the next register');
  check(ebay_sales_cache_read($file, $now + EBAY_SALES_FULL_SECONDS) === null, 'Periodic ranked refresh becomes due');
  $progressFile = ebay_sales_cache_file($key, true);
  $prefix = array_replace($full, ['coverageId' => null, 'pages' => 5,
    'issues' => [['code' => 'unreadable', 'page' => 2]], 'retriedPages' => [2]]);
  expect_status(400, fn() => ebay_sales_cache_write($file, $prefix, $now));
  expect_status(400, fn() => ebay_sales_cache_write($progressFile, array_replace($prefix, ['retriedPages' => [6]]), $now, true));
  expect_status(200, fn() => ebay_sales_cache_write($progressFile, $prefix, $now, true));
  $progress = ebay_sales_cache_read($progressFile, $now);
  check($progress['pages'] === 5 && $progress['issues'] === $prefix['issues'], 'Progress retains the page offset and warnings');
  expect_status(409, fn() => ebay_sales_cache_write($progressFile, $prefix, $now, true));
  check(ebay_sales_cache_read($progressFile, $now + 300) === null, 'Incomplete pagination expires after five minutes');
  echo "Shared eBay sales cache validation, isolation, revisions and expiry passed.\n";
} finally {
  foreach (['ebay-sales-v1', 'ebay-search-progress-v1'] as $name) {
    foreach (glob(data_path($name) . '/*') ?: [] as $path) unlink($path);
    if (is_dir(data_path($name))) rmdir(data_path($name));
  }
  rmdir($directory);
}
