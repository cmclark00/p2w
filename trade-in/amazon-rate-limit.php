<?php
declare(strict_types=1);

// Per-operation queues across staff devices; the shared state lock is held only
// while reading/updating clocks, never across network calls or sleeps.
// Defaults: catalog 2/s, itemOffers 0.5/s, itemOffersBatch 0.1/s (up to 20).
// A 429 cooldown remains shared, including across independently running queues.
function amazon_rate_state(string $file, callable $work) {
  $lock = fopen($file, 'c+');
  if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('Amazon queue unavailable');
  try {
    $raw = stream_get_contents($lock);
    $state = json_decode($raw, true);
    if (!is_array($state)) $state = ['last' => (float)$raw];
    if (!isset($state['lastByOperation'])) {
      $last = (float)($state['last'] ?? 0);
      $state['lastByOperation'] = array_fill_keys(['catalog-search', 'catalog-item', 'offers', 'offers-batch'], $last);
      if (isset($state['gaps']['catalog'])) {
        $state['gaps']['catalog-search'] = $state['gaps']['catalog'];
        $state['gaps']['catalog-item'] = $state['gaps']['catalog'];
      }
    }
    $result = $work($state);
    ftruncate($lock, 0); rewind($lock); fwrite($lock, json_encode($state)); fflush($lock);
    return $result;
  } finally { flock($lock, LOCK_UN); fclose($lock); }
}
function amazon_rate_request(string $file, string $operation, callable $send, ?callable $clock = null, ?callable $sleep = null): array {
  if (!in_array($operation, ['catalog-search', 'catalog-item', 'offers', 'offers-batch'], true)) return [400, '', 'Unknown operation', []];
  $clock = $clock ?? static fn() => microtime(true);
  $sleep = $sleep ?? static function (float $seconds): void { usleep((int)ceil($seconds * 1e6)); };
  $lock = fopen($file . '.' . $operation, 'c+');
  if (!$lock) return [429, '', '', ['retry-after' => '5']];
  $queued = $clock();
  while (!flock($lock, LOCK_EX | LOCK_NB)) {
    if ($clock() - $queued >= 20) { fclose($lock); return [429, '', '', ['retry-after' => '5']]; }
    $sleep(0.05);
  }
  try {
    $defaultGap = in_array($operation, ['catalog-search', 'catalog-item'], true) ? 0.6 : ($operation === 'offers-batch' ? 10.1 : 2.1);
    $start = $clock();
    for ($attempt = 0; $attempt < 3; $attempt++) {
      // Re-read after sleeping: another operation/device may have received a 429.
      do {
        $wait = amazon_rate_state($file, static function (&$state) use ($operation, $defaultGap, $clock) {
          $gap = max($defaultGap, (float)($state['gaps'][$operation] ?? $defaultGap));
          return max(0, max((float)($state['lastByOperation'][$operation] ?? 0) + $gap, (float)($state['cooldown'] ?? 0)) - $clock());
        });
        if ($wait > 12 || $clock() - $start + $wait > 20) return [429, '', '', ['retry-after' => (string)max(1, (int)ceil($wait))]];
        if ($wait > 0) $sleep($wait);
      } while ($wait > 0);
      [$status, $body, $error, $headers] = array_pad($send(), 4, []);
      $now = $clock();
      amazon_rate_state($file, static function (&$state) use ($operation, $defaultGap, $now, $status, &$headers, $attempt) {
        $state['last'] = $now;
        $state['lastByOperation'][$operation] = $now;
        $rate = (float)($headers['x-amzn-ratelimit-limit'] ?? 0);
        if ($rate > 0) $state['gaps'][$operation] = max($defaultGap, 1 / $rate + 0.1);
        if ($status === 429) {
          $retry = (string)($headers['retry-after'] ?? '');
          $requested = is_numeric($retry) ? max(0, (float)$retry) : max(0, (strtotime($retry) ?: 0) - $now);
          $delay = max(4 * (2 ** $attempt), $requested, (float)($state['gaps'][$operation] ?? $defaultGap));
          $state['cooldown'] = max((float)($state['cooldown'] ?? 0), $now + $delay);
          $headers['retry-after'] = (string)(int)ceil($state['cooldown'] - $now);
        }
        // A success must not erase a cooldown just set by another in-flight operation.
      });
      if ($status !== 429 || $attempt === 2) return [$status, $body, $error, $headers];
    }
  } catch (RuntimeException $e) {
    return [429, '', '', ['retry-after' => '5']];
  } finally { flock($lock, LOCK_UN); fclose($lock); }
  return [429, '', '', ['retry-after' => '16']];
}
