<?php
/**
 * Ask Avi — WordPress Admin Dashboard (Settings, Registered Users CSV, Troubleshooting Logs)
 * Include from your theme functions.php:
 *   require_once get_template_directory() . '/inc/ask-avi-admin.php';
 */
if (!defined('ABSPATH')) {
  exit;
}

/**
 * Automatically create & publish https://aviperera.com/ask-avi/ with the Ask Avi template,
 * provision database tables, and purge LiteSpeed caches on new theme version rollout.
 */
add_action('init', static function () {
  if (get_option('ask_avi_deployment_ver') === '20261115b') {
    return;
  }

  $bootstrap = get_template_directory() . '/apps/ask-avi/api/wp-bootstrap.php';
  if (file_exists($bootstrap)) {
    require_once $bootstrap;
    ask_avi_ensure_tables();
  }

  $page = get_page_by_path('ask-avi');
  if (!$page) {
    $page_id = wp_insert_post([
      'post_title' => 'Ask Avi',
      'post_name' => 'ask-avi',
      'post_status' => 'publish',
      'post_type' => 'page',
      'post_content' => '',
    ]);
    if ($page_id && !is_wp_error($page_id)) {
      update_post_meta($page_id, '_wp_page_template', 'page-ask-avi.php');
    }
  } else {
    update_post_meta($page->ID, '_wp_page_template', 'page-ask-avi.php');
    if ($page->post_status !== 'publish') {
      wp_update_post([
        'ID' => $page->ID,
        'post_status' => 'publish',
      ]);
    }
  }

  update_option('ask_avi_deployment_ver', '20261115b', false);
  flush_rewrite_rules(false);
  do_action('litespeed_purge_all');
  if (class_exists('\LiteSpeed\Purge')) {
    \LiteSpeed\Purge::purge_all();
  }
});

// Clean SEO page title on /ask-avi/
add_filter('pre_get_document_title', static function ($title) {
  if (is_page('ask-avi') || is_page_template('page-ask-avi.php')) {
    return 'Ask Avi — AI Persona · Avi Perera';
  }
  return $title;
}, 99999);

add_filter('document_title_parts', static function ($parts) {
  if (is_page('ask-avi') || is_page_template('page-ask-avi.php')) {
    $parts['title'] = 'Ask Avi — AI Persona';
  }
  return $parts;
}, 99999);

// Prevent LiteSpeed Cache lazy-loading from rewriting the Ask Avi iframe to about:blank on mobile
add_filter('litespeed_optm_html_lazy_iframe_exc', static function ($excludes) {
  $excludes[] = 'ask-avi-host-frame';
  $excludes[] = 'apps/ask-avi';
  return $excludes;
});

add_action('template_redirect', static function () {
  if (is_page('ask-avi') || is_page_template('page-ask-avi.php')) {
    do_action('litespeed_conf_force', 'media-iframe_lazy', false);
    return;
  }

  // Provide aviperera.com/ask as a clean shortlink redirect to aviperera.com/ask-avi/
  if (is_404() && !empty($_SERVER['REQUEST_URI'])) {
    $path = trim((string) wp_parse_url(wp_unslash($_SERVER['REQUEST_URI']), PHP_URL_PATH), '/');
    if (strtolower($path) === 'ask') {
      wp_safe_redirect(home_url('/ask-avi/'), 301);
      exit;
    }
  }
});

add_action('admin_menu', static function () {
  add_menu_page(
    'Ask Avi',
    'Ask Avi',
    'manage_options',
    'ask-avi-admin',
    'ask_avi_render_admin_page',
    'dashicons-format-chat',
    31
  );
});

add_action('admin_post_ask_avi_export_csv', static function () {
  if (!current_user_can('manage_options')) {
    wp_die('Unauthorized');
  }
  check_admin_referer('ask_avi_export_csv');

  global $wpdb;
  $users_table = $wpdb->prefix . 'ask_avi_users';
  $rows = $wpdb->get_results("SELECT * FROM {$users_table} ORDER BY last_seen_at DESC", ARRAY_A) ?: [];

  header('Content-Type: text/csv; charset=utf-8');
  header('Content-Disposition: attachment; filename="ask-avi-users-' . gmdate('Y-m-d') . '.csv"');
  $out = fopen('php://output', 'w');
  fputcsv($out, ['Name', 'Email', 'Provider', 'Role', 'Opt-In', 'Logins', 'Chats', 'Errors', 'Created', 'Last Seen']);

  foreach ($rows as $u) {
    $safe = static function ($val) {
      $s = (string) $val;
      return preg_match('/^[=+\-@\t\r]/', $s) ? "'" . $s : $s;
    };
    fputcsv($out, [
      $safe($u['name']),
      $safe($u['email']),
      $safe($u['provider']),
      $safe($u['role']),
      !empty($u['marketing_opt_in']) ? 'Yes' : 'No',
      (int) $u['login_count'],
      (int) $u['chat_count'],
      (int) $u['error_count'],
      gmdate('c', (int) floor(((int) $u['created_at']) / 1000)),
      gmdate('c', (int) floor(((int) $u['last_seen_at']) / 1000)),
    ]);
  }
  fclose($out);
  exit;
});

add_action('admin_post_ask_avi_delete_user', static function () {
  if (!current_user_can('manage_options')) {
    wp_die('Unauthorized');
  }
  $user_id = sanitize_text_field(wp_unslash($_POST['user_id'] ?? ''));
  if ($user_id === '') {
    wp_safe_redirect(admin_url('admin.php?page=ask-avi-admin&deleted=0'));
    exit;
  }
  check_admin_referer('ask_avi_delete_user_' . $user_id);

  global $wpdb;
  $users_table = $wpdb->prefix . 'ask_avi_users';
  $deleted = $wpdb->delete($users_table, ['id' => $user_id], ['%s']);
  wp_safe_redirect(admin_url('admin.php?page=ask-avi-admin&deleted=' . ($deleted ? '1' : '0')));
  exit;
});

function ask_avi_render_admin_page(): void {
  if (!current_user_can('manage_options')) {
    return;
  }

  $bootstrap = get_template_directory() . '/apps/ask-avi/api/wp-bootstrap.php';
  if (file_exists($bootstrap)) {
    require_once $bootstrap;
    ask_avi_ensure_tables();
  }

  global $wpdb;
  $users_table = $wpdb->prefix . 'ask_avi_users';
  $logs_table = $wpdb->prefix . 'ask_avi_logs';
  $users_exists = ($wpdb->get_var("SHOW TABLES LIKE '{$users_table}'") === $users_table);

  $saved = false;
  $masterReset = false;
  $adminPwSaved = false;
  $adminPwError = '';
  if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['ask_avi_reset_master_prompt'])) {
    check_admin_referer('ask_avi_save_settings');
    $existing = function_exists('ask_avi_get_settings') ? ask_avi_get_settings() : (get_option('ask_avi_settings', []) ?: []);
    if (!is_array($existing)) $existing = [];
    $existing['master_prompt'] = '';
    update_option('ask_avi_settings', $existing, false);
    $masterReset = true;
    $saved = true;
  } elseif ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['ask_avi_save_settings'])) {
    check_admin_referer('ask_avi_save_settings');
    $existing = function_exists('ask_avi_get_settings') ? ask_avi_get_settings() : (get_option('ask_avi_settings', []) ?: []);
    if (!is_array($existing)) $existing = [];

    $rawMaster = array_key_exists('master_prompt', $_POST)
      ? trim(str_replace(["\r\n", "\r"], "\n", (string) wp_unslash($_POST['master_prompt'])))
      : (string) ($existing['master_prompt'] ?? '');
    $defaultMaster = function_exists('ask_avi_default_master_prompt') ? trim(ask_avi_default_master_prompt()) : '';
    if ($rawMaster !== '' && $defaultMaster !== '' && $rawMaster === $defaultMaster) {
      $rawMaster = '';
    }
    if (function_exists('mb_substr')) {
      $rawMaster = mb_substr($rawMaster, 0, 12000, 'UTF-8');
    } else {
      $rawMaster = substr($rawMaster, 0, 12000);
    }

    $next = [
      'groq_api_key' => sanitize_text_field(wp_unslash($_POST['groq_api_key'] ?? '')),
      'openrouter_api_key' => sanitize_text_field(wp_unslash($_POST['openrouter_api_key'] ?? '')),
      'gemini_api_key' => sanitize_text_field(wp_unslash($_POST['gemini_api_key'] ?? '')),
      'google_client_id' => sanitize_text_field(wp_unslash($_POST['google_client_id'] ?? '')),
      'admin_passcode' => '',
      'master_prompt' => $rawMaster,
    ];
    update_option('ask_avi_settings', $next, false);

    $rawAdminPw = trim((string) wp_unslash($_POST['admin_ask_avi_password'] ?? ''));
    if ($rawAdminPw !== '') {
      if (strlen($rawAdminPw) < 6) {
        $adminPwError = 'Admin password must be at least 6 characters (API keys were still saved).';
      } elseif (!$users_exists) {
        $adminPwError = 'Ask Avi user table is not initialized yet; reload and try again.';
      } else {
        $adminEmail = defined('ASK_AVI_ADMIN_EMAIL') ? ASK_AVI_ADMIN_EMAIL : 'workwithavip@gmail.com';
        $pwHash = password_hash($rawAdminPw, PASSWORD_DEFAULT);
        $existingAdmin = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$users_table} WHERE email = %s", $adminEmail), ARRAY_A);
        $nowMs = (int) round(microtime(true) * 1000);
        if ($existingAdmin) {
          $wpdb->update(
            $users_table,
            [
              'role' => 'admin',
              'password_hash' => $pwHash,
              'last_seen_at' => $nowMs,
            ],
            ['id' => $existingAdmin['id']]
          );
        } else {
          $wpdb->insert(
            $users_table,
            [
              'id' => 'u_' . bin2hex(random_bytes(6)),
              'email' => $adminEmail,
              'name' => 'Avi Perera',
              'picture' => null,
              'provider' => 'email',
              'role' => 'admin',
              'password_hash' => $pwHash,
              'marketing_opt_in' => 0,
              'created_at' => $nowMs,
              'last_seen_at' => $nowMs,
              'login_count' => 0,
              'chat_count' => 0,
              'error_count' => 0,
            ]
          );
        }
        $adminPwSaved = true;
      }
    }
    $saved = true;
  }

  $opts = get_option('ask_avi_settings', []);
  $adminEmail = defined('ASK_AVI_ADMIN_EMAIL') ? ASK_AVI_ADMIN_EMAIL : 'workwithavip@gmail.com';
  $hasAdminPassword = $users_exists
    ? (bool) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$users_table} WHERE email = %s AND password_hash IS NOT NULL AND password_hash != ''", $adminEmail))
    : false;
  $users = $users_exists
    ? ($wpdb->get_results("SELECT * FROM {$users_table} ORDER BY last_seen_at DESC LIMIT 500", ARRAY_A) ?: [])
    : [];
  $logs = $users_exists
    ? ($wpdb->get_results("SELECT * FROM {$logs_table} ORDER BY ts DESC LIMIT 80", ARRAY_A) ?: [])
    : [];

  $totalUsers = count($users);
  $optInUsers = 0;
  $googleUsers = 0;
  $emailUsers = 0;
  foreach ($users as $u) {
    if (!empty($u['marketing_opt_in'])) $optInUsers++;
    if (($u['provider'] ?? '') === 'google') $googleUsers++;
    elseif (($u['provider'] ?? '') === 'email') $emailUsers++;
  }
  $dayAgoMs = (int) round(microtime(true) * 1000) - (24 * 60 * 60 * 1000);
  $chats24h = $users_exists ? (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$logs_table} WHERE ts >= %d AND type IN ('chat_ok','chat_error')", $dayAgoMs)) : 0;
  $errTotal = $users_exists ? (int) $wpdb->get_var("SELECT COUNT(*) FROM {$logs_table} WHERE level = 'error'") : 0;
  ?>
  <div class="wrap">
    <h1>Ask Avi — AI Persona Administration</h1>
    <p>
      Public route: <code><?php echo esc_html(home_url('/ask-avi/')); ?></code>
      (shortlink: <code><?php echo esc_html(home_url('/ask/')); ?></code>) ·
      <a href="<?php echo esc_url(home_url('/ask-avi/')); ?>" target="_blank" class="button button-secondary" style="margin-left:8px;">Open Live Ask Avi (/ask-avi/) &nearr;</a>
    </p>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:16px 0 20px;">
      <div style="background:#fff;border:1px solid #ccd0d4;border-radius:6px;padding:12px 14px;">
        <div style="font-size:11px;text-transform:uppercase;color:#646970;">Registered Accounts</div>
        <div style="font-size:22px;font-weight:700;margin-top:4px;"><?php echo (int) $totalUsers; ?></div>
        <div style="font-size:12px;color:#646970;">Google: <?php echo (int) $googleUsers; ?> · Email: <?php echo (int) $emailUsers; ?></div>
      </div>
      <div style="background:#fff;border:1px solid #ccd0d4;border-radius:6px;padding:12px 14px;">
        <div style="font-size:11px;text-transform:uppercase;color:#646970;">Mailing List Opt-Ins</div>
        <div style="font-size:22px;font-weight:700;margin-top:4px;"><?php echo (int) $optInUsers; ?></div>
        <div style="font-size:12px;color:#646970;">Synced to WP Leads</div>
      </div>
      <div style="background:#fff;border:1px solid #ccd0d4;border-radius:6px;padding:12px 14px;">
        <div style="font-size:11px;text-transform:uppercase;color:#646970;">Chats (Last 24h)</div>
        <div style="font-size:22px;font-weight:700;margin-top:4px;"><?php echo (int) $chats24h; ?></div>
        <div style="font-size:12px;color:#646970;">Live &amp; authenticated turns</div>
      </div>
      <div style="background:#fff;border:1px solid #ccd0d4;border-radius:6px;padding:12px 14px;">
        <div style="font-size:11px;text-transform:uppercase;color:#646970;">Logged Errors</div>
        <div style="font-size:22px;font-weight:700;margin-top:4px;color:<?php echo $errTotal > 0 ? '#b32d2e' : '#008a20'; ?>;"><?php echo (int) $errTotal; ?></div>
        <div style="font-size:12px;color:#646970;">Diagnostics &amp; rate guards</div>
      </div>
    </div>

    <?php if ($adminPwError !== ''): ?>
      <div class="notice notice-error is-dismissible"><p><?php echo esc_html($adminPwError); ?></p></div>
    <?php elseif ($masterReset): ?>
      <div class="notice notice-success is-dismissible"><p>Master Prompt &amp; Reasoning Policy reset to built-in default.</p></div>
    <?php elseif ($adminPwSaved): ?>
      <div class="notice notice-success is-dismissible"><p>Ask Avi backend settings and admin email password saved securely.</p></div>
    <?php elseif ($saved): ?>
      <div class="notice notice-success is-dismissible"><p>Ask Avi backend settings saved securely in WordPress options.</p></div>
    <?php elseif (isset($_GET['deleted']) && $_GET['deleted'] === '1'): ?>
      <div class="notice notice-success is-dismissible"><p>User record removed from Ask Avi directory.</p></div>
    <?php endif; ?>

    <form method="post" style="background:#fff;padding:18px;border:1px solid #ccd0d4;border-radius:6px;margin-bottom:24px;">
      <?php wp_nonce_field('ask_avi_save_settings'); ?>
      <h2 style="margin-top:0;">Provider APIs &amp; Authentication</h2>
      <table class="form-table" role="presentation">
        <tr>
          <th scope="row"><label for="groq_api_key">Groq Free API Key</label></th>
          <td><input name="groq_api_key" id="groq_api_key" type="password" class="regular-text" value="<?php echo esc_attr($opts['groq_api_key'] ?? ''); ?>" /></td>
        </tr>
        <tr>
          <th scope="row"><label for="openrouter_api_key">OpenRouter Free API Key</label></th>
          <td><input name="openrouter_api_key" id="openrouter_api_key" type="password" class="regular-text" value="<?php echo esc_attr($opts['openrouter_api_key'] ?? ''); ?>" /></td>
        </tr>
        <tr>
          <th scope="row"><label for="gemini_api_key">Google Gemini API Key</label></th>
          <td><input name="gemini_api_key" id="gemini_api_key" type="password" class="regular-text" value="<?php echo esc_attr($opts['gemini_api_key'] ?? ''); ?>" /></td>
        </tr>
        <tr>
          <th scope="row"><label for="google_client_id">Google OAuth Client ID</label></th>
          <td>
            <input name="google_client_id" id="google_client_id" type="text" class="regular-text" placeholder="123456-abc.apps.googleusercontent.com" value="<?php echo esc_attr($opts['google_client_id'] ?? ''); ?>" />
            <p class="description">Authorized JS Origin: <code>https://aviperera.com</code></p>
          </td>
        </tr>
        <tr>
          <th scope="row"><label for="admin_ask_avi_password">Admin Email Password</label></th>
          <td>
            <input name="admin_ask_avi_password" id="admin_ask_avi_password" type="password" autocomplete="new-password" class="regular-text" placeholder="Leave blank to keep current password" value="" />
            <p class="description">
              Status: <strong><?php echo $hasAdminPassword ? 'Password configured' : 'Not set yet'; ?></strong> for <code><?php echo esc_html($adminEmail); ?></code>.
              Set this (min 6 characters) if you want to sign into Ask Avi via Email &amp; Password without showing any passcode prompt on the public login modal. Google Sign-In and logged-in WordPress Admin sessions also authenticate automatically.
            </p>
          </td>
        </tr>
        <tr>
          <th scope="row"><label for="ask-avi-master-prompt">Master Prompt &amp; Reasoning Policy</label></th>
          <td>
            <?php
              $savedMaster = trim((string) ($opts['master_prompt'] ?? ''));
              $defaultMaster = function_exists('ask_avi_default_master_prompt') ? ask_avi_default_master_prompt() : '';
              $displayMaster = $savedMaster !== '' ? $savedMaster : $defaultMaster;
            ?>
            <textarea id="ask-avi-master-prompt" name="master_prompt" rows="16" class="large-text code" style="width:100%;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.5;"><?php echo esc_textarea($displayMaster); ?></textarea>
            <p class="description">
              Authoritative backend-only system prompt &amp; inner-reasoning policy injected server-side into every chat request (never exposed to or editable from the public frontend).
              Status: <strong><?php echo $savedMaster !== '' ? 'Custom prompt active' : 'Using built-in default'; ?></strong>.
            </p>
            <p style="margin-top:8px;">
              <button type="submit" name="ask_avi_reset_master_prompt" value="1" class="button" onclick="return confirm('Reset the backend Master Prompt back to the built-in default?');">Reset to Built-In Default Prompt</button>
            </p>
          </td>
        </tr>
      </table>
      <p class="submit">
        <button type="submit" name="ask_avi_save_settings" value="1" class="button button-primary">Save Settings</button>
      </p>
    </form>

    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:10px;">
      <h2 style="margin:0;">Registered Users (<?php echo count($users); ?>)</h2>
      <div style="display:flex;align-items:center;gap:8px;">
        <input
          type="search"
          id="ask-avi-user-filter"
          placeholder="Search name, email, or provider…"
          style="min-width:240px;"
          oninput="var q=this.value.toLowerCase();document.querySelectorAll('#ask-avi-users-tbody tr[data-search]').forEach(function(r){r.style.display=r.getAttribute('data-search').indexOf(q)!==-1?'':'none';});"
        />
        <?php if (!empty($users)): ?>
          <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="margin:0;">
            <input type="hidden" name="action" value="ask_avi_export_csv" />
            <?php wp_nonce_field('ask_avi_export_csv'); ?>
            <button type="submit" class="button">Export Users CSV</button>
          </form>
        <?php endif; ?>
      </div>
    </div>

    <table class="widefat striped" style="margin-bottom:24px;">
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Provider</th>
          <th>Role</th>
          <th>List Opt-In</th>
          <th>Logins</th>
          <th>Chats (Errors)</th>
          <th>Signed Up</th>
          <th>Last Seen</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id="ask-avi-users-tbody">
        <?php if (empty($users)): ?>
          <tr><td colspan="10">No registered users yet.</td></tr>
        <?php else: foreach ($users as $u): ?>
          <tr data-search="<?php echo esc_attr(strtolower($u['name'] . ' ' . $u['email'] . ' ' . $u['provider'])); ?>">
            <td><strong><?php echo esc_html($u['name']); ?></strong></td>
            <td><?php echo esc_html($u['email']); ?></td>
            <td><code><?php echo esc_html($u['provider']); ?></code></td>
            <td><?php echo esc_html($u['role']); ?></td>
            <td><?php echo !empty($u['marketing_opt_in']) ? 'Yes' : 'No'; ?></td>
            <td><?php echo (int) $u['login_count']; ?></td>
            <td><?php echo (int) $u['chat_count']; ?> (<?php echo (int) $u['error_count']; ?> err)</td>
            <td><?php echo esc_html(gmdate('Y-m-d H:i', (int) floor(((int) $u['created_at']) / 1000)) . ' UTC'); ?></td>
            <td><?php echo esc_html(gmdate('Y-m-d H:i', (int) floor(((int) $u['last_seen_at']) / 1000)) . ' UTC'); ?></td>
            <td>
              <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:inline;" onsubmit="return confirm('Remove this Ask Avi account record?');">
                <input type="hidden" name="action" value="ask_avi_delete_user" />
                <input type="hidden" name="user_id" value="<?php echo esc_attr($u['id']); ?>" />
                <?php wp_nonce_field('ask_avi_delete_user_' . $u['id']); ?>
                <button type="submit" class="button button-small button-link-delete">Remove</button>
              </form>
            </td>
          </tr>
        <?php endforeach; endif; ?>
      </tbody>
    </table>

    <h2>Recent Troubleshooting &amp; Usage Logs</h2>
    <table class="widefat striped">
      <thead>
        <tr>
          <th>Time (UTC)</th>
          <th>Type</th>
          <th>Level</th>
          <th>User</th>
          <th>Model</th>
          <th>Status</th>
          <th>Message</th>
        </tr>
      </thead>
      <tbody>
        <?php if (empty($logs)): ?>
          <tr><td colspan="7">No events recorded yet.</td></tr>
        <?php else: foreach ($logs as $l): ?>
          <tr>
            <td><?php echo esc_html(gmdate('Y-m-d H:i:s', (int) floor(((int) $l['ts']) / 1000))); ?></td>
            <td><code><?php echo esc_html($l['type']); ?></code></td>
            <td><?php echo esc_html($l['level']); ?></td>
            <td><?php echo esc_html($l['user_email']); ?></td>
            <td><?php echo esc_html($l['model_used'] ?: '—'); ?></td>
            <td><?php echo $l['status_code'] ? (int) $l['status_code'] : '—'; ?></td>
            <td><?php echo esc_html($l['message']); ?></td>
          </tr>
        <?php endforeach; endif; ?>
      </tbody>
    </table>
  </div>
  <?php
}
