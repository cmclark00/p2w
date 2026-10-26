<?php
// Public signed package download. Only versioned CRX filenames in this directory.
$version = $_GET['v'] ?? '';
if (!is_string($version) || !preg_match('/\A\d+(?:\.\d+){1,3}\z/', $version)) {
    http_response_code(400);
    exit('Invalid version');
}
$file = __DIR__ . '/helper-' . $version . '.crx';
if (!is_file($file)) {
    http_response_code(404);
    exit('Version not available');
}
header('Content-Type: application/x-chrome-extension');
header('Content-Length: ' . filesize($file));
header('Cache-Control: public, max-age=31536000, immutable');
header('X-Content-Type-Options: nosniff');
readfile($file);
