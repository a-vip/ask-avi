import { resolveEffectiveProxyUrl } from '../engine/llmService';
import type { UserProfile } from '../types/chat';

export const ADMIN_EMAIL = 'workwithavip@gmail.com';

export interface AuthConfigResponse {
  ok: boolean;
  googleEnabled: boolean;
  googleClientId: string;
  geminiConfigured?: boolean;
  wpSsoEnabled: boolean;
  wpLoginUrl?: string;
  wpLogoutUrl?: string;
  wpAdminUrl?: string;
  serverConfigured?: boolean;
  hasAdminPasscode: boolean;
  currentUser: UserProfile | null;
}

export interface ServerKeysUpdatePayload {
  groqApiKey?: string;
  openRouterApiKey?: string;
  geminiApiKey?: string;
  googleClientId?: string;
  adminPasscode?: string;
  clearKeys?: Array<
    'groqApiKey' | 'openRouterApiKey' | 'geminiApiKey' | 'googleClientId' | 'adminPasscode'
  >;
}

export interface AdminOverviewUser {
  id: string;
  name: string;
  email: string;
  provider: 'google' | 'email' | 'wordpress';
  role: 'admin' | 'user';
  marketingOptIn: boolean;
  createdAt: number;
  lastSeenAt: number;
  loginCount: number;
  chatCount: number;
  errorCount: number;
}

export interface AdminTelemetryLog {
  id: string;
  ts: number;
  type: 'chat_ok' | 'chat_error' | 'auth_signup' | 'auth_signin' | 'auth_denied' | 'client_error';
  level: 'info' | 'warn' | 'error';
  userEmail: string;
  modelUsed?: string;
  statusCode?: number;
  latencyMs?: number;
  message: string;
}

export interface AdminOverviewResponse {
  ok: boolean;
  stats: {
    totalUsers: number;
    marketingOptInCount: number;
    totalChats: number;
    errorCount: number;
    last24hChats: number;
  };
  users: AdminOverviewUser[];
  logs: AdminTelemetryLog[];
  serverKeys: {
    groq: boolean;
    openrouter: boolean;
    gemini: boolean;
    googleOAuth: boolean;
    adminPasscode: boolean;
  };
}

export function isVerifiedAdmin(profile: UserProfile | null | undefined): boolean {
  return Boolean(
    profile?.isAdmin &&
      profile.email?.trim().toLowerCase() === ADMIN_EMAIL
  );
}

export function resolveEffectiveAuthUrl(customProxyUrl?: string): string {
  const proxyUrl = resolveEffectiveProxyUrl(customProxyUrl);
  if (!proxyUrl) return '';
  if (proxyUrl === './api/chat') return './api/auth';
  if (proxyUrl === '/api/chat') return '/api/auth';
  if (proxyUrl.endsWith('/api/chat')) {
    return `${proxyUrl.slice(0, -'/api/chat'.length)}/api/auth`;
  }
  return '';
}

async function parseAuthJson<T>(res: Response): Promise<T & { ok?: boolean; error?: string }> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T & { ok?: boolean; error?: string };
  } catch {
    throw new Error(
      res.ok
        ? 'Unexpected response from authentication server.'
        : `Authentication request failed (${res.status}).`
    );
  }
}

export async function fetchAuthConfig(
  sessionToken?: string,
  customProxyUrl?: string
): Promise<AuthConfigResponse | null> {
  const authUrl = resolveEffectiveAuthUrl(customProxyUrl);
  if (!authUrl) return null;

  try {
    const res = await fetch(`${authUrl}?config=1`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      },
    });
    if (!res.ok) return null;
    const data = await parseAuthJson<AuthConfigResponse>(res);
    if (!data.ok) return null;
    return data;
  } catch {
    return null;
  }
}

export async function signUpWithEmail(
  params: {
    name: string;
    email: string;
    password: string;
    marketingOptIn?: boolean;
    adminPasscode?: string;
  },
  customProxyUrl?: string
): Promise<UserProfile> {
  const authUrl = resolveEffectiveAuthUrl(customProxyUrl);
  if (!authUrl) {
    throw new Error(
      'Backend account service is not available on this static mirror. Visit aviperera.com/ask-avi to create an account.'
    );
  }
  const res = await fetch(authUrl, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'signup', ...params }),
  });
  const data = await parseAuthJson<{ user?: UserProfile }>(res);
  if (!res.ok || !data.ok || !data.user) {
    throw new Error(data.error || `Could not create account (${res.status}).`);
  }
  return data.user;
}

export async function signInWithEmail(
  params: {
    email: string;
    password: string;
    adminPasscode?: string;
  },
  customProxyUrl?: string
): Promise<UserProfile> {
  const authUrl = resolveEffectiveAuthUrl(customProxyUrl);
  if (!authUrl) {
    throw new Error(
      'Backend account service is not available on this static mirror. Visit aviperera.com/ask-avi to sign in.'
    );
  }
  const res = await fetch(authUrl, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'signin', ...params }),
  });
  const data = await parseAuthJson<{ user?: UserProfile }>(res);
  if (!res.ok || !data.ok || !data.user) {
    throw new Error(data.error || `Sign in failed (${res.status}).`);
  }
  return data.user;
}

export async function signInWithGoogleCredential(
  credential: string,
  marketingOptIn = false,
  customProxyUrl?: string
): Promise<UserProfile> {
  const authUrl = resolveEffectiveAuthUrl(customProxyUrl);
  if (!authUrl) {
    throw new Error('Google Sign-In requires the Ask Avi backend endpoint.');
  }
  const res = await fetch(authUrl, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'google',
      credential,
      marketingOptIn,
    }),
  });
  const data = await parseAuthJson<{ user?: UserProfile }>(res);
  if (!res.ok || !data.ok || !data.user) {
    throw new Error(data.error || `Google Sign-In failed (${res.status}).`);
  }
  return data.user;
}

export async function fetchAdminOverview(
  sessionToken?: string,
  customProxyUrl?: string
): Promise<AdminOverviewResponse> {
  const authUrl = resolveEffectiveAuthUrl(customProxyUrl);
  if (!authUrl) {
    throw new Error('Admin backend endpoint is unavailable on this static origin.');
  }
  const res = await fetch(`${authUrl}?action=admin_overview`, {
    method: 'GET',
    credentials: 'same-origin',
    headers: {
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
  });
  const data = await parseAuthJson<AdminOverviewResponse>(res);
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Failed to load admin overview (${res.status}).`);
  }
  return data;
}

export async function saveServerSettings(
  payload: ServerKeysUpdatePayload,
  sessionToken?: string,
  customProxyUrl?: string
): Promise<AdminOverviewResponse['serverKeys']> {
  const authUrl = resolveEffectiveAuthUrl(customProxyUrl);
  if (!authUrl) {
    throw new Error('Live backend server endpoint is unavailable on this static origin.');
  }
  const res = await fetch(authUrl, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    body: JSON.stringify({
      action: 'save_server_settings',
      ...payload,
    }),
  });
  const data = await parseAuthJson<{ serverKeys?: AdminOverviewResponse['serverKeys'] }>(res);
  if (!res.ok || !data.ok || !data.serverKeys) {
    throw new Error(data.error || `Failed to save server keys (${res.status}).`);
  }
  return data.serverKeys;
}

export async function reportClientTelemetry(
  payload: {
    event?: string;
    level?: 'info' | 'warn' | 'error';
    message: string;
    engineId?: string;
    statusCode?: number;
  },
  sessionToken?: string,
  customProxyUrl?: string
): Promise<void> {
  const authUrl = resolveEffectiveAuthUrl(customProxyUrl);
  if (!authUrl) return;
  try {
    await fetch(authUrl, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      },
      body: JSON.stringify({
        action: 'telemetry',
        ...payload,
      }),
    });
  } catch {
    // Non-blocking telemetry
  }
}

export interface QaTurnReportPayload {
  turnId: string;
  threadId?: string;
  turnIndex?: number;
  promptText: string;
  answerText: string;
  thoughtsText?: string;
  citedSources?: Array<{ index: number; title: string; url: string; kind: 'archive' | 'web' }>;
  topRagScore?: number;
  ragMatchCount?: number;
  isContentGap?: boolean;
  gapTopic?: string;
  engineId?: string;
  modelUsed?: string;
  voiceStyle?: string;
  latencyMs?: number;
}

export async function reportCompletedQaTurn(
  payload: QaTurnReportPayload,
  sessionToken?: string,
  customProxyUrl?: string
): Promise<void> {
  const authUrl = resolveEffectiveAuthUrl(customProxyUrl);
  if (!authUrl || !payload.promptText.trim()) return;
  try {
    await fetch(authUrl, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      },
      body: JSON.stringify({
        action: 'record_qa_turn',
        ...payload,
      }),
    });
  } catch {
    // Non-blocking Q&A archival
  }
}

export async function subscribeToDispatch(
  email: string,
  topicHint?: string,
  sessionToken?: string,
  customProxyUrl?: string
): Promise<{ ok: boolean; email: string }> {
  const authUrl = resolveEffectiveAuthUrl(customProxyUrl);
  if (!authUrl) {
    throw new Error('Dispatch subscription endpoint is unavailable on this origin.');
  }
  const res = await fetch(authUrl, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    body: JSON.stringify({
      action: 'subscribe_dispatch',
      email: email.trim(),
      topicHint: topicHint ?? '',
    }),
  });
  const data = await parseAuthJson<{ email?: string }>(res);
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Subscription failed (${res.status}).`);
  }
  return { ok: true, email: data.email || email.trim() };
}

let googleScriptPromise: Promise<void> | null = null;

export function loadGoogleIdentityScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Browser window unavailable.'));
  }
  const gWindow = window as unknown as {
    google?: { accounts?: { id?: unknown } };
  };
  if (gWindow.google?.accounts?.id) {
    return Promise.resolve();
  }
  if (googleScriptPromise) return googleScriptPromise;

  googleScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-ask-avi-gsi="true"]'
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('Failed to load Google Sign-In script.')),
        { once: true }
      );
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.askAviGsi = 'true';
    script.onload = () => resolve();
    script.onerror = () => {
      googleScriptPromise = null;
      reject(new Error('Failed to load Google Identity Services.'));
    };
    document.head.appendChild(script);
  });

  return googleScriptPromise;
}

function escapeCsvCell(value: unknown): string {
  let raw = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(raw)) {
    raw = `'${raw}`;
  }
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function exportUsersAsCsv(users: AdminOverviewUser[]): string {
  const header = [
    'Name',
    'Email',
    'Provider',
    'Role',
    'Mailing List Opt-In',
    'Logins',
    'Messages',
    'Errors',
    'Created At',
    'Last Seen At',
  ];
  const rows = users.map((u) => [
    u.name,
    u.email,
    u.provider,
    u.role,
    u.marketingOptIn ? 'Yes' : 'No',
    u.loginCount,
    u.chatCount,
    u.errorCount,
    new Date(u.createdAt).toISOString(),
    new Date(u.lastSeenAt).toISOString(),
  ]);
  return [header, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
}
