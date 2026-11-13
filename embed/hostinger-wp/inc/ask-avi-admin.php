<?php
/**
 * Ask Avi — WordPress Admin Dashboard (Settings, Registered Users CSV, Troubleshooting Logs)
 * Include from your theme functions.php:
 *   require_once get_template_directory() . '/inc/ask-avi-admin.php';
 */
if (!defined('ABSPATH')) {
  exit;
}

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

function ask_avi_render_admin_page(): void {
  if (!current_user_can('manage_options')) {
    return;
  }

  $bootstrap = get_template_directory() . '/apps/ask-avi/api/wp-bootstrap.php';
  if (file_exists($bootstrap)) {
    require_once $bootstrap;
    ask_avi_ensure_tables();
  }

  $saved = false;
  if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['ask_avi_save_settings'])) {
    check_admin_referer('ask_avi_save_settings');
    $next = [
      'groq_api_key' => sanitize_text_field(wp_unslash($_POST['groq_api_key'] ?? '')),
      'openrouter_api_key' => sanitize_text_field(wp_unslash($_POST['openrouter_api_key'] ?? '')),
      'gemini_api_key' => sanitize_text_field(wp_unslash($_POST['gemini_api_key'] ?? '')),
      'google_client_id' => sanitize_text_field(wp_unslash($_POST['google_client_id'] ?? '')),
      'admin_passcode' => sanitize_text_field(wp_unslash($_POST['admin_passcode'] ?? '')),
    ];
    update_option('ask_avi_settings', $next, false);
    $saved = true;
  }

  $opts = get_option('ask_avi_settings', []);
  global $wpdb;
  $users_table = $wpdb->prefix . 'ask_avi_users';
  $logs_table = $wpdb->prefix . 'ask_avi_logs';
  $users_exists = ($wpdb->get_var("SHOW TABLES LIKE '{$users_table}'") === $users_table);
  $users = $users_exists
    ? ($wpdb->get_results("SELECT * FROM {$users_table} ORDER BY last_seen_at DESC LIMIT 200", ARRAY_A) ?: [])
    : [];
  $logs = $users_exists
    ? ($wpdb->get_results("SELECT * FROM {$logs_table} ORDER BY ts DESC LIMIT 60", ARRAY_A) ?: [])
    : [];
  ?>
  <div class="wrap">
    <h1>Ask Avi — AI Persona Administration</h1>
    <p>Public route: <code><?php echo esc_html(home_url('/ask-avi/')); ?></code> · Users signed up here can be exported for outreach &amp; troubleshooting.</p>

    <?php if ($saved): ?>
      <div class="notice notice-success is-dismissible"><p>Ask Avi backend keys saved securely in WordPress options.</p></div>
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
          <th scope="row"><label for="admin_passcode">Admin Fallback Passcode</label></th>
          <td>
            <input name="admin_passcode" id="admin_passcode" type="password" class="regular-text" value="<?php echo esc_attr($opts['admin_passcode'] ?? ''); ?>" />
            <p class="description">Required only when logging into the frontend UI via email with <code>workwithavip@gmail.com</code> without Google/WP SSO.</p>
          </td>
        </tr>
      </table>
      <p class="submit">
        <button type="submit" name="ask_avi_save_settings" value="1" class="button button-primary">Save Settings</button>
      </p>
    </form>

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <h2 style="margin:0;">Registered Users (<?php echo count($users); ?>)</h2>
      <?php if (!empty($users)): ?>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
          <input type="hidden" name="action" value="ask_avi_export_csv" />
          <?php wp_nonce_field('ask_avi_export_csv'); ?>
          <button type="submit" class="button">Export Users CSV</button>
        </form>
      <?php endif; ?>
    </div>

    <table class="widefat striped" style="margin-bottom:24px;">
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Provider</th>
          <th>Role</th>
          <th>List Opt-In</th>
          <th>Chats (Errors)</th>
          <th>Last Seen</th>
        </tr>
      </thead>
      <tbody>
        <?php if (empty($users)): ?>
          <tr><td colspan="7">No registered users yet.</td></tr>
        <?php else: foreach ($users as $u): ?>
          <tr>
            <td><?php echo esc_html($u['name']); ?></td>
            <td><?php echo esc_html($u['email']); ?></td>
            <td><?php echo esc_html($u['provider']); ?></td>
            <td><?php echo esc_html($u['role']); ?></td>
            <td><?php echo !empty($u['marketing_opt_in']) ? 'Yes' : 'No'; ?></td>
            <td><?php echo (int) $u['chat_count']; ?> (<?php echo (int) $u['error_count']; ?> err)</td>
            <td><?php echo esc_html(gmdate('Y-m-d H:i', (int) floor(((int) $u['last_seen_at']) / 1000)) . ' UTC'); ?></td>
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
