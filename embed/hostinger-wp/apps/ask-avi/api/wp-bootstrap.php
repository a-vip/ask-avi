<?php
/**
 * Ask Avi — WordPress Bootstrap, MySQL Registry & Signed Session Helpers
 * Located inside <theme>/apps/ask-avi/api/wp-bootstrap.php
 */
declare(strict_types=1);

define('ASK_AVI_ADMIN_EMAIL', 'workwithavip@gmail.com');
define('ASK_AVI_OPTION_KEY', 'ask_avi_settings');
define('ASK_AVI_SECRET_OPTION', 'ask_avi_auth_secret');
define('ASK_AVI_SCHEMA_VER', '1');
define('ASK_AVI_TOKEN_TTL', 30 * 24 * 60 * 60);

/**
 * Locate wp-load.php upwards from the theme apps subfolder.
 */
function ask_avi_boot_wordpress(): bool {
  if (defined('ABSPATH')) {
    return true;
  }
  $dir = __DIR__;
  for ($i = 0; $i < 8; $i++) {
    $candidate = $dir . '/wp-load.php';
    if (file_exists($candidate)) {
      define('SHORTINIT', false);
      require_once $candidate;
      return true;
    }
    $parent = dirname($dir);
    if ($parent === $dir) {
      break;
    }
    $dir = $parent;
  }
  return false;
}

ask_avi_boot_wordpress();

function ask_avi_get_settings(): array {
  $defaults = [
    'groq_api_key' => '',
    'openrouter_api_key' => '',
    'gemini_api_key' => '',
    'google_client_id' => '',
    'admin_passcode' => '',
  ];
  if (function_exists('get_option')) {
    $saved = get_option(ASK_AVI_OPTION_KEY, []);
    if (is_array($saved)) {
      $defaults = array_merge($defaults, $saved);
    }
  }
  foreach ([
    'groq_api_key' => 'GROQ_API_KEY',
    'openrouter_api_key' => 'OPENROUTER_API_KEY',
    'gemini_api_key' => 'GEMINI_API_KEY',
    'google_client_id' => 'GOOGLE_CLIENT_ID',
    'admin_passcode' => 'ASK_AVI_ADMIN_PASSCODE',
  ] as $k => $envName) {
    if (empty($defaults[$k])) {
      $envVal = getenv($envName);
      if (is_string($envVal) && trim($envVal) !== '') {
        $defaults[$k] = trim($envVal);
      }
    }
  }
  return $defaults;
}

function ask_avi_ensure_tables(): void {
  global $wpdb;
  if (!isset($wpdb) || !defined('ABSPATH')) {
    return;
  }
  static $checked = false;
  if ($checked) {
    return;
  }
  $checked = true;

  if (function_exists('get_option') && get_option('ask_avi_schema_ver') === ASK_AVI_SCHEMA_VER) {
    return;
  }

  $users_table = $wpdb->prefix . 'ask_avi_users';
  $logs_table = $wpdb->prefix . 'ask_avi_logs';
  $charset_collate = $wpdb->get_charset_collate();

  require_once ABSPATH . 'wp-admin/includes/upgrade.php';

  $sql_users = "CREATE TABLE {$users_table} (
    id varchar(40) NOT NULL,
    email varchar(190) NOT NULL,
    name varchar(190) NOT NULL,
    picture text NULL,
    provider varchar(32) NOT NULL DEFAULT 'email',
    role varchar(20) NOT NULL DEFAULT 'user',
    password_hash varchar(255) NULL,
    marketing_opt_in tinyint(1) NOT NULL DEFAULT 0,
    created_at bigint(20) NOT NULL,
    last_seen_at bigint(20) NOT NULL,
    login_count int(11) NOT NULL DEFAULT 1,
    chat_count int(11) NOT NULL DEFAULT 0,
    error_count int(11) NOT NULL DEFAULT 0,
    PRIMARY KEY  (id),
    UNIQUE KEY email_unique (email)
  ) {$charset_collate};";

  $sql_logs = "CREATE TABLE {$logs_table} (
    id varchar(40) NOT NULL,
    ts bigint(20) NOT NULL,
    type varchar(32) NOT NULL,
    level varchar(16) NOT NULL DEFAULT 'info',
    user_email varchar(190) NOT NULL DEFAULT 'guest',
    model_used varchar(128) NULL,
    status_code int(11) NULL,
    latency_ms int(11) NULL,
    message text NOT NULL,
    PRIMARY KEY  (id),
    KEY ts_idx (ts),
    KEY level_idx (level)
  ) {$charset_collate};";

  dbDelta($sql_users);
  dbDelta($sql_logs);
  if (function_exists('update_option')) {
    update_option('ask_avi_schema_ver', ASK_AVI_SCHEMA_VER, false);
  }
}

function ask_avi_get_auth_secret(): string {
  if (function_exists('get_option') && function_exists('update_option')) {
    $secret = get_option(ASK_AVI_SECRET_OPTION, '');
    if (is_string($secret) && strlen($secret) >= 32) {
      return $secret;
    }
    $generated = bin2hex(random_bytes(32));
    update_option(ASK_AVI_SECRET_OPTION, $generated, false);
    return $generated;
  }
  return hash('sha256', __FILE__ . (defined('AUTH_KEY') ? AUTH_KEY : 'ask-avi'));
}

function ask_avi_base64url_encode(string $data): string {
  return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function ask_avi_base64url_decode(string $data): string {
  $pad = strlen($data) % 4;
  if ($pad > 0) {
    $data .= str_repeat('=', 4 - $pad);
  }
  return (string) base64_decode(strtr($data, '-_', '+/'));
}

function ask_avi_sign_token(array $payload): string {
  $body = ask_avi_base64url_encode((string) json_encode($payload));
  $sig = ask_avi_base64url_encode(hash_hmac('sha256', $body, ask_avi_get_auth_secret(), true));
  return $body . '.' . $sig;
}

function ask_avi_verify_token(?string $token): ?array {
  if (!$token || strpos($token, '.') === false) {
    return null;
  }
  [$body, $sig] = explode('.', $token, 2);
  $expected = ask_avi_base64url_encode(hash_hmac('sha256', $body, ask_avi_get_auth_secret(), true));
  if (!hash_equals($expected, $sig)) {
    return null;
  }
  $decoded = json_decode(ask_avi_base64url_decode($body), true);
  if (!is_array($decoded) || empty($decoded['email']) || empty($decoded['exp'])) {
    return null;
  }
  if ((int) $decoded['exp'] < (int) round(microtime(true) * 1000)) {
    return null;
  }
  return $decoded;
}

function ask_avi_get_authorization_header(): string {
  if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
    return trim((string) $_SERVER['HTTP_AUTHORIZATION']);
  }
  if (!empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
    return trim((string) $_SERVER['REDIRECT_HTTP_AUTHORIZATION']);
  }
  return '';
}

/**
 * Resolve verified user either from Bearer token or current WordPress session.
 */
function ask_avi_resolve_request_user(): ?array {
  $header = ask_avi_get_authorization_header();
  if (stripos($header, 'Bearer ') === 0) {
    $token = trim(substr($header, 7));
    $verified = ask_avi_verify_token($token);
    if ($verified !== null) {
      return [
        'sub' => (string) ($verified['sub'] ?? ''),
        'email' => strtolower((string) $verified['email']),
        'name' => (string) ($verified['name'] ?? ''),
        'role' => (string) ($verified['role'] ?? 'user'),
        'provider' => (string) ($verified['provider'] ?? 'email'),
      ];
    }
  }

  if (function_exists('is_user_logged_in') && is_user_logged_in() && function_exists('wp_get_current_user')) {
    $wpUser = wp_get_current_user();
    if ($wpUser && $wpUser->exists()) {
      $email = strtolower(trim((string) $wpUser->user_email));
      $isWpAdmin = function_exists('current_user_can') && current_user_can('manage_options');
      $isAviAdmin = $isWpAdmin && ($email === ASK_AVI_ADMIN_EMAIL || count_users()['total_users'] > 0);
      // Admin features require verified workwithavip@gmail.com OR explicit WP administrator matched to admin email.
      $role = ($isWpAdmin && $email === ASK_AVI_ADMIN_EMAIL) ? 'admin' : 'user';
      return [
        'sub' => 'wp_' . (string) $wpUser->ID,
        'email' => $email,
        'name' => (string) ($wpUser->display_name ?: $wpUser->user_login),
        'role' => $role,
        'provider' => 'wordpress',
        'isAdminWpFallback' => $isAviAdmin,
      ];
    }
  }

  return null;
}

function ask_avi_record_log(array $entry): void {
  global $wpdb;
  if (!isset($wpdb)) {
    return;
  }
  ask_avi_ensure_tables();
  $logs_table = $wpdb->prefix . 'ask_avi_logs';
  $nowMs = (int) round(microtime(true) * 1000);
  $row = array_filter([
    'id' => 'log_' . bin2hex(random_bytes(6)),
    'ts' => $nowMs,
    'type' => substr((string) ($entry['type'] ?? 'chat_ok'), 0, 32),
    'level' => substr((string) ($entry['level'] ?? 'info'), 0, 16),
    'user_email' => substr((string) ($entry['user_email'] ?? 'guest'), 0, 190),
    'model_used' => isset($entry['model_used']) ? substr((string) $entry['model_used'], 0, 128) : null,
    'status_code' => isset($entry['status_code']) ? (int) $entry['status_code'] : null,
    'latency_ms' => isset($entry['latency_ms']) ? (int) $entry['latency_ms'] : null,
    'message' => substr((string) ($entry['message'] ?? ''), 0, 500),
  ], static fn($v) => $v !== null);
  $wpdb->insert($logs_table, $row);
}

function ask_avi_record_chat_telemetry(?array $user, int $statusCode, ?string $modelUsed, int $latencyMs, ?string $errorMessage = null): void {
  global $wpdb;
  if (!isset($wpdb)) {
    return;
  }
  ask_avi_ensure_tables();
  $users_table = $wpdb->prefix . 'ask_avi_users';
  $ok = $statusCode >= 200 && $statusCode < 400;
  $email = $user['email'] ?? 'guest';
  $nowMs = (int) round(microtime(true) * 1000);

  if ($email !== 'guest') {
    $col = $ok ? 'chat_count' : 'error_count';
    $wpdb->query(
      $wpdb->prepare(
        "UPDATE {$users_table} SET {$col} = {$col} + 1, last_seen_at = %d WHERE email = %s",
        $nowMs,
        $email
      )
    );
  }

  ask_avi_record_log([
    'type' => $ok ? 'chat_ok' : 'chat_error',
    'level' => $ok ? 'info' : 'error',
    'user_email' => $email,
    'model_used' => $modelUsed,
    'status_code' => $statusCode,
    'latency_ms' => $latencyMs,
    'message' => $ok
      ? "Response streamed via " . ($modelUsed ?: 'upstream provider') . " in {$latencyMs}ms"
      : ($errorMessage ?: "Chat API returned HTTP {$statusCode}"),
  ]);
}

function ask_avi_send_json(int $status, array $payload): void {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
  header('X-LiteSpeed-Cache-Control: no-cache');
  echo json_encode($payload);
  exit;
}
