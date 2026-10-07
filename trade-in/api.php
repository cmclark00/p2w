<?php
/**
 * Play2Win Trade-In Calculator - server API for play2wingames.com/trade-in/
 *
 * Same job as the shop PC's server.ps1: stores settings + hardware prices,
 * and proxies PriceCharting so the API token never reaches a browser.
 * Adds staff/manager logins because this copy is on the public internet.
 *
 * Everything private (PriceCharting token, password hashes, settings,
 * prices, cache) lives OUTSIDE the website folder in
 *   <home>/p2w-trade-in-data/
 * so it is never in the (public) repo and the FTP deploy's --delete can't
 * touch it. Override with the P2W_TRADEIN_DATA environment variable.
 *
 * Routes (api.php?route=...):
 *   GET  status                  who is logged in, is setup needed
 *   POST setup                   one-time: setup code + passwords (+ token)
 *   POST login / logout
 *   GET  settings | hardware     any logged-in user
 *   PUT  settings | hardware     manager
 *   PUT  token | passwords       manager
 *   GET  pc/product (id|upc|q), pc/products (q)   any logged-in user
 *   POST trades / GET trades (q, from, to) completed-trade log, any logged-in user
 *   PUT  trades                  manager: correct a logged trade (kept: who/when/why + what it was before)
 *   GET  history (of=settings|hardware)  manager: saved versions, newest first
 *   GET  pc/sales (id)           recent sold listings from a game's PriceCharting page (floor pricing)
 *   GET  floor-sessions (id)     saved floor-pricing sessions: list, or one session with its items
 *   PUT  floor-sessions          save (create or update) a named session; 409 if someone saved it since baseUpdated
 *   DELETE floor-sessions (id)   delete a saved session
 *   GET  amazon/offers (upc, cond) Amazon's lowest offers for a game, via the shop's SP-API app
 *   PUT  amazon / GET amazon/test  manager: save / check the Amazon SP-API keys
 */

declare(strict_types=1);

// SHA-256 of the one-time setup code (dashes removed, uppercase). Only a hash
// lives here - the code itself was given to the shop owner. Useless once setup is done.
const SETUP_CODE_SHA256 = 'a3257f6bb85bfe885a89176d77c207ef600aecbaa6bf269e973daf2b3bad4cd3';

const COOKIE_NAME = 'p2w_tradein';
const SESSION_DAYS = 30;
const MIN_PASSWORD_LENGTH = 8;
const MAX_LOGIN_FAILS = 20;         // per IP (the whole shop shares one IP, so not too few) ...
const LOGIN_WINDOW_SECONDS = 900;   // ... per 15 minutes
const PC_MIN_GAP_SECONDS = 1.1;     // PriceCharting allows 1 call/second
const PC_CACHE_SECONDS = 1800;      // re-scanning a game within 30 min costs no API call
const SALES_CACHE_SECONDS = 21600;  // a game's recent-sales list is re-read at most every 6 hours
const MAX_FLOOR_SESSIONS = 300;     // oldest saved floor-pricing sessions drop off past this
const HISTORY_KEEP = 50;            // saved versions of settings / hardware prices kept for "Change history"
const LOG_MAX = 100;                // trade-log results without a date range ...
const LOG_MAX_RANGE = 2000;         // ... and with one (end-of-day totals, export)
const AMZ_MARKETPLACE = 'ATVPDKIKX0DER'; // amazon.com
const AMZ_MIN_GAP_SECONDS = 2.1;    // getItemOffers allows 0.5 requests/second
const AMZ_CACHE_SECONDS = 21600;    // a game's Amazon offers are re-read at most every 6 hours

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');

/* ------------------------------------------------------------------ responses */

function respond(int $status, $data): void {
  http_response_code($status);
  echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  exit;
}

function respond_raw(int $status, string $json): void {
  http_response_code($status);
  echo $json;
  exit;
}

function fail(int $status, string $message): void {
  respond($status, ['status' => 'error', 'error-message' => $message]);
}

/* ------------------------------------------------------------------ storage */

function data_dir(): string {
  static $dir = null;
  if ($dir !== null) return $dir;
  $dir = getenv('P2W_TRADEIN_DATA') ?: '';
  if ($dir === '') {
    $docroot = rtrim((string)($_SERVER['DOCUMENT_ROOT'] ?? ''), '/\\');
    if ($docroot === '') fail(500, 'Cannot find the website folder on the server.');
    $dir = dirname($docroot) . '/p2w-trade-in-data';
  }
  if (!is_dir($dir) && !@mkdir($dir, 0700, true)) {
    fail(500, 'Cannot create the private data folder next to the website. Check the hosting account permissions.');
  }
  return $dir;
}

function data_path(string $name): string {
  return data_dir() . '/' . $name;
}

function read_json(string $name) {
  $path = data_path($name);
  if (!is_file($path)) return null;
  return json_decode((string)file_get_contents($path), true);
}

// Writes via a temp file + rename so a crash can't leave half a file; keeps a .bak of the previous version.
function write_atomic(string $name, string $content): void {
  $path = data_path($name);
  $tmp = $path . '.' . bin2hex(random_bytes(4)) . '.tmp';
  if (file_put_contents($tmp, $content, LOCK_EX) === false) fail(500, 'Could not save on the server.');
  @chmod($tmp, 0600);
  if (is_file($path)) @copy($path, $path . '.bak');
  if (!@rename($tmp, $path)) {
    @unlink($tmp);
    fail(500, 'Could not save on the server.');
  }
}

function config(): ?array {
  static $cfg = false;
  if ($cfg === false) {
    $cfg = read_json('config.json');
    if (!is_array($cfg)) $cfg = null;
  }
  return $cfg;
}

function save_config(array $cfg): void {
  write_atomic('config.json', json_encode($cfg, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
}

/* ------------------------------------------------------------------ request helpers */

function json_body(): array {
  $data = json_decode((string)file_get_contents('php://input'), true);
  if (!is_array($data)) fail(400, 'Expected a JSON request body.');
  return $data;
}

function client_ip(): string {
  return (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
}

function is_https(): bool {
  return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https'
    || strtolower((string)($_SERVER['HTTP_X_FORWARDED_SSL'] ?? '')) === 'on';
}

// First $n characters of UTF-8 text (no mbstring needed).
function cut_text(string $s, int $n): string {
  return preg_match('/^.{0,' . $n . '}/us', $s, $m) ? $m[0] : '';
}

function b64url(string $s): string {
  return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
}

function b64url_decode(string $s): string {
  return (string)base64_decode(strtr($s, '-_', '+/'));
}

/* ------------------------------------------------------------------ auth */

// Login cookie = payload.signature, HMAC-signed with a secret made at setup.
// Changing passwords bumps sessionVersion, which logs out every device.
function set_login_cookie(string $role, array $cfg): void {
  $expires = time() + SESSION_DAYS * 86400;
  $payload = b64url((string)json_encode(['r' => $role, 'e' => $expires, 'v' => $cfg['sessionVersion']]));
  $value = $payload . '.' . hash_hmac('sha256', $payload, $cfg['secret']);
  setcookie(COOKIE_NAME, $value, cookie_options($expires));
}

function clear_login_cookie(): void {
  setcookie(COOKIE_NAME, '', cookie_options(time() - 3600));
}

function cookie_options(int $expires): array {
  $path = rtrim(str_replace('\\', '/', dirname((string)($_SERVER['SCRIPT_NAME'] ?? '/'))), '/') . '/';
  return ['expires' => $expires, 'path' => $path, 'secure' => is_https(), 'httponly' => true, 'samesite' => 'Strict'];
}

function current_role(): ?string {
  $cfg = config();
  $cookie = (string)($_COOKIE[COOKIE_NAME] ?? '');
  if (!$cfg || strpos($cookie, '.') === false) return null;
  [$payload, $sig] = explode('.', $cookie, 2);
  if (!hash_equals(hash_hmac('sha256', $payload, $cfg['secret']), $sig)) return null;
  $data = json_decode(b64url_decode($payload), true);
  if (!is_array($data) || ($data['e'] ?? 0) < time() || ($data['v'] ?? null) !== $cfg['sessionVersion']) return null;
  return in_array($data['r'] ?? '', ['staff', 'manager'], true) ? $data['r'] : null;
}

function require_role(string $needed): void {
  if (!config()) fail(409, 'The calculator has not been set up yet.');
  $role = current_role();
  if ($role === null) fail(401, 'Please log in.');
  if ($needed === 'manager' && $role !== 'manager') fail(403, 'Only a manager can change this.');
}

function check_password_rules(string $staff, string $manager): void {
  if (strlen($staff) < MIN_PASSWORD_LENGTH || strlen($manager) < MIN_PASSWORD_LENGTH) {
    fail(400, 'Passwords must be at least ' . MIN_PASSWORD_LENGTH . ' characters.');
  }
  if ($staff === $manager) fail(400, 'The staff and manager passwords must be different.');
}

// Simple per-IP brute-force limit for login and setup attempts.
function login_attempts(callable $update): array {
  $fh = fopen(data_path('login-attempts.json'), 'c+');
  flock($fh, LOCK_EX);
  $all = json_decode((string)stream_get_contents($fh), true);
  if (!is_array($all)) $all = [];
  $cutoff = time() - LOGIN_WINDOW_SECONDS;
  foreach ($all as $ip => $times) {
    $all[$ip] = array_values(array_filter((array)$times, function ($t) use ($cutoff) { return $t > $cutoff; }));
    if (!$all[$ip]) unset($all[$ip]);
  }
  $all = $update($all);
  ftruncate($fh, 0);
  rewind($fh);
  fwrite($fh, (string)json_encode($all));
  flock($fh, LOCK_UN);
  fclose($fh);
  return $all;
}

function guard_login_rate(): void {
  $ip = client_ip();
  $all = login_attempts(function ($all) { return $all; });
  $fails = $all[$ip] ?? [];
  if (count($fails) >= MAX_LOGIN_FAILS) {
    // The oldest counted failure drops out of the window first; that's when another try is allowed.
    $mins = max(1, (int)ceil((min($fails) + LOGIN_WINDOW_SECONDS - time()) / 60));
    fail(429, "Too many wrong passwords from this location. Try again in $mins minute" . ($mins === 1 ? '' : 's') . '.');
  }
}

function record_login(bool $ok): void {
  $ip = client_ip();
  login_attempts(function ($all) use ($ip, $ok) {
    if ($ok) unset($all[$ip]);
    else $all[$ip][] = time();
    return $all;
  });
}

/* ------------------------------------------------------------------ PriceCharting */

function http_get(string $url, bool $follow = false): array {
  if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_TIMEOUT => 20,
      CURLOPT_CONNECTTIMEOUT => 10,
      CURLOPT_USERAGENT => 'P2W-TradeIn/1.0',
      CURLOPT_FOLLOWLOCATION => $follow,
      CURLOPT_MAXREDIRS => 3,
    ]);
    $body = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    return [$status, $body === false ? '' : (string)$body, $error];
  }
  $ctx = stream_context_create(['http' => ['timeout' => 20, 'ignore_errors' => true, 'follow_location' => $follow ? 1 : 0, 'header' => "User-Agent: P2W-TradeIn/1.0\r\n"]]);
  $body = @file_get_contents($url, false, $ctx);
  $status = 0;
  foreach ($http_response_header ?? [] as $h) {
    if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) $status = (int)$m[1];
  }
  return [$status, $body === false ? '' : (string)$body, $body === false ? 'request failed' : ''];
}

// Any HTTP request with headers (Amazon's token exchange is a form POST). Returns [status, body, error].
function http_send(string $method, string $url, array $headers = [], ?string $body = null): array {
  if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_TIMEOUT => 20,
      CURLOPT_CONNECTTIMEOUT => 10,
      CURLOPT_CUSTOMREQUEST => $method,
      CURLOPT_HTTPHEADER => $headers,
      CURLOPT_USERAGENT => 'P2W-TradeIn/1.0 (Language=PHP)',
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $out = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    return [$status, $out === false ? '' : (string)$out, $error];
  }
  $ctx = stream_context_create(['http' => [
    'method' => $method, 'timeout' => 20, 'ignore_errors' => true,
    'header' => implode("\r\n", array_merge($headers, ['User-Agent: P2W-TradeIn/1.0 (Language=PHP)'])),
    'content' => $body ?? '',
  ]]);
  $out = @file_get_contents($url, false, $ctx);
  $status = 0;
  foreach ($http_response_header ?? [] as $h) {
    if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) $status = (int)$m[1];
  }
  return [$status, $out === false ? '' : (string)$out, $out === false ? 'request failed' : ''];
}

function pricecharting(string $endpoint, string $param, string $value): void {
  $token = (string)(config()['token'] ?? '');
  if ($token === '') fail(400, 'No PriceCharting API token is set. A manager can add it on the Settings tab.');

  $cacheDir = data_path('cache');
  if (!is_dir($cacheDir)) @mkdir($cacheDir, 0700);
  $cacheFile = $cacheDir . '/' . sha1($endpoint . '|' . $param . '|' . strtolower($value)) . '.json';
  $fresh = function () use ($cacheFile) { return is_file($cacheFile) && time() - filemtime($cacheFile) < PC_CACHE_SECONDS; };
  if ($fresh()) respond_raw(200, (string)file_get_contents($cacheFile));

  // One call at a time, at least PC_MIN_GAP_SECONDS apart, across every staff device.
  $lock = fopen(data_path('pc-throttle.lock'), 'c+');
  flock($lock, LOCK_EX);
  if ($fresh()) { // another request fetched it while we waited
    flock($lock, LOCK_UN);
    respond_raw(200, (string)file_get_contents($cacheFile));
  }
  $wait = PC_MIN_GAP_SECONDS - (microtime(true) - (float)stream_get_contents($lock));
  if ($wait > 0) usleep((int)($wait * 1e6));
  $url = 'https://www.pricecharting.com/api/' . $endpoint . '?t=' . rawurlencode($token) . '&' . $param . '=' . rawurlencode($value);
  [$status, $body, $error] = http_get($url);
  ftruncate($lock, 0);
  rewind($lock);
  fwrite($lock, (string)microtime(true));
  flock($lock, LOCK_UN);
  fclose($lock);

  if (mt_rand(1, 50) === 1) { // occasionally sweep old cache files
    foreach ((array)glob($cacheDir . '/*.json') as $f) {
      if (time() - (int)@filemtime($f) > PC_CACHE_SECONDS) @unlink($f);
    }
  }

  if ($status === 0) fail(502, 'Could not reach PriceCharting: ' . $error);
  $trimmed = ltrim($body);
  if ($trimmed === '' || $trimmed[0] !== '{') fail(502, "PriceCharting returned HTTP $status.");
  if ($status === 200 && preg_match('/"status"\s*:\s*"success"/', $body)) @file_put_contents($cacheFile, $body, LOCK_EX);
  respond_raw($status ?: 502, $body);
}

// Floor pricing: the recent sold listings on a game's public PriceCharting page (the API has no
// sales data). One page read covers Loose, CIB, and New; it's cached for SALES_CACHE_SECONDS.
// If PriceCharting changes their page, this returns no sales and staff use the page link instead.
function pc_sales(string $id): void {
  if (!preg_match('/^\d{1,10}$/', $id)) fail(400, 'Pass a PriceCharting product id.');
  $cacheDir = data_path('cache');
  if (!is_dir($cacheDir)) @mkdir($cacheDir, 0700);
  $cacheFile = $cacheDir . '/sales-' . $id . '.json';
  if (is_file($cacheFile) && time() - filemtime($cacheFile) < SALES_CACHE_SECONDS) respond_raw(200, (string)file_get_contents($cacheFile));

  // Same one-at-a-time gap as the API calls, so a busy pricing session can't hammer their site.
  $lock = fopen(data_path('pc-throttle.lock'), 'c+');
  flock($lock, LOCK_EX);
  $wait = PC_MIN_GAP_SECONDS - (microtime(true) - (float)stream_get_contents($lock));
  if ($wait > 0) usleep((int)($wait * 1e6));
  [$status, $html, $error] = http_get('https://www.pricecharting.com/game/' . $id, true);
  ftruncate($lock, 0);
  rewind($lock);
  fwrite($lock, (string)microtime(true));
  flock($lock, LOCK_UN);
  fclose($lock);
  if ($status === 0) fail(502, 'Could not reach PriceCharting: ' . $error);
  if ($status !== 200) fail(502, "PriceCharting returned HTTP $status.");

  $out = ['status' => 'success', 'sales' => []];
  foreach (['loose' => 'used', 'cib' => 'cib', 'new' => 'new'] as $cond => $cls) {
    $list = [];
    if (preg_match('#<div class="completed-auctions-' . $cls . '"[^>]*>(.*?)</table>#s', $html, $m)) {
      preg_match_all('#<tr id="[^"]*">(.*?)</tr>#s', $m[1], $rows);
      foreach ($rows[1] as $row) {
        if (!preg_match('#class="js-price"\s*>\s*\$([\d,]+\.\d{2})#', $row, $pm)) continue;
        $date = preg_match('#class="date">\s*([\d-]{10})#', $row, $dm) ? $dm[1] : '';
        $title = '';
        $url = '';
        if (preg_match('#<td class="title">\s*<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>#s', $row, $am)) {
          $url = html_entity_decode($am[1], ENT_QUOTES | ENT_HTML5, 'UTF-8');
          $title = trim(preg_replace('/\s+/', ' ', html_entity_decode(strip_tags($am[2]), ENT_QUOTES | ENT_HTML5, 'UTF-8')));
        }
        $list[] = [
          'date' => $date,
          'price' => (int)round((float)str_replace(',', '', $pm[1]) * 100),
          'title' => cut_text($title, 160),
          'url' => preg_match('#^https://#', $url) ? $url : '',
        ];
      }
    }
    $out['sales'][$cond] = $list;
  }
  $json = json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  if ($out['sales']['loose'] || $out['sales']['cib'] || $out['sales']['new']) @file_put_contents($cacheFile, $json, LOCK_EX);
  respond_raw(200, $json);
}

// Saved floor-pricing sessions, all in one file: { id: { id, name, staff, created, updated, items: [...] } }.
// $update gets the whole set and returns [new set, result, changed?].
function floor_sessions(callable $update) {
  $fh = fopen(data_path('floor-sessions.json'), 'c+');
  if (!$fh) fail(500, 'Could not open the saved sessions on the server.');
  flock($fh, LOCK_EX);
  $all = json_decode((string)stream_get_contents($fh), true);
  if (!is_array($all)) $all = [];
  [$all, $result, $changed] = $update($all);
  if ($changed) {
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, (string)json_encode((object)$all, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    fflush($fh);
  }
  flock($fh, LOCK_UN);
  fclose($fh);
  return $result;
}

/* ------------------------------------------------------------------ Amazon (Selling Partner API) */

// The shop's own private SP-API app: Login-with-Amazon client id/secret + the refresh token from
// self-authorizing it. Kept in config.json with the other secrets; never sent to a browser.
function amazon_keys(): ?array {
  $a = config()['amazon'] ?? null;
  return is_array($a) && ($a['clientId'] ?? '') !== '' && ($a['clientSecret'] ?? '') !== '' && ($a['refreshToken'] ?? '') !== '' ? $a : null;
}

function amazon_error(int $status, string $body): string {
  $d = json_decode($body, true);
  $msg = $d['errors'][0]['message'] ?? $d['error_description'] ?? $d['error'] ?? '';
  return "Amazon returned HTTP $status" . ($msg !== '' ? ': ' . rtrim($msg, '.') . '.' : '.');
}

// A Login-with-Amazon access token (good for an hour), cached until 2 minutes before it expires.
function amazon_access_token(array $keys): string {
  $cache = read_json('amazon-token.json');
  if (is_array($cache) && ($cache['expires'] ?? 0) > time() + 120 && ($cache['for'] ?? '') === sha1($keys['refreshToken'])) return $cache['token'];
  // P2W_AMAZON_LWA / P2W_AMAZON_HOST point at a fake Amazon for local testing (like P2W_TRADEIN_DATA).
  $lwa = getenv('P2W_AMAZON_LWA') ?: 'https://api.amazon.com/auth/o2/token';
  [$status, $body, $error] = http_send('POST', $lwa, ['Content-Type: application/x-www-form-urlencoded'], http_build_query([
    'grant_type' => 'refresh_token', 'refresh_token' => $keys['refreshToken'],
    'client_id' => $keys['clientId'], 'client_secret' => $keys['clientSecret'],
  ]));
  if ($status === 0) fail(502, 'Could not reach Amazon: ' . $error);
  $d = json_decode($body, true);
  if ($status !== 200 || empty($d['access_token'])) fail(502, amazon_error($status, $body) . ' Check the Amazon keys in Settings.');
  write_atomic('amazon-token.json', (string)json_encode([
    'token' => $d['access_token'], 'expires' => time() + (int)($d['expires_in'] ?? 3600), 'for' => sha1($keys['refreshToken']),
  ]));
  return $d['access_token'];
}

// GET from the SP-API (production or sandbox), one call at a time across every device.
function amazon_get(array $keys, string $path, array $query): array {
  $token = amazon_access_token($keys);
  $host = getenv('P2W_AMAZON_HOST') ?: (!empty($keys['sandbox']) ? 'https://sandbox.sellingpartnerapi-na.amazon.com' : 'https://sellingpartnerapi-na.amazon.com');
  $lock = fopen(data_path('amazon-throttle.lock'), 'c+');
  flock($lock, LOCK_EX);
  $wait = AMZ_MIN_GAP_SECONDS - (microtime(true) - (float)stream_get_contents($lock));
  if ($wait > 0) usleep((int)($wait * 1e6));
  [$status, $body, $error] = http_send('GET', $host . $path . '?' . http_build_query($query), ['x-amz-access-token: ' . $token, 'Accept: application/json']);
  ftruncate($lock, 0);
  rewind($lock);
  fwrite($lock, (string)microtime(true));
  flock($lock, LOCK_UN);
  fclose($lock);
  if ($status === 0) fail(502, 'Could not reach Amazon: ' . $error);
  return [$status, $body];
}

// A game's lowest Amazon offers by UPC: catalog lookup (UPC -> ASIN), then getItemOffers for the condition.
// Renewed copies are separate Amazon products, so they never show up here.
function amazon_offers(string $upc, string $cond): void {
  $keys = amazon_keys();
  if (!$keys) fail(400, 'Amazon is not set up. A manager can add the keys in Settings.');
  if (!preg_match('/^\d{8,14}$/', $upc)) fail(400, 'Pass a UPC.');
  $condition = $cond === 'new' ? 'New' : 'Used';
  $cacheDir = data_path('cache');
  if (!is_dir($cacheDir)) @mkdir($cacheDir, 0700);
  $cacheFile = $cacheDir . '/amz-' . $upc . '-' . strtolower($condition) . '.json';
  if (is_file($cacheFile) && time() - filemtime($cacheFile) < AMZ_CACHE_SECONDS) respond_raw(200, (string)file_get_contents($cacheFile));

  [$status, $body] = amazon_get($keys, '/catalog/2022-04-01/items', [
    'identifiers' => $upc, 'identifiersType' => 'UPC', 'marketplaceIds' => AMZ_MARKETPLACE, 'includedData' => 'summaries',
  ]);
  if ($status !== 200) fail(502, amazon_error($status, $body));
  $item = json_decode($body, true)['items'][0] ?? null;
  $out = ['status' => 'success', 'found' => false, 'condition' => $condition];
  if ($item && !empty($item['asin'])) {
    $asin = (string)$item['asin'];
    [$status, $body] = amazon_get($keys, '/products/pricing/v0/items/' . rawurlencode($asin) . '/offers', [
      'MarketplaceId' => AMZ_MARKETPLACE, 'ItemCondition' => $condition, 'CustomerType' => 'Consumer',
    ]);
    if ($status !== 200) fail(502, amazon_error($status, $body));
    $payload = json_decode($body, true)['payload'] ?? [];
    $offers = [];
    foreach ((array)($payload['Offers'] ?? []) as $o) {
      $price = (float)($o['ListingPrice']['Amount'] ?? 0) + (float)($o['Shipping']['Amount'] ?? 0);
      if ($price <= 0) continue;
      $offers[] = ['price' => (int)round($price * 100), 'sub' => (string)($o['SubCondition'] ?? ''), 'fba' => !empty($o['IsFulfilledByAmazon'])];
    }
    usort($offers, function ($a, $b) { return $a['price'] <=> $b['price']; });
    $out = [
      'status' => 'success', 'found' => true, 'condition' => $condition, 'asin' => $asin,
      'title' => cut_text((string)($item['summaries'][0]['itemName'] ?? ''), 160),
      'url' => 'https://www.amazon.com/dp/' . rawurlencode($asin),
      'count' => (int)($payload['Summary']['TotalOfferCount'] ?? count($offers)),
      'lowest' => $offers[0]['price'] ?? null, 'offers' => $offers, // Amazon returns up to its 20 lowest
    ];
  }
  $json = (string)json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  @file_put_contents($cacheFile, $json, LOCK_EX);
  respond_raw(200, $json);
}

// Every save of settings / hardware prices also goes in <name>-history.jsonl (newest last, the last
// HISTORY_KEEP kept), so a mistyped number can be found and undone. The first save also records the
// version it replaces.
function add_history(string $name, string $raw): void {
  $file = data_path($name . '-history.jsonl');
  $oneLine = function (string $json): string { return trim(str_replace(["\r", "\n"], ' ', $json)); }; // JSON strings never hold raw newlines
  $lines = is_file($file) ? (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: []) : [];
  if (!$lines && is_file(data_path($name . '.json'))) {
    $prev = $oneLine((string)file_get_contents(data_path($name . '.json')));
    if ($prev !== '' && $prev !== 'null' && is_array(json_decode($prev, true))) {
      $lines[] = '{"time":' . json_encode(gmdate('c', (int)filemtime(data_path($name . '.json')))) . ',"role":"before history","data":' . $prev . '}';
    }
  }
  $lines[] = '{"time":' . json_encode(gmdate('c')) . ',"role":' . json_encode(current_role()) . ',"data":' . $oneLine($raw) . '}';
  $lines = array_slice($lines, -HISTORY_KEEP);
  $tmp = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
  if (file_put_contents($tmp, implode("\n", $lines) . "\n", LOCK_EX) === false || !@rename($tmp, $file)) @unlink($tmp);
}

// The fields a manager may correct on a logged trade (PUT trades), checked and trimmed. Anything else
// in $c is ignored; id, time, role and edits can never be changed.
function clean_trade_changes(array $c): array {
  $money = function ($v): bool { return is_int($v) && $v >= 0 && $v <= 100000000; };
  $text = function ($v): string { return is_scalar($v) ? trim((string)$v) : ''; }; // never "Array" or a notice
  $out = [];
  foreach (['customer' => 'Customer', 'staff' => 'Staff name'] as $k => $label) {
    if (!array_key_exists($k, $c)) continue;
    $v = $text($c[$k]);
    if ($v === '') fail(400, "$label can't be blank.");
    $out[$k] = cut_text($v, 120);
  }
  if (array_key_exists('notes', $c)) {
    $v = $text($c['notes']);
    $out['notes'] = $v === '' ? null : cut_text($v, 1000);
  }
  if (array_key_exists('items', $c)) {
    if (!is_array($c['items']) || !$c['items'] || array_values($c['items']) !== $c['items'] || count($c['items']) > 500) fail(400, 'A trade needs at least one item.');
    $items = [];
    foreach ($c['items'] as $it) {
      if (!is_array($it)) fail(400, 'That item is not in the right format.');
      $name = $text($it['name'] ?? '');
      if ($name === '') fail(400, 'Every item needs a name.');
      $qty = $it['qty'] ?? 1;
      if (!is_int($qty) || $qty < 1 || $qty > 9999) fail(400, "Check the quantity for $name.");
      foreach (['cash', 'credit'] as $k) {
        if (array_key_exists($k, $it) && $it[$k] !== null && !$money($it[$k])) fail(400, "Check the $k amount for $name.");
      }
      $clean = ['name' => cut_text($name, 200), 'qty' => $qty, 'cash' => $it['cash'] ?? null, 'credit' => $it['credit'] ?? null];
      foreach (['platform', 'type', 'condition', 'note', 'upc', 'serial', 'detail'] as $k) {
        if (isset($it[$k]) && $text($it[$k]) !== '') $clean[$k] = cut_text($text($it[$k]), 500);
      }
      if (!empty($it['dontBuy'])) $clean['dontBuy'] = true;
      if (!empty($it['cashEdited'])) $clean['cashEdited'] = true;
      if (isset($it['creditBonus']) && is_numeric($it['creditBonus'])) $clean['creditBonus'] = $it['creditBonus'] + 0;
      if (isset($it['deductions']) && is_array($it['deductions'])) {
        $clean['deductions'] = array_values(array_map(function ($d) { return cut_text((string)$d, 120); }, array_filter($it['deductions'], 'is_string')));
      }
      $items[] = $clean;
    }
    $out['items'] = $items;
  }
  if (array_key_exists('payout', $c)) {
    $p = $c['payout'];
    if (!is_array($p) || !in_array($p['type'] ?? '', ['cash', 'credit', 'split'], true) || !$money($p['cash'] ?? null) || !$money($p['credit'] ?? null)) {
      fail(400, 'Check the payout amounts.');
    }
    // The amounts are what was paid, so they decide the type (a type left on "credit" with $0 credit and
    // $40 cash is a cash payout).
    $type = $p['type'];
    if ($p['cash'] > 0 && $p['credit'] > 0) $type = 'split';
    elseif ($p['cash'] > 0) $type = 'cash';
    elseif ($p['credit'] > 0) $type = 'credit';
    $out['payout'] = ['type' => $type, 'cash' => $p['cash'], 'credit' => $p['credit']];
  }
  if (array_key_exists('totals', $c)) {
    $t = $c['totals'];
    if (!is_array($t) || !$money($t['cash'] ?? null) || !$money($t['credit'] ?? null) || !is_int($t['count'] ?? null) || $t['count'] < 0) {
      fail(400, 'Check the trade totals.');
    }
    $out['totals'] = ['cash' => $t['cash'], 'credit' => $t['credit'], 'count' => $t['count']];
  }
  return $out;
}

// A trade-log line's time (UTC ISO, written by POST trades), without decoding the whole record.
function trade_time(string $line): string {
  return preg_match('/"time":"([^"]+)"/', $line, $m) ? $m[1] : '';
}

function clear_cache(): void {
  foreach ((array)glob(data_path('cache') . '/*.json') as $f) @unlink($f);
}

/* ------------------------------------------------------------------ routes */

$method = (string)($_SERVER['REQUEST_METHOD'] ?? 'GET');
$route = trim((string)($_GET['route'] ?? ''), '/');

// Writes must be same-site JSON requests (blocks cross-site form posts).
if ($method !== 'GET') {
  if (stripos((string)($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json') !== 0) fail(415, 'Expected JSON.');
  if (($_SERVER['HTTP_SEC_FETCH_SITE'] ?? 'same-origin') === 'cross-site') fail(403, 'Cross-site request refused.');
}

switch ("$method $route") {
  case 'GET status':
    $role = current_role();
    respond(200, [
      'auth' => true,
      'setupNeeded' => config() === null,
      'role' => $role,
      'tokenSet' => $role !== null && (string)(config()['token'] ?? '') !== '',
      'amazonSet' => $role !== null && amazon_keys() !== null,
      'amazonSandbox' => $role !== null && !empty(config()['amazon']['sandbox']),
    ]);

  case 'POST setup':
    guard_login_rate();
    $in = json_body();
    $lock = fopen(data_path('setup.lock'), 'c');
    flock($lock, LOCK_EX);
    if (read_json('config.json') !== null) fail(409, 'Setup has already been done. Log in instead.');
    $code = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)($in['code'] ?? '')));
    if (!hash_equals(SETUP_CODE_SHA256, hash('sha256', $code))) {
      record_login(false);
      fail(400, 'That setup code is not right.');
    }
    $staff = (string)($in['staffPassword'] ?? '');
    $manager = (string)($in['managerPassword'] ?? '');
    check_password_rules($staff, $manager);
    $token = trim((string)($in['token'] ?? ''));
    if ($token !== '' && !ctype_alnum($token)) fail(400, "That doesn't look like a PriceCharting token (letters and numbers only).");
    $cfg = [
      'staffHash' => password_hash($staff, PASSWORD_DEFAULT),
      'managerHash' => password_hash($manager, PASSWORD_DEFAULT),
      'secret' => bin2hex(random_bytes(32)),
      'sessionVersion' => 1,
      'token' => $token,
    ];
    save_config($cfg);
    flock($lock, LOCK_UN);
    record_login(true);
    set_login_cookie('manager', $cfg);
    respond(200, ['ok' => true, 'role' => 'manager']);

  case 'POST login':
    $cfg = config();
    if (!$cfg) fail(409, 'The calculator has not been set up yet.');
    guard_login_rate();
    $password = (string)(json_body()['password'] ?? '');
    $role = password_verify($password, $cfg['managerHash']) ? 'manager'
      : (password_verify($password, $cfg['staffHash']) ? 'staff' : null);
    record_login($role !== null);
    if ($role === null) fail(400, 'Wrong password.');
    set_login_cookie($role, $cfg);
    respond(200, ['ok' => true, 'role' => $role]);

  case 'POST logout':
    clear_login_cookie();
    respond(200, ['ok' => true]);

  case 'GET settings':
  case 'GET hardware':
    require_role('staff');
    $file = $route . '.json';
    respond_raw(200, is_file(data_path($file)) ? (string)file_get_contents(data_path($file)) : 'null');

  case 'PUT settings':
  case 'PUT hardware':
    require_role('manager');
    $raw = (string)file_get_contents('php://input');
    $data = json_decode($raw, true);
    $valid = $route === 'hardware' ? (is_array($data) && array_values($data) === $data) : (is_array($data) && array_values($data) !== $data);
    if (!$valid) fail(400, 'That data is not in the right format.');
    add_history($route, $raw);
    write_atomic($route . '.json', $raw);
    respond(200, ['ok' => true]);

  // Saved versions of settings or hardware prices, newest first: [{ time, role, data }].
  case 'GET history':
    require_role('manager');
    $of = (string)($_GET['of'] ?? '');
    if (!in_array($of, ['settings', 'hardware'], true)) fail(400, 'Pass of=settings or of=hardware.');
    $file = data_path($of . '-history.jsonl');
    $lines = is_file($file) ? (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: []) : [];
    respond_raw(200, '[' . implode(',', array_reverse($lines)) . ']');

  case 'PUT token':
    require_role('manager');
    $token = trim((string)(json_body()['token'] ?? ''));
    if ($token !== '' && !ctype_alnum($token)) fail(400, "That doesn't look like a PriceCharting token (letters and numbers only).");
    $cfg = config();
    $cfg['token'] = $token;
    save_config($cfg);
    clear_cache();
    respond(200, ['tokenSet' => $token !== '']);

  case 'PUT passwords':
    require_role('manager');
    $in = json_body();
    $cfg = config();
    $staff = (string)($in['staffPassword'] ?? '');
    $manager = (string)($in['managerPassword'] ?? '');
    if ($staff === '' && $manager === '') fail(400, 'Enter at least one new password.');
    foreach ([$staff, $manager] as $p) {
      if ($p !== '' && strlen($p) < MIN_PASSWORD_LENGTH) fail(400, 'Passwords must be at least ' . MIN_PASSWORD_LENGTH . ' characters.');
    }
    // The two passwords must differ - including against whichever one isn't changing.
    $same = ($staff !== '' && $manager !== '' && $staff === $manager)
      || ($staff !== '' && $manager === '' && password_verify($staff, $cfg['managerHash']))
      || ($manager !== '' && $staff === '' && password_verify($manager, $cfg['staffHash']));
    if ($same) fail(400, 'The staff and manager passwords must be different.');
    if ($staff !== '') $cfg['staffHash'] = password_hash($staff, PASSWORD_DEFAULT);
    if ($manager !== '') $cfg['managerHash'] = password_hash($manager, PASSWORD_DEFAULT);
    $cfg['sessionVersion'] = (int)$cfg['sessionVersion'] + 1; // log out every device
    save_config($cfg);
    set_login_cookie('manager', $cfg); // ...except this one
    respond(200, ['ok' => true]);

  case 'GET pc/product':
    require_role('staff');
    foreach (['id', 'upc', 'q'] as $param) {
      if (isset($_GET[$param]) && $_GET[$param] !== '') pricecharting('product', $param, (string)$_GET[$param]);
    }
    fail(400, 'Pass id, upc, or q.');

  case 'GET pc/products':
    require_role('staff');
    $q = (string)($_GET['q'] ?? '');
    if ($q === '') fail(400, 'Pass q.');
    pricecharting('products', 'q', $q);

  // Trade log: one JSON object per line, one file per month (trades/2026-09.jsonl). No delete route;
  // managers can correct a trade with PUT trades, which keeps what it said before (below).
  case 'POST trades':
    require_role('staff');
    $raw = (string)file_get_contents('php://input');
    if (strlen($raw) > 262144) fail(413, 'That trade is too large to save.');
    $record = json_decode($raw, true);
    if (!is_array($record) || array_values($record) === $record || !is_array($record['items'] ?? null) || !$record['items']) {
      fail(400, 'That trade is not in the right format.');
    }
    $record = ['id' => bin2hex(random_bytes(6)), 'time' => gmdate('c'), 'role' => current_role()] + $record;
    $dir = data_path('trades');
    if (!is_dir($dir) && !@mkdir($dir, 0700)) fail(500, 'Could not create the trade log folder.');
    $line = json_encode($record, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n";
    if (file_put_contents($dir . '/' . gmdate('Y-m') . '.jsonl', $line, FILE_APPEND | LOCK_EX) === false) fail(500, 'Could not save the trade.');
    respond(200, ['ok' => true, 'id' => $record['id'], 'time' => $record['time']]);

  // Managers can correct a logged trade: { id, month: "YYYY-MM" (UTC, from its time), reason, changes }.
  // The record is rewritten in place in its month file, under the same lock POST trades appends with,
  // and what it looked like before goes on its "edits" list with when, which login, and why. Records are
  // never deleted. Returns the updated record.
  case 'PUT trades':
    require_role('manager');
    $raw = (string)file_get_contents('php://input');
    if (strlen($raw) > 262144) fail(413, 'That trade is too large to save.');
    $in = json_decode($raw, true);
    if (!is_array($in)) fail(400, 'That edit is not in the right format.');
    $id = is_string($in['id'] ?? null) ? $in['id'] : '';
    $month = is_string($in['month'] ?? null) ? $in['month'] : '';
    if (!preg_match('/^[a-f0-9]{12}$/', $id) || !preg_match('/^\d{4}-\d{2}$/', $month)
        || !is_array($in['changes'] ?? null) || array_values($in['changes']) === $in['changes']) {
      fail(400, 'That edit is not in the right format.');
    }
    $reason = is_string($in['reason'] ?? null) ? cut_text(trim($in['reason']), 300) : '';
    if ($reason === '') fail(400, 'Say why the trade is being changed.');
    $changes = clean_trade_changes($in['changes']);
    $file = data_path('trades') . '/' . $month . '.jsonl';
    if (!is_file($file)) fail(404, 'That trade was not found.');
    $fh = fopen($file, 'c+');
    if (!$fh) fail(500, 'Could not open the trade log.');
    flock($fh, LOCK_EX); // released at exit, so the fail()s below can't leave it locked
    $lines = explode("\n", rtrim((string)stream_get_contents($fh), "\n"));
    $updated = null;
    foreach ($lines as $i => $line) {
      if (strpos($line, '"id":"' . $id . '"') === false) continue;
      $rec = json_decode($line, true);
      if (!is_array($rec) || ($rec['id'] ?? '') !== $id) continue;
      $before = [];
      foreach ($changes as $k => $v) {
        $old = $rec[$k] ?? null;
        if (json_encode($old) === json_encode($v)) continue;
        $before[$k] = $old;
        if ($v === null) unset($rec[$k]); else $rec[$k] = $v;
      }
      if (!$before) fail(400, 'Nothing was changed.');
      $rec['edits'] = array_merge((array)($rec['edits'] ?? []), [['time' => gmdate('c'), 'role' => current_role(), 'reason' => $reason, 'before' => $before]]);
      $lines[$i] = json_encode($rec, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
      $updated = $rec;
      break;
    }
    if ($updated === null) fail(404, 'That trade was not found.');
    @copy($file, $file . '.bak'); // the month as it was, in case a rewrite is ever cut short
    ftruncate($fh, 0);
    rewind($fh);
    if (fwrite($fh, implode("\n", $lines) . "\n") === false) fail(500, 'Could not save the change. The backup is ' . basename($file) . '.bak.');
    fflush($fh);
    flock($fh, LOCK_UN);
    fclose($fh);
    respond(200, ['ok' => true, 'record' => $updated]);

  // q = substring search; from/to = UTC ISO times (from inclusive, to exclusive) for a date range,
  // which also raises the cap from LOG_MAX to LOG_MAX_RANGE (end-of-day totals, export).
  case 'GET trades':
    require_role('staff');
    $q = strtolower(trim((string)($_GET['q'] ?? '')));
    $from = (string)($_GET['from'] ?? '');
    $to = (string)($_GET['to'] ?? '');
    foreach ([$from, $to] as $t) {
      if ($t !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/', $t)) fail(400, 'Dates must look like 2026-10-07T04:00:00+00:00.');
    }
    $max = ($from !== '' || $to !== '') ? LOG_MAX_RANGE : LOG_MAX;
    $found = [];
    $files = glob(data_path('trades') . '/*.jsonl') ?: [];
    rsort($files); // newest month first
    foreach (array_slice($files, 0, 36) as $file) { // search back 3 years
      if ($from !== '' && basename($file, '.jsonl') < substr($from, 0, 7)) break; // whole month is before the range
      $lines = file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
      for ($i = count($lines) - 1; $i >= 0 && count($found) < $max; $i--) { // newest first
        $time = ($from !== '' || $to !== '') ? trade_time($lines[$i]) : '';
        if ($to !== '' && $time >= $to) continue;
        if ($from !== '' && $time < $from) break 2; // everything older is outside the range too
        if ($q === '' || strpos(strtolower($lines[$i]), $q) !== false) $found[] = $lines[$i];
      }
      if (count($found) >= $max) break;
    }
    respond_raw(200, '[' . implode(',', $found) . ']');

  case 'GET pc/sales':
    require_role('staff');
    pc_sales((string)($_GET['id'] ?? ''));

  case 'GET floor-sessions':
    require_role('staff');
    $id = (string)($_GET['id'] ?? '');
    $result = floor_sessions(function ($all) use ($id) {
      if ($id !== '') return [$all, $all[$id] ?? null, false];
      $list = [];
      foreach ($all as $s) {
        $list[] = ['id' => $s['id'], 'name' => $s['name'], 'staff' => $s['staff'] ?? '', 'updated' => $s['updated'], 'count' => count($s['items'] ?? [])];
      }
      usort($list, function ($a, $b) { return strcmp($b['updated'], $a['updated']); });
      return [$all, $list, false];
    });
    if ($id !== '' && $result === null) fail(404, 'That session was deleted.');
    respond(200, $result);

  case 'PUT floor-sessions':
    require_role('staff');
    $raw = (string)file_get_contents('php://input');
    if (strlen($raw) > 524288) fail(413, 'That session is too large to save. Split it into two.');
    $in = json_decode($raw, true);
    $name = trim((string)($in['name'] ?? ''));
    if (!is_array($in) || $name === '' || !is_array($in['items'] ?? null)) fail(400, 'A session needs a name and a list of games.');
    $id = (string)($in['id'] ?? '');
    if ($id !== '' && !preg_match('/^[a-f0-9]{12}$/', $id)) fail(400, 'That session id is not valid.');
    // baseUpdated = the session's "updated" time when this browser opened or last saved it. If someone
    // saved it since, refuse (409) instead of silently overwriting their games; force = overwrite anyway.
    $base = (string)($in['baseUpdated'] ?? '');
    $saved = floor_sessions(function ($all) use ($in, $id, $name, $base) {
      if ($id !== '' && isset($all[$id]) && $base !== '' && $all[$id]['updated'] !== $base && empty($in['force'])) {
        return [$all, ['conflict' => true, 'updated' => $all[$id]['updated'], 'staff' => $all[$id]['staff'] ?? ''], false];
      }
      $now = gmdate('c');
      if ($id === '' || !isset($all[$id])) $id = bin2hex(random_bytes(6));
      $all[$id] = [
        'id' => $id, 'name' => cut_text($name, 80), 'staff' => cut_text(trim((string)($in['staff'] ?? '')), 60),
        'created' => $all[$id]['created'] ?? $now, 'updated' => $now, 'items' => array_values($in['items']),
      ];
      if (count($all) > MAX_FLOOR_SESSIONS) { // drop the oldest
        uasort($all, function ($a, $b) { return strcmp($b['updated'], $a['updated']); });
        $all = array_slice($all, 0, MAX_FLOOR_SESSIONS, true);
      }
      return [$all, ['id' => $id, 'updated' => $now], true];
    });
    if (!empty($saved['conflict'])) {
      respond(409, ['status' => 'error', 'error-message' => 'Someone else saved this session since you opened it.', 'conflict' => $saved]);
    }
    respond(200, ['ok' => true] + $saved);

  case 'DELETE floor-sessions':
    require_role('staff');
    $id = (string)($_GET['id'] ?? '');
    floor_sessions(function ($all) use ($id) { unset($all[$id]); return [$all, null, true]; });
    respond(200, ['ok' => true]);

  case 'GET amazon/offers':
    require_role('staff');
    amazon_offers((string)($_GET['upc'] ?? ''), (string)($_GET['cond'] ?? 'used'));

  // Save the Amazon keys. Blank fields keep what's saved; {"clear": true} removes them all.
  case 'PUT amazon':
    require_role('manager');
    $in = json_body();
    $cfg = config();
    $amz = !empty($in['clear']) ? [] : (array)($cfg['amazon'] ?? []);
    if (empty($in['clear'])) {
      foreach (['clientId', 'clientSecret', 'refreshToken'] as $k) {
        $v = trim((string)($in[$k] ?? ''));
        if ($v === '') continue;
        if (strlen($v) > 2000 || preg_match('/\s/', $v)) fail(400, "That $k doesn't look right. Copy it again from Amazon.");
        $amz[$k] = $v;
      }
      if (array_key_exists('sandbox', $in)) $amz['sandbox'] = !empty($in['sandbox']);
    }
    $cfg['amazon'] = $amz;
    save_config($cfg);
    @unlink(data_path('amazon-token.json'));
    foreach ((array)glob(data_path('cache') . '/amz-*.json') as $f) @unlink($f);
    respond(200, ['amazonSet' => amazon_keys() !== null, 'amazonSandbox' => !empty($amz['sandbox'])]);

  // Checks the keys by trading them for an access token (works for sandbox and production apps).
  case 'GET amazon/test':
    require_role('manager');
    $keys = amazon_keys();
    if (!$keys) fail(400, 'Save all three Amazon keys first.');
    @unlink(data_path('amazon-token.json'));
    amazon_access_token($keys);
    respond(200, ['ok' => true, 'sandbox' => !empty($keys['sandbox'])]);

  default:
    fail(404, "No route for $method $route");
}
