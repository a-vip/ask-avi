import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

export const ADMIN_EMAIL = 'workwithavip@gmail.com';
const DATA_DIR = join(process.cwd(), '.ask-avi-data');
const DB_PATH = join(DATA_DIR, 'ask-avi-db.json');
const SECRET_PATH = join(DATA_DIR, 'auth-secret.key');
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_LOGS = 500;

export type UserRole = 'admin' | 'user';
export type AuthProvider = 'google' | 'email' | 'wordpress';

export interface StoredUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
  provider: AuthProvider;
  role: UserRole;
  passwordHash?: string;
  marketingOptIn: boolean;
  createdAt: number;
  lastSeenAt: number;
  loginCount: number;
  chatCount: number;
  errorCount: number;
}

export interface TelemetryLog {
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

interface AuthDatabase {
  users: StoredUser[];
  logs: TelemetryLog[];
}

export interface SessionPayload {
  sub: string;
  email: string;
  name: string;
  role: UserRole;
  provider: AuthProvider;
  exp: number;
}

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readDb(): AuthDatabase {
  ensureDataDir();
  if (!existsSync(DB_PATH)) {
    return { users: [], logs: [] };
  }
  try {
    const raw = JSON.parse(readFileSync(DB_PATH, 'utf8')) as Partial<AuthDatabase>;
    return {
      users: Array.isArray(raw.users) ? raw.users : [],
      logs: Array.isArray(raw.logs) ? raw.logs : [],
    };
  } catch {
    return { users: [], logs: [] };
  }
}

function writeDb(db: AuthDatabase): void {
  ensureDataDir();
  const trimmed: AuthDatabase = {
    users: db.users,
    logs: db.logs.slice(-MAX_LOGS),
  };
  const tmpPath = `${DB_PATH}.${process.pid}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(trimmed, null, 2), 'utf8');
  renameSync(tmpPath, DB_PATH);
}

function getAuthSecret(): string {
  const fromEnv = process.env.ASK_AVI_AUTH_SECRET?.trim();
  if (fromEnv && fromEnv.length >= 16) return fromEnv;

  ensureDataDir();
  if (existsSync(SECRET_PATH)) {
    const existing = readFileSync(SECRET_PATH, 'utf8').trim();
    if (existing.length >= 32) return existing;
  }

  const generated = randomBytes(32).toString('hex');
  writeFileSync(SECRET_PATH, generated, 'utf8');
  try {
    chmodSync(SECRET_PATH, 0o600);
  } catch {
    // Windows ACLs may ignore POSIX mode bits.
  }
  return generated;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, storedHash?: string): boolean {
  if (!storedHash) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  const derivedHex = scryptSync(password, salt, 64).toString('hex');
  return constantTimeEquals(derivedHex, expectedHex);
}

function signSessionToken(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', getAuthSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySessionToken(token?: string | null): SessionPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expectedSig = createHmac('sha256', getAuthSecret()).update(body).digest('base64url');
  if (!constantTimeEquals(sig, expectedSig)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed.sub || !parsed.email || !parsed.exp || parsed.exp < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function extractBearerUser(req: IncomingMessage): SessionPayload | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return verifySessionToken(token);
}

function toClientUser(user: StoredUser, sessionToken?: string) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    picture: user.picture,
    provider: user.provider,
    isAdmin: user.role === 'admin' && user.email.toLowerCase() === ADMIN_EMAIL,
    marketingOptIn: user.marketingOptIn,
    signedInAt: user.lastSeenAt,
    ...(sessionToken ? { sessionToken } : {}),
  };
}

function issueUserSession(user: StoredUser): string {
  return signSessionToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    provider: user.provider,
    exp: Date.now() + TOKEN_TTL_MS,
  });
}

function appendLog(
  db: AuthDatabase,
  entry: Omit<TelemetryLog, 'id' | 'ts'>
): void {
  db.logs.push({
    id: randomBytes(6).toString('hex'),
    ts: Date.now(),
    ...entry,
    message: entry.message.slice(0, 500),
  });
}

function verifyAdminPasscode(candidate?: string): { ok: boolean; reason?: string } {
  const configured = process.env.ASK_AVI_ADMIN_PASSCODE?.trim();
  if (!configured) {
    return {
      ok: false,
      reason:
        'Admin email passcode is not configured on this server (set ASK_AVI_ADMIN_PASSCODE in .env.local or sign in with Google/WordPress).',
    };
  }
  if (!candidate || !constantTimeEquals(candidate.trim(), configured)) {
    return {
      ok: false,
      reason: 'Invalid admin verification passcode for workwithavip@gmail.com.',
    };
  }
  return { ok: true };
}

async function verifyGoogleIdToken(idToken: string): Promise<{
  sub: string;
  email: string;
  name: string;
  picture?: string;
}> {
  const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('Google ID token verification failed.');
  }
  const info = (await res.json()) as {
    sub?: string;
    email?: string;
    email_verified?: string | boolean;
    name?: string;
    picture?: string;
    aud?: string;
  };
  const verified = info.email_verified === 'true' || info.email_verified === true;
  if (!verified || !info.email || !info.sub) {
    throw new Error('Google account email could not be verified.');
  }
  const expectedClientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (expectedClientId && info.aud !== expectedClientId) {
    throw new Error('Google Sign-In client audience mismatch.');
  }
  return {
    sub: info.sub,
    email: info.email.toLowerCase().trim(),
    name: info.name?.trim() || info.email.split('@')[0],
    picture: info.picture?.trim() || undefined,
  };
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > 64 * 1024) {
      throw new Error('Request payload too large.');
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export function recordChatTelemetry(params: {
  user: SessionPayload | null;
  statusCode: number;
  modelUsed?: string;
  latencyMs: number;
  errorMessage?: string;
}): void {
  try {
    const db = readDb();
    const ok = params.statusCode >= 200 && params.statusCode < 400;
    const userEmail = params.user?.email ?? 'guest';

    if (params.user) {
      const stored = db.users.find((u) => u.id === params.user?.sub || u.email === params.user?.email);
      if (stored) {
        stored.lastSeenAt = Date.now();
        if (ok) stored.chatCount += 1;
        else stored.errorCount += 1;
      }
    }

    appendLog(db, {
      type: ok ? 'chat_ok' : 'chat_error',
      level: ok ? 'info' : 'error',
      userEmail,
      modelUsed: params.modelUsed || undefined,
      statusCode: params.statusCode,
      latencyMs: params.latencyMs,
      message: ok
        ? `Response streamed via ${params.modelUsed || 'upstream provider'} in ${params.latencyMs}ms`
        : params.errorMessage || `Chat API returned HTTP ${params.statusCode}`,
    });
    writeDb(db);
  } catch {
    // Telemetry must never crash the request lifecycle.
  }
}

export async function handleAuthRequest(
  req: IncomingMessage,
  reqUrl: URL,
  res: ServerResponse
): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  const bearer = extractBearerUser(req);

  if (req.method === 'GET') {
    const action = reqUrl.searchParams.get('action');

    if (action === 'admin_overview') {
      if (!bearer) {
        sendJson(res, 401, { ok: false, error: 'Authentication required.' });
        return;
      }
      if (bearer.role !== 'admin' || bearer.email.toLowerCase() !== ADMIN_EMAIL) {
        sendJson(res, 403, { ok: false, error: 'Admin privileges required.' });
        return;
      }

      const db = readDb();
      const now = Date.now();
      const dayAgo = now - 24 * 60 * 60 * 1000;
      const safeUsers = [...db.users]
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
        .map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          provider: u.provider,
          role: u.role,
          marketingOptIn: u.marketingOptIn,
          createdAt: u.createdAt,
          lastSeenAt: u.lastSeenAt,
          loginCount: u.loginCount,
          chatCount: u.chatCount,
          errorCount: u.errorCount,
        }));

      sendJson(res, 200, {
        ok: true,
        stats: {
          totalUsers: db.users.length,
          marketingOptInCount: db.users.filter((u) => u.marketingOptIn).length,
          totalChats: db.logs.filter((l) => l.type === 'chat_ok' || l.type === 'chat_error').length,
          errorCount: db.logs.filter((l) => l.level === 'error').length,
          last24hChats: db.logs.filter(
            (l) => l.ts >= dayAgo && (l.type === 'chat_ok' || l.type === 'chat_error')
          ).length,
        },
        users: safeUsers,
        logs: [...db.logs].reverse().slice(0, 150),
        serverKeys: {
          groq: Boolean(process.env.GROQ_API_KEY?.trim()),
          openrouter: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
          gemini: Boolean(process.env.GEMINI_API_KEY?.trim()),
          googleOAuth: Boolean(process.env.GOOGLE_CLIENT_ID?.trim()),
          adminPasscode: Boolean(process.env.ASK_AVI_ADMIN_PASSCODE?.trim()),
        },
      });
      return;
    }

    const db = readDb();
    const matchedUser = bearer
      ? db.users.find((u) => u.id === bearer.sub || u.email === bearer.email)
      : undefined;
    sendJson(res, 200, {
      ok: true,
      googleEnabled: Boolean(process.env.GOOGLE_CLIENT_ID?.trim()),
      googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || '',
      wpSsoEnabled: false,
      hasAdminPasscode: Boolean(process.env.ASK_AVI_ADMIN_PASSCODE?.trim()),
      currentUser: matchedUser ? toClientUser(matchedUser) : null,
    });
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    return;
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, {
      ok: false,
      error: err instanceof Error ? err.message : 'Invalid JSON request.',
    });
    return;
  }

  const action = String(body.action ?? '').trim();

  if (action === 'google') {
    const idToken = String(body.idToken ?? body.credential ?? '').trim();
    if (!idToken) {
      sendJson(res, 400, { ok: false, error: 'Missing Google ID token.' });
      return;
    }
    try {
      const gUser = await verifyGoogleIdToken(idToken);
      const db = readDb();
      const now = Date.now();
      const role: UserRole = gUser.email === ADMIN_EMAIL ? 'admin' : 'user';
      let user = db.users.find((u) => u.email === gUser.email);
      const isNew = !user;

      if (!user) {
        user = {
          id: `g_${randomBytes(6).toString('hex')}`,
          email: gUser.email,
          name: gUser.name,
          picture: gUser.picture,
          provider: 'google',
          role,
          marketingOptIn: Boolean(body.marketingOptIn),
          createdAt: now,
          lastSeenAt: now,
          loginCount: 1,
          chatCount: 0,
          errorCount: 0,
        };
        db.users.push(user);
      } else {
        user.name = gUser.name;
        user.picture = gUser.picture;
        user.provider = 'google';
        user.role = role;
        user.lastSeenAt = now;
        user.loginCount += 1;
        if (typeof body.marketingOptIn === 'boolean') {
          user.marketingOptIn = body.marketingOptIn;
        }
      }

      appendLog(db, {
        type: isNew ? 'auth_signup' : 'auth_signin',
        level: 'info',
        userEmail: user.email,
        statusCode: 200,
        message: `${isNew ? 'Signed up' : 'Signed in'} via Google (${role})`,
      });
      writeDb(db);

      const sessionToken = issueUserSession(user);
      sendJson(res, 200, { ok: true, user: toClientUser(user, sessionToken) });
    } catch (err) {
      sendJson(res, 401, {
        ok: false,
        error: err instanceof Error ? err.message : 'Google Sign-In verification failed.',
      });
    }
    return;
  }

  if (action === 'signup' || action === 'signin') {
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const nameInput = String(body.name ?? '').trim();
    const adminPasscode = String(body.adminPasscode ?? '');
    const marketingOptIn = Boolean(body.marketingOptIn);

    if (!validateEmail(email)) {
      sendJson(res, 400, { ok: false, error: 'Please enter a valid email address.' });
      return;
    }
    if (password.length < 6) {
      sendJson(res, 400, {
        ok: false,
        error: 'Password must be at least 6 characters.',
      });
      return;
    }

    const db = readDb();
    const now = Date.now();
    const isAdminTarget = email === ADMIN_EMAIL;

    if (isAdminTarget) {
      const check = verifyAdminPasscode(adminPasscode);
      if (!check.ok) {
        appendLog(db, {
          type: 'auth_denied',
          level: 'warn',
          userEmail: email,
          statusCode: 403,
          message: `Denied unverified admin ${action} attempt.`,
        });
        writeDb(db);
        sendJson(res, 403, { ok: false, error: check.reason });
        return;
      }
    }

    let existing = db.users.find((u) => u.email === email);

    if (action === 'signup') {
      if (existing) {
        sendJson(res, 409, {
          ok: false,
          error: 'An account with this email already exists. Please sign in instead.',
        });
        return;
      }
      const user: StoredUser = {
        id: `u_${randomBytes(6).toString('hex')}`,
        email,
        name: nameInput || email.split('@')[0],
        provider: 'email',
        role: isAdminTarget ? 'admin' : 'user',
        passwordHash: hashPassword(password),
        marketingOptIn,
        createdAt: now,
        lastSeenAt: now,
        loginCount: 1,
        chatCount: 0,
        errorCount: 0,
      };
      db.users.push(user);
      appendLog(db, {
        type: 'auth_signup',
        level: 'info',
        userEmail: user.email,
        statusCode: 200,
        message: `Created ${user.role} account via Email.`,
      });
      writeDb(db);
      const sessionToken = issueUserSession(user);
      sendJson(res, 200, { ok: true, user: toClientUser(user, sessionToken) });
      return;
    }

    // action === 'signin'
    if (!existing) {
      if (isAdminTarget) {
        // Bootstrap verified admin if passcode passed on first local sign-in.
        existing = {
          id: `u_${randomBytes(6).toString('hex')}`,
          email,
          name: nameInput || 'Avi Perera',
          provider: 'email',
          role: 'admin',
          passwordHash: hashPassword(password),
          marketingOptIn: false,
          createdAt: now,
          lastSeenAt: now,
          loginCount: 1,
          chatCount: 0,
          errorCount: 0,
        };
        db.users.push(existing);
        appendLog(db, {
          type: 'auth_signup',
          level: 'info',
          userEmail: existing.email,
          statusCode: 200,
          message: 'Verified admin signed in & initialized admin profile.',
        });
        writeDb(db);
        const sessionToken = issueUserSession(existing);
        sendJson(res, 200, { ok: true, user: toClientUser(existing, sessionToken) });
        return;
      }
      sendJson(res, 401, {
        ok: false,
        error: 'No account found for that email. Switch to Create account to sign up.',
      });
      return;
    }

    if (existing.passwordHash) {
      if (!verifyPassword(password, existing.passwordHash)) {
        appendLog(db, {
          type: 'auth_denied',
          level: 'warn',
          userEmail: email,
          statusCode: 401,
          message: 'Incorrect password on Email sign-in.',
        });
        writeDb(db);
        sendJson(res, 401, { ok: false, error: 'Incorrect email or password.' });
        return;
      }
    } else if (existing.provider === 'google' && !isAdminTarget) {
      sendJson(res, 400, {
        ok: false,
        error: 'This account uses Google Sign-In. Please continue with Google.',
      });
      return;
    }

    if (isAdminTarget) {
      existing.role = 'admin';
    }
    existing.lastSeenAt = now;
    existing.loginCount += 1;
    appendLog(db, {
      type: 'auth_signin',
      level: 'info',
      userEmail: existing.email,
      statusCode: 200,
      message: `Signed in via Email (${existing.role}).`,
    });
    writeDb(db);
    const sessionToken = issueUserSession(existing);
    sendJson(res, 200, { ok: true, user: toClientUser(existing, sessionToken) });
    return;
  }

  if (action === 'telemetry') {
    const db = readDb();
    const userEmail = bearer?.email || 'guest';
    const message = String(body.message ?? 'Client diagnostic event').trim();
    const level = body.level === 'error' || body.level === 'warn' ? body.level : 'info';
    appendLog(db, {
      type: 'client_error',
      level,
      userEmail,
      modelUsed: body.engineId ? String(body.engineId) : undefined,
      statusCode: typeof body.statusCode === 'number' ? body.statusCode : undefined,
      message,
    });
    writeDb(db);
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 400, { ok: false, error: 'Unknown auth action.' });
}
