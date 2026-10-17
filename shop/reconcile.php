<?php
declare(strict_types=1);
require __DIR__ . '/lib.php';
require __DIR__ . '/kiosk.php';
require __DIR__ . '/checkout.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');
if (!shop_service_allowed()) { http_response_code(403); echo '{"error":"Authentication required"}'; exit; }
ignore_user_abort(true);
@set_time_limit(180);
echo json_encode(web_reconcile_due(), JSON_THROW_ON_ERROR);
