<?php
// The browser uses the normal staff API. Only this server sees the upstream credential.
function ebay_sales_cache_upstream(string $method, array $query): void {
  $config = read_json('ebay-cache-upstream.json');
  $url = $config['url'] ?? '';
  $token = $config['token'] ?? '';
  $parts = is_string($url) && filter_var($url, FILTER_VALIDATE_URL) ? parse_url($url) : false;
  if (!$parts || ($parts['scheme'] ?? '') !== 'https' || ($parts['path'] ?? '') !== '/cache'
    || isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])
    || !is_string($token) || !preg_match('/^[a-f0-9]{64}$/D', $token)) {
    fail(503, 'Shared eBay cache is unavailable.');
  }
  $params = array_intersect_key($query, array_flip(['id', 'query', 'condition']));
  ebay_sales_cache_key($params); // Validate before forwarding to the cache host.
  $url .= '?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);
  $body = $method === 'POST' ? ebay_sales_cache_body() : '';
  $headers = ["Authorization: Bearer $token", 'Content-Type: application/json', 'Accept: application/json'];
  $responseLimit = EBAY_SALES_MAX_BYTES + 8192;
  if (function_exists('curl_init')) {
    $ch = curl_init($url);
    $raw = '';
    curl_setopt_array($ch, [
      CURLOPT_CUSTOMREQUEST => $method,
      CURLOPT_HTTPHEADER => $headers,
      CURLOPT_CONNECTTIMEOUT_MS => 1000,
      CURLOPT_TIMEOUT_MS => 1400,
      CURLOPT_FOLLOWLOCATION => false,
      CURLOPT_WRITEFUNCTION => static function ($ch, string $chunk) use (&$raw, $responseLimit): int {
        if (strlen($raw) + strlen($chunk) > $responseLimit) return 0;
        $raw .= $chunk;
        return strlen($chunk);
      },
    ]);
    if ($method === 'POST') curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $status = curl_exec($ch) ? (int)curl_getinfo($ch, CURLINFO_HTTP_CODE) : 0;
  } else {
    $context = stream_context_create(['http' => [
      'method' => $method, 'timeout' => 1.4, 'ignore_errors' => true, 'follow_location' => 0,
      'header' => implode("\r\n", [...$headers, 'Connection: close']),
      'content' => $body,
    ]]);
    $raw = @file_get_contents($url, false, $context, 0, $responseLimit);
    $received = function_exists('http_get_last_response_headers') ? http_get_last_response_headers() : ($http_response_header ?? []);
    $status = preg_match('#^HTTP/\S+\s+(\d{3})\b#', $received[0] ?? '', $match) ? (int)$match[1] : 0;
    if ($raw === false) $status = 0;
  }
  $data = json_decode($raw, true);
  if (!in_array($status, [200, 400, 409, 413], true) || !is_array($data)) fail(503, 'Shared eBay cache is unavailable.');
  respond($status, $data);
}
