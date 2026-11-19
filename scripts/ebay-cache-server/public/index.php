<?php
require dirname(__DIR__) . '/ebay-sales-cache.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function respond(int $status, array $data): void {
  http_response_code($status);
  echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  exit;
}

function fail(int $status, string $message): void {
  respond($status, ['status' => 'error', 'error-message' => $message]);
}

function data_path(string $name): string {
  return getenv('P2W_EBAY_CACHE_HOME') . '/private/' . $name;
}

$token = trim((string)@file_get_contents(data_path('token'), false, null, 0, 128));
$authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if (!preg_match('/^[a-f0-9]{64}$/D', $token)) fail(503, 'Shared eBay cache is unavailable.');
if (!hash_equals('Bearer ' . $token, $authorization)) fail(401, 'Cache authorization required.');

$method = $_SERVER['REQUEST_METHOD'] ?? '';
if (!in_array($method, ['GET', 'POST'], true)) {
  header('Allow: GET, POST');
  fail(405, 'Use GET or POST.');
}
if ($method === 'POST' && stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) fail(415, 'Expected JSON.');
ebay_sales_cache_request($method, $_GET);
