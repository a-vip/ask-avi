<?php
/**
 * Ask Avi — WordPress Bootstrap, MySQL Registry & Signed Session Helpers
 * Located inside <theme>/apps/ask-avi/api/wp-bootstrap.php
 */
declare(strict_types=1);

define('ASK_AVI_ADMIN_EMAIL', 'workwithavip@gmail.com');
define('ASK_AVI_OPTION_KEY', 'ask_avi_settings');
define('ASK_AVI_SECRET_OPTION', 'ask_avi_auth_secret');
define('ASK_AVI_SCHEMA_VER', '2');
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
      if (!defined('DONOTCACHEPAGE')) {
        define('DONOTCACHEPAGE', true);
      }
      if (!defined('DONOTCACHEOBJECT')) {
        define('DONOTCACHEOBJECT', true);
      }
      if (!defined('DONOTCACHEDB')) {
        define('DONOTCACHEDB', true);
      }
      if (!defined('LSCACHE_NO_CACHE')) {
        define('LSCACHE_NO_CACHE', true);
      }
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
    'master_prompt' => '',
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

function ask_avi_default_master_prompt(): string {
  return implode("\n", [
    'I am Avi Perera — speaking directly in conversation on aviperera.com.',
    '',
    'Background & Grounding:',
    '- Raised in Harrow, London as the first in my family to attend university, working to self-fund higher education. My studies span Mathematics (The Open University and the University of Essex), Applied Mathematics for Machine Learning (Imperial College London), Data Science & Artificial Intelligence (Northumbria University; 2021 Google Scholarship), First Class Law LLB (University of Buckingham, High Achiever Award), and First Class International Relations (University of Cambridge).',
    '- Driven by philosophy, computer science, neuroscience, pure and applied mathematics, jurisprudence, and AI governance. I always reason from first principles — excavating causal architecture, incentive structures, mathematical bounds, and human realities rather than repeating consensus talking points or branding slogans.',
    '- Policy & research work across AI governance, autonomous weapons systems, and International Humanitarian Law with UNIDIR, UNODA, UNRCPD, the Campaign to Stop Killer Robots (Anticipatory Objection Registry), and The Royal Society (online information ecosystems & algorithmic radicalisation), dividing time across London, Geneva, and Bangkok.',
    '- Things built: SovDash (3D WebGL geopolitical OSINT console at app.sovdash.com), Lex Machina (legal Git corpus + FastMCP server), LAWS Simulator (sim.sovdash.com), Global AI Policy Tracker, The Echo Realm (32-bit RPG), Suiji (Go/Weiqi AI dojo), and Agentic Launchpad.',
    '- Core commitments: Reject false binaries ("Neither a techno-optimist nor an AI doomsayer — I am for accountability"). Interrogate "linguistic superposition" in high-stakes rhetoric and insist on verifiable technical and legal constraints over voluntary pledges ("Control is not a button; it is an architecture", "Achievement is a receipt. Confidence is weather").',
    '',
    'Method & Voice:',
    '- Speak throughout in the first person ("I", "my") as Avi Perera himself. Every visitor "you" or "your" addresses me personally — never slip into referring to Avi in the third person and never break frame into an AI assistant, language model, or generic disclaimer. Ground personal answers strictly in what appears in my writings and background notes; never fabricate or extrapolate undocumented personal details (such as what I write on CVs or forms, religious vows, rituals, or private habits) — reason candidly from first principles instead.',
    '- Think slowly and deeply from first principles: unpack definitions, surface unstated premises, stress-test strongest counter-arguments, trace downstream failure modes, and draw structural connections across philosophy, mathematics, computation, neuroscience, and law.',
    '- In multi-turn conversations, examine the full arc of prior prompts and replies, resolve follow-ups against what was already discussed, and engage directly with the new point or tension instead of restarting earlier answers.',
    '- Keep any preparatory thinking wholly immersed in the substance of the problem — ideas, definitions, evidence, causal links, and counter-arguments.',
    '- Begin your visible reply directly with the substantive answer itself — keep outlines, drafting notes, constraint checks, self-corrections, and revision steps strictly out of the final response.',
    '- Reply candidly, incisively, and warmly in British English across any subject — world events, philosophy, law, software engineering, career decisions, mathematics, or life — using live web findings when current facts matter, never stitching canned passages from old essays.',
    '- Register discipline: Light, dry British wit fits exploratory or personal banter in Standard/Candid registers, whereas in Legal & IR (academic) or Blunt registers — and on ANY query involving lethal autonomous weapons targeting, armed conflict, civilian harm, war crimes, director liability, or personal crisis — maintain unfailing analytical gravitas with zero jokes or levity.',
    '- Cite genuinely relied-upon numbered sources inline cleanly as [1], [2] without inventing details or stretching tangential matches. Only when asked directly about consulting, briefings, or contact, share https://calendly.com/aviperera/free-consultation or workwithavip@gmail.com briefly.',
  ]);
}

function ask_avi_voice_style_directive(string $style): string {
  $map = [
    'standard' => 'Conversational, intellectually honest, and unpretentious — clear first-principles analysis without academic stiffness; keep dry warmth where light topics invite it, and full analytical seriousness on grave legal or humanitarian issues.',
    'blunt' => 'Direct, unsentimental, and concise — cut straight to the underlying incentives, trade-offs, and what actually breaks in practice. Zero small talk or jokey banter.',
    'academic' => 'Rigorous analytical and international-law register referencing concrete treaties and mechanisms (Additional Protocol I Art. 36, Martens Clause, CCW GGE) where apt. Maintain strict scholarly gravitas with zero humour or casual banter.',
    'mentor' => 'Warm, reflective, and grounded — speak honestly like a thoughtful conversation over coffee, valuing lived evidence over performative polish.',
  ];
  $key = strtolower(trim($style));
  return $map[$key] ?? $map['standard'];
}

function ask_avi_clip_utf8(string $text, int $limit): string {
  if ($limit <= 0 || $text === '') {
    return '';
  }
  if (function_exists('mb_substr')) {
    return mb_substr($text, 0, $limit, 'UTF-8');
  }
  return substr($text, 0, $limit);
}

function ask_avi_assemble_system_prompt(
  string $masterPromptOverride,
  string $voiceStyle,
  string $archiveBlock,
  string $webContext,
  string $attachedContext,
  bool $isAuthenticated,
  string $continuityBrief = '',
  string $reasoningSynthesis = '',
  string $phase = 'final'
): string {
  if ($phase === 'deliberate') {
    return 'Speak and reason in the first person ("I", "my") as Avi Perera, engaging deeply in pure domain analysis from first principles. Weigh definitions, evidence, counter-arguments, contradictions, and conversation trajectory directly in the substance without commentary on instructions or tone. Any visitor reference to "you" or "your" addresses Avi Perera personally, never an AI assistant or language model.';
  }

  $basePrompt = trim($masterPromptOverride);
  if ($basePrompt === '') {
    $basePrompt = ask_avi_default_master_prompt();
  }
  $basePrompt = ask_avi_clip_utf8($basePrompt, 12000);

  $styleDirective = ask_avi_voice_style_directive($voiceStyle);
  $archive = ask_avi_clip_utf8(trim($archiveBlock), 6000);
  $web = ask_avi_clip_utf8(trim($webContext), 6000);
  $continuity = ask_avi_clip_utf8(trim($continuityBrief), 1800);
  $synthesis = ask_avi_clip_utf8(trim($reasoningSynthesis), 4800);
  $maxAttached = $isAuthenticated ? 12000 : 8000;
  $attachedRaw = ask_avi_clip_utf8(trim($attachedContext), $maxAttached);
  $attachedBlock = '';
  if ($attachedRaw !== '') {
    $attachedBlock = strpos($attachedRaw, 'USER-ATTACHED CONTEXT') === 0
      ? $attachedRaw
      : "USER-ATTACHED DOCUMENT (respond directly to this):\n" . $attachedRaw;
  }

  $parts = [
    $basePrompt,
    '',
    'REGISTER: ' . $styleDirective,
  ];
  if ($continuity !== '') {
    $parts[] = "\nCONVERSATION CONTINUITY & CITATIONS:\n" . $continuity;
  }
  if ($archive !== '') {
    $parts[] = "\nRELEVANT ARCHIVE REFERENCES:\n" . $archive;
  }
  if ($web !== '') {
    $parts[] = "\n" . $web;
  }
  if ($synthesis !== '') {
    $parts[] = "\nINTERNAL WORKING NOTES (weave these substantive conclusions into your own natural first-person reply — NEVER echo meta-headings such as \"Stage 2\", \"Stage 3\", or \"Critical Synthesis\"):\n" . $synthesis;
  }
  if ($attachedBlock !== '') {
    $parts[] = "\n" . $attachedBlock;
  }
  return implode("\n", $parts);
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

  $users_table = $wpdb->prefix . 'ask_avi_users';
  $logs_table = $wpdb->prefix . 'ask_avi_logs';
  $qa_table = $wpdb->prefix . 'ask_avi_qa_logs';
  $hasUsers = ($wpdb->get_var("SHOW TABLES LIKE '{$users_table}'") === $users_table);
  $hasLogs = ($wpdb->get_var("SHOW TABLES LIKE '{$logs_table}'") === $logs_table);
  $hasQa = ($wpdb->get_var("SHOW TABLES LIKE '{$qa_table}'") === $qa_table);

  if ($hasUsers && $hasLogs && $hasQa && function_exists('get_option') && get_option('ask_avi_schema_ver') === ASK_AVI_SCHEMA_VER) {
    return;
  }

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

  $sql_qa = "CREATE TABLE {$qa_table} (
    id varchar(64) NOT NULL,
    ts bigint(20) NOT NULL,
    thread_id varchar(64) NOT NULL DEFAULT '',
    turn_index int(11) NOT NULL DEFAULT 1,
    user_email varchar(190) NOT NULL DEFAULT 'guest',
    user_name varchar(190) NOT NULL DEFAULT '',
    engine_id varchar(40) NOT NULL DEFAULT '',
    model_used varchar(128) NOT NULL DEFAULT '',
    voice_style varchar(32) NOT NULL DEFAULT 'standard',
    prompt_text longtext NOT NULL,
    answer_text longtext NOT NULL,
    thoughts_text longtext NULL,
    cited_sources_json text NULL,
    top_rag_score float NOT NULL DEFAULT 0,
    rag_match_count int(11) NOT NULL DEFAULT 0,
    is_content_gap tinyint(1) NOT NULL DEFAULT 0,
    gap_topic varchar(255) NOT NULL DEFAULT '',
    latency_ms int(11) NOT NULL DEFAULT 0,
    PRIMARY KEY  (id),
    KEY ts_idx (ts),
    KEY gap_idx (is_content_gap),
    KEY user_idx (user_email)
  ) {$charset_collate};";

  dbDelta($sql_users);
  dbDelta($sql_logs);
  dbDelta($sql_qa);
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
      // Admin features require verified workwithavip@gmail.com OR WordPress administrator capability.
      $role = ($isWpAdmin && ($email === ASK_AVI_ADMIN_EMAIL || current_user_can('manage_options'))) ? 'admin' : 'user';
      return [
        'sub' => 'wp_' . (string) $wpUser->ID,
        'email' => $email,
        'name' => (string) ($wpUser->display_name ?: $wpUser->user_login),
        'role' => $role,
        'provider' => 'wordpress',
        'wpAdmin' => $isWpAdmin,
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
  $ok = $statusCode >= 200 && $statusCode < 400;
  if ($ok && defined('ASK_AVI_SKIP_OK_TELEMETRY') && ASK_AVI_SKIP_OK_TELEMETRY) {
    return;
  }
  ask_avi_ensure_tables();
  $users_table = $wpdb->prefix . 'ask_avi_users';
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

function ask_avi_upsert_qa_turn(array $entry): void {
  global $wpdb;
  if (!isset($wpdb)) {
    return;
  }
  $promptText = ask_avi_clip_utf8(trim((string) ($entry['prompt_text'] ?? '')), 32000);
  if ($promptText === '') {
    return;
  }

  ask_avi_ensure_tables();
  $qa_table = $wpdb->prefix . 'ask_avi_qa_logs';
  $nowMs = (int) round(microtime(true) * 1000);

  $rawId = preg_replace('/[^a-zA-Z0-9_-]/', '', (string) ($entry['id'] ?? $entry['turn_id'] ?? ''));
  $id = $rawId !== '' ? substr($rawId, 0, 64) : ('qa_' . bin2hex(random_bytes(8)));

  $answerText = ask_avi_clip_utf8(trim((string) ($entry['answer_text'] ?? '')), 64000);
  $thoughtsText = ask_avi_clip_utf8(trim((string) ($entry['thoughts_text'] ?? '')), 32000);
  $citedJson = ask_avi_clip_utf8(trim((string) ($entry['cited_sources_json'] ?? '')), 16000);
  $threadId = substr(preg_replace('/[^a-zA-Z0-9_-]/', '', (string) ($entry['thread_id'] ?? '')), 0, 64);
  $turnIndex = max(1, (int) ($entry['turn_index'] ?? 1));
  $userEmail = ask_avi_clip_utf8(strtolower(trim((string) ($entry['user_email'] ?? 'guest'))) ?: 'guest', 190);
  $userName = ask_avi_clip_utf8(trim((string) ($entry['user_name'] ?? '')), 190);
  $engineId = ask_avi_clip_utf8(trim((string) ($entry['engine_id'] ?? '')), 40);
  $modelUsed = ask_avi_clip_utf8(trim((string) ($entry['model_used'] ?? '')), 128);
  $voiceStyle = ask_avi_clip_utf8(trim((string) ($entry['voice_style'] ?? 'standard')) ?: 'standard', 32);
  $topRagScore = (float) ($entry['top_rag_score'] ?? 0.0);
  $ragMatchCount = max(0, (int) ($entry['rag_match_count'] ?? 0));
  $latencyMs = max(0, (int) ($entry['latency_ms'] ?? 0));

  $isTrivialGreeting = preg_match('/^(hi|hello|hey|thanks|thank you|good morning|good afternoon|good evening|test|ok|okay)\b/i', $promptText) === 1
    && strlen($promptText) <= 36;
  $explicitGap = array_key_exists('is_content_gap', $entry) ? !empty($entry['is_content_gap']) : null;
  $autoGap = (!$isTrivialGreeting && strlen($promptText) >= 18 && ($topRagScore < 6.2 || $ragMatchCount === 0));
  $isContentGap = ($explicitGap !== null) ? ($explicitGap ? 1 : 0) : ($autoGap ? 1 : 0);

  $rawGapTopic = trim((string) ($entry['gap_topic'] ?? ''));
  if ($rawGapTopic === '' && $isContentGap === 1) {
    $rawGapTopic = preg_replace('/\s+/', ' ', $promptText) ?? $promptText;
  }
  $gapTopic = ask_avi_clip_utf8($rawGapTopic, 180);

  $existing = $wpdb->get_row(
    $wpdb->prepare("SELECT id, answer_text, thoughts_text, cited_sources_json FROM {$qa_table} WHERE id = %s", $id),
    ARRAY_A
  );

  if ($existing) {
    $updates = [];
    if ($answerText !== '') $updates['answer_text'] = $answerText;
    if ($thoughtsText !== '') $updates['thoughts_text'] = $thoughtsText;
    if ($citedJson !== '') $updates['cited_sources_json'] = $citedJson;
    if ($modelUsed !== '') $updates['model_used'] = $modelUsed;
    if ($voiceStyle !== '') $updates['voice_style'] = $voiceStyle;
    if ($topRagScore > 0) $updates['top_rag_score'] = $topRagScore;
    if ($ragMatchCount > 0 || $topRagScore > 0) $updates['rag_match_count'] = $ragMatchCount;
    if ($latencyMs > 0) $updates['latency_ms'] = $latencyMs;
    if ($userName !== '') $updates['user_name'] = $userName;
    if ($threadId !== '') $updates['thread_id'] = $threadId;
    $updates['is_content_gap'] = $isContentGap;
    if ($gapTopic !== '') $updates['gap_topic'] = $gapTopic;
    if (!empty($updates)) {
      $wpdb->update($qa_table, $updates, ['id' => $id]);
    }
    return;
  }

  $wpdb->insert($qa_table, [
    'id' => $id,
    'ts' => $nowMs,
    'thread_id' => $threadId,
    'turn_index' => $turnIndex,
    'user_email' => $userEmail,
    'user_name' => $userName,
    'engine_id' => $engineId,
    'model_used' => $modelUsed,
    'voice_style' => $voiceStyle,
    'prompt_text' => $promptText,
    'answer_text' => $answerText,
    'thoughts_text' => $thoughtsText !== '' ? $thoughtsText : null,
    'cited_sources_json' => $citedJson !== '' ? $citedJson : null,
    'top_rag_score' => $topRagScore,
    'rag_match_count' => $ragMatchCount,
    'is_content_gap' => $isContentGap,
    'gap_topic' => $gapTopic,
    'latency_ms' => $latencyMs,
  ]);
}

function ask_avi_map_wp_category(array $catNames): string {
  $joined = strtolower(implode(' ', $catNames));
  if (preg_match('/\b(laws|ihl|killer robots?|autonomous weapons?|military|humanitarian law)\b/', $joined)) {
    return 'LAWS & IHL';
  }
  if (preg_match('/\b(governance|regulation|policy|ai|ethics)\b/', $joined)) {
    return 'AI Governance';
  }
  if (preg_match('/\b(project|code|sovdash|system|software|tool)\b/', $joined)) {
    return 'Systems & Projects';
  }
  if (preg_match('/\b(research|paper|doi|publication|academic)\b/', $joined)) {
    return 'Research & Publications';
  }
  return 'Essays & Philosophy';
}

function ask_avi_chunk_wp_post_html(string $title, string $rawHtml): array {
  $html = preg_replace('#<(script|style|noscript|nav|aside)[^>]*>.*?</\1>#is', ' ', $rawHtml) ?? $rawHtml;
  if (function_exists('strip_shortcodes')) {
    $html = strip_shortcodes($html);
  }
  // Split roughly along H2/H3 section boundaries while retaining heading context
  $parts = preg_split('#(?=<h[23]\b)#i', $html) ?: [$html];
  $chunks = [];

  foreach ($parts as $section) {
    $heading = '';
    if (preg_match('#<h[23][^>]*>(.*?)</h[23]>#is', $section, $m)) {
      $heading = trim(html_entity_decode(strip_tags($m[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
      $sectionBody = substr($section, strlen($m[0]));
    } else {
      $sectionBody = $section;
    }

    $plain = preg_replace('#</(p|div|li|blockquote|h[1-6])>#i', "\n", $sectionBody) ?? $sectionBody;
    $plain = html_entity_decode(strip_tags($plain), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $plain = preg_replace('/[ \t]+/', ' ', $plain) ?? $plain;
    $plain = trim((string) preg_replace("/\n{2,}/", "\n", $plain));
    if ($plain === '') {
      continue;
    }

    $paragraphs = explode("\n", $plain);
    $buf = $heading !== '' ? "{$heading}: " : '';
    foreach ($paragraphs as $p) {
      $p = trim($p);
      if ($p === '') continue;
      if (strlen($buf) + strlen($p) + 1 > 650 && strlen($buf) >= 220) {
        $chunks[] = trim($buf);
        $buf = $heading !== '' ? "{$heading}: {$p}" : $p;
      } else {
        $buf = $buf === '' ? $p : (substr($buf, -2) === ': ' ? $buf . $p : $buf . ' ' . $p);
      }
      if (count($chunks) >= 16) {
        break 2;
      }
    }
    if (strlen(trim($buf)) >= 40) {
      $chunks[] = trim($buf);
    }
    if (count($chunks) >= 16) {
      break;
    }
  }

  if (empty($chunks)) {
    $fallbackPlain = trim(preg_replace('/\s+/', ' ', html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8')) ?? '');
    if ($fallbackPlain !== '') {
      $chunks[] = ask_avi_clip_utf8($title . ': ' . $fallbackPlain, 680);
    }
  }

  return array_slice($chunks, 0, 16);
}

function ask_avi_get_live_wp_knowledge(bool $forceRebuild = false): array {
  $cacheKey = 'ask_avi_live_wp_corpus_v1';
  $nowMs = (int) round(microtime(true) * 1000);
  $lastPostChangeMs = function_exists('get_option') ? (int) get_option('ask_avi_last_post_change_ms', 0) : 0;

  if (!$forceRebuild && function_exists('get_option')) {
    $cached = get_option($cacheKey, null);
    if (is_array($cached) && !empty($cached['generatedAtMs'])) {
      $ageMs = $nowMs - (int) $cached['generatedAtMs'];
      if ($ageMs < 15 * 60 * 1000 && (int) $cached['generatedAtMs'] >= $lastPostChangeMs) {
        return $cached;
      }
    }
  }

  if (!function_exists('get_posts')) {
    return [
      'ok' => true,
      'generatedAt' => gmdate('c'),
      'generatedAtMs' => $nowMs,
      'totalEntries' => 0,
      'entries' => [],
    ];
  }

  $posts = get_posts([
    'post_type' => 'post',
    'post_status' => 'publish',
    'numberposts' => 200,
    'orderby' => 'date',
    'order' => 'DESC',
  ]);

  $entries = [];
  $thirtyDaysAgo = time() - (30 * 24 * 60 * 60);

  foreach ($posts as $idx => $post) {
    $postId = (int) $post->ID;
    $title = trim(html_entity_decode(strip_tags((string) $post->post_title), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    if ($title === '') continue;

    $rawContent = (string) $post->post_content;
    $chunks = ask_avi_chunk_wp_post_html($title, $rawContent);
    if (empty($chunks)) continue;

    $rawExcerpt = trim((string) ($post->post_excerpt ?? ''));
    $summarySource = $rawExcerpt !== ''
      ? html_entity_decode(strip_tags($rawExcerpt), ENT_QUOTES | ENT_HTML5, 'UTF-8')
      : ($chunks[0] ?? $title);
    $summary = ask_avi_clip_utf8(trim((string) preg_replace('/\s+/', ' ', $summarySource)), 320);

    $catNames = [];
    if (function_exists('wp_get_post_categories') && function_exists('get_category')) {
      $catIds = wp_get_post_categories($postId);
      if (is_array($catIds)) {
        foreach ($catIds as $cid) {
          $c = get_category($cid);
          if ($c && !is_wp_error($c) && !empty($c->name)) {
            $catNames[] = (string) $c->name;
          }
        }
      }
    }

    $kwSet = [];
    if (function_exists('wp_get_post_tags')) {
      $tags = wp_get_post_tags($postId);
      if (is_array($tags)) {
        foreach ($tags as $t) {
          if (!empty($t->name)) $kwSet[strtolower((string) $t->name)] = true;
        }
      }
    }
    foreach ($catNames as $cn) {
      $kwSet[strtolower($cn)] = true;
    }
    foreach (preg_split('/[^a-z0-9]+/i', strtolower($title)) ?: [] as $tok) {
      if (strlen($tok) >= 3) $kwSet[$tok] = true;
    }

    $postTs = strtotime((string) $post->post_date_gmt ?: (string) $post->post_date) ?: time();
    $dateStr = gmdate('Y-m-d', $postTs);
    $justPublished = ($idx < 6 || $postTs >= $thirtyDaysAgo);
    $url = function_exists('get_permalink') ? (string) get_permalink($postId) : '';
    $doi = function_exists('get_post_meta') ? trim((string) get_post_meta($postId, 'doi', true)) : '';

    $entries[] = [
      'id' => 'wp-post-' . $postId,
      'title' => $title,
      'category' => ask_avi_map_wp_category($catNames),
      'date' => $dateStr,
      'url' => $url,
      'doi' => $doi,
      'keywords' => array_slice(array_keys($kwSet), 0, 24),
      'summary' => $summary,
      'chunks' => $chunks,
      'justPublished' => $justPublished,
      'liveIngested' => true,
      'contentHash' => substr(hash('sha256', $title . "\n" . $rawContent), 0, 20),
    ];
  }

  $payload = [
    'ok' => true,
    'generatedAt' => gmdate('c'),
    'generatedAtMs' => $nowMs,
    'totalEntries' => count($entries),
    'entries' => $entries,
  ];
  if (function_exists('update_option')) {
    update_option($cacheKey, $payload, false);
  }
  return $payload;
}

function ask_avi_send_json(int $status, array $payload): void {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
  header('X-LiteSpeed-Cache-Control: no-cache');
  echo json_encode($payload);
  exit;
}
