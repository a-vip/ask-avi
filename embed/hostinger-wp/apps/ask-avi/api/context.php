<?php
/**
 * Ask Avi — SSRF-Hardened Web Link Context Extractor
 * Routed via .htaccess from ./api/context -> api/context.php
 */
declare(strict_types=1);

require_once __DIR__ . '/wp-bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  ask_avi_send_json(405, ['ok' => false, 'error' => 'Method not allowed.']);
}

$raw = file_get_contents('php://input');
$body = json_decode($raw ?: '{}', true);
$targetUrl = trim((string) ($body['url'] ?? ''));

if ($targetUrl === '') {
  ask_avi_send_json(400, ['ok' => false, 'error' => 'Missing URL parameter.']);
}

function ask_avi_is_public_ip(string $ip): bool {
  return filter_var(
    $ip,
    FILTER_VALIDATE_IP,
    FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
  ) !== false;
}

function ask_avi_validate_public_url(string $url): string {
  $parts = @parse_url($url);
  if (!is_array($parts) || empty($parts['scheme']) || empty($parts['host'])) {
    throw new RuntimeException('Invalid URL format.');
  }
  $scheme = strtolower((string) $parts['scheme']);
  if ($scheme !== 'http' && $scheme !== 'https') {
    throw new RuntimeException('Only http:// and https:// URLs are allowed.');
  }
  $host = strtolower((string) $parts['host']);
  if (
    $host === 'localhost' ||
    substr($host, -6) === '.local' ||
    substr($host, -9) === '.internal' ||
    substr($host, -10) === '.localhost'
  ) {
    throw new RuntimeException('Local or internal hostnames are blocked.');
  }

  $cleanHost = trim($host, '[]');
  if (filter_var($cleanHost, FILTER_VALIDATE_IP) !== false) {
    if (!ask_avi_is_public_ip($cleanHost)) {
      throw new RuntimeException('Private or reserved IP addresses are blocked.');
    }
    return $url;
  }

  $ips = @gethostbynamel($cleanHost);
  $v6 = function_exists('dns_get_record') ? @dns_get_record($cleanHost, DNS_AAAA) : [];
  $allIps = is_array($ips) ? $ips : [];
  if (is_array($v6)) {
    foreach ($v6 as $rec) {
      if (!empty($rec['ipv6'])) {
        $allIps[] = $rec['ipv6'];
      }
    }
  }
  if (empty($allIps)) {
    throw new RuntimeException('Could not resolve target hostname.');
  }
  foreach ($allIps as $ip) {
    if (!ask_avi_is_public_ip((string) $ip)) {
      throw new RuntimeException('Target domain resolves to a restricted network address.');
    }
  }
  return $url;
}

function ask_avi_resolve_relative_url(string $base, string $rel): string {
  if (preg_match('#^https?://#i', $rel)) {
    return $rel;
  }
  $b = @parse_url($base);
  if (!is_array($b) || empty($b['scheme']) || empty($b['host'])) {
    return $rel;
  }
  $origin = $b['scheme'] . '://' . $b['host'] . (!empty($b['port']) ? ':' . $b['port'] : '');
  if (strpos($rel, '//') === 0) {
    return $b['scheme'] . ':' . $rel;
  }
  if (strpos($rel, '/') === 0) {
    return $origin . $rel;
  }
  $path = isset($b['path']) ? preg_replace('#/[^/]*$#', '/', (string) $b['path']) : '/';
  return $origin . $path . $rel;
}

try {
  $currentUrl = ask_avi_validate_public_url($targetUrl);
  $maxBytes = 512 * 1024;
  $html = '';
  $contentType = '';
  $statusCode = 0;

  for ($hop = 0; $hop <= 3; $hop++) {
    $ch = curl_init($currentUrl);
    if ($ch === false) {
      throw new RuntimeException('cURL initialization failed.');
    }
    $headersOut = [];
    $bodyBuf = '';

    curl_setopt($ch, CURLOPT_RETURNTRANSFER, false);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 4);
    curl_setopt($ch, CURLOPT_TIMEOUT, 7);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
      'User-Agent: AskAviContextFetcher/1.0 (+https://aviperera.com)',
      'Accept: text/html,text/plain,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5',
    ]);
    curl_setopt($ch, CURLOPT_HEADERFUNCTION, static function ($c, $line) use (&$headersOut) {
      $len = strlen($line);
      $parts = explode(':', $line, 2);
      if (count($parts) === 2) {
        $headersOut[strtolower(trim($parts[0]))] = trim($parts[1]);
      }
      return $len;
    });
    curl_setopt($ch, CURLOPT_WRITEFUNCTION, static function ($c, $chunk) use (&$bodyBuf, $maxBytes) {
      $rem = $maxBytes - strlen($bodyBuf);
      if ($rem <= 0) {
        return 0;
      }
      $bodyBuf .= substr($chunk, 0, $rem);
      return strlen($chunk);
    });

    curl_exec($ch);
    $statusCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr = curl_error($ch);
    curl_close($ch);

    if ($statusCode >= 300 && $statusCode < 400 && !empty($headersOut['location'])) {
      $next = ask_avi_resolve_relative_url($currentUrl, $headersOut['location']);
      $currentUrl = ask_avi_validate_public_url($next);
      continue;
    }

    if ($statusCode === 0) {
      throw new RuntimeException($curlErr ?: 'Unable to connect to link.');
    }
    if ($statusCode < 200 || $statusCode >= 400) {
      throw new RuntimeException("Target site returned HTTP {$statusCode}.");
    }

    $contentType = strtolower((string) ($headersOut['content-type'] ?? ''));
    $html = $bodyBuf;
    break;
  }

  if (strpos($contentType, 'application/pdf') !== false) {
    ask_avi_send_json(415, [
      'ok' => false,
      'error' => 'Direct PDF links cannot be scraped remotely — download and upload the PDF file instead.',
    ]);
  }
  if (
    $contentType !== '' &&
    strpos($contentType, 'text/') === false &&
    strpos($contentType, 'application/xhtml+xml') === false &&
    strpos($contentType, 'application/json') === false &&
    strpos($contentType, 'application/xml') === false
  ) {
    ask_avi_send_json(415, ['ok' => false, 'error' => 'Unsupported remote file type.']);
  }

  $hostFallback = (string) (parse_url($currentUrl, PHP_URL_HOST) ?: 'Web Link');
  if (strpos($contentType, 'html') !== false || strpos(ltrim($html), '<') === 0) {
    $title = $hostFallback;
    if (preg_match('#<title[^>]*>(.*?)</title>#is', $html, $tm)) {
      $t = trim(html_entity_decode(preg_replace('/\s+/', ' ', strip_tags($tm[1])), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
      if ($t !== '') {
        $title = $t;
      }
    }
    $desc = '';
    if (preg_match('#<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\']#i', $html, $dm)) {
      $desc = trim(html_entity_decode($dm[1], ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    }

    $snippet = $html;
    if (preg_match('#<article[^>]*>(.*?)</article>#is', $html, $am)) {
      $snippet = $am[1];
    } elseif (preg_match('#<main[^>]*>(.*?)</main>#is', $html, $mm)) {
      $snippet = $mm[1];
    } elseif (preg_match('#<body[^>]*>(.*?)</body>#is', $html, $bm)) {
      $snippet = $bm[1];
    }

    $snippet = preg_replace('#<(script|style|noscript|svg|nav|footer|header|aside|form)[^>]*>.*?</\1>#is', ' ', $snippet);
    $snippet = preg_replace('#</(p|div|li|h[1-6]|tr|blockquote|section|article)>#i', "\n", $snippet);
    $snippet = preg_replace('#<br\s*/?>#i', "\n", $snippet);
    $snippet = html_entity_decode(strip_tags((string) $snippet), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $snippet = trim((string) preg_replace("/\n{3,}/", "\n\n", (string) preg_replace("/[ \t]{2,}/", ' ', $snippet)));

    if ($desc !== '' && stripos($snippet, $desc) !== 0) {
      $snippet = $desc . "\n\n" . $snippet;
    }
    $cleanContent = mb_substr($snippet, 0, 4200, 'UTF-8');
    if ($cleanContent === '') {
      ask_avi_send_json(422, ['ok' => false, 'error' => 'No readable article text found at that URL.']);
    }

    ask_avi_send_json(200, [
      'ok' => true,
      'title' => mb_substr($title, 0, 140, 'UTF-8'),
      'url' => $currentUrl,
      'content' => $cleanContent,
      'kind' => 'link',
    ]);
  }

  $plain = trim(mb_substr($html, 0, 4200, 'UTF-8'));
  if ($plain === '') {
    ask_avi_send_json(422, ['ok' => false, 'error' => 'Empty response body from link.']);
  }
  ask_avi_send_json(200, [
    'ok' => true,
    'title' => $hostFallback,
    'url' => $currentUrl,
    'content' => $plain,
    'kind' => 'link',
  ]);
} catch (Throwable $e) {
  ask_avi_send_json(400, ['ok' => false, 'error' => $e->getMessage()]);
}
