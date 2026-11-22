<?php
require __DIR__ . '/../trade-in/floor-recent.php';
class RecentResponse extends RuntimeException {
  public function __construct(public int $status, public array $body) { parent::__construct((string)$status); }
}
function respond(int $status,array $body): void { throw new RecentResponse($status,$body); }
function fail(int $status,string $message): void { throw new RecentResponse($status,['error'=>$message]); }
function data_path(string $name): string { return $GLOBALS['directory'].'/'.$name; }
function check(bool $ok,string $message): void { if(!$ok)throw new RuntimeException($message); }
function request(array $in,int $status=200): array {
  try{floor_recent_request($in);}catch(RecentResponse $r){check($r->status===$status,'Response '.$r->status);return $r->body;}
  throw new RuntimeException('Missing response');
}
$directory=sys_get_temp_dir().'/p2w-recent-test-'.bin2hex(random_bytes(8));mkdir($directory,0700);
try {
  $base=['scope'=>'rules-version-1','key'=>'item-1-cib'];
  $e=['product'=>['id'=>'1','product-name'=>'Example','console-name'=>'PS4'],'condition'=>'cib','sales'=>['cib'=>[]]];
  request($base+['action'=>'save','evidence'=>$e]);
  check(request($base+['action'=>'get'])['entry']['evidence']===$e,'Evidence roundtrip');
  check(request(array_replace($base,['scope'=>'rules-version-2','action'=>'get']))['entry']===null,'Rules/settings isolated');
  check(request(array_replace($base,['key'=>'item-1-loose','action'=>'get']))['entry']===null,'Conditions isolated');
  $list=request($base+['action'=>'list']);check(count($list['entries'])===1&&!isset($list['entries'][0]['evidence']),'List exposes only summary');
  foreach ([['typed'=>1000],['amazon'=>['incomplete'=>true]],['ebayChecks'=>['results'=>['x'=>['state'=>'pending']]]],['condition'=>'bad']] as $bad)
    request($base+['action'=>'save','evidence'=>array_replace($e,$bad)],400);
  $file=data_path('floor-recent.json');$rows=json_decode(file_get_contents($file),true);
  foreach($rows as &$row)$row['checkedAt']=1;unset($row);file_put_contents($file,json_encode($rows));
  check(request($base+['action'=>'get'])['entry']===null,'Expired entries cannot be reused');
  echo "PASS shared recent evidence validation, isolation, summaries and expiry\n";
} finally { if(is_file(data_path('floor-recent.json')))unlink(data_path('floor-recent.json'));rmdir($directory); }
