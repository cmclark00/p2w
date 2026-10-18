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
function check(bool $yes, string $why): void { if (!$yes) throw new RuntimeException($why); }
function response(callable $f): TestResponse { try { $f(); } catch (TestResponse $r) { return $r; } throw new RuntimeException('Expected response'); }
$source = file_get_contents(__DIR__ . '/../trade-in/api.php');
$start = strpos($source, 'function amazon_candidate(');
$end = strpos($source, '// Every save of settings', $start);
eval(substr($source, $start, $end - $start));
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
    amazon_catalog_items(amazon_keys(), '123456789012'); check(count($calls) === 1, 'Catalog cache');
    amazon_catalog_items(amazon_keys(), '', 'Final Fight Super Nintendo');
    check($calls[1][1]['keywords'] === 'Final Fight Super Nintendo' && !isset($calls[1][1]['identifiers']), 'Keyword fallback query');
    check($calls[1][1]['pageSize'] === 20 && $calls[1][1]['includedData'] === 'summaries,attributes', 'Bounded catalog evidence');
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
            'Summary' => ['TotalOfferCount' => 8]]])];
    };
    $offers = response(fn() => amazon_offers('', 'new', 'B000000001'))->payload;
    check($offers['asin'] === 'B000000001' && $offers['url'] === 'https://www.amazon.com/dp/B000000001', 'ASIN and link stay paired');
    check($offers['title'] === $item['summaries'][1]['itemName'] && $offers['platforms'] === ['Super Nintendo'], 'Offer response uses server-fetched catalog evidence');
    check($offers['lowest'] === 3200 && $offers['offers'][1]['price'] === 4500, 'Sort prices including shipping');
    check($offers['count'] === 8 && $offers['condition'] === 'New', 'Preserve count and condition');
    $before = count($calls); response(fn() => amazon_offers('', 'new', 'B000000001')); check(count($calls) === $before, 'Offer cache');
    check(amazon_cache_file(amazon_keys(), 'offers', ['New']) !== amazon_cache_file(amazon_keys(), 'offers', ['Used']), 'Condition isolation');
    check(amazon_cache_file(amazon_keys(), 'catalog', []) !== amazon_cache_file(['refreshToken' => 'other'], 'catalog', []), 'Credential isolation');
    foreach (['catalog', 'offers'] as $route) check((bool)preg_match("/case 'GET amazon\/$route':\s*require_role\('staff'\)/", $source), 'Staff-only route');
    echo "Amazon API offline checks passed.\n";
} finally {
    foreach (glob($folder . '/cache/*') ?: [] as $file) unlink($file);
    if (is_dir($folder . '/cache')) rmdir($folder . '/cache');
    rmdir($folder);
}
