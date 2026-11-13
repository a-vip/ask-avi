<?php
/**
 * Ask Avi — Backend Auth, User Registry & Admin Analytics Endpoint
 * Routed via .htaccess from ./api/auth -> api/auth.php
 */
declare(strict_types=1);

require_once __DIR__ . '/wp-bootstrap.php';
ask_avi_ensure_tables();

global $wpdb;
$users_table = $wpdb->prefix . 'ask_avi_users';
$logs_table = $wpdb->prefix . 'ask_avi_logs';
$settings = ask_avi_get_settings();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}

$reqUser = ask_avi_resolve_request_user();

function ask_avi_format_client_user(array $row, ?string $token = null): array {
  $email = strtolower((string) $row['email']);
  $res = [
    'id' => (string) $row['id'],
    'name' => (string) $row['name'],
    'email' => $email,
    'picture' => !empty($row['picture']) ? (string) $row['picture'] : null,
    'provider' => (string) $row['provider'],
    'isAdmin' => ($row['role'] === 'admin' && $email === ASK_AVI_ADMIN_EMAIL),
    'marketingOptIn' => !empty($row['marketing_opt_in']),
    'signedInAt' => (int) ($row['last_seen_at'] ?? round(microtime(true) * 1000)),
  ];
  if ($token !== null) {
    $res['sessionToken'] = $token;
  }
  return $res;
}

function ask_avi_issue_token_for_row(array $row): string {
  return ask_avi_sign_token([
    'sub' => (string) $row['id'],
    'email' => strtolower((string) $row['email']),
    'name' => (string) $row['name'],
    'role' => (string) $row['role'],
    'provider' => (string) $row['provider'],
    'exp' => (int) round(microtime(true) * 1000) + (ASK_AVI_TOKEN_TTL * 1000),
  ]);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
  $action = $_GET['action'] ?? '';

  if ($action === 'admin_overview') {
    if (!$reqUser) {
      ask_avi_send_json(401, ['ok' => false, 'error' => 'Authentication required.']);
    }
    if (($reqUser['role'] ?? '') !== 'admin' || strtolower($reqUser['email']) !== ASK_AVI_ADMIN_EMAIL) {
      ask_avi_send_json(403, ['ok' => false, 'error' => 'Admin privileges required.']);
    }

    $users = $wpdb->get_results(
      "SELECT id, name, email, provider, role, marketing_opt_in, created_at, last_seen_at, login_count, chat_count, error_count
       FROM {$users_table} ORDER BY last_seen_at DESC LIMIT 500",
      ARRAY_A
    ) ?: [];

    $logs = $wpdb->get_results(
      "SELECT id, ts, type, level, user_email, model_used, status_code, latency_ms, message
       FROM {$logs_table} ORDER BY ts DESC LIMIT 150",
      ARRAY_A
    ) ?: [];

    $dayAgoMs = (int) round(microtime(true) * 1000) - (24 * 60 * 60 * 1000);
    $totalUsers = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$users_table}");
    $optInCount = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$users_table} WHERE marketing_opt_in = 1");
    $totalChats = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$logs_table} WHERE type IN ('chat_ok','chat_error')");
    $errorCount = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$logs_table} WHERE level = 'error'");
    $last24hChats = (int) $wpdb->get_var(
      $wpdb->prepare("SELECT COUNT(*) FROM {$logs_table} WHERE ts >= %d AND type IN ('chat_ok','chat_error')", $dayAgoMs)
    );

    ask_avi_send_json(200, [
      'ok' => true,
      'stats' => [
        'totalUsers' => $totalUsers,
        'marketingOptInCount' => $optInCount,
        'totalChats' => $totalChats,
        'errorCount' => $errorCount,
        'last24hChats' => $last24hChats,
      ],
      'users' => array_map(static fn($u) => [
        'id' => $u['id'],
        'name' => $u['name'],
        'email' => $u['email'],
        'provider' => $u['provider'],
        'role' => $u['role'],
        'marketingOptIn' => (bool) $u['marketing_opt_in'],
        'createdAt' => (int) $u['created_at'],
        'lastSeenAt' => (int) $u['last_seen_at'],
        'loginCount' => (int) $u['login_count'],
        'chatCount' => (int) $u['chat_count'],
        'errorCount' => (int) $u['error_count'],
      ], $users),
      'logs' => array_map(static fn($l) => [
        'id' => $l['id'],
        'ts' => (int) $l['ts'],
        'type' => $l['type'],
        'level' => $l['level'],
        'userEmail' => $l['user_email'],
        'modelUsed' => $l['model_used'] ?: null,
        'statusCode' => $l['status_code'] !== null ? (int) $l['status_code'] : null,
        'latencyMs' => $l['latency_ms'] !== null ? (int) $l['latency_ms'] : null,
        'message' => $l['message'],
      ], $logs),
      'serverKeys' => [
        'groq' => !empty($settings['groq_api_key']),
        'openrouter' => !empty($settings['openrouter_api_key']),
        'gemini' => !empty($settings['gemini_api_key']),
        'googleOAuth' => !empty($settings['google_client_id']),
        'adminPasscode' => !empty($settings['admin_passcode']),
      ],
    ]);
  }

  // Config / session status
  $currentUserPayload = null;
  if ($reqUser) {
    $email = strtolower($reqUser['email']);
    if (($reqUser['provider'] ?? '') === 'wordpress' && !empty($email)) {
      $nowMs = (int) round(microtime(true) * 1000);
      $existing = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$users_table} WHERE email = %s", $email), ARRAY_A);
      if (!$existing) {
        $row = [
          'id' => 'wp_' . bin2hex(random_bytes(5)),
          'email' => $email,
          'name' => $reqUser['name'] ?: $email,
          'picture' => null,
          'provider' => 'wordpress',
          'role' => $reqUser['role'],
          'password_hash' => null,
          'marketing_opt_in' => 0,
          'created_at' => $nowMs,
          'last_seen_at' => $nowMs,
          'login_count' => 1,
          'chat_count' => 0,
          'error_count' => 0,
        ];
        $wpdb->insert($users_table, $row);
        $existing = $row;
      } else {
        $wpdb->update($users_table, [
          'last_seen_at' => $nowMs,
          'role' => $reqUser['role'],
        ], ['id' => $existing['id']]);
        $existing['last_seen_at'] = $nowMs;
        $existing['role'] = $reqUser['role'];
      }
      $currentUserPayload = ask_avi_format_client_user($existing, ask_avi_issue_token_for_row($existing));
    } else {
      $existing = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$users_table} WHERE email = %s", $email), ARRAY_A);
      if ($existing) {
        $currentUserPayload = ask_avi_format_client_user($existing);
      }
    }
  }

  $wpLoginUrl = function_exists('wp_login_url') ? wp_login_url(home_url('/ask-avi/')) : '';
  $wpLogoutUrl = function_exists('wp_logout_url') ? wp_logout_url(home_url('/ask-avi/')) : '';

  ask_avi_send_json(200, [
    'ok' => true,
    'googleEnabled' => !empty($settings['google_client_id']),
    'googleClientId' => (string) ($settings['google_client_id'] ?? ''),
    'wpSsoEnabled' => true,
    'wpLoginUrl' => $wpLoginUrl,
    'wpLogoutUrl' => $wpLogoutUrl,
    'hasAdminPasscode' => !empty($settings['admin_passcode']),
    'currentUser' => $currentUserPayload,
  ]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  ask_avi_send_json(405, ['ok' => false, 'error' => 'Method not allowed.']);
}

$raw = file_get_contents('php://input');
$body = json_decode($raw ?: '{}', true);
if (!is_array($body)) {
  ask_avi_send_json(400, ['ok' => false, 'error' => 'Invalid JSON request body.']);
}

$action = trim((string) ($body['action'] ?? ''));

if ($action === 'google') {
  $credential = trim((string) ($body['credential'] ?? $body['idToken'] ?? ''));
  if ($credential === '') {
    ask_avi_send_json(400, ['ok' => false, 'error' => 'Missing Google ID token.']);
  }

  $verifyUrl = 'https://oauth2.googleapis.com/tokeninfo?id_token=' . rawurlencode($credential);
  $resp = function_exists('wp_remote_get')
    ? wp_remote_get($verifyUrl, ['timeout' => 12])
    : null;

  if (!$resp || is_wp_error($resp) || (int) wp_remote_retrieve_response_code($resp) !== 200) {
    ask_avi_send_json(401, ['ok' => false, 'error' => 'Google ID token verification failed.']);
  }

  $info = json_decode((string) wp_remote_retrieve_body($resp), true);
  $verified = isset($info['email_verified']) && ($info['email_verified'] === 'true' || $info['email_verified'] === true);
  if (!$verified || empty($info['email'])) {
    ask_avi_send_json(401, ['ok' => false, 'error' => 'Google account email is not verified.']);
  }
  if (!empty($settings['google_client_id']) && ($info['aud'] ?? '') !== $settings['google_client_id']) {
    ask_avi_send_json(401, ['ok' => false, 'error' => 'Google Sign-In client ID mismatch.']);
  }

  $email = strtolower(trim((string) $info['email']));
  $name = trim((string) ($info['name'] ?? '')) ?: explode('@', $email)[0];
  $picture = trim((string) ($info['picture'] ?? '')) ?: null;
  $role = ($email === ASK_AVI_ADMIN_EMAIL) ? 'admin' : 'user';
  $nowMs = (int) round(microtime(true) * 1000);
  $optIn = !empty($body['marketingOptIn']) ? 1 : 0;

  $existing = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$users_table} WHERE email = %s", $email), ARRAY_A);
  $isNew = !$existing;

  if ($isNew) {
    $existing = [
      'id' => 'g_' . bin2hex(random_bytes(6)),
      'email' => $email,
      'name' => $name,
      'picture' => $picture,
      'provider' => 'google',
      'role' => $role,
      'password_hash' => null,
      'marketing_opt_in' => $optIn,
      'created_at' => $nowMs,
      'last_seen_at' => $nowMs,
      'login_count' => 1,
      'chat_count' => 0,
      'error_count' => 0,
    ];
    $wpdb->insert($users_table, $existing);
  } else {
    $wpdb->update($users_table, [
      'name' => $name,
      'picture' => $picture,
      'provider' => 'google',
      'role' => $role,
      'last_seen_at' => $nowMs,
      'login_count' => ((int) $existing['login_count']) + 1,
      'marketing_opt_in' => isset($body['marketingOptIn']) ? $optIn : (int) $existing['marketing_opt_in'],
    ], ['id' => $existing['id']]);
    $existing['name'] = $name;
    $existing['picture'] = $picture;
    $existing['provider'] = 'google';
    $existing['role'] = $role;
    $existing['last_seen_at'] = $nowMs;
  }

  ask_avi_record_log([
    'type' => $isNew ? 'auth_signup' : 'auth_signin',
    'level' => 'info',
    'user_email' => $email,
    'status_code' => 200,
    'message' => ($isNew ? 'Signed up' : 'Signed in') . " via Google ({$role})",
  ]);

  $token = ask_avi_issue_token_for_row($existing);
  ask_avi_send_json(200, ['ok' => true, 'user' => ask_avi_format_client_user($existing, $token)]);
}

if ($action === 'signup' || $action === 'signin') {
  $email = strtolower(trim((string) ($body['email'] ?? '')));
  $password = (string) ($body['password'] ?? '');
  $nameInput = trim((string) ($body['name'] ?? ''));
  $adminPasscode = trim((string) ($body['adminPasscode'] ?? ''));
  $optIn = !empty($body['marketingOptIn']) ? 1 : 0;

  if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    ask_avi_send_json(400, ['ok' => false, 'error' => 'Please enter a valid email address.']);
  }
  if (strlen($password) < 6) {
    ask_avi_send_json(400, ['ok' => false, 'error' => 'Password must be at least 6 characters.']);
  }

  $isAdminTarget = ($email === ASK_AVI_ADMIN_EMAIL);
  if ($isAdminTarget) {
    $configuredPasscode = trim((string) ($settings['admin_passcode'] ?? ''));
    if ($configuredPasscode === '' || !hash_equals($configuredPasscode, $adminPasscode)) {
      ask_avi_record_log([
        'type' => 'auth_denied',
        'level' => 'warn',
        'user_email' => $email,
        'status_code' => 403,
        'message' => "Denied unverified admin {$action} attempt.",
      ]);
      ask_avi_send_json(403, [
        'ok' => false,
        'error' => $configuredPasscode === ''
          ? 'Set Admin Passcode in WP Admin -> Ask Avi, or sign in via Google/WordPress.'
          : 'Invalid admin verification passcode for workwithavip@gmail.com.',
      ]);
    }
  }

  $existing = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$users_table} WHERE email = %s", $email), ARRAY_A);
  $nowMs = (int) round(microtime(true) * 1000);

  if ($action === 'signup') {
    if ($existing) {
      ask_avi_send_json(409, ['ok' => false, 'error' => 'An account with this email already exists. Please sign in instead.']);
    }
    $row = [
      'id' => 'u_' . bin2hex(random_bytes(6)),
      'email' => $email,
      'name' => $nameInput !== '' ? $nameInput : explode('@', $email)[0],
      'picture' => null,
      'provider' => 'email',
      'role' => $isAdminTarget ? 'admin' : 'user',
      'password_hash' => password_hash($password, PASSWORD_DEFAULT),
      'marketing_opt_in' => $optIn,
      'created_at' => $nowMs,
      'last_seen_at' => $nowMs,
      'login_count' => 1,
      'chat_count' => 0,
      'error_count' => 0,
    ];
    $wpdb->insert($users_table, $row);
    ask_avi_record_log([
      'type' => 'auth_signup',
      'level' => 'info',
      'user_email' => $email,
      'status_code' => 200,
      'message' => "Created {$row['role']} account via Email.",
    ]);
    $token = ask_avi_issue_token_for_row($row);
    ask_avi_send_json(200, ['ok' => true, 'user' => ask_avi_format_client_user($row, $token)]);
  }

  // signin
  if (!$existing) {
    if ($isAdminTarget) {
      $row = [
        'id' => 'u_' . bin2hex(random_bytes(6)),
        'email' => $email,
        'name' => $nameInput !== '' ? $nameInput : 'Avi Perera',
        'picture' => null,
        'provider' => 'email',
        'role' => 'admin',
        'password_hash' => password_hash($password, PASSWORD_DEFAULT),
        'marketing_opt_in' => 0,
        'created_at' => $nowMs,
        'last_seen_at' => $nowMs,
        'login_count' => 1,
        'chat_count' => 0,
        'error_count' => 0,
      ];
      $wpdb->insert($users_table, $row);
      ask_avi_record_log([
        'type' => 'auth_signup',
        'level' => 'info',
        'user_email' => $email,
        'status_code' => 200,
        'message' => 'Verified admin signed in & initialized admin profile.',
      ]);
      $token = ask_avi_issue_token_for_row($row);
      ask_avi_send_json(200, ['ok' => true, 'user' => ask_avi_format_client_user($row, $token)]);
    }
    ask_avi_send_json(401, ['ok' => false, 'error' => 'No account found for that email. Switch to Create account to sign up.']);
  }

  if (!empty($existing['password_hash'])) {
    if (!password_verify($password, (string) $existing['password_hash'])) {
      ask_avi_record_log([
        'type' => 'auth_denied',
        'level' => 'warn',
        'user_email' => $email,
        'status_code' => 401,
        'message' => 'Incorrect password on Email sign-in.',
      ]);
      ask_avi_send_json(401, ['ok' => false, 'error' => 'Incorrect email or password.']);
    }
  } elseif ($existing['provider'] === 'google' && !$isAdminTarget) {
    ask_avi_send_json(400, ['ok' => false, 'error' => 'This account uses Google Sign-In. Please continue with Google.']);
  }

  $role = $isAdminTarget ? 'admin' : (string) $existing['role'];
  $wpdb->update($users_table, [
    'last_seen_at' => $nowMs,
    'login_count' => ((int) $existing['login_count']) + 1,
    'role' => $role,
  ], ['id' => $existing['id']]);
  $existing['last_seen_at'] = $nowMs;
  $existing['role'] = $role;

  ask_avi_record_log([
    'type' => 'auth_signin',
    'level' => 'info',
    'user_email' => $email,
    'status_code' => 200,
    'message' => "Signed in via Email ({$role}).",
  ]);
  $token = ask_avi_issue_token_for_row($existing);
  ask_avi_send_json(200, ['ok' => true, 'user' => ask_avi_format_client_user($existing, $token)]);
}

if ($action === 'telemetry') {
  $level = ($body['level'] ?? '') === 'error' || ($body['level'] ?? '') === 'warn' ? $body['level'] : 'info';
  ask_avi_record_log([
    'type' => 'client_error',
    'level' => $level,
    'user_email' => $reqUser['email'] ?? 'guest',
    'model_used' => isset($body['engineId']) ? (string) $body['engineId'] : null,
    'status_code' => isset($body['statusCode']) ? (int) $body['statusCode'] : null,
    'message' => (string) ($body['message'] ?? 'Client diagnostic event'),
  ]);
  ask_avi_send_json(200, ['ok' => true]);
}

ask_avi_send_json(400, ['ok' => false, 'error' => 'Unknown auth action.']);
