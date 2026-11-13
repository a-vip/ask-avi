import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { handleGeminiProxyRequest, type ProxyEnv } from '../shared/geminiProxy.ts';

const ROOT_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST_DIR = join(ROOT_DIR, 'dist');
const PORT = Number(process.env.PORT || 4173);

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function loadLocalEnvFile(): void {
  const candidates = [join(ROOT_DIR, '.env.local'), join(ROOT_DIR, '.env')];
  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    const raw = readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

async function readBodyBuffer(req: IncomingMessage): Promise<Uint8Array | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) {
      v.forEach((item) => headers.append(k, item));
    } else if (typeof v === 'string') {
      headers.set(k, v);
    }
  }

  const body = await readBodyBuffer(req);
  const webRequest = new Request(`http://127.0.0.1:${PORT}${req.url ?? '/api/chat'}`, {
    method: req.method,
    headers,
    body: body ? Buffer.from(body) : undefined,
  });

  const env: ProxyEnv = {
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
  };

  const webResponse = await handleGeminiProxyRequest(webRequest, env);
  const outHeaders: Record<string, string> = {};
  webResponse.headers.forEach((val, key) => {
    outHeaders[key] = val;
  });

  res.writeHead(webResponse.status, outHeaders);
  if (!webResponse.body) {
    res.end();
    return;
  }

  const nodeStream = Readable.fromWeb(webResponse.body as import('node:stream/web').ReadableStream);
  nodeStream.pipe(res);
}

function serveStaticAsset(pathname: string, res: ServerResponse): void {
  const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let targetPath = resolve(DIST_DIR, relPath);
  if (!targetPath.startsWith(DIST_DIR) || !existsSync(targetPath) || statSync(targetPath).isDirectory()) {
    targetPath = join(DIST_DIR, 'index.html');
  }

  if (!existsSync(targetPath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('dist/ not built yet. Run "npm run build" first.');
    return;
  }

  const mime = MIME_TYPES[extname(targetPath).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
  res.end(readFileSync(targetPath));
}

loadLocalEnvFile();

const server = createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
    if (reqUrl.pathname === '/api/chat') {
      await handleApiRequest(req, res);
      return;
    }
    serveStaticAsset(reqUrl.pathname, res);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        error: 'local_server_error',
        message: err instanceof Error ? err.message : String(err),
      })
    );
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const hasGroq = Boolean(process.env.GROQ_API_KEY?.trim());
  const hasOr = Boolean(process.env.OPENROUTER_API_KEY?.trim());
  const hasGem = Boolean(process.env.GEMINI_API_KEY?.trim());
  console.log(
    `Ask Avi local server listening on http://localhost:${PORT} (groq=${hasGroq}, openrouter=${hasOr}, gemini=${hasGem})`
  );
});
