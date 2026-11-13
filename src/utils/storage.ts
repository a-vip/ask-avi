import type { AppSettings, ChatThread, ThemeMode, UserProfile } from '../types/chat';

const THREADS_KEY = 'ask_avi_threads_v1';
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

export function loadThreads(): ChatThread[] {
  try {
    const raw = localStorage.getItem(THREADS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatThread[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((t) => ({
        ...t,
        messages: t.messages.map((m) => ({ ...m, isStreaming: false })),
      }))
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function saveThreads(threads: ChatThread[]): void {
  try {
    const cleaned = threads.slice(0, 60).map((t) => ({
      ...t,
      messages: t.messages.map((m) => ({ ...m, isStreaming: false })),
    }));
    localStorage.setItem(THREADS_KEY, JSON.stringify(cleaned));
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
      name,
      email: typeof parsed.email === 'string' && parsed.email.trim() ? parsed.email.trim() : undefined,
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
