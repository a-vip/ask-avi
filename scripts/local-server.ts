import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { handleGeminiProxyRequest, type ProxyEnv } from '../shared/geminiProxy.ts';
import { assembleServerSystemPrompt } from '../shared/masterPrompt.ts';
import { fetchPublicUrlContext } from '../shared/urlFetcher.ts';

const ROOT_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST_DIR = join(ROOT_DIR, 'dist');
const PORT = Number(process.env.PORT || 4173);

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
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

async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  preReadBody?: Uint8Array,
  bearerUser?: { email: string; role: string } | null
): Promise<void> {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) {
      v.forEach((item) => headers.append(k, item));
    } else if (typeof v === 'string') {
      headers.set(k, v);
    }
  }

  const body = preReadBody ?? (await readBodyBuffer(req));
  let forwardBody: Uint8Array | undefined = body;
  if (req.method === 'POST' && body) {
    try {
      const parsed = JSON.parse(Buffer.from(body).toString('utf8')) as {
        mode?: string;
        phase?: 'deliberate' | 'final';
        model?: string;
        voiceStyle?: string;
        archiveBlock?: string;
        webContext?: string;
        attachedContext?: string;
        continuityBrief?: string;
        reasoningSynthesis?: string;
        systemInstruction?: string;
        contents?: Array<{ role?: string; parts?: Array<{ text?: string }> }>;
      };
      const isGoogleMode =
        parsed.mode === 'google' ||
        (typeof parsed.model === 'string' && parsed.model.toLowerCase().startsWith('gemini'));
      if (isGoogleMode && !bearerUser) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            error: 'auth_required',
            message: 'Unlock frontier models, deeper context, and saved conversations.',
          })
        );
        return;
      }

      const maxSysChars = bearerUser ? 22000 : 16000;
      const maxTurns = bearerUser ? 20 : 14;
      const maxPartChars = bearerUser ? 10000 : 6000;
      const localMasterPath = join(ROOT_DIR, '.ask-avi-data', 'master-prompt.txt');
      const localMasterOverride = existsSync(localMasterPath)
        ? readFileSync(localMasterPath, 'utf8')
        : undefined;
      // Assemble authoritative Master Prompt strictly on the backend, ignoring any untrusted client override.
      parsed.systemInstruction = assembleServerSystemPrompt({
        masterPromptOverride: localMasterOverride,
        voiceStyle: parsed.voiceStyle,
        archiveBlock: parsed.archiveBlock,
        webContext: parsed.webContext,
        attachedContext: parsed.attachedContext,
        continuityBrief: parsed.continuityBrief,
        reasoningSynthesis: parsed.reasoningSynthesis,
        phase: parsed.phase === 'deliberate' ? 'deliberate' : 'final',
        isAuthenticated: Boolean(bearerUser),
      }).slice(0, maxSysChars);
      if (Array.isArray(parsed.contents)) {
        parsed.contents = parsed.contents.slice(-maxTurns).map((turn) => ({
          ...turn,
          parts: Array.isArray(turn.parts)
            ? turn.parts.map((p) =>
                typeof p?.text === 'string' ? { ...p, text: p.text.slice(0, maxPartChars) } : p
              )
            : turn.parts,
        }));
      }
      forwardBody = Buffer.from(JSON.stringify(parsed), 'utf8');
    } catch {
      // Let proxy validate malformed JSON
    }
  }

  const webRequest = new Request(`http://127.0.0.1:${PORT}${req.url ?? '/api/chat'}`, {
    method: req.method,
    headers,
    body: forwardBody ? Buffer.from(forwardBody) : undefined,
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
const authMod = await import('./auth-store.ts');

const server = createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
    if (reqUrl.pathname === '/api/auth') {
      await authMod.handleAuthRequest(req, reqUrl, res);
      return;
    }
    if (reqUrl.pathname === '/api/context') {
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Method not allowed.' }));
        return;
      }
      try {
        const raw = await readBodyBuffer(req);
        const payload = JSON.parse(raw ? Buffer.from(raw).toString('utf8') : '{}') as { url?: string };
        const result = await fetchPublicUrlContext(String(payload.url ?? '').trim());
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, ...result, kind: 'link' }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : 'Unable to fetch link.',
          })
        );
      }
      return;
    }
    if (reqUrl.pathname === '/api/chat') {
      const startedAt = Date.now();
      const bearerUser = authMod.extractBearerUser(req);
      let capturedStatus = 200;
      let capturedModel = '';
      let errorSnippet = '';

      const origWriteHead = res.writeHead.bind(res);
      res.writeHead = ((statusCode: number, ...rest: unknown[]) => {
        capturedStatus = statusCode;
        return (origWriteHead as (...args: unknown[]) => ServerResponse)(statusCode, ...rest);
      }) as ServerResponse['writeHead'];

      const origWrite = res.write.bind(res);
      res.write = ((chunk: unknown, ...rest: unknown[]) => {
        if (capturedStatus >= 400 && errorSnippet.length < 500 && chunk) {
          errorSnippet += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        }
        return (origWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
      }) as ServerResponse['write'];

      const origEnd = res.end.bind(res);
      res.end = ((chunk?: unknown, ...rest: unknown[]) => {
        if (
          capturedStatus >= 400 &&
          errorSnippet.length < 500 &&
          chunk &&
          typeof chunk !== 'function'
        ) {
          errorSnippet += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        }
        const modelHeader = res.getHeader('X-Ask-Avi-Model');
        if (modelHeader) {
          capturedModel = Array.isArray(modelHeader)
            ? modelHeader.join(', ')
            : String(modelHeader);
        }
        return (origEnd as (...args: unknown[]) => ServerResponse)(chunk, ...rest);
      }) as ServerResponse['end'];

      const rawChatBody = await readBodyBuffer(req);
      let isDeliberatePhase = false;
      if (rawChatBody) {
        try {
          const preview = JSON.parse(Buffer.from(rawChatBody).toString('utf8')) as { phase?: string };
          isDeliberatePhase = preview.phase === 'deliberate';
        } catch {
          isDeliberatePhase = false;
        }
      }

      res.on('finish', () => {
        const finalCode = res.statusCode || capturedStatus;
        if (isDeliberatePhase && finalCode < 400) return;
        authMod.recordChatTelemetry({
          user: bearerUser,
          statusCode: finalCode,
          modelUsed: capturedModel || undefined,
          latencyMs: Date.now() - startedAt,
          errorMessage: errorSnippet ? errorSnippet.slice(0, 400) : undefined,
        });
      });

      await handleApiRequest(req, res, rawChatBody, bearerUser);
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
  const hasGoogleOAuth = Boolean(process.env.GOOGLE_CLIENT_ID?.trim());
  const hasAdminPasscode = Boolean(process.env.ASK_AVI_ADMIN_PASSCODE?.trim());
  console.log(
    `Ask Avi local server listening on http://localhost:${PORT} (groq=${hasGroq}, openrouter=${hasOr}, gemini=${hasGem}, googleOAuth=${hasGoogleOAuth}, adminPasscode=${hasAdminPasscode})`
  );
});
