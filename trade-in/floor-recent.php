<?php
declare(strict_types=1);

// Authenticated staff evidence, stored outside the public site. No final/manual
// prices are cached; clients always run current matching and pricing rules.
const FLOOR_RECENT_SECONDS = 1800;
const FLOOR_RECENT_MAX = 100;
function floor_recent_validate(array $in): bool {
  if (!is_string($in['scope'] ?? null) || strlen($in['scope']) > 32768 || strlen($in['scope']) < 10
      || !is_string($in['key'] ?? null) || strlen($in['key']) > 4096) return false;
  $e = $in['evidence'] ?? null;
  if (!is_array($e) || !is_array($e['product'] ?? null)
      || !preg_match('/^\d{1,12}$/', (string)($e['product']['id'] ?? ''))
      || !in_array($e['condition'] ?? '', ['loose', 'cib', 'new'], true)) return false;
  $allowed = ['product','condition','quickPricingEnabled','researchRequested','manualMissing','toyGroup',
    'quickSales','sales','salesNotes','salesSources','salesError','standardGame','gamestopUrl','gamestopStock','amazon','directEbay','ebayChecks','cibComparison'];
  if (array_diff(array_keys($e), $allowed) || !empty($e['salesError'])) return false;
  return !floor_recent_unfinished($e);
}
function floor_recent_unfinished($v, int $depth = 0): bool {
  if ($depth > 30) return true;
  if (!is_array($v)) return false;
  foreach (['error','incomplete','partial','loading'] as $key) if (!empty($v[$key])) return true;
  if (in_array($v['state'] ?? '', ['pending','unavailable'], true)) return true;
  foreach ($v as $value) if (is_array($value) && floor_recent_unfinished($value, $depth + 1)) return true;
  return false;
}
function floor_recent_request(array $in): void {
  $action = $in['action'] ?? '';
  $scope = $in['scope'] ?? null;
  if (!in_array($action, ['get','list','save'], true) || !is_string($scope) || strlen($scope) < 10 || strlen($scope) > 32768) fail(400, 'Invalid recent-results request.');
  if ($action !== 'list' && (!is_string($in['key'] ?? null) || strlen($in['key']) > 4096)) fail(400, 'Invalid recent-results key.');
  if ($action === 'save' && !floor_recent_validate($in)) fail(400, 'Only completed research evidence can be shared.');
  $scopeHash = hash('sha256', $scope);
  $keyHash = hash('sha256', $scope . "\n" . ($in['key'] ?? ''));
  $fh = fopen(data_path('floor-recent.json'), 'c+');
  if (!$fh || !flock($fh, LOCK_EX)) fail(503, 'Recent results temporarily unavailable.');
  @chmod(data_path('floor-recent.json'), 0600);
  $all = json_decode(stream_get_contents($fh), true);
  if (!is_array($all)) $all = [];
  $now = (int)floor(microtime(true) * 1000);
  $all = array_filter($all, function ($e) use ($now) { return is_array($e) && isset($e['scope'], $e['key'], $e['evidence']['product']) && ($e['checkedAt'] ?? 0) <= $now && ($e['checkedAt'] ?? 0) > $now - FLOOR_RECENT_SECONDS * 1000; });
  if ($action === 'save') {
    $all[$keyHash] = ['scope' => $scopeHash, 'key' => $in['key'], 'checkedAt' => $now, 'evidence' => $in['evidence']];
  }
  uasort($all, function ($a, $b) { return $b['checkedAt'] <=> $a['checkedAt']; });
  $all = array_slice($all, 0, FLOOR_RECENT_MAX, true);
  if ($action === 'list') {
    $entries = [];
    foreach ($all as $e) {
      if ($e['scope'] !== $scopeHash) continue;
      $p = $e['evidence']['product'];
      $entries[] = ['key' => $e['key'], 'checkedAt' => $e['checkedAt'], 'name' => $p['product-name'] ?? '',
        'platform' => $p['console-name'] ?? '', 'condition' => $e['evidence']['condition']];
    }
    $result = ['entries' => $entries];
  } else { $result = ['entry' => $all[$keyHash] ?? null]; }
  $json = json_encode($all, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  rewind($fh); ftruncate($fh, 0); fwrite($fh, $json); fflush($fh); flock($fh, LOCK_UN); fclose($fh);
  respond(200, $result);
}
