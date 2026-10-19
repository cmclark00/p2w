<?php
// Offline tests of product links extracted from PriceCharting comparison rows.
declare(strict_types=1);
$source = file_get_contents(__DIR__ . '/../trade-in/api.php');
$start = strpos($source, 'function pc_gamestop_url(');
$end = strpos($source, '// Floor pricing:', $start);
eval(substr($source, $start, $end - $start));
function check(bool $ok, string $why): void { if (!$ok) throw new RuntimeException($why); }
function row(string $url): string { return '<tr data-source-name="GameStop"><td><a data-affiliate="GameStop" href="' . htmlspecialchars($url, ENT_QUOTES) . '">See it</a></td></tr>'; }
$product = 'https://www.gamestop.com/video-games/products/-/930799.html';
$affiliate = 'https://click.linksynergy.com/deeplink?id=example&mid=24348&murl=' . rawurlencode($product);
check(pc_gamestop_url(row($affiliate)) === $product, 'Decode the product destination from the affiliate URL');
check(pc_gamestop_url(row($product . '?tracking=example#offers')) === $product, 'Direct product link; strip tracking');
check(pc_gamestop_url(str_replace('"', "'", row($product))) === $product, 'Single-quoted HTML attributes');
check(pc_gamestop_url(row($product) . row($product)) === $product, 'Repeated condition rows are one product');
check(pc_gamestop_url('<table class="used-prices condition-comparison">' . row($product) . '</table><table class="new-prices">' . row('https://www.gamestop.com/products/new-copy/456.html') . '</table>') === $product, 'Pre-owned reference uses the used comparison table');
check(pc_gamestop_url(row($product) . row('https://www.gamestop.com/products/other/123.html')) === null, 'Conflicting product ids must not select the first');
check(pc_gamestop_url(str_replace('data-source-name="GameStop"', 'data-source-name="Amazon"', row($product))) === null, 'Ignore other retailer rows');
foreach (['https://www.gamestop.com/search/?q=game', 'https://gamestop.com.evil.test/products/game/123.html', 'https://evil.test/products/game/123.html', 'javascript:alert(1)', 'https://user@gamestop.com/products/game/123.html', 'https://gamestop.com:8080/products/game/123.html', 'https://click.linksynergy.com/deeplink?murl[]=x'] as $bad) {
  check(pc_gamestop_url(row($bad)) === null, 'Reject search or invalid destination: ' . $bad);
}
check(pc_gamestop_url('') === null, 'No match remains unavailable');
echo "GameStop product-link extraction checks passed.\n";
