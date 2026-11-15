<?php
/**
 * Ask Avi — Streaming Chat Proxy (Groq Free -> OpenRouter Free -> Optional Gemini)
 * Routed via .htaccess from ./api/chat -> api/chat.php
 */
declare(strict_types=1);

require_once __DIR__ . '/wp-bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  ask_avi_send_json(405, ['error' => 'method_not_allowed', 'message' => 'Use POST.']);
}

@set_time_limit(180);
$startedMs = (int) round(microtime(true) * 1000);
$reqUser = ask_avi_resolve_request_user();
$settings = ask_avi_get_settings();

$rawBody = file_get_contents('php://input');
$body = json_decode($rawBody ?: '{}', true);
if (!is_array($body) || empty($body['contents']) || !is_array($body['contents'])) {
  ask_avi_send_json(400, ['error' => 'invalid_payload', 'message' => 'Missing contents array.']);
}

$mode = (string) ($body['mode'] ?? 'oss-reasoning');
$temperature = isset($body['temperature']) ? (float) $body['temperature'] : 0.72;
$temperature = max(0.0, min(1.3, $temperature));
$isAuthenticated = ($reqUser !== null);

// Master Prompt & Reasoning Policy live strictly on the backend (WP Admin configurable).
// Untrusted client payloads never override the Master Prompt directly.
$systemInstruction = ask_avi_assemble_system_prompt(
  (string) ($settings['master_prompt'] ?? ''),
  (string) ($body['voiceStyle'] ?? 'standard'),
  (string) ($body['archiveBlock'] ?? ''),
  (string) ($body['webContext'] ?? ''),
  (string) ($body['attachedContext'] ?? ''),
  $isAuthenticated
);

function ask_avi_clip_text(string $text, int $limit): string {
  if (function_exists('mb_substr')) {
    return mb_substr($text, 0, $limit, 'UTF-8');
  }
  return substr($text, 0, $limit);
}

function ask_avi_to_openai_messages(array $contents, string $system, bool $isAuthenticated = false): array {
  $msgs = [];
  if ($system !== '') {
    $msgs[] = ['role' => 'system', 'content' => $system];
  }
  $maxTurns = $isAuthenticated ? 18 : 12;
  $maxPartChars = $isAuthenticated ? 10000 : 6000;
  $tail = array_slice($contents, -$maxTurns);
  foreach ($tail as $turn) {
    $role = (($turn['role'] ?? 'user') === 'model') ? 'assistant' : 'user';
    $parts = $turn['parts'] ?? [];
    $texts = [];
    foreach ($parts as $p) {
      if (isset($p['text']) && is_string($p['text'])) {
        $texts[] = ask_avi_clip_text($p['text'], $maxPartChars);
      }
    }
    $joined = trim(implode("\n", $texts));
    if ($joined !== '') {
      $msgs[] = ['role' => $role, 'content' => $joined];
    }
  }
  return $msgs;
}

/**
 * Attempt streaming an upstream SSE request. Only emits 200 headers once upstream is confirmed 2xx.
 */
function ask_avi_stream_upstream(
  string $url,
  array $headers,
  array $payload,
  string $protocol,
  string $modelLabel,
  int $startedMs,
  ?array $reqUser
): array {
  $ch = curl_init($url);
  if ($ch === false) {
    return ['ok' => false, 'status' => 500, 'error' => 'cURL initialization failed.'];
  }

  $httpStatus = 0;
  $headersEmitted = false;
  $errorBuffer = '';
  $streamDone = false;

  curl_setopt($ch, CURLOPT_POST, true);
  curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
  curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, false);
  curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 15);
  curl_setopt($ch, CURLOPT_TIMEOUT, 150);

  curl_setopt($ch, CURLOPT_HEADERFUNCTION, static function ($curl, $headerLine) use (&$httpStatus) {
    if (preg_match('#^HTTP/\S+\s+(\d{3})#i', trim($headerLine), $matches)) {
      $httpStatus = (int) $matches[1];
    }
    return strlen($headerLine);
  });

  curl_setopt($ch, CURLOPT_WRITEFUNCTION, static function ($curl, $chunk) use (
    &$httpStatus,
    &$headersEmitted,
    &$errorBuffer,
    $protocol,
    $modelLabel
  ) {
    if ($httpStatus >= 200 && $httpStatus < 300) {
      if (!$headersEmitted) {
        $headersEmitted = true;
        while (ob_get_level() > 0) {
          @ob_end_flush();
        }
        http_response_code(200);
        header('Content-Type: text/event-stream; charset=utf-8');
        header('Cache-Control: no-cache, no-transform');
        header('X-LiteSpeed-Cache-Control: no-cache');
        header('X-Accel-Buffering: no');
        header('X-Ask-Avi-Protocol: ' . $protocol);
        header('X-Ask-Avi-Model: ' . $modelLabel);
      }
      echo $chunk;
      if (function_exists('ob_flush')) {
        @ob_flush();
      }
      flush();
      return strlen($chunk);
    }

    if (strlen($errorBuffer) < 1600) {
      $errorBuffer .= $chunk;
    }
    return strlen($chunk);
  });

  $okExec = curl_exec($ch);
  $curlErr = curl_error($ch);
  if ($httpStatus === 0) {
    $httpStatus = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
  }
  curl_close($ch);

  if ($headersEmitted && $okExec !== false && $httpStatus >= 200 && $httpStatus < 300) {
    $streamDone = true;
    $latencyMs = (int) round(microtime(true) * 1000) - $startedMs;
    ask_avi_record_chat_telemetry($reqUser, 200, $modelLabel, $latencyMs);
    return ['ok' => true, 'done' => $streamDone];
  }

  return [
    'ok' => false,
    'status' => $httpStatus > 0 ? $httpStatus : 502,
    'error' => trim($errorBuffer) !== '' ? $errorBuffer : ($curlErr ?: 'Upstream stream error.'),
  ];
}

if ($mode === 'google') {
  if (!$reqUser) {
    $latencyMs = (int) round(microtime(true) * 1000) - $startedMs;
    ask_avi_record_chat_telemetry(null, 401, 'gemini', $latencyMs, 'auth_required: Gemini models require a signed-in account');
    ask_avi_send_json(401, [
      'error' => 'auth_required',
      'message' => 'Unlock frontier models, deeper context, and saved conversations.',
    ]);
  }

  $isAdminReq = (($reqUser['role'] ?? '') === 'admin') || (function_exists('current_user_can') && current_user_can('manage_options'));
  if (!$isAdminReq && isset($wpdb)) {
    ask_avi_ensure_tables();
    $logsTable = $wpdb->prefix . 'ask_avi_logs';
    $dayAgoMs = (int) round(microtime(true) * 1000) - (24 * 60 * 60 * 1000);
    $dailyGeminiCount = (int) $wpdb->get_var(
      $wpdb->prepare(
        "SELECT COUNT(*) FROM {$logsTable} WHERE ts >= %d AND type = 'chat_ok' AND user_email = %s AND model_used LIKE %s",
        $dayAgoMs,
        strtolower((string) $reqUser['email']),
        'gemini%'
      )
    );
    if ($dailyGeminiCount >= 40) {
      $latencyMs = (int) round(microtime(true) * 1000) - $startedMs;
      ask_avi_record_chat_telemetry($reqUser, 429, 'gemini', $latencyMs, 'Daily Gemini limit reached (40/24h)');
      ask_avi_send_json(429, [
        'error' => 'gemini_quota_exceeded',
        'message' => 'Daily Gemini allowance reached (40 messages / 24h) — switch to Open-Source Reasoning (free) or try again tomorrow.',
      ]);
    }
  }

  $geminiKey = trim((string) ($settings['gemini_api_key'] ?? ''));
  if ($geminiKey === '') {
    $latencyMs = (int) round(microtime(true) * 1000) - $startedMs;
    ask_avi_record_chat_telemetry($reqUser, 503, 'gemini', $latencyMs, 'proxy_unconfigured: GEMINI_API_KEY unset');
    ask_avi_send_json(503, [
      'error' => 'proxy_unconfigured',
      'message' => 'Server GEMINI_API_KEY is not configured in WP Admin -> Ask Avi.',
    ]);
  }

  $allowedGemini = [
    'gemini-3-flash-preview',
    'gemini-3.8-flash',
    'gemini-3.5-flash',
    'gemini-4-hydrogen',
    'gemini-3.1-pro-preview',
    'gemini-flash-latest',
    'gemini-flash-lite-latest',
    'gemini-pro-latest',
  ];
  $reqModel = trim((string) ($body['model'] ?? 'gemini-3-flash-preview'));
  $primary = in_array($reqModel, $allowedGemini, true) ? $reqModel : 'gemini-3-flash-preview';
  $candidates = array_values(array_unique([
    $primary,
    'gemini-3-flash-preview',
    'gemini-3.5-flash',
    'gemini-4-hydrogen',
    'gemini-flash-lite-latest',
  ]));

  $budget = max(1024, min(24576, (int) ($body['thinkingBudget'] ?? 12288)));
  $searchAllowed = (($body['enableSearch'] ?? true) !== false);

  $lastStatus = 502;
  $lastError = 'Gemini upstream failed.';

  foreach ($candidates as $model) {
    $attemptFlags = $searchAllowed ? [true, false] : [false];
    foreach ($attemptFlags as $withSearch) {
      $isDeepGemini = $budget >= 20000 || in_array($primary, ['gemini-4-hydrogen', 'gemini-3.1-pro-preview', 'gemini-pro-latest'], true);
      $maxGeminiOutput = $isDeepGemini ? 32768 : 16384;
      $payload = [
        'contents' => array_slice($body['contents'], -24),
        'generationConfig' => [
          'temperature' => $temperature,
          'topP' => 0.92,
          'maxOutputTokens' => $maxGeminiOutput,
          'thinkingConfig' => [
            'includeThoughts' => true,
            'thinkingBudget' => $budget,
          ],
        ],
      ];
      if ($systemInstruction !== '') {
        $payload['systemInstruction'] = ['parts' => [['text' => $systemInstruction]]];
      }
      if ($withSearch) {
        $payload['tools'] = [['googleSearch' => new stdClass()]];
      }

      $url = 'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($model) . ':streamGenerateContent?alt=sse';
      $attempt = ask_avi_stream_upstream(
        $url,
        ['Content-Type: application/json', 'x-goog-api-key: ' . $geminiKey],
        $payload,
        'gemini',
        $model,
        $startedMs,
        $reqUser
      );
      if (!empty($attempt['ok'])) {
        exit;
      }
      $lastStatus = (int) $attempt['status'];
      $lastError = (string) $attempt['error'];
      if (!in_array($lastStatus, [400, 403, 404, 429, 503], true)) {
        break 2;
      }
    }
  }

  $latencyMs = (int) round(microtime(true) * 1000) - $startedMs;
  ask_avi_record_chat_telemetry($reqUser, $lastStatus, 'gemini', $latencyMs, $lastError);
  ask_avi_send_json($lastStatus, ['error' => 'upstream_failed', 'message' => $lastError]);
}

// Default: Open-Source Stack (Groq Free -> OpenRouter :free)
$groqKey = trim((string) ($settings['groq_api_key'] ?? ''));
$openRouterKey = trim((string) ($settings['openrouter_api_key'] ?? ''));

if ($groqKey === '' && $openRouterKey === '') {
  $latencyMs = (int) round(microtime(true) * 1000) - $startedMs;
  ask_avi_record_chat_telemetry($reqUser, 503, 'oss', $latencyMs, 'proxy_unconfigured: GROQ_API_KEY & OPENROUTER_API_KEY unset');
  ask_avi_send_json(503, [
    'error' => 'proxy_unconfigured',
    'message' => 'Set GROQ_API_KEY or OPENROUTER_API_KEY in WP Admin -> Ask Avi.',
  ]);
}

$messages = ask_avi_to_openai_messages($body['contents'], $systemInstruction, $isAuthenticated);
$isFast = ($mode === 'oss-fast');
$groqModels = $isFast
  ? ['qwen/qwen3.8-27b', 'openai/gpt-oss-20b', 'openai/gpt-oss-120b']
  : ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'];
$orModels = $isFast
  ? ['nvidia/nemotron-3.5-lightning:free', 'openrouter/free', 'google/gemma-4-26b-a4b-it:free']
  : ['nvidia/nemotron-3-ultra-550b-a55b:free', 'openrouter/free', 'google/gemma-4-31b-it:free', 'nvidia/nemotron-3.5-super-vl:free'];

$lastStatus = 502;
$lastError = 'Upstream open-source provider request failed.';

if ($groqKey !== '') {
  foreach ($groqModels as $model) {
    $payload = [
      'model' => $model,
      'messages' => $messages,
      'stream' => true,
      'temperature' => $temperature,
      'max_tokens' => $isFast ? 4096 : 8192,
    ];
    if (strpos($model, 'openai/gpt-oss') === 0) {
      $payload['reasoning_format'] = 'parsed';
      $payload['reasoning_effort'] = $isFast ? 'low' : 'high';
    }
    $attempt = ask_avi_stream_upstream(
      'https://api.groq.com/openai/v1/chat/completions',
      ['Content-Type: application/json', 'Authorization: Bearer ' . $groqKey],
      $payload,
      'openai',
      $model . ' (Groq Free)',
      $startedMs,
      $reqUser
    );
    if (!empty($attempt['ok'])) {
      exit;
    }
    $lastStatus = (int) $attempt['status'];
    $lastError = (string) $attempt['error'];
    if (!in_array($lastStatus, [402, 404, 429, 503], true)) {
      break;
    }
  }
}

if ($openRouterKey !== '') {
  foreach ($orModels as $model) {
    $payload = [
      'model' => $model,
      'messages' => $messages,
      'stream' => true,
      'temperature' => $temperature,
      'max_tokens' => $isFast ? 4096 : 8192,
    ];
    if (!$isFast) {
      $payload['reasoning'] = ['effort' => 'high'];
    }
    $attempt = ask_avi_stream_upstream(
      'https://openrouter.ai/api/v1/chat/completions',
      [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $openRouterKey,
        'HTTP-Referer: https://aviperera.com',
        'X-Title: Ask Avi',
      ],
      $payload,
      'openai',
      $model . ' (OpenRouter Free)',
      $startedMs,
      $reqUser
    );
    if (!empty($attempt['ok'])) {
      exit;
    }
    $lastStatus = (int) $attempt['status'];
    $lastError = (string) $attempt['error'];
    if (!in_array($lastStatus, [402, 404, 429, 503], true)) {
      break;
    }
  }
}

$latencyMs = (int) round(microtime(true) * 1000) - $startedMs;
ask_avi_record_chat_telemetry($reqUser, $lastStatus, 'oss-fallback', $latencyMs, $lastError);
ask_avi_send_json($lastStatus, ['error' => 'upstream_failed', 'message' => $lastError]);
