<?php
declare(strict_types=1);
// Offline regression suite: production persistence/locks/recovery, fake payment/inventory adapters.
// No network, real credentials, customer emails, or production data.
$testDir = sys_get_temp_dir() . '/p2w-checkout-test-' . bin2hex(random_bytes(6));
putenv('P2W_SHOP_DATA=' . $testDir);
require __DIR__ . '/../shop/lib.php';
require __DIR__ . '/../shop/kiosk.php';
require __DIR__ . '/../shop/orders.php';

function load_functions(string $file, array $names): void {
  $tokens = token_get_all(file_get_contents($file));
  foreach ($tokens as $i => $token) {
    if (!is_array($token) || $token[0] !== T_FUNCTION) continue;
    $j = $i + 1;
    while (is_array($tokens[$j]) && $tokens[$j][0] === T_WHITESPACE) $j++;
    if (!is_array($tokens[$j]) || !in_array($tokens[$j][1], $names, true)) continue;
    $code = ''; $depth = 0; $opened = false;
    for ($k = $i; $k < count($tokens); $k++) {
      $t = $tokens[$k]; $code .= is_array($t) ? $t[1] : $t;
      if ($t === '{' || (is_array($t) && $t[0] === T_CURLY_OPEN)) { $depth++; $opened = true; }
      if ($t === '}' && --$depth === 0 && $opened) break;
    }
    eval($code);
  }
}
load_functions(__DIR__ . '/../shop/checkout.php', ['web_orders_update', 'web_find_order', 'web_order_set', 'web_config_problem']);
load_functions(__DIR__ . '/../shop/sync.php', ['sync_match']);
const SHOP_PREVIEW = true;
const WEB_EMPLOYEE = 'WEBSITE - PAID ONLINE';
function web_cfg(): array { return $GLOBALS['config']; }
function web_gate_on(): bool { return web_cfg()['password'] !== ''; }
function web_check_cart(): array { return $GLOBALS['cartCheck']; }
function web_secret(): string { return str_repeat('s', 64); }
function web_cart_token(): string { return 'fixture-cart'; }
function web_order_url(array $o): string { return '/shop/order/' . $o['num']; }
function web_mail_confirmation(array $o): bool { $GLOBALS['emails']++; return $GLOBALS['mailOK']; }
function pp_api(string $method, string $path, $body = null, array $headers = []): array { return ($GLOBALS['paypal'])($method, $path, $body, $headers); }
// shop_cc is provided by lib.php; use the real web_cc_order payload builder with an extracted adapter name.
// Replace only its boundary call, so the suite cannot make outbound HTTP.
$source = file_get_contents(__DIR__ . '/../shop/checkout.php');
$start = strpos($source, 'function web_cc_order('); $end = strpos($source, '/* ================================================================== email', $start);
$code = str_replace(['function web_cc_order(', 'shop_cc('], ['function test_cc_payload(', 'fake_cc('], substr($source, $start, $end - $start));
eval($code);
function fake_cc(string $method, string $path, string $scope, $body = null): array { return ($GLOBALS['cc'])($method, $path, $body); }
// Recovery calls shop_cc directly for verification; provide a production-equivalent isolated engine namespace.
// Its persistence and lock calls remain the real functions, while API calls are redirected to fakes.
$engine = file_get_contents(__DIR__ . '/../shop/orders.php');
$engine = str_replace(['<?php', 'declare(strict_types=1);', 'web_cc_order(', 'shop_cc('], ['', '', 'test_cc_payload(', 'fake_cc('], $engine);
$engine = preg_replace('/\b(web_[a-z_]+)\s*\(/', 'test_$1(', $engine);
// All web helpers present only in checkout stay as real production functions through namespace aliases.
foreach (['web_find_order','web_orders_update','web_order_set','web_cfg','web_config_problem','web_gate_on','web_check_cart','web_secret','web_cart_token','web_order_url','web_mail_confirmation'] as $name) $engine = str_replace('test_' . $name . '(', $name . '(', $engine);
eval($engine);

$count = 0;
function check(bool $value, string $message): void { if (!$value) throw new RuntimeException($message); $GLOBALS['count']++; }
function setup(): array {
  $GLOBALS['config'] = ['ppLive' => false, 'ordersLive' => false, 'password' => 'preview', 'customer' => 'TEST'];
  $GLOBALS['mailOK'] = true; $GLOBALS['emails'] = 0;
  $GLOBALS['captureCalls'] = $GLOBALS['ccCreates'] = $GLOBALS['refundCalls'] = 0;
  $o = ['ref' => 'W1001', 'num' => 'W1001', 'pp' => 'PP1', 'version' => 2, 'status' => 'pending', 'test' => true, 'paypal' => 'sandbox', 'name' => 'Fixture', 'email' => 'audit@example.invalid', 'phone' => '', 'total' => 109, 'tax' => 9,
    'items' => [['variant' => 42, 'qty' => 1, 'cents' => 100, 'name' => 'Card', 'cond' => 'Near Mint', 'detail' => '']]];
  shop_write_json('shop-orders.json', ['seq' => 1001, 'orders' => [$o]]);
  $GLOBALS['cartCheck'] = ['items' => $o['items']];
  $GLOBALS['cap'] = ['id' => 'CAP1', 'status' => 'COMPLETED', 'amount' => ['currency_code' => 'USD', 'value' => '1.09']];
  $GLOBALS['paypal'] = function ($method, $path) {
    if (str_ends_with($path, '/capture')) $GLOBALS['captureCalls']++;
    return [200, ['status' => 'COMPLETED', 'purchase_units' => [['payments' => ['captures' => [$GLOBALS['cap']]]]]]];
  };
  $GLOBALS['cc'] = function ($method, $path, $body) {
    if ($method === 'POST') { $GLOBALS['ccCreates']++; check(($body['order']['status'] ?? '') === 'Preorder', 'CC must reserve as Preorder'); }
    return [200, ['order' => ['id' => 9001, 'status' => 'Preorder']], ''];
  };
  return $o;
}
function live_inventory(): void { $GLOBALS['config']['ordersLive'] = true; putenv('SHOP_SANDBOX_CC_TEST=1'); putenv('SHOP_TEST_VARIANTS=42'); web_order_set('W1001', ['test' => false]); }
try {
  setup(); $r = test_web_process_order('W1001', true); check(isset($r['redirect']), 'Happy path');
  test_web_process_order('W1001', true); check($GLOBALS['captureCalls'] === 1 && $GLOBALS['emails'] === 1, 'Repeat must not capture or email twice');
  setup(); live_inventory();
  $GLOBALS['paypal'] = function ($m, $p) {
    if ($m === 'POST') { $GLOBALS['captureCalls']++; $r = test_web_process_order('W1001', true); check(!empty($r['pending']), 'Overlapping request must stop at lock'); }
    return [200, ['purchase_units' => [['payments' => ['captures' => [$GLOBALS['cap']]]]]]];
  };
  test_web_process_order('W1001', true); check($GLOBALS['captureCalls'] === 1 && $GLOBALS['ccCreates'] === 1, 'Concurrent requests must create one payment and one CC order');
  setup(); $GLOBALS['paypal'] = function ($m, $p) { if ($m === 'POST') { $GLOBALS['captureCalls']++; return [0, null]; } return [200, ['purchase_units' => [['payments' => ['captures' => [$GLOBALS['cap']]]]]]]; };
  $r = test_web_process_order('W1001', true); check(!empty($r['pending']) && web_order_get('W1001')['status'] === 'capture-unknown', 'Timeout must remain unknown');
  $GLOBALS['cartCheck'] = ['problems' => ['Cart changed']]; test_web_process_order('W1001', true);
  check(web_order_get('W1001')['status'] === 'paid' && $GLOBALS['captureCalls'] === 1, 'Recovery must ignore changed cart and not recapture');
  setup(); $GLOBALS['cap']['amount']['value'] = '8.00';
  $GLOBALS['paypal'] = function ($m, $p) { if (str_ends_with($p, '/refund')) { $GLOBALS['refundCalls']++; return [500, null]; } return [200, ['purchase_units' => [['payments' => ['captures' => [$GLOBALS['cap']]]]]]]; };
  test_web_process_order('W1001', true); check(web_order_get('W1001')['status'] === 'refund-unknown', 'Failed refund must not be reported refunded');
  test_web_process_order('W1001'); check($GLOBALS['refundCalls'] === 1, 'Unknown refund without ID must not be blindly retried');
  setup(); $GLOBALS['cap']['amount']['value'] = '8.00';
  $GLOBALS['paypal'] = function ($m, $p) { if (str_ends_with($p, '/refund')) return [201, ['id' => 'R1', 'status' => 'PENDING']]; if (str_contains($p, '/refunds/')) return [200, ['id' => 'R1', 'status' => 'COMPLETED']]; return [200, ['purchase_units' => [['payments' => ['captures' => [$GLOBALS['cap']]]]]]]; };
  test_web_process_order('W1001', true); check(web_order_get('W1001')['status'] === 'refund-pending', 'Pending refund must stay pending');
  test_web_process_order('W1001'); check(web_order_get('W1001')['status'] === 'refunded', 'Refund GET can confirm completion');
  setup(); live_inventory(); $GLOBALS['cc'] = function ($m, $p, $b) { if ($m === 'POST') { $GLOBALS['ccCreates']++; return [201, ['order' => ['id' => 9001]], '']; } return [503, null, '']; };
  test_web_process_order('W1001', true); check(web_order_get('W1001')['ccId'] === 9001 && web_order_get('W1001')['status'] === 'cc-unknown', 'Readback failure must preserve CC id');
  test_web_process_order('W1001'); check($GLOBALS['ccCreates'] === 1 && $GLOBALS['refundCalls'] === 0, 'Uncertain CC order must not be recreated or refunded');
  setup(); live_inventory(); $GLOBALS['cc'] = function ($m, $p, $b) { $GLOBALS['ccCreates']++; return [0, null, '']; };
  test_web_process_order('W1001', true); test_web_process_order('W1001'); check($GLOBALS['ccCreates'] === 1 && web_order_get('W1001')['status'] === 'cc-unknown', 'Lost CC POST response must not cause duplicate');
  setup(); $GLOBALS['mailOK'] = false; test_web_process_order('W1001', true); check(web_order_get('W1001')['mailStatus'] === 'failed', 'SMTP false must remain visible');
  web_order_set('W1001', ['mailAttemptAt' => 0]); $GLOBALS['mailOK'] = true; test_web_process_order('W1001'); check(web_order_get('W1001')['mailStatus'] === 'sent', 'Receipt retry');
  setup(); web_orders_update(function (&$d) { for ($i=0; $i<2100; $i++) $d['orders'][] = ['ref'=>'new'.$i]; }); check(web_find_order(fn($o)=>$o['ref']==='W1001') !== null, 'More than 2000 records must retain original order');
  check(sync_match(['c'=>'Near Mint','dkey'=>'english','p'=>100], [[42,'Damaged','japanese',100]]) === null, 'Conflicting variant must not match');
  check(sync_match(['c'=>'Near Mint','dkey'=>'english','p'=>100], [[42,'Near Mint','english',100]]) === [42,false], 'Exact variant must match');
  check(sync_match(['c'=>'Near Mint','dkey'=>'','p'=>100], [[42,'Near Mint','',100],[43,'Near Mint','',100]]) === null, 'Ambiguous variants must not match');
  setup(); $GLOBALS['config']['ppLive'] = true; check(web_config_problem() !== null, 'Real payments plus fake inventory must be refused');
  setup(); $GLOBALS['config']['ordersLive'] = true; putenv('SHOP_SANDBOX_CC_TEST'); check(web_config_problem() !== null, 'Sandbox real inventory needs explicit override');
  setup(); test_web_process_order('W1001'); check($GLOBALS['captureCalls'] === 0, 'Worker must not capture a merely created order');
  setup(); $GLOBALS['cartCheck'] = ['problems' => ['Sold out']]; test_web_process_order('W1001', true);
  check($GLOBALS['captureCalls'] === 0 && web_order_get('W1001')['status'] === 'abandoned', 'Changed stock must stop before capture');
  setup(); $GLOBALS['paypal'] = function ($m,$p) { $GLOBALS['captureCalls']++; return [422,['details'=>[['issue'=>'INSTRUMENT_DECLINED']]]]; };
  $r=test_web_process_order('W1001',true); check(!empty($r['retry']) && web_order_get('W1001')['status']==='pending', 'Explicit decline permits another method');
  setup(); live_inventory(); $GLOBALS['cc'] = function($m,$p,$b){ if($m==='POST'){$GLOBALS['ccCreates']++; return [422,['error'=>'invalid_resource'],''];} throw new RuntimeException('No CC readback after validation rejection'); };
  $GLOBALS['paypal'] = function($m,$p){ if(str_ends_with($p,'/refund')){$GLOBALS['refundCalls']++;return [201,['id'=>'R2','status'=>'COMPLETED']];}return [200,['purchase_units'=>[['payments'=>['captures'=>[$GLOBALS['cap']]]]]]]; };
  test_web_process_order('W1001',true); check(web_order_get('W1001')['status']==='refunded' && $GLOBALS['refundCalls']===1,'Explicit CC rejection can safely refund');
  setup(); $GLOBALS['cap']['amount']['currency_code']='EUR';
  $GLOBALS['paypal']=function($m,$p){if(str_ends_with($p,'/refund'))return [201,['id'=>'R3','status'=>'COMPLETED']];return [200,['purchase_units'=>[['payments'=>['captures'=>[$GLOBALS['cap']]]]]]];};
  test_web_process_order('W1001',true); check(web_order_get('W1001')['status']==='refunded','Wrong currency cannot fulfill');
  check(shop_variant_identity(['descriptors'=>[['variant_descriptor'=>['name'=>'condition','value'=>'NM']],['name'=>'Language','value'=>'English']]] )===['Near Mint','english','English'],'Live variant identity normalizes aliases');
  $key=shop_private_key('test-stable');check($key===shop_private_key('test-stable'),'Signing key survives repeated reads');
  shop_write_json('atomic.json',['ok'=>true]);
  try{shop_write_json('atomic.json',['invalid'=>"\xB1\x31"]);}catch(JsonException $e){}
  check(shop_read_json('atomic.json')===['ok'=>true],'Invalid JSON cannot overwrite existing storage');
  $_COOKIE[KIOSK_CART_COOKIE]='local-cart-revision';
  $cartHash=hash('sha256',$_COOKIE[KIOSK_CART_COOKIE]);
  $oldToken=str_repeat('a',32);
  shop_write_json('kiosk-orders.json',['seq'=>1,'orders'=>[['num'=>'T1','status'=>'open','token'=>$oldToken]]]);
  shop_write_json('kiosk-cart-attempt-'.$cartHash.'.json',['token'=>$oldToken]);
  $k=kiosk_place_order('Fixture',str_repeat('b',32));
  check(($k['order']['num']??'')==='T1','New kiosk form token for same cart must recover the original order');
  shop_write_json('kiosk-orders.json',['seq'=>1,'orders'=>[]]);
  $k=kiosk_place_order('Fixture',str_repeat('c',32));
  check(!empty($k['problems']),'Interrupted kiosk cart must not start another order');
  $cartLock=shop_lock('kiosk-cart-order',$cartHash);
  $k=kiosk_place_order('Fixture',str_repeat('d',32));
  shop_unlock($cartLock);
  check(!empty($k['problems']),'Overlapping kiosk carts must stop at the cart lock');
  putenv('KIOSK_KEY=local-kiosk-signing-key-only');
  kiosk_cart_save([43=>['q'=>1,'p'=>100]]);$first=$_COOKIE[KIOSK_CART_COOKIE];
  kiosk_cart_save([43=>['q'=>1,'p'=>100]]);
  check($first!==$_COOKIE[KIOSK_CART_COOKIE],'A new kiosk cart intent must get a unique revision');
  file_put_contents(shop_data_dir().'/shop-orders.json','{broken');
  $refused=false;
  try{web_orders_update(function(&$d){$d['seq']=1;});}catch(RuntimeException $e){$refused=true;}
  check($refused && file_get_contents(shop_data_dir().'/shop-orders.json')==='{broken','Corrupt ledger must fail closed instead of resetting history');
  check(!shop_service_allowed() || PHP_SAPI === 'cli', 'CLI service entry supported');
  echo "Shop checkout regression checks passed ($count assertions).\n";
} finally {
  // The only removal target is the newly created test directory, never the shop data directory.
  foreach (glob($testDir . '/*') ?: [] as $file) if (is_file($file)) unlink($file);
  if (is_dir($testDir)) rmdir($testDir);
}
