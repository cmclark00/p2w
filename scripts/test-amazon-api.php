<?php
// Offline boundary tests of the production Amazon helpers; credentials/network are stubbed.
declare(strict_types=1);
const AMZ_MARKETPLACE = 'ATVPDKIKX0DER';
const AMZ_CACHE_SECONDS = 21600;
class TestResponse extends Exception {
    public int $status; public array $payload;
    public function __construct(int $status, array $payload) { parent::__construct(); $this->status = $status; $this->payload = $payload; }
}
function respond(int $status, $data): void { throw new TestResponse($status, $data); }
function respond_raw(int $status, string $json): void { respond($status, json_decode($json, true)); }
function fail(int $status, string $message): void { respond($status, ['error' => $message]); }
function cut_text(string $s, int $n): string { return substr($s, 0, $n); }
function amazon_keys(): array { return ['refreshToken' => 'offline-fixture', 'sandbox' => false]; }
function amazon_error(int $status, string $body): string { return "Amazon HTTP $status"; }
$folder = sys_get_temp_dir() . '/p2w-amazon-test-' . bin2hex(random_bytes(8));
mkdir($folder, 0700);
function data_path(string $name): string { return $GLOBALS['folder'] . '/' . $name; }
$calls = []; $fake = null;
function amazon_get(array $keys, string $path, array $query): array {
    $GLOBALS['calls'][] = [$path, $query];
    return ($GLOBALS['fake'])($path, $query);
}
function amazon_post(array $keys, string $path, array $body): array {
    $GLOBALS['calls'][] = [$path, $body];
    return ($GLOBALS['fakePost'])($path, $body);
}
function check(bool $yes, string $why): void { if (!$yes) throw new RuntimeException($why); }
function response(callable $f): TestResponse { try { $f(); } catch (TestResponse $r) { return $r; } throw new RuntimeException('Expected response'); }
$source = file_get_contents(__DIR__ . '/../trade-in/api.php');
$start = strpos($source, 'function amazon_candidate(');
$end = strpos($source, '// Every save of settings', $start);
eval(str_replace('__DIR__', var_export(dirname(__DIR__) . '/trade-in', true), substr($source, $start, $end - $start)));
try {
    $item = ['asin' => 'B000000001', 'summaries' => [
        ['marketplaceId' => 'OTHER', 'itemName' => 'Wrong marketplace title'],
        ['marketplaceId' => AMZ_MARKETPLACE, 'itemName' => 'Final Fight - Super Nintendo']],
        'attributes' => ['platform' => [['value' => 'Super Nintendo', 'marketplace_id' => AMZ_MARKETPLACE], ['value' => 'Other platform', 'marketplace_id' => 'OTHER']]]];
    $fake = fn($path, $query) => [200, json_encode(['items' => [$item, array_merge($item, ['asin' => 'B000000002'])], 'pagination' => ['nextToken' => 'more']])];
    $catalog = amazon_catalog_items(amazon_keys(), '123456789012');
    check(count($catalog['candidates']) === 2, 'Keep all UPC candidates');
    check($catalog['candidates'][0]['title'] === 'Final Fight - Super Nintendo', 'Use US summary');
    check($catalog['candidates'][0]['platforms'] === ['Super Nintendo'], 'Keep US structured platform');
    check($calls[0][1]['identifiersType'] === 'UPC' && !isset($calls[0][1]['keywords']), 'Identifier query');
    check($catalog['more'] === true, 'Preserve truncated-search indicator');
    check($catalog['nextToken'] === 'more', 'Return pagination token');
    amazon_catalog_items(amazon_keys(), '123456789012'); check(count($calls) === 1, 'Catalog cache');
    amazon_catalog_items(amazon_keys(), '', 'Final Fight Super Nintendo');
    check($calls[1][1]['keywords'] === 'Final Fight Super Nintendo' && !isset($calls[1][1]['identifiers']), 'Keyword fallback query');
    check($calls[1][1]['pageSize'] === 20 && $calls[1][1]['includedData'] === 'summaries,attributes', 'Bounded catalog evidence');
    amazon_catalog_items(amazon_keys(), '', 'Final Fight Super Nintendo', '', 'more');
    check($calls[2][1]['pageToken'] === 'more' && $calls[2][1]['pageSize'] === 20, 'Forward next token without changing page size');
    $pageCalls = count($calls);
    amazon_catalog_items(amazon_keys(), '', 'Final Fight Super Nintendo', '', 'more');
    check(count($calls) === $pageCalls, 'Cache pages separately');
    foreach ([str_repeat('x', 2049), "bad\ntoken"] as $token) {
        check(response(fn() => amazon_catalog_items(amazon_keys(), '', 'Final Fight Super Nintendo', '', $token))->status === 400, 'Reject malformed page tokens');
    }
    foreach ([['bad', '', ''], ['123456789012', 'search', ''], ['', '', '../secret'], ['', '', ''], ['', str_repeat('x', 241), '']] as $args) {
        check(response(fn() => amazon_catalog_items(amazon_keys(), ...$args))->status === 400, 'Reject malformed lookup parameters');
    }
    $fake = function($path, $query) use ($item) {
        if (str_contains($path, '/catalog/')) return [200, json_encode($item)];
        check(str_contains($path, '/B000000001/offers'), 'Offer identity');
        check($query['ItemCondition'] === 'New', 'Keep new condition');
        return [200, json_encode(['payload' => ['Offers' => [
            ['ListingPrice' => ['Amount' => 40], 'Shipping' => ['Amount' => 5]],
            ['ListingPrice' => ['Amount' => 30], 'Shipping' => ['Amount' => 2], 'SubCondition' => 'new', 'IsFulfilledByAmazon' => true]],
            'Summary' => ['TotalOfferCount' => 8, 'ListPrice' => ['CurrencyCode' => 'USD', 'Amount' => 59.99]]]])];
    };
    $offers = response(fn() => amazon_offers('', 'new', 'B000000001'))->payload;
    check($offers['asin'] === 'B000000001' && $offers['url'] === 'https://www.amazon.com/dp/B000000001', 'ASIN and link stay paired');
    check($offers['title'] === $item['summaries'][1]['itemName'] && $offers['platforms'] === ['Super Nintendo'], 'Offer response uses server-fetched catalog evidence');
    check($offers['lowest'] === 3200 && $offers['offers'][1]['price'] === 4500, 'Sort prices including shipping');
    check($offers['count'] === 8 && $offers['condition'] === 'New', 'Preserve count and condition');
    check($offers['msrp'] === 5999 && $offers['msrpSource'] === 'amazon-list-price', 'MSRP is manufacturer ListPrice, not lowest offer');
    foreach ([[], ['CurrencyCode'=>'EUR','Amount'=>59.99], ['CurrencyCode'=>'USD','Amount'=>0], ['CurrencyCode'=>'USD','Amount'=>'invalid']] as $list) {
        $out = amazon_offer_output(amazon_candidate($item), 'New', ['Summary'=>['ListPrice'=>$list], 'Offers'=>[['ListingPrice'=>['Amount'=>59.99]]]]);
        check($out['msrp'] === null && $out['msrpSource'] === null, 'Never infer MSRP from seller prices or other currencies');
    }
    $before = count($calls); response(fn() => amazon_offers('', 'new', 'B000000001')); check(count($calls) === $before, 'Offer cache');
    check(amazon_cache_file(amazon_keys(), 'offers', ['New']) !== amazon_cache_file(amazon_keys(), 'offers', ['Used']), 'Condition isolation');
    check(amazon_cache_file(amazon_keys(), 'catalog', []) !== amazon_cache_file(['refreshToken' => 'other'], 'catalog', []), 'Credential isolation');
    foreach (['catalog', 'offers'] as $route) check((bool)preg_match("/case 'GET amazon\/$route':\s*require_role\('staff'\)/", $source), 'Staff-only route');
    check((bool)preg_match("/case 'POST amazon\\/offers-batch':\\s*require_role\\('staff'\\)/", $source), 'Batch route is staff-only');
    foreach ([[], array_fill(0, 21, ['asin' => 'B000000001', 'cond' => 'used']), [['asin' => '../secret', 'cond' => 'used']], [['asin' => 'B000000001', 'cond' => 'bad']]] as $bad) {
        check(response(fn() => amazon_offers_batch($bad))->status === 400, 'Reject malformed batches');
    }
    $requests = [];
    for ($i = 10; $i < 16; $i++) $requests[] = ['asin' => 'B' . str_pad((string)$i, 9, '0', STR_PAD_LEFT), 'cond' => 'used'];
    $fake = function ($path, $query) use ($item) {
        if (str_contains($path, '/catalog/')) return [200, json_encode(array_merge($item, ['asin' => basename($path)]))];
        return [200, json_encode(['payload' => ['Offers' => [['ListingPrice' => ['Amount' => 20], 'Shipping' => ['Amount' => 2], 'SubCondition' => 'very_good']]]])];
    };
    $fakePost = function ($path, $body) {
        check($path === '/batches/products/pricing/v0/itemOffers', 'Official batch endpoint');
        check(count($body['requests']) === 6, 'Use batch for six uncached members');
        $responses = [];
        foreach ($body['requests'] as $i => $r) {
            preg_match('#/items/([^/]+)/offers#', $r['uri'], $m); $asin = $m[1];
            $response = ['request' => ['Asin' => $asin, 'ItemCondition' => $r['ItemCondition'], 'MarketplaceId' => AMZ_MARKETPLACE],
                'status' => ['statusCode' => 200], 'body' => ['payload' => ['ASIN' => $asin, 'ItemCondition' => 'Used', 'Summary'=>['ListPrice'=>['CurrencyCode'=>'USD','Amount'=>69.99]],
                    'Offers' => [['ListingPrice' => ['Amount' => 20 + $i], 'Shipping' => ['Amount' => 2], 'SubCondition' => 'very_good']]]]];
            if ($i === 1) { $response['status']['statusCode'] = 429; $response['headers'] = ['Retry-After' => '60']; }
            if ($i === 2) $response['body']['payload']['ASIN'] = 'B999999999';
            if ($i === 3) continue; // Missing member cannot become an empty success.
            if ($i === 4) $responses[] = $response; // Duplicate member is ambiguous.
            $responses[] = $response;
        }
        return [200, json_encode(['responses' => array_reverse($responses)])];
    };
    $batch = response(fn() => amazon_offers_batch($requests))->payload['results'];
    check($batch['B000000010:used']['data']['msrp'] === 6999, 'Batch preserves manufacturer MSRP');
    check($batch['B000000010:used']['data']['lowest'] === 2200, 'Batch includes shipping and preserves subcondition');
    check($batch['B000000010:used']['data']['offers'][0]['sub'] === 'very_good', 'Batch grade survives');
    check($batch['B000000015:used']['data']['lowest'] === 2700, 'Reordered response maps by identity, not index');
    foreach ([11, 12, 13, 14] as $i) check(isset($batch['B0000000' . $i . ':used']['error']), 'Failed, mismatched, missing and duplicate members stay incomplete');
    $state = json_decode(file_get_contents(data_path('amazon-throttle.lock')), true);
    check($state['cooldown'] > microtime(true) + 50, 'Member 429 preserves shared cooldown even when envelope is HTTP 200');
    $before = count($calls);
    response(fn() => amazon_offers('', 'used', 'B000000010'));
    response(fn() => amazon_offers_batch([$requests[0], $requests[5]]));
    check(count($calls) === $before, 'Batch and individual endpoints share successful cache entries');
    $retry = response(fn() => amazon_offers_batch([$requests[1]]))->payload['results'];
    check($retry['B000000011:used']['data']['lowest'] === 2200, 'Failed members are retried using singles for a small remaining group');
    $fakePost = fn() => [403, '{}'];
    $fresh = array_map(fn($r) => ['asin' => str_replace('B0000000', 'B0000001', $r['asin']), 'cond' => 'new'], $requests);
    $fallback = response(fn() => amazon_offers_batch($fresh))->payload['results'];
    check(count(array_filter($fallback, fn($r) => isset($r['data']))) === 6, 'Unsupported batch permission retains individual offer checks');
    echo "Amazon API offline checks and batch identity, cache, partial failure and fallback checks passed.\n";
} finally {
    foreach (glob($folder . '/cache/*') ?: [] as $file) unlink($file);
    if (is_dir($folder . '/cache')) rmdir($folder . '/cache');
    foreach (glob($folder . '/*') ?: [] as $file) unlink($file);
    rmdir($folder);
}
