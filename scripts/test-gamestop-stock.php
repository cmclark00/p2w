<?php
declare(strict_types=1);
require __DIR__ . '/../trade-in/gamestop-stock.php';
function check(bool $ok, string $why): void { if (!$ok) throw new RuntimeException($why); }
// Shape observed on GameStop's matching pre-owned product page. No network/cart calls.
function fixture(string $availability, bool $disabled, string $label, string $condition = 'Pre-Owned', string $sku = '930799', bool $shippingDisabled = false): string {
  $data = htmlspecialchars(json_encode(['productInfo' => ['sku' => $sku, 'name' => 'Lollipop Chainsaw - PlayStation 3', 'condition' => $condition, 'availability' => $availability]]), ENT_QUOTES);
  return '<button class="js-add-to-cart" data-pid="930799" data-gtmdata="' . $data . '"' . ($disabled ? ' disabled' : '') . '>' . $label . '</button>'
    . '<button data-optionvalue="ship"' . ($shippingDisabled ? ' disabled' : '') . '>Ship to Home ' . ($shippingDisabled ? 'Not Available' : 'In Stock') . '</button>';
}
$out = fixture('Not Available', true, 'Not Available', 'Pre-Owned', '930799', true);
$in = fixture('In Stock', false, 'Add to Cart');
check(gs_stock_parse($out, '930799')['state'] === 'out', 'Confirmed disabled pre-owned cart and shipping');
check(gs_stock_parse($in, '930799')['state'] === 'in', 'Enabled matching cart and shipping');
check(gs_stock_parse($in . $in, '930799')['state'] === 'in', 'Repeated responsive buttons agree');
foreach ([$in . $out, fixture('In Stock', false, 'Pre-order'), fixture('In Stock', false, 'Add to Cart', 'New'),
  fixture('In Stock', false, 'Add to Cart', 'Pre-Owned', '123'), fixture('In Stock', true, 'Add to Cart'),
  fixture('Not Available', false, 'Not Available'), fixture('In Stock', false, 'Add to Cart', 'Pre-Owned', '930799', true),
  '<button disabled>Not Available</button>', '<h1>Access denied</h1>', '', str_replace('data-optionvalue="ship"', 'data-optionvalue="pickup"', $in)] as $ambiguous) {
  check(gs_stock_parse($ambiguous, '930799')['state'] === 'unknown', 'Ambiguous, blocked, preorder, other condition or local-only evidence stays unknown');
}
$url = 'https://www.gamestop.com/products/lollipop-chainsaw---playstation-3/930799.html';
foreach (['https://evil.test/products/game/930799.html', 'https://www.gamestop.com.evil.test/products/game/930799.html', 'http://gamestop.com/products/game/930799.html', 'https://user@gamestop.com/products/game/930799.html', 'https://gamestop.com:8443/products/game/930799.html', 'https://www.gamestop.com/search/?q=game'] as $bad) check(gs_stock_url($bad) === null, 'Reject unsafe/non-product URL');
check(gs_stock_url($url . '?tracking=x')['url'] === $url, 'Strip query data');
check(gs_stock_fetch($url, fn() => [200, $out, null])['state'] === 'out', 'Parse readable public product');
foreach ([0, 403, 404, 429, 500] as $status) check(gs_stock_fetch($url, fn() => [$status, $out, null])['state'] === 'unknown', 'HTTP failures never mean sold out');
$calls = 0;
$result = gs_stock_fetch($url, function () use (&$calls, $in) { return ++$calls === 1 ? [302, '', '/products/game/930799.html'] : [200, $in, null]; });
check($result['state'] === 'in' && $calls === 2, 'Follow same-product canonical redirect');
foreach (['https://evil.test/products/game/930799.html', 'https://www.gamestop.com/products/game/123.html', '//evil.test/products/game/930799.html'] as $bad) {
  $calls = 0;
  check(gs_stock_fetch($url, function () use (&$calls, $bad) { $calls++; return [302, '', $bad]; })['state'] === 'unknown' && $calls === 1, 'Do not follow untrusted/different-product redirects');
}
echo "GameStop stock parsing and request boundary checks passed.\n";
