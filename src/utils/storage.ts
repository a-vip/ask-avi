import type { AppSettings, ChatThread, ThemeMode, UserProfile } from '../types/chat';

const THREADS_KEY = 'ask_avi_threads_v1';
const GUEST_THREADS_KEY = 'ask_avi_guest_threads_v1';
const SETTINGS_KEY = 'ask_avi_settings_v4';
const LEGACY_SETTINGS_KEY = 'ask_avi_settings_v3';
const THEME_KEY = 'ask_avi_theme';
const PROFILE_KEY = 'ask_avi_profile_v1';

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  engineId: 'oss-reasoning',
  voiceStyle: 'standard',
  webSearchEnabled: true,
  groqApiKey: '',
  openRouterApiKey: '',
  geminiApiKey: '',
  proxyUrl: '',
  customApi: {
    endpointUrl: '',
    apiKey: '',
    modelName: '',
  },
};

function normalizeEmailKey(userEmail?: string | null): string {
  return (userEmail ?? '').trim().toLowerCase();
}

function accountThreadsKey(email: string): string {
  return `${THREADS_KEY}:${email}`;
}

function normalizeThreadList(parsed: unknown): ChatThread[] {
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (t): t is ChatThread =>
        Boolean(t) &&
        typeof t === 'object' &&
        typeof (t as ChatThread).id === 'string' &&
        Array.isArray((t as ChatThread).messages)
    )
    .map((t) => ({
      ...t,
      messages: t.messages.map((m) => ({ ...m, isThinking: false, isStreaming: false })),
    }))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt);
}

function chooseRicherThread(a: ChatThread, b: ChatThread): ChatThread {
  const lenDiff = b.messages.length - a.messages.length;
  if (lenDiff !== 0) {
    return lenDiff > 0 ? b : a;
  }
  const lastA = a.messages[a.messages.length - 1];
  const lastB = b.messages[b.messages.length - 1];
  const contentA = (lastA?.content ?? '').trim().length;
  const contentB = (lastB?.content ?? '').trim().length;
  if ((contentA === 0) !== (contentB === 0)) {
    return contentB > 0 ? b : a;
  }
  return (b.updatedAt || 0) >= (a.updatedAt || 0) ? b : a;
}

export function mergeThreadLists(localThreads: ChatThread[], remoteThreads: ChatThread[]): ChatThread[] {
  const byId = new Map<string, ChatThread>();
  for (const raw of [...remoteThreads, ...localThreads]) {
    if (!raw || typeof raw.id !== 'string' || !Array.isArray(raw.messages)) continue;
    const cleanItem: ChatThread = {
      ...raw,
      messages: raw.messages.map((m) => ({ ...m, isThinking: false, isStreaming: false })),
    };
    const existing = byId.get(cleanItem.id);
    if (!existing) {
      byId.set(cleanItem.id, cleanItem);
      continue;
    }
    const chosen = chooseRicherThread(existing, cleanItem);
    const maxUpdated = Math.max(existing.updatedAt || 0, cleanItem.updatedAt || 0);
    byId.set(cleanItem.id, {
      ...chosen,
      pinned:
        (chosen.updatedAt || 0) >= maxUpdated
          ? Boolean(chosen.pinned)
          : Boolean(existing.pinned || cleanItem.pinned),
    });
  }
  return Array.from(byId.values())
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt)
    .slice(0, 60);
}

export function loadGuestThreads(): ChatThread[] {
  const sessionList: ChatThread[] = [];
  const legacyList: ChatThread[] = [];
  try {
    if (typeof sessionStorage !== 'undefined') {
      const sessionRaw = sessionStorage.getItem(GUEST_THREADS_KEY);
      if (sessionRaw) sessionList.push(...normalizeThreadList(JSON.parse(sessionRaw)));
    }
  } catch {
    // Ignore storage read failures
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const legacyRaw = localStorage.getItem(THREADS_KEY);
      if (legacyRaw) legacyList.push(...normalizeThreadList(JSON.parse(legacyRaw)));
    }
  } catch {
    // Ignore storage read failures
  }
  return mergeThreadLists(sessionList, legacyList);
}

export function clearGuestThreads(): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(GUEST_THREADS_KEY);
    }
  } catch {
    // Ignore storage failures
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(THREADS_KEY);
    }
  } catch {
    // Ignore storage failures
  }
}

export function loadThreads(userEmail?: string | null): ChatThread[] {
  const email = normalizeEmailKey(userEmail);
  try {
    if (email) {
      if (typeof localStorage === 'undefined') return [];
      const acctKey = accountThreadsKey(email);
      const raw = localStorage.getItem(acctKey);
      if (raw !== null) {
        localStorage.removeItem(THREADS_KEY);
        return normalizeThreadList(JSON.parse(raw));
      }
      const legacyRaw = localStorage.getItem(THREADS_KEY);
      if (legacyRaw) {
        const migrated = normalizeThreadList(JSON.parse(legacyRaw));
        localStorage.setItem(acctKey, JSON.stringify(migrated.slice(0, 60)));
        localStorage.removeItem(THREADS_KEY);
        return migrated;
      }
      return [];
    }

    if (typeof sessionStorage !== 'undefined') {
      const sessionRaw = sessionStorage.getItem(GUEST_THREADS_KEY);
      if (sessionRaw !== null) {
        return normalizeThreadList(JSON.parse(sessionRaw));
      }
    }
    if (typeof localStorage !== 'undefined' && !localStorage.getItem(PROFILE_KEY)) {
      const legacyRaw = localStorage.getItem(THREADS_KEY);
      if (legacyRaw) {
        return normalizeThreadList(JSON.parse(legacyRaw));
      }
    }
    return [];
  } catch {
    return [];
  }
}

export function saveThreads(threads: ChatThread[], userEmail?: string | null): void {
  const email = normalizeEmailKey(userEmail);
  try {
    const cleaned = threads.slice(0, 60).map((t) => ({
      ...t,
      messages: t.messages.map((m) => ({ ...m, isThinking: false, isStreaming: false })),
    }));
    if (email) {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(accountThreadsKey(email), JSON.stringify(cleaned));
        localStorage.removeItem(THREADS_KEY);
      }
      return;
    }
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(GUEST_THREADS_KEY, JSON.stringify(cleaned));
    }
  } catch {
    // Ignore storage quota errors gracefully
  }
}

export function loadSettings(): AppSettings {
  try {
    const params = new URLSearchParams(window.location.search);
    const urlTheme = params.get('theme');
    const raw = localStorage.getItem(SETTINGS_KEY);
    const legacyRaw = !raw ? localStorage.getItem(LEGACY_SETTINGS_KEY) : null;
    const stored = raw
      ? (JSON.parse(raw) as Partial<AppSettings>)
      : legacyRaw
        ? (JSON.parse(legacyRaw) as Partial<AppSettings>)
        : {};
    const themeFromStorage = localStorage.getItem(THEME_KEY) as ThemeMode | null;

    const resolvedTheme: ThemeMode =
      urlTheme === 'light' || urlTheme === 'dark'
        ? urlTheme
        : stored.theme === 'light' || stored.theme === 'dark'
          ? stored.theme
          : themeFromStorage === 'light' || themeFromStorage === 'dark'
            ? themeFromStorage
            : 'dark';

    const resolvedEngineId =
      raw && stored.engineId
        ? stored.engineId
        : stored.engineId === 'custom-api'
          ? 'custom-api'
          : DEFAULT_SETTINGS.engineId;

    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      engineId: resolvedEngineId,
      theme: resolvedTheme,
      customApi: {
        ...DEFAULT_SETTINGS.customApi,
        ...(stored.customApi ?? {}),
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    localStorage.setItem(THEME_KEY, settings.theme);
  } catch {
    // Ignore storage failures
  }
}

export function applyThemeToDocument(theme: ThemeMode): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

export function deriveThreadTitle(firstPrompt: string): string {
  const cleaned = firstPrompt.replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'New conversation';
  return cleaned.length <= 54 ? cleaned : cleaned.slice(0, 51).trimEnd() + '…';
}

export function groupThreadsByRecency(threads: ChatThread[]): Array<{ label: string; items: ChatThread[] }> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const oneDay = 86_400_000;

  const pinned: ChatThread[] = [];
  const today: ChatThread[] = [];
  const yesterday: ChatThread[] = [];
  const week: ChatThread[] = [];
  const older: ChatThread[] = [];

  for (const t of threads) {
    if (t.pinned) {
      pinned.push(t);
    } else if (t.updatedAt >= startOfToday) {
      today.push(t);
    } else if (t.updatedAt >= startOfToday - oneDay) {
      yesterday.push(t);
    } else if (t.updatedAt >= startOfToday - 7 * oneDay) {
      week.push(t);
    } else {
      older.push(t);
    }
  }

  return [
    { label: 'Pinned', items: pinned },
    { label: 'Today', items: today },
    { label: 'Yesterday', items: yesterday },
    { label: 'Previous 7 Days', items: week },
    { label: 'Earlier', items: older },
  ].filter((g) => g.items.length > 0);
}

export function exportThreadAsMarkdown(thread: ChatThread): string {
  const header = `# ${thread.title}\n\n*Exported from Ask Avi (https://aviperera.com) on ${new Date().toISOString().slice(0, 10)}*\n\n---\n`;
  const body = thread.messages
    .map((m) => {
      const speaker = m.role === 'user' ? '### You' : '### Ask Avi';
      const cites =
        m.sources && m.sources.length > 0
          ? `\n\n**Sources:**\n${m.sources.map((s) => `- [${s.index}] [${s.entry.title}](${s.entry.url})${s.entry.doi ? ` (DOI: ${s.entry.doi})` : ''}`).join('\n')}`
          : '';
      return `${speaker}\n\n${m.content}${cites}`;
    })
    .join('\n\n---\n\n');

  return `${header}\n${body}\n`;
}

export function postParentBridgeEvent(type: string, payload?: unknown): void {
  try {
    if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
      window.parent.postMessage({ source: 'ask-avi', type, payload }, '*');
    }
  } catch {
    // Ignore cross-origin postMessage restrictions
  }
}

export function loadUserProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UserProfile>;
    const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
    if (!name) return null;
    return {
      id: typeof parsed.id === 'string' ? parsed.id : undefined,
      name,
      email: typeof parsed.email === 'string' && parsed.email.trim() ? parsed.email.trim() : undefined,
      picture: typeof parsed.picture === 'string' && parsed.picture.trim() ? parsed.picture.trim() : undefined,
      provider:
        parsed.provider === 'google' ||
        parsed.provider === 'email' ||
        parsed.provider === 'wordpress' ||
        parsed.provider === 'local'
          ? parsed.provider
          : 'local',
      isAdmin: Boolean(parsed.isAdmin),
      sessionToken: typeof parsed.sessionToken === 'string' ? parsed.sessionToken : undefined,
      marketingOptIn: typeof parsed.marketingOptIn === 'boolean' ? parsed.marketingOptIn : undefined,
      signedInAt: typeof parsed.signedInAt === 'number' ? parsed.signedInAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function saveUserProfile(profile: UserProfile | null): void {
  try {
    if (!profile) {
      localStorage.removeItem(PROFILE_KEY);
    } else {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    }
  } catch {
    // Ignore storage failures
  }
}
