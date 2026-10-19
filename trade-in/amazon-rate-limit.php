<?php
declare(strict_types=1);

// Shared pacing across staff devices. Never retry earlier than Amazon requests.
// Inject time/transport only for offline tests; production uses the system clock.
function amazon_rate_request(string $file, string $operation, callable $send, ?callable $clock = null, ?callable $sleep = null): array {
  $clock = $clock ?? static fn() => microtime(true);
  $sleep = $sleep ?? static function (float $seconds): void { usleep((int)ceil($seconds * 1e6)); };
  $lock = fopen($file, 'c+');
  if (!$lock || !flock($lock, LOCK_EX)) return [429, '', '', ['retry-after' => '5']];
  try {
    $raw = stream_get_contents($lock);
    $state = json_decode($raw, true);
    if (!is_array($state)) $state = ['last' => (float)$raw];
    $start = $clock();
    for ($attempt = 0; $attempt < 3; $attempt++) {
      $gap = max(2.1, (float)($state['gaps'][$operation] ?? 2.1));
      $wait = max(0, max((float)($state['last'] ?? 0) + $gap, (float)($state['cooldown'] ?? 0)) - $clock());
      if ($wait > 8 || $clock() - $start + $wait > 20) {
        return [429, '', '', ['retry-after' => (string)max(1, (int)ceil($wait))]];
      }
      if ($wait > 0) $sleep($wait);
      [$status, $body, $error, $headers] = array_pad($send(), 4, []);
      $now = $clock();
      $state['last'] = $now;
      $rate = (float)($headers['x-amzn-ratelimit-limit'] ?? 0);
      if ($rate > 0) $state['gaps'][$operation] = max(2.1, 1 / $rate + 0.1);
      if ($status === 429) {
        $retry = (string)($headers['retry-after'] ?? '');
        $requested = is_numeric($retry) ? max(0, (float)$retry) : max(0, (strtotime($retry) ?: 0) - $now);
        $delay = max(4 * (2 ** $attempt), $requested, (float)($state['gaps'][$operation] ?? 2.1));
        $state['cooldown'] = $now + $delay;
        $headers['retry-after'] = (string)(int)ceil($delay);
      } else { $state['cooldown'] = 0; }
      ftruncate($lock, 0); rewind($lock);
      fwrite($lock, json_encode($state)); fflush($lock);
      if ($status !== 429 || $attempt === 2) return [$status, $body, $error, $headers];
    }
  } finally { flock($lock, LOCK_UN); fclose($lock); }
  return [429, '', '', ['retry-after' => '16']];
}
