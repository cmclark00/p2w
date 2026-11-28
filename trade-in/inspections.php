<?php
declare(strict_types=1);

// Called only by the staff-authenticated routes in api.php.
function inspection_db(): PDO {
  $db = new PDO('sqlite:' . data_path('console-inspections.sqlite'), null, null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_TIMEOUT => 5,
  ]);
  $db->exec('CREATE TABLE IF NOT EXISTS inspections (
    id TEXT PRIMARY KEY, saved TEXT NOT NULL, serial TEXT NOT NULL COLLATE NOCASE,
    intake TEXT NOT NULL COLLATE NOCASE, model TEXT NOT NULL, fields TEXT NOT NULL
  )');
  $db->exec('CREATE INDEX IF NOT EXISTS inspections_serial ON inspections(serial)');
  $db->exec('CREATE INDEX IF NOT EXISTS inspections_intake ON inspections(intake)');
  return $db;
}

function inspection_id(array $body): string {
  $id = $body['id'] ?? null;
  if (!is_string($id) || !preg_match('/^[a-f0-9]{32}$/D', $id)) fail(400, 'Invalid inspection reference.');
  return $id;
}

function save_inspection(PDO $db, array $body): void {
  $id = inspection_id($body);
  $fields = $body['fields'] ?? null;
  if (!is_array($fields) || count($fields) > 120) fail(400, 'Invalid inspection fields.');
  foreach ($fields as $key => $value) {
    if (!is_string($key) || !preg_match('/^[a-z][A-Za-z0-9]{0,31}$/D', $key) || !is_string($value)) {
      fail(400, 'Invalid inspection field.');
    }
    $fields[$key] = trim($value);
  }
  $serial = $fields['serial'] ?? '';
  $intake = $fields['intake'] ?? '';
  if ($serial === '' && $intake === '') fail(422, 'Enter a serial number or an intake number before saving.');
  if (strlen($serial) > 512 || strlen($intake) > 512) fail(422, 'Use a shorter serial or intake number.');
  // Canonical order makes an identical retry safe even if the client reorders its keys.
  ksort($fields);
  $data = json_encode($fields, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
  $insert = $db->prepare('INSERT INTO inspections (id,saved,serial,intake,model,fields)
    VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING');
  $insert->execute([$id, gmdate('c'), $serial, $intake, $fields['model'] ?? '', $data]);
  $record = $db->prepare('SELECT saved,fields FROM inspections WHERE id=?');
  $record->execute([$id]);
  $row = $record->fetch();
  if ($row['fields'] !== $data) fail(409, 'An earlier version was already saved. Look it up before starting another intake.');
  respond($insert->rowCount() ? 201 : 200, ['id' => $id, 'saved' => $row['saved']]);
}

function inspection_request(string $route): void {
  // Keep identifiers and customer details out of URL and access logs.
  $raw = file_get_contents('php://input', false, null, 0, 262145);
  if ($raw === false || strlen($raw) > 262144) fail(413, 'This inspection is too large to process.');
  $body = json_decode($raw, true);
  if (!is_array($body)) fail(400, 'Expected inspection data.');
  try {
    $db = inspection_db();
    if ($route === 'inspections/save') save_inspection($db, $body);
    if ($route === 'inspections/open') {
      $record = $db->prepare('SELECT saved,fields FROM inspections WHERE id=?');
      $record->execute([inspection_id($body)]);
      $row = $record->fetch();
      if (!$row) fail(404, 'Inspection not found.');
      respond(200, ['saved' => $row['saved'], 'fields' => json_decode($row['fields'], true, 512, JSON_THROW_ON_ERROR)]);
    }
    $number = $body['number'] ?? null;
    $offset = $body['offset'] ?? 0;
    if (!is_string($number) || trim($number) === '' || strlen($number) > 512 ||
        !is_int($offset) || $offset < 0) fail(400, 'Enter a serial number or an intake number.');
    $matches = $db->prepare('SELECT id,saved,serial,intake,model FROM inspections
      WHERE serial=? OR intake=? ORDER BY saved DESC, rowid DESC LIMIT 26 OFFSET ?');
    $matches->execute([trim($number), trim($number), $offset]);
    $rows = $matches->fetchAll();
    respond(200, ['matches' => array_slice($rows, 0, 25), 'more' => count($rows) > 25]);
  } catch (Throwable $error) {
    error_log('Console inspection storage error: ' . get_class($error));
    fail(503, 'Inspection storage is unavailable. Please try again.');
  }
}
