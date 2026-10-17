<?php
declare(strict_types=1);

// Durable checkout recovery. No remote create is repeated after an uncertain CC response.
function web_checkout_owner(): string {
  $owner = kiosk_unsign($_COOKIE['p2w_checkout'] ?? null, web_secret());
  if (!is_string($owner) || !preg_match('/^[a-f0-9]{48}$/', $owner)) {
    $owner = bin2hex(random_bytes(24));
    kiosk_set_cookie('p2w_checkout', kiosk_sign($owner, web_secret()), 14 * 86400);
  }
  return $owner;
}

function web_create_allowed(string $owner): bool {
  $key = hash_hmac('sha256', (string)($_SERVER['REMOTE_ADDR'] ?? 'local'), web_secret());
  $lock = shop_lock('checkout-rate', $key, true);
  if (!$lock) return false;
  try {
    $name = 'checkout-rate-' . $key . '.json';
    $times = array_values(array_filter(shop_read_json($name) ?: [], function ($t) { return $t > time() - 900; }));
    if (count($times) >= 10) return false;
    $times[] = time(); shop_write_json($name, $times); return true;
  } finally { shop_unlock($lock); }
}

function web_wait(array $o, string $message = ''): array {
  return ['pending' => true, 'id' => $o['pp'] ?? '', 'ref' => $o['ref'], 'problems' => [$message ?: 'We are checking your payment and inventory order. Do not pay again. Keep reference ' . $o['ref'] . ' or call 865-910-8357.']];
}

function web_order_get(string $ref): array {
  return web_find_order(function ($o) use ($ref) { return $o['ref'] === $ref; }) ?: [];
}

function web_order_data(): array {
  $data = shop_read_json('shop-orders.json');
  if ($data === null && !is_file(shop_data_dir() . '/shop-orders.json')) return ['seq' => 1000, 'orders' => []];
  if (!is_array($data) || !isset($data['orders']) || !is_array($data['orders'])) throw new RuntimeException('Order records are unreadable; preserve the file and restore a verified backup');
  return $data;
}

function web_try_receipt(array $o): array {
  if (($o['mailStatus'] ?? '') === 'sent' || ($o['mailAttempts'] ?? 0) >= 5 || ($o['mailAttemptAt'] ?? 0) > time() - 300) return $o;
  // At-least-once email delivery: a crash after SMTP acceptance can send a duplicate receipt, never a duplicate charge.
  $o = web_order_set($o['ref'], ['mailStatus' => 'sending', 'mailAttemptAt' => time(), 'mailAttempts' => ($o['mailAttempts'] ?? 0) + 1]);
  try { $ok = web_mail_confirmation($o); } catch (Throwable $e) { $ok = false; }
  return web_order_set($o['ref'], ['mailStatus' => $ok ? 'sent' : 'failed']);
}

function web_refund_result(array $o): array {
  if (!empty($o['ccAttemptAt'])) return web_wait($o, 'The inventory order needs staff review before a refund. Do not pay again; call 865-910-8357 with ' . $o['ref'] . '.');
  if (!empty($o['refundId'])) {
    [$s, $j] = pp_api('GET', '/v2/payments/refunds/' . rawurlencode($o['refundId']));
  } elseif (!empty($o['refundAttemptAt'])) {
    [$s, $capture] = pp_api('GET', '/v2/payments/captures/' . rawurlencode($o['capture']));
    if ($s === 200 && ($capture['status'] ?? '') === 'REFUNDED') {
      web_order_set($o['ref'], ['status' => 'refunded']);
      return ['problems' => ['PayPal confirms that this payment was refunded. Reference ' . $o['ref'] . '.']];
    }
    web_order_set($o['ref'], ['status' => 'refund-unknown']);
    return web_wait($o, 'The refund result needs staff verification. Do not pay again; contact the store with ' . $o['ref'] . '.');
  } else {
    $o = web_order_set($o['ref'], ['status' => 'refund-requesting', 'refundAttemptAt' => time()]);
    [$s, $j] = pp_api('POST', '/v2/payments/captures/' . rawurlencode($o['capture']) . '/refund', new stdClass(), ['PayPal-Request-Id: refund-' . $o['capture']]);
  }
  $fields = ['refundHttp' => $s];
  if (!empty($j['id'])) $fields['refundId'] = (string)$j['id'];
  $state = $s >= 200 && $s < 300 ? ($j['status'] ?? '') : '';
  $fields['status'] = $state === 'COMPLETED' ? 'refunded' : ($state === 'PENDING' ? 'refund-pending' : ($state === 'FAILED' || in_array($s, [400, 401, 403, 422], true) ? 'refund-failed' : 'refund-unknown'));
  $o = web_order_set($o['ref'], $fields);
  if ($o['status'] === 'refunded') return ['problems' => ['Your payment was refunded. Contact the store with ' . $o['ref'] . ' if you need help.']];
  return web_wait($o, $o['status'] === 'refund-pending' ? 'Your refund is pending at PayPal. Keep reference ' . $o['ref'] . '; the store is tracking it.' : 'Your refund needs staff attention. Keep reference ' . $o['ref'] . ' and call 865-910-8357.');
}

function web_process_order(string $ref, bool $fromBuyer = false): array {
  $lock = shop_lock('web-order', $ref);
  if (!$lock) return web_wait(['ref' => $ref], 'This order is already being checked. Please wait; do not pay again.');
  try {
    $o = web_order_get($ref);
    if (!$o) return ['problems' => ['Order not found. Contact the store before paying again.']];
    if (in_array($o['status'], ['paid', 'fulfilled'], true)) {
      if (!$fromBuyer && $o['status'] === 'paid' && !empty($o['capture']) && ($o['paypal'] ?? '') === (web_cfg()['ppLive'] ? 'live' : 'sandbox')) {
        [$s, $capture] = pp_api('GET', '/v2/payments/captures/' . rawurlencode($o['capture']));
        if ($s === 200 && ($capture['status'] ?? '') !== 'COMPLETED') {
          $state = ($capture['status'] ?? '') === 'REFUNDED' ? (!empty($o['ccAttemptAt']) ? 'cc-cancel-required' : 'refunded') : 'payment-review';
          $o = web_order_set($ref, ['status' => $state, 'why' => 'PayPal capture changed to ' . ($capture['status'] ?? 'unknown') . '; verify before pickup']);
          return web_wait($o);
        }
      }
      $o = web_try_receipt($o);
      return ['redirect' => web_order_url($o)];
    }
    if ($o['status'] === 'refunded') return ['problems' => ['This payment was refunded. Contact the store with ' . $ref . ' if you need help.']];
    if (in_array($o['status'], ['abandoned', 'payment-failed'], true)) return ['problems' => ['This checkout is closed. Review your cart before starting again.'], 'reload' => true];
    if (($o['version'] ?? 0) < 2 || ($o['paypal'] ?? '') !== (web_cfg()['ppLive'] ? 'live' : 'sandbox')) return web_wait($o, 'This order requires staff reconciliation in its original payment environment. Do not pay again.');
    if (strpos($o['status'], 'refund-') === 0) return web_refund_result($o);
    if ($o['status'] === 'cc-cancel-required') return web_wait($o, 'The payment was refunded, but staff must cancel the inventory order. Contact the store with ' . $ref . '.');
    if ($o['status'] === 'payment-review') return web_wait($o, 'Staff must review the payment before pickup. Contact the store with ' . $ref . '.');

    $captureResponse = null;
    if ($o['status'] === 'pending' && empty($o['captureAttemptAt'])) {
      if (!$fromBuyer) return web_wait($o); // background jobs never capture a merely created order
      if (web_config_problem() !== null || (bool)$o['test'] !== !web_cfg()['ordersLive']) return web_wait($o, 'Checkout configuration changed. Contact the store before paying.');
      $check = web_check_cart();
      $shape = function ($items) { return array_map(function ($i) { return [$i['variant'], $i['qty'], $i['cents']]; }, $items); };
      if (!isset($check['items']) || $shape($check['items']) !== $shape($o['items'])) {
        web_order_set($ref, ['status' => 'abandoned']);
        return ['problems' => array_merge($check['problems'] ?? [], ['Your cart changed before payment. Review the updated order.']), 'reload' => true];
      }
      // This survives process termination or a lost response. Recovery uses GET, never a new capture request.
      $o = web_order_set($ref, ['status' => 'capture-unknown', 'captureAttemptAt' => time(), 'cartToken' => web_cart_token()]);
      $captureResponse = pp_api('POST', '/v2/checkout/orders/' . rawurlencode($o['pp']) . '/capture', new stdClass(), ['PayPal-Request-Id: capture-' . $ref, 'Prefer: return=representation']);
    }
    if ($captureResponse === null) $captureResponse = pp_api('GET', '/v2/checkout/orders/' . rawurlencode($o['pp']));
    [$s, $j] = $captureResponse;
    $cap = $j['purchase_units'][0]['payments']['captures'][0] ?? null;
    if (!is_array($cap) || empty($cap['id'])) {
      if (($j['details'][0]['issue'] ?? '') === 'INSTRUMENT_DECLINED') {
        web_order_set($ref, ['status' => 'pending', 'captureAttemptAt' => null]);
        return ['problems' => ['Your payment method was declined. Choose another payment method.'], 'retry' => true];
      }
      // A GET without a capture does not prove a previous POST will never complete.
      web_order_set($ref, ['why' => 'Capture outcome requires reconciliation (HTTP ' . $s . ')']);
      return web_wait($o);
    }
    $o = web_order_set($ref, ['capture' => (string)$cap['id'], 'captureStatus' => (string)($cap['status'] ?? '')]);
    if (in_array($cap['status'] ?? '', ['REFUNDED', 'PARTIALLY_REFUNDED'], true)) {
      $o = web_order_set($ref, ['status' => !empty($o['ccAttemptAt']) ? 'cc-cancel-required' : (($cap['status'] ?? '') === 'REFUNDED' ? 'refunded' : 'refund-failed')]);
      return web_wait($o, 'A refund was recorded. Staff are checking the payment and inventory order; contact the store with ' . $ref . '.');
    }
    if (($cap['status'] ?? '') !== 'COMPLETED') {
      web_order_set($ref, ['status' => in_array($cap['status'] ?? '', ['DECLINED', 'FAILED'], true) ? 'payment-failed' : 'payment-pending']);
      return web_wait($o);
    }
    $correct = ($cap['amount']['currency_code'] ?? '') === 'USD' && (int)round((float)($cap['amount']['value'] ?? 0) * 100) === (int)$o['total'];
    if (!$correct) {
      $o = web_order_set($ref, ['status' => !empty($o['ccAttemptAt']) ? 'cc-unknown' : 'refund-needed', 'why' => 'Captured amount/currency does not match checkout']);
      return !empty($o['ccAttemptAt']) ? web_wait($o) : web_refund_result($o);
    }
    if (!empty($o['ccId'])) return web_confirm_cc($o);
    if (!empty($o['ccAttemptAt'])) {
      web_order_set($ref, ['status' => 'cc-unknown', 'why' => 'CC create result unknown; locate by website reference/capture before further action']);
      return web_wait($o);
    }
    if ($o['test']) return web_finish_order($o, null);
    if (web_config_problem() !== null || !web_cfg()['ordersLive']) return web_wait($o, 'Payment received; inventory setup needs staff attention. Do not pay again.');
    $o = web_order_set($ref, ['status' => 'cc-creating', 'ccAttemptAt' => time()]);
    [$id, $error, $outcome] = web_cc_order($o, $o['capture']);
    if ($id) {
      $o = web_order_set($ref, ['ccId' => $id, 'status' => 'cc-verifying']);
      return web_confirm_cc($o);
    }
    if ($outcome === 'rejected') {
      // An explicit validation rejection is the only case where automatic compensation is safe.
      $o = web_order_set($ref, ['status' => 'refund-needed', 'ccAttemptAt' => null, 'why' => $error]);
      return web_refund_result($o);
    }
    $o = web_order_set($ref, ['status' => 'cc-unknown', 'why' => $error]);
    return web_wait($o);
  } catch (Throwable $e) {
    // The stage already persisted before the side effect tells staff/worker what may have happened.
    $o = web_order_get($ref);
    if ($o) web_order_set($ref, ['why' => 'Recovery interrupted: ' . get_class($e)]);
    return web_wait($o ?: ['ref' => $ref]);
  } finally { shop_unlock($lock); }
}

function web_confirm_cc(array $o): array {
  [$s, $j] = shop_cc('GET', '/orders/' . (int)$o['ccId'], 'admin:read-orders');
  $r = is_array($j) ? ($j['order'] ?? $j) : [];
  if ($s === 200 && (int)($r['id'] ?? 0) === (int)$o['ccId'] && ($r['status'] ?? '') === KIOSK_CC_STATUS) return web_finish_order($o, (int)$o['ccId']);
  web_order_set($o['ref'], ['status' => 'cc-unknown', 'why' => 'CC order ' . $o['ccId'] . ' could not be verified; do not recreate or refund blindly']);
  return web_wait($o);
}

function web_finish_order(array $o, ?int $id): array {
  $o = web_order_set($o['ref'], ['status' => 'paid', 'ccId' => $id, 'num' => $id ? (string)$id : $o['ref'], 'paidAt' => time()]);
  $o = web_try_receipt($o);
  return ['redirect' => web_order_url($o)];
}

function web_reconcile_due(int $limit = 5): array {
  $lock = shop_lock('worker', 'orders');
  if (!$lock) return ['busy' => true];
  try {
    $orders = web_order_data()['orders'];
    usort($orders, function ($a, $b) { return ($a['checkedAt'] ?? 0) <=> ($b['checkedAt'] ?? 0); });
    $checked = 0; $deadline = microtime(true) + 45;
    foreach ($orders as $o) {
      if ($checked >= $limit || microtime(true) > $deadline) break;
      if (($o['version'] ?? 0) < 2 || in_array($o['status'], ['pending', 'abandoned', 'refunded', 'fulfilled', 'payment-failed'], true)) continue;
      if ($o['status'] === 'paid' && ($o['mailStatus'] ?? '') === 'sent' && ($o['checkedAt'] ?? 0) > time() - 900) continue;
      if (($o['checkedAt'] ?? 0) > time() - 60) continue;
      web_process_order($o['ref']);
      web_order_set($o['ref'], ['checkedAt' => time()]); $checked++;
    }
    return ['checked' => $checked];
  } finally { shop_unlock($lock); }
}

function web_staff_token(): string { return hash_hmac('sha256', 'manage:' . ($_COOKIE[KIOSK_STAFF_COOKIE] ?? ''), web_secret()); }

function web_kick_reconcile(): void {
  if (PHP_SAPI === 'cli-server' || !is_file(shop_data_dir() . '/shop-orders.json')) return;
  $lock = shop_lock('worker-kick', 'orders');
  if (!$lock) return;
  try {
    $stamp = shop_data_dir() . '/reconcile-kick.txt';
    if (is_file($stamp) && (int)file_get_contents($stamp) > time() - 60) return;
    file_put_contents($stamp, (string)time());
    $ch = curl_init('https://play2wingames.com/shop/reconcile.php');
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT_MS => 1500, CURLOPT_NOSIGNAL => true, CURLOPT_HTTPHEADER => ['X-Shop-Sync-Key: ' . shop_service_key()]]);
    curl_exec($ch); curl_close($ch);
  } finally { shop_unlock($lock); }
}

function web_manage_page(bool $post): void {
  if (!kiosk_staff()) kiosk_404();
  $message = '';
  if ($post) {
    if (!hash_equals(web_staff_token(), (string)($_POST['token'] ?? ''))) kiosk_404();
    $ref = (string)($_POST['ref'] ?? '');
    $lock = shop_lock('web-order', $ref);
    if (!$lock) $message = 'This order is busy; try again shortly.';
    else {
      try {
        $o = web_order_get($ref);
        if ($o && ($_POST['do'] ?? '') === 'attach' && !empty($o['capture'])) {
          $id = (int)($_POST['ccId'] ?? 0);
          [$s, $j] = shop_cc('GET', '/orders/' . $id, 'admin:read-orders');
          $r = is_array($j) ? ($j['order'] ?? $j) : [];
          $note = (string)($r['vendor_comments'] ?? '') . ' ' . (string)($r['customer_comments'] ?? '');
          if ($s === 200 && (int)($r['id'] ?? 0) === $id && strpos($note, $ref) !== false && strpos($note, $o['capture']) !== false) {
            web_order_set($ref, ['ccId' => $id, 'ccAttemptAt' => $o['ccAttemptAt'] ?? time(), 'status' => 'cc-verifying']); $message = 'Linked verified CrystalCommerce order. Check status to resume verification.';
          } else $message = 'Order could not be linked: its comments must contain this website reference and capture ID.';
        } elseif ($o && ($_POST['do'] ?? '') === 'receipt' && in_array($o['status'], ['paid', 'fulfilled'], true)) {
          web_order_set($ref, ['mailAttemptAt' => 0, 'mailAttempts' => 0]);
          $message = 'Receipt retry enabled. Check status to send it.';
        } elseif ($o && ($_POST['do'] ?? '') === 'cancelled' && !empty($o['ccId']) && !empty($o['capture'])) {
          [$ps, $capture] = pp_api('GET', '/v2/payments/captures/' . rawurlencode($o['capture']));
          [$cs, $remote] = shop_cc('GET', '/orders/' . (int)$o['ccId'], 'admin:read-orders');
          $remote = is_array($remote) ? ($remote['order'] ?? $remote) : [];
          if ($ps === 200 && ($capture['status'] ?? '') === 'REFUNDED' && $cs === 200 && ($remote['status'] ?? '') === 'Void') {
            web_order_set($ref, ['status' => 'refunded', 'cancelVerifiedAt' => time()]); $message = 'PayPal refund and CC cancellation verified.';
          } else $message = 'Resolution refused: PayPal must confirm REFUNDED and CrystalCommerce must confirm Void. Cancel/refund in their admin tools first.';
        } elseif ($o && ($_POST['do'] ?? '') === 'fulfilled' && $o['status'] === 'paid') {
          [$ps, $capture] = pp_api('GET', '/v2/payments/captures/' . rawurlencode($o['capture'] ?? ''));
          if ($ps === 200 && ($capture['status'] ?? '') === 'COMPLETED') {
            web_order_set($ref, ['status' => 'fulfilled', 'fulfilledAt' => time()]); $message = 'Marked picked up in this list. Keep CrystalCommerce updated separately.';
          } else $message = 'Pickup completion refused: the payment is not confirmed completed. Check PayPal first.';
        }
      } finally { shop_unlock($lock); }
      if (($_POST['do'] ?? '') === 'check') { web_process_order($ref); $message = 'Status checked. See the current result below.'; }
    }
  }
  $orders = array_reverse(web_order_data()['orders']);
  $rows = '';
  foreach ($orders as $o) {
    if (in_array($o['status'], ['abandoned', 'refunded', 'fulfilled'], true)) continue;
    $form = '<input type="hidden" name="token" value="' . h(web_staff_token()) . '"><input type="hidden" name="ref" value="' . h($o['ref']) . '">';
    $rows .= '<li class="web-order kiosk-ord"><h2>' . h($o['ref']) . ' · ' . h($o['status']) . '</h2><p>' . h($o['name']) . ' · ' . h($o['email']) . ' · ' . shop_money((int)$o['total']) . '</p><p>PayPal: ' . h($o['paypal'] ?? '?') . ' · Capture: ' . h($o['capture'] ?? 'not confirmed') . ' · CC: ' . h($o['ccId'] ?? 'not confirmed') . ' · Receipt: ' . h($o['mailStatus'] ?? 'not sent') . '</p><p>' . h($o['why'] ?? '') . '</p>'
      . '<form method="post">' . $form . '<button class="button secondary" name="do" value="check">Check status</button>' . ($o['status'] === 'paid' ? '<button class="button secondary" name="do" value="fulfilled">Confirm picked up</button><button class="button secondary" name="do" value="receipt">Enable receipt retry</button>' : '') . (!empty($o['ccId']) && !empty($o['capture']) ? '<button class="button secondary" name="do" value="cancelled">Verify refund and CC cancellation</button>' : '') . '</form>'
      . (!empty($o['capture']) && empty($o['ccId']) && !empty($o['ccAttemptAt']) ? '<form method="post">' . $form . '<label>Existing CC order ID <input name="ccId" inputmode="numeric" required></label><button class="button secondary" name="do" value="attach">Link verified order</button></form>' : '') . '</li>';
  }
  shop_page('Website order recovery', 'Staff website orders', '<section class="shop-section"><h1>Website orders</h1><p><a href="/shop/kiosk/orders">Kiosk orders and interrupted attempts</a></p>' . (web_config_problem() !== null ? '<p class="kiosk-problems">' . h(web_config_problem()) . '</p>' : '') . '<p role="status">' . h($message) . '</p><p>For unknown payments, check PayPal by its order/capture ID. For unknown CC creates, search the admin for the website reference and capture ID. Never create another order or refund until you know what happened. If refunding manually, cancel the CC order and release its stock before handing anything out.</p><ul class="web-orders">' . ($rows ?: '<li>No open website orders.</li>') . '</ul></section>', ['crumbs' => [], 'private' => true]);
}
