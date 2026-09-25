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
 *   POST trades / GET trades (q) completed-trade log, any logged-in user
 */

declare(strict_types=1);

// SHA-256 of the one-time setup code (dashes removed, uppercase). Only a hash
// lives here - the code itself was given to the shop owner. Useless once setup is done.
const SETUP_CODE_SHA256 = 'a3257f6bb85bfe885a89176d77c207ef600aecbaa6bf269e973daf2b3bad4cd3';

const COOKIE_NAME = 'p2w_tradein';
const SESSION_DAYS = 30;
const MIN_PASSWORD_LENGTH = 8;
const MAX_LOGIN_FAILS = 8;          // per IP ...
const LOGIN_WINDOW_SECONDS = 900;   // ... per 15 minutes
const PC_MIN_GAP_SECONDS = 1.1;     // PriceCharting allows 1 call/second
const PC_CACHE_SECONDS = 1800;      // re-scanning a game within 30 min costs no API call

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
  if (count($all[$ip] ?? []) >= MAX_LOGIN_FAILS) {
    fail(429, 'Too many wrong attempts. Wait 15 minutes and try again.');
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

function http_get(string $url): array {
  if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_TIMEOUT => 20,
      CURLOPT_CONNECTTIMEOUT => 10,
      CURLOPT_USERAGENT => 'P2W-TradeIn/1.0',
    ]);
    $body = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    return [$status, $body === false ? '' : (string)$body, $error];
  }
  $ctx = stream_context_create(['http' => ['timeout' => 20, 'ignore_errors' => true, 'header' => "User-Agent: P2W-TradeIn/1.0\r\n"]]);
  $body = @file_get_contents($url, false, $ctx);
  $status = 0;
  foreach ($http_response_header ?? [] as $h) {
    if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) $status = (int)$m[1];
  }
  return [$status, $body === false ? '' : (string)$body, $body === false ? 'request failed' : ''];
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
    write_atomic($route . '.json', $raw);
    respond(200, ['ok' => true]);

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

  // Trade log: one JSON object per line, one file per month (trades/2026-09.jsonl). Append-only -
  // there is deliberately no edit or delete route.
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

  case 'GET trades':
    require_role('staff');
    $q = strtolower(trim((string)($_GET['q'] ?? '')));
    $found = [];
    $files = glob(data_path('trades') . '/*.jsonl') ?: [];
    rsort($files); // newest month first
    foreach (array_slice($files, 0, 36) as $file) { // search back 3 years
      $lines = file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
      for ($i = count($lines) - 1; $i >= 0 && count($found) < 100; $i--) {
        if ($q === '' || strpos(strtolower($lines[$i]), $q) !== false) $found[] = $lines[$i];
      }
      if (count($found) >= 100) break;
    }
    respond_raw(200, '[' . implode(',', $found) . ']');

  default:
    fail(404, "No route for $method $route");
}
