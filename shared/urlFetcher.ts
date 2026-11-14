import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 7000;
const MAX_OUTPUT_CHARS = 4200;

function isPrivateOrReservedIp(ip: string): boolean {
  const family = isIP(ip);
  if (!family) return true;
  if (family === 4) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }

  const lower = ip.toLowerCase();
  if (
    lower === '::' ||
    lower === '::1' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe80') ||
    lower.startsWith('::ffff:')
  ) {
    if (lower.startsWith('::ffff:')) {
      return isPrivateOrReservedIp(lower.slice(7));
    }
    return true;
  }
  return false;
}

async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// and https:// links are allowed.');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new Error('Local or internal network addresses are blocked.');
  }
  if (isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      throw new Error('Private or reserved IP addresses are blocked.');
    }
    return parsed;
  }

  const records = await lookup(host, { all: true });
  if (!records || records.length === 0) {
    throw new Error('Could not resolve target hostname.');
  }
  for (const rec of records) {
    if (isPrivateOrReservedIp(rec.address)) {
      throw new Error('Target domain resolves to a restricted private IP.');
    }
  }
  return parsed;
}

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function extractReadableTextFromHtml(html: string, fallbackTitle: string): {
  title: string;
  content: string;
} {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = decodeBasicEntities(titleMatch?.[1]?.replace(/\s+/g, ' ').trim() || '') || fallbackTitle;

  const descMatch =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  const desc = descMatch ? decodeBasicEntities(descMatch[1].trim()) : '';

  const mainMatch =
    html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
    html.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
    html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);

  let snippet = mainMatch ? mainMatch[1] : html;
  snippet = snippet
    .replace(/<(script|style|noscript|svg|nav|footer|header|aside|form)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  const cleaned = decodeBasicEntities(snippet)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const combined = desc && !cleaned.startsWith(desc) ? `${desc}\n\n${cleaned}` : cleaned;
  return {
    title: title.slice(0, 140),
    content: combined.slice(0, MAX_OUTPUT_CHARS).trim(),
  };
}

export async function fetchPublicUrlContext(rawUrl: string): Promise<{
  title: string;
  url: string;
  content: string;
}> {
  let currentUrl = (await assertSafePublicUrl(rawUrl)).toString();
  let finalResponse: Response | null = null;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'AskAviContextFetcher/1.0 (+https://aviperera.com)',
          Accept: 'text/html,text/plain,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5',
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        throw new Error('Redirect target was missing.');
      }
      const nextUrl = new URL(location, currentUrl).toString();
      currentUrl = (await assertSafePublicUrl(nextUrl)).toString();
      continue;
    }

    finalResponse = res;
    break;
  }

  if (!finalResponse) {
    throw new Error('Too many redirects while loading URL.');
  }
  if (!finalResponse.ok) {
    throw new Error(`Target site returned HTTP ${finalResponse.status}.`);
  }

  const ctype = (finalResponse.headers.get('content-type') || '').toLowerCase();
  if (ctype.includes('application/pdf')) {
    throw new Error('Direct PDF links cannot be scraped remotely — download and upload the PDF file directly.');
  }
  if (
    ctype &&
    !ctype.includes('text/') &&
    !ctype.includes('application/xhtml+xml') &&
    !ctype.includes('application/json') &&
    !ctype.includes('application/xml')
  ) {
    throw new Error(`Unsupported remote content type (${ctype.split(';')[0]}).`);
  }

  const reader = finalResponse.body?.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        const take = Math.min(value.length, MAX_BYTES - totalBytes);
        if (take > 0) {
          chunks.push(value.subarray(0, take));
          totalBytes += take;
        }
        if (totalBytes >= MAX_BYTES) {
          await reader.cancel().catch(() => undefined);
          break;
        }
      }
    }
  }

  const rawText = Buffer.concat(chunks).toString('utf8');
  const parsedUrl = new URL(currentUrl);
  if (ctype.includes('html') || rawText.trimStart().startsWith('<')) {
    const extracted = extractReadableTextFromHtml(rawText, parsedUrl.hostname);
    if (!extracted.content) {
      throw new Error('No readable text content found on that webpage.');
    }
    return { title: extracted.title, url: currentUrl, content: extracted.content };
  }

  return {
    title: parsedUrl.hostname,
    url: currentUrl,
    content: rawText.slice(0, MAX_OUTPUT_CHARS).trim(),
  };
}
