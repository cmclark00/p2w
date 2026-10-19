<?php
declare(strict_types=1);
require __DIR__ . '/../trade-in/amazon-rate-limit.php';
function check(bool $ok, string $why): void { if (!$ok) throw new RuntimeException($why); }
$file = tempnam(sys_get_temp_dir(), 'p2w-rate-');
$now = 1000.0; $waits = []; $calls = 0;
$clock = function () use (&$now): float { return $now; };
$sleep = function (float $seconds) use (&$now, &$waits): void { $waits[] = $seconds; $now += $seconds; };
try {
  $send = function () use (&$calls): array { return ++$calls < 3 ? [429, 'throttled', '', []] : [200, 'offers', '', []]; };
  $r = amazon_rate_request($file, 'offers', $send, $clock, $sleep);
  check($r[0] === 200 && $r[1] === 'offers' && $calls === 3 && $waits === [4.0, 8.0], '429 retries back off then recover');
  file_put_contents($file, ''); $calls = 0; $waits = [];
  $send = function () use (&$calls): array { $calls++; return [429, 'throttled', '', []]; };
  $r = amazon_rate_request($file, 'offers', $send, $clock, $sleep);
  check($r[0] === 429 && $calls === 3 && $r[3]['retry-after'] === '16', 'Retries are bounded and return cooldown');
  $r = amazon_rate_request($file, 'catalog', $send, $clock, $sleep);
  check($r[0] === 429 && $calls === 3, 'Another request/device respects the persisted cooldown without hitting Amazon');
  file_put_contents($file, ''); $calls = 0; $waits = [];
  $send = function () use (&$calls): array { $calls++; return [429, '', '', ['retry-after' => '90']]; };
  $r = amazon_rate_request($file, 'offers', $send, $clock, $sleep);
  check($calls === 1 && !$waits && (int)$r[3]['retry-after'] === 90, 'Long Retry-After is preserved, not retried early');
  file_put_contents($file, ''); $calls = 0;
  $send = function () use (&$calls, &$now): array { $calls++; return [429, '', '', ['retry-after' => gmdate('D, d M Y H:i:s', (int)$now + 120) . ' GMT']]; };
  $r = amazon_rate_request($file, 'offers', $send, $clock, $sleep);
  check($calls === 1 && (int)$r[3]['retry-after'] === 120, 'HTTP-date Retry-After is honored');
  file_put_contents($file, ''); $calls = 0; $waits = [];
  $send = function () use (&$calls): array { $calls++; return [200, 'offers', '', ['x-amzn-ratelimit-limit' => '0.25']]; };
  amazon_rate_request($file, 'offers', $send, $clock, $sleep);
  amazon_rate_request($file, 'offers', $send, $clock, $sleep);
  check($calls === 2 && abs($waits[0] - 4.1) < 0.001, 'Advertised slower operation limit sets pacing');
  file_put_contents($file, ''); $calls = 0;
  foreach ([400, 401, 403, 500, 0] as $status) {
    $send = function () use (&$calls, $status): array { $calls++; return [$status, 'error', '', []]; };
    $before = $calls; $r = amazon_rate_request($file, 'catalog', $send, $clock, $sleep);
    check($r[0] === $status && $calls === $before + 1, 'Non-429 errors are not blindly retried');
  }
  file_put_contents($file, (string)$now); $waits = [];
  amazon_rate_request($file, 'offers', fn() => [200, 'offers', '', []], $clock, $sleep);
  check(abs($waits[0] - 2.1) < 0.001, 'Existing numeric throttle state migrates without a burst');
  echo "Amazon throttling, recovery and shared cooldown checks passed.\n";
} finally { unlink($file); }
