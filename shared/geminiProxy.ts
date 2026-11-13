export interface ProxyEnv {
  GEMINI_API_KEY?: string;
  ALLOWED_ORIGINS?: string;
}

const DEFAULT_ALLOWED_ORIGINS = [
  'https://aviperera.com',
  'https://www.aviperera.com',
  'https://a-vip.github.io',
];

const ALLOWED_MODELS = new Set(['gemini-2.5-flash', 'gemini-2.5-pro']);

export function resolveCorsHeaders(request: Request, extraOrigins?: string): Record<string, string> {
  const origin = request.headers.get('Origin') ?? '';
  const extra = (extraOrigins ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const allowAllLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  const isVercelPreview = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin);
  const isExplicitlyAllowed =
    DEFAULT_ALLOWED_ORIGINS.includes(origin) || extra.includes(origin);

  const allowOrigin =
    allowAllLocal || isVercelPreview || isExplicitlyAllowed
      ? origin
      : DEFAULT_ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

interface ChatRequestPayload {
  model?: string;
  systemInstruction?: string;
  contents?: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
  thinkingBudget?: number;
  enableSearch?: boolean;
  temperature?: number;
}

export async function handleGeminiProxyRequest(
  request: Request,
  env: ProxyEnv
): Promise<Response> {
  const corsHeaders = resolveCorsHeaders(request, env.ALLOWED_ORIGINS);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: 'proxy_unconfigured',
        message: 'Server GEMINI_API_KEY environment variable is not set yet.',
      }),
      {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  let body: ChatRequestPayload;
  try {
    body = (await request.json()) as ChatRequestPayload;
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const requestedModel = body.model ?? 'gemini-2.5-flash';
  const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : 'gemini-2.5-flash';

  if (!Array.isArray(body.contents) || body.contents.length === 0) {
    return new Response(JSON.stringify({ error: 'missing_contents' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const budget = Math.max(
    1024,
    Math.min(24576, Number(body.thinkingBudget) || (model === 'gemini-2.5-pro' ? 16384 : 8192))
  );

  const geminiPayload: Record<string, unknown> = {
    contents: body.contents.slice(-24),
    generationConfig: {
      temperature:
        typeof body.temperature === 'number'
          ? Math.max(0.1, Math.min(1.3, body.temperature))
          : 0.75,
      topP: 0.92,
      maxOutputTokens: 8192,
      thinkingConfig: {
        includeThoughts: true,
        thinkingBudget: budget,
      },
    },
  };

  if (body.systemInstruction && body.systemInstruction.trim().length > 0) {
    geminiPayload.systemInstruction = {
      parts: [{ text: body.systemInstruction.trim() }],
    };
  }

  if (body.enableSearch !== false) {
    geminiPayload.tools = [{ googleSearch: {} }];
  }

  const upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  const upstream = await fetch(upstreamUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(geminiPayload),
  });

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => upstream.statusText);
    return new Response(
      JSON.stringify({
        error: 'upstream_gemini_error',
        status: upstream.status,
        message: errText.slice(0, 500),
      }),
      {
        status: upstream.status || 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}
