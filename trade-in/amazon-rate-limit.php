<?php
declare(strict_types=1);

// Shared pacing across staff devices. Catalog and offers have different quotas:
// catalog search/get each default to 2/s, offers 0.5/s.
// https://developer-docs.amazon/sp-api/docs/catalog-items-api-rate-limits
// https://developer-docs.amazon/sp-api/reference/getitemoffers
// Never retry earlier than Amazon requests; cooldowns remain shared across buckets.
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
    $defaultGap = in_array($operation, ['catalog-search', 'catalog-item'], true) ? 0.6 : 2.1;
    // Preserve old timing on the first call after upgrade, without forcing
    // unrelated operations to reset each other's pacing on subsequent calls.
    if (!isset($state['lastByOperation'])) {
      $last = (float)($state['last'] ?? 0);
      $state['lastByOperation'] = ['catalog-search' => $last, 'catalog-item' => $last, 'offers' => $last];
      if (isset($state['gaps']['catalog'])) {
        $state['gaps']['catalog-search'] = $state['gaps']['catalog'];
        $state['gaps']['catalog-item'] = $state['gaps']['catalog'];
      }
    }
    $start = $clock();
    for ($attempt = 0; $attempt < 3; $attempt++) {
      $gap = max($defaultGap, (float)($state['gaps'][$operation] ?? $defaultGap));
      $wait = max(0, max((float)($state['lastByOperation'][$operation] ?? 0) + $gap, (float)($state['cooldown'] ?? 0)) - $clock());
      if ($wait > 8 || $clock() - $start + $wait > 20) {
        return [429, '', '', ['retry-after' => (string)max(1, (int)ceil($wait))]];
      }
      if ($wait > 0) $sleep($wait);
      [$status, $body, $error, $headers] = array_pad($send(), 4, []);
      $now = $clock();
      $state['last'] = $now;
      $state['lastByOperation'][$operation] = $now;
      $rate = (float)($headers['x-amzn-ratelimit-limit'] ?? 0);
      if ($rate > 0) $state['gaps'][$operation] = max($defaultGap, 1 / $rate + 0.1);
      if ($status === 429) {
        $retry = (string)($headers['retry-after'] ?? '');
        $requested = is_numeric($retry) ? max(0, (float)$retry) : max(0, (strtotime($retry) ?: 0) - $now);
        $delay = max(4 * (2 ** $attempt), $requested, (float)($state['gaps'][$operation] ?? $defaultGap));
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
