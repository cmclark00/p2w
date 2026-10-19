<?php
declare(strict_types=1);

// Read-only stock checks. No cart requests, cookies, credentials or location data.
function gs_stock_url(string $url): ?array {
  $p = parse_url($url);
  if (!is_array($p) || ($p['scheme'] ?? '') !== 'https'
      || !in_array(strtolower($p['host'] ?? ''), ['gamestop.com', 'www.gamestop.com'], true)
      || isset($p['user']) || isset($p['pass']) || isset($p['port'])) return null;
  $path = $p['path'] ?? '';
  if (!preg_match('~^/(?:[a-z0-9-]+/)*products/(?:[a-z0-9%-]+/)?(\d{1,12})\.html$~i', $path, $m)) return null;
  return ['id' => $m[1], 'url' => 'https://www.gamestop.com' . $path];
}

function gs_stock_parse(string $html, string $id): array {
  $unknown = ['state' => 'unknown', 'reason' => 'Pre-owned online availability could not be confirmed. Open the listing to check.'];
  if (!class_exists('DOMDocument')) return $unknown;
  $doc = new DOMDocument();
  $old = libxml_use_internal_errors(true);
  $ok = $doc->loadHTML($html ?: '<html></html>', LIBXML_NONET);
  libxml_clear_errors();
  libxml_use_internal_errors($old);
  if (!$ok) return $unknown;
  $xpath = new DOMXPath($doc);
  $cart = $xpath->query('//button[contains(concat(" ", normalize-space(@class), " "), " js-add-to-cart ")]');
  $states = []; $title = null;
  foreach ($cart as $button) {
    if ($button->getAttribute('data-pid') !== $id) continue;
    $data = json_decode($button->getAttribute('data-gtmdata'), true);
    $info = $data['productInfo'] ?? [];
    if ((string)($info['sku'] ?? '') !== $id || strcasecmp(trim((string)($info['condition'] ?? '')), 'Pre-Owned') !== 0) continue;
    $availability = strtolower(trim((string)($info['availability'] ?? '')));
    $label = strtolower(trim($button->textContent));
    $disabled = $button->hasAttribute('disabled') || $button->getAttribute('aria-disabled') === 'true'
      || preg_match('/\bdisabled\b/', $button->getAttribute('class'));
    $state = 'unknown';
    if ($disabled && in_array($availability, ['not available', 'out of stock'], true)
        && in_array($label, ['not available', 'out of stock'], true)) $state = 'out';
    if (!$disabled && in_array($availability, ['in stock', 'available'], true) && $label === 'add to cart') $state = 'in';
    $states[] = $state;
    $title = trim((string)($info['name'] ?? ''));
  }
  if (!$states || count(array_unique($states)) !== 1 || $states[0] === 'unknown' || !$title) return $unknown;
  // A cart button can also represent pickup. Require matching shipping evidence.
  $shipping = $xpath->query('//button[@data-optionvalue="ship"]');
  if (!$shipping->length) return $unknown;
  foreach ($shipping as $button) {
    $disabled = $button->hasAttribute('disabled') || $button->getAttribute('aria-disabled') === 'true';
    $text = strtolower(preg_replace('/\s+/', ' ', trim($button->textContent)));
    if ($states[0] === 'out' && (!$disabled || strpos($text, 'not available') === false)) return $unknown;
    if ($states[0] === 'in' && ($disabled || preg_match('/not available|unavailable|verify address|pre.?order|back.?order/', $text))) return $unknown;
  }
  return ['state' => $states[0], 'title' => $title, 'reason' => 'GameStop pre-owned Ship to Home availability; local store stock may differ.'];
}

function gs_stock_http(string $url): array {
  if (!function_exists('curl_init')) return [0, '', null];
  $ch = curl_init($url); $body = ''; $location = null;
  curl_setopt_array($ch, [CURLOPT_TIMEOUT => 8, CURLOPT_CONNECTTIMEOUT => 4,
    CURLOPT_FOLLOWLOCATION => false, CURLOPT_USERAGENT => 'P2W-TradeIn/1.0',
    CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
    CURLOPT_WRITEFUNCTION => static function ($ch, string $chunk) use (&$body): int {
      if (strlen($body) + strlen($chunk) > 3000000) return 0;
      $body .= $chunk; return strlen($chunk);
    },
    CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$location): int {
      if (stripos($line, 'Location:') === 0) $location = trim(substr($line, 9));
      return strlen($line);
    },
  ]);
  $ok = curl_exec($ch);
  $status = $ok === false ? 0 : (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  return [$status, $body, $location];
}

function gs_stock_fetch(string $url, ?callable $request = null): array {
  $target = gs_stock_url($url);
  $unknown = ['state' => 'unknown', 'reason' => 'GameStop stock check unavailable. Open the listing to check.'];
  if (!$target) return $unknown;
  $request = $request ?? 'gs_stock_http';
  $current = $target['url'];
  for ($i = 0; $i < 3; $i++) {
    [$status, $html, $location] = $request($current);
    if ($status === 200) return gs_stock_parse($html, $target['id']);
    if (!in_array($status, [301, 302, 303, 307, 308], true) || !is_string($location)) return $unknown;
    if (substr($location, 0, 1) === '/' && substr($location, 0, 2) !== '//') $location = 'https://www.gamestop.com' . $location;
    $next = gs_stock_url($location);
    if (!$next || $next['id'] !== $target['id']) return $unknown;
    $current = $next['url'];
  }
  return $unknown;
}

function gamestop_stock(string $url): void {
  $target = gs_stock_url($url);
  if (!$target) fail(400, 'A matching GameStop product link is required.');
  $dir = data_path('cache');
  if (!is_dir($dir)) @mkdir($dir, 0700);
  $file = $dir . '/gs-stock-v1-' . $target['id'] . '.json';
  $lock = fopen($file . '.lock', 'c+');
  if (!$lock || !flock($lock, LOCK_EX)) fail(503, 'Stock check temporarily unavailable.');
  $cached = is_file($file) ? json_decode((string)file_get_contents($file), true) : null;
  if (is_array($cached) && time() - (int)($cached['checkedAt'] ?? 0) < (($cached['state'] ?? '') === 'unknown' ? 180 : 600)) {
    flock($lock, LOCK_UN); fclose($lock); respond(200, $cached);
  }
  $result = gs_stock_fetch($target['url']);
  $result['checkedAt'] = time();
  @file_put_contents($file, json_encode($result), LOCK_EX);
  flock($lock, LOCK_UN); fclose($lock);
  respond(200, $result);
}
