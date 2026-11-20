import type { EngineId, ThemeMode, ThinkingEffort, VoiceStyle } from '../types/chat';
import { KNOWLEDGE_META } from '../engine/rag';

export type CircadianSlot =
  | 'weeHours'
  | 'earlyDawn'
  | 'morning'
  | 'midday'
  | 'afternoon'
  | 'goldenHour'
  | 'evening'
  | 'lateNight';

export type RegionBucket =
  | 'london'
  | 'bangkok'
  | 'europe'
  | 'americas'
  | 'east_asia'
  | 'south_east_asia'
  | 'south_asia'
  | 'oceania'
  | 'global';

export type GreetingCategory =
  | 'circadian'
  | 'landmark'
  | 'region'
  | 'cadence'
  | 'wit'
  | 'context';

export interface GreetingVisitorInput {
  now?: Date;
  timeZone?: string;
  locale?: string;
  userName?: string | null;
  isAuthenticated?: boolean;
  threadCount?: number;
  thinkingEffort?: ThinkingEffort;
  voiceStyle?: VoiceStyle;
  engineId?: EngineId;
  theme?: ThemeMode;
  corpusCount?: number;
  excludeIds?: string[];
  preferredIndex?: number;
  skipVisitTracking?: boolean;
}

export interface VisitStats {
  visitCount: number;
  firstVisitAt: number;
  lastVisitAt: number;
  lastDayKey: string;
  consecutiveDays: number;
}

export interface ResolvedVisitorSignals {
  now: Date;
  hour: number;
  minute: number;
  formattedTime: string;
  dayOfWeek: number;
  dayName: string;
  dayOfMonth: number;
  month: number;
  season: 'spring' | 'summer' | 'autumn' | 'winter';
  circadianSlot: CircadianSlot;
  timeZone: string;
  cityLabel: string;
  regionBucket: RegionBucket;
  locale: string;
  isBritishLocale: boolean;
  firstName: string;
  isAuthenticated: boolean;
  threadCount: number;
  visitCount: number;
  hoursSinceLastVisit: number | null;
  consecutiveDays: number;
  thinkingEffort: ThinkingEffort;
  voiceStyle?: VoiceStyle;
  engineId: EngineId;
  theme: ThemeMode;
  corpusCount: number;
}

export interface GreetingEntry {
  id: string;
  category: GreetingCategory;
  weight?: number;
  playful?: boolean;
  when?: (ctx: ResolvedVisitorSignals) => boolean;
  text: string | ((ctx: ResolvedVisitorSignals) => string);
}

export interface SelectedGreeting {
  id: string;
  headline: string;
  kicker: string;
  category: GreetingCategory;
  signals: ResolvedVisitorSignals;
}

const VISIT_STATS_KEY = 'ask_avi_visit_stats_v1';
const RECENT_GREETINGS_KEY = 'ask_avi_recent_greetings_v1';
const SESSION_TRACKED_KEY = 'ask_avi_session_counted_v1';

export function getCircadianSlot(hour: number): CircadianSlot {
  if (hour < 5) return 'weeHours';
  if (hour < 8) return 'earlyDawn';
  if (hour < 12) return 'morning';
  if (hour < 14) return 'midday';
  if (hour < 17) return 'afternoon';
  if (hour < 19) return 'goldenHour';
  if (hour < 22) return 'evening';
  return 'lateNight';
}

function getLocalDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isSouthernHemisphereTz(tz: string): boolean {
  return /^(Australia|Antarctica|Pacific\/Auckland|Pacific\/Fiji|America\/(Argentina|Sao_Paulo|Santiago|Montevideo|Asuncion|Lima)|Africa\/(Johannesburg|Windhoek|Harare|Maputo|Gaborone))/i.test(
    tz
  );
}

export function resolveSeason(month: number, timeZone: string): 'spring' | 'summer' | 'autumn' | 'winter' {
  const south = isSouthernHemisphereTz(timeZone);
  // 0=Jan..11=Dec
  let northSeason: 'spring' | 'summer' | 'autumn' | 'winter' = 'winter';
  if (month >= 2 && month <= 4) northSeason = 'spring';
  else if (month >= 5 && month <= 7) northSeason = 'summer';
  else if (month >= 8 && month <= 10) northSeason = 'autumn';

  if (!south) return northSeason;
  const flip: Record<'spring' | 'summer' | 'autumn' | 'winter', 'spring' | 'summer' | 'autumn' | 'winter'> = {
    spring: 'autumn',
    summer: 'winter',
    autumn: 'spring',
    winter: 'summer',
  };
  return flip[northSeason];
}

export function parseTimeZoneMeta(tz: string): { cityLabel: string; regionBucket: RegionBucket } {
  const lower = tz.toLowerCase();
  let regionBucket: RegionBucket = 'global';

  if (lower.includes('london') || lower.includes('belfast') || lower.includes('dublin')) {
    regionBucket = 'london';
  } else if (lower.includes('bangkok')) {
    regionBucket = 'bangkok';
  } else if (lower.startsWith('europe/')) {
    regionBucket = 'europe';
  } else if (lower.startsWith('america/')) {
    regionBucket = 'americas';
  } else if (/asia\/(singapore|kuala_lumpur|jakarta|manila|ho_chi_minh|saigon|phnom_penh|vientiane|yangon)/i.test(lower)) {
    regionBucket = 'south_east_asia';
  } else if (/asia\/(colombo|kolkata|calcutta|dhaka|karachi|kathmandu|mumbai)/i.test(lower)) {
    regionBucket = 'south_asia';
  } else if (/asia\/(tokyo|seoul|shanghai|hong_kong|taipei|macau)/i.test(lower)) {
    regionBucket = 'east_asia';
  } else if (lower.startsWith('australia/') || /pacific\/(auckland|fiji|wellington)/i.test(lower)) {
    regionBucket = 'oceania';
  }

  let cityLabel = '';
  if (tz && !/^etc\//i.test(tz) && !/^utc$/i.test(tz) && !/^gmt$/i.test(tz)) {
    const parts = tz.split('/');
    const rawCity = parts[parts.length - 1] || '';
    const cleaned = rawCity.replace(/_/g, ' ').trim();
    if (cleaned && cleaned.length <= 24) {
      cityLabel = cleaned === 'Calcutta' ? 'Kolkata' : cleaned;
    }
  }

  return { cityLabel, regionBucket };
}

function readAndUpdateVisitStats(now: Date, skipTracking: boolean): {
  stats: VisitStats;
  hoursSinceLastVisit: number | null;
} {
  const todayKey = getLocalDayKey(now);
  const nowMs = now.getTime();
  const defaultStats: VisitStats = {
    visitCount: 1,
    firstVisitAt: nowMs,
    lastVisitAt: nowMs,
    lastDayKey: todayKey,
    consecutiveDays: 1,
  };

  if (skipTracking || typeof localStorage === 'undefined') {
    return { stats: defaultStats, hoursSinceLastVisit: null };
  }

  try {
    const raw = localStorage.getItem(VISIT_STATS_KEY);
    if (!raw) {
      localStorage.setItem(VISIT_STATS_KEY, JSON.stringify(defaultStats));
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(SESSION_TRACKED_KEY, '1');
      }
      return { stats: defaultStats, hoursSinceLastVisit: null };
    }

    const parsed = JSON.parse(raw) as Partial<VisitStats>;
    const prevLastAt = typeof parsed.lastVisitAt === 'number' ? parsed.lastVisitAt : nowMs;
    const hoursSinceLastVisit = Math.max(0, (nowMs - prevLastAt) / 3600000);
    const alreadyCountedThisTab =
      typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SESSION_TRACKED_KEY) === '1';

    let nextVisitCount = typeof parsed.visitCount === 'number' ? parsed.visitCount : 1;
    let nextConsecutiveDays = typeof parsed.consecutiveDays === 'number' ? parsed.consecutiveDays : 1;

    if (!alreadyCountedThisTab) {
      nextVisitCount += 1;
      const prevDayKey = typeof parsed.lastDayKey === 'string' ? parsed.lastDayKey : todayKey;
      if (prevDayKey !== todayKey) {
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        const yesterdayKey = getLocalDayKey(yesterday);
        nextConsecutiveDays = prevDayKey === yesterdayKey ? nextConsecutiveDays + 1 : 1;
      }
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(SESSION_TRACKED_KEY, '1');
      }
    }

    const updated: VisitStats = {
      visitCount: nextVisitCount,
      firstVisitAt: typeof parsed.firstVisitAt === 'number' ? parsed.firstVisitAt : nowMs,
      lastVisitAt: alreadyCountedThisTab ? prevLastAt : nowMs,
      lastDayKey: todayKey,
      consecutiveDays: nextConsecutiveDays,
    };

    if (!alreadyCountedThisTab) {
      localStorage.setItem(VISIT_STATS_KEY, JSON.stringify(updated));
    }

    return {
      stats: updated,
      hoursSinceLastVisit: alreadyCountedThisTab && updated.visitCount <= 1 ? null : hoursSinceLastVisit,
    };
  } catch {
    return { stats: defaultStats, hoursSinceLastVisit: null };
  }
}

export function resolveVisitorSignals(input: GreetingVisitorInput = {}): ResolvedVisitorSignals {
  const now = input.now ?? new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const dayOfWeek = now.getDay();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = dayNames[dayOfWeek] ?? 'Today';
  const dayOfMonth = now.getDate();
  const month = now.getMonth();

  let detectedTz = input.timeZone ?? '';
  if (!detectedTz) {
    try {
      detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {
      detectedTz = '';
    }
  }

  let locale = input.locale ?? '';
  if (!locale && typeof navigator !== 'undefined') {
    locale = navigator.language || '';
  }

  const formattedTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const { cityLabel, regionBucket } = parseTimeZoneMeta(detectedTz);
  const season = resolveSeason(month, detectedTz);
  const circadianSlot = getCircadianSlot(hour);
  const { stats, hoursSinceLastVisit } = readAndUpdateVisitStats(now, Boolean(input.skipVisitTracking));

  const trimmedName = (input.userName ?? '').trim();
  const firstName = trimmedName ? trimmedName.split(/\s+/)[0].slice(0, 24) : '';

  return {
    now,
    hour,
    minute,
    formattedTime,
    dayOfWeek,
    dayName,
    dayOfMonth,
    month,
    season,
    circadianSlot,
    timeZone: detectedTz,
    cityLabel,
    regionBucket,
    locale,
    isBritishLocale: /^en-(GB|AU|NZ|IE|SG|HK)/i.test(locale),
    firstName,
    isAuthenticated: Boolean(input.isAuthenticated && firstName),
    threadCount: input.threadCount ?? 0,
    visitCount: stats.visitCount,
    hoursSinceLastVisit,
    consecutiveDays: stats.consecutiveDays,
    thinkingEffort:
      input.thinkingEffort ??
      (input.voiceStyle === 'academic' ? 'deep' : input.voiceStyle === 'mentor' ? 'medium' : 'fast'),
    voiceStyle: input.voiceStyle,
    engineId: input.engineId ?? 'oss-reasoning',
    theme: input.theme ?? 'dark',
    corpusCount: input.corpusCount ?? KNOWLEDGE_META.totalEntries,
  };
}

function clipShort(value: string, maxLen: number): string {
  const clean = value.trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`;
}

/**
 * Curated repository of context-aware, witty, and intellectually engaging hero greetings
 * spanning circadian bands, temporal landmarks, timezone regions, visitor cadence, and mode cues.
 * Every rendered variation is kept concise enough (<= 32 chars) to sit cleanly on a single hero line.
 */
export const GREETING_REPOSITORY: GreetingEntry[] = [
  // ── 1. Wee Hours (00:00 – 04:59) ─────────────────────────────────────────
  {
    id: 'wee-midnight-oil',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'weeHours',
    text: 'Burning the midnight oil?',
  },
  {
    id: 'wee-insomnia-footnotes',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'weeHours',
    text: 'Best footnotes happen late.',
  },
  {
    id: 'wee-named-owl',
    category: 'circadian',
    weight: 5,
    when: (c) => c.circadianSlot === 'weeHours' && Boolean(c.firstName),
    text: (c) => `Still awake, ${clipShort(c.firstName, 16)}?`,
  },
  {
    id: 'wee-sleep-or-hubris',
    category: 'circadian',
    weight: 4,
    playful: true,
    when: (c) => c.circadianSlot === 'weeHours',
    text: (c) => `${c.formattedTime} genius — or hubris?`,
  },
  {
    id: 'wee-quiet-world',
    category: 'circadian',
    weight: 3,
    playful: true,
    when: (c) => c.circadianSlot === 'weeHours',
    text: 'Up late, or up early?',
  },
  {
    id: 'wee-tea-stubbornness',
    category: 'circadian',
    weight: 3,
    playful: true,
    when: (c) => c.circadianSlot === 'weeHours',
    text: 'Late desk. Coffee or hubris?',
  },

  // ── 2. Early Dawn (05:00 – 07:59) ────────────────────────────────────────
  {
    id: 'dawn-before-inbox',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'earlyDawn',
    text: 'Up before the inbox wakes?',
  },
  {
    id: 'dawn-first-light',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'earlyDawn',
    text: 'First light thinking.',
  },
  {
    id: 'dawn-quiet-hours',
    category: 'circadian',
    weight: 3,
    when: (c) => c.circadianSlot === 'earlyDawn',
    text: 'Quiet hours before the noise.',
  },
  {
    id: 'dawn-coffee-clean-slate',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'earlyDawn',
    text: 'Fresh coffee, clean slate.',
  },
  {
    id: 'dawn-named',
    category: 'circadian',
    weight: 5,
    when: (c) => c.circadianSlot === 'earlyDawn' && Boolean(c.firstName),
    text: (c) => `Early start, ${clipShort(c.firstName, 17)}.`,
  },

  // ── 3. Morning (08:00 – 11:59) ───────────────────────────────────────────
  {
    id: 'morn-coffee-kick',
    category: 'circadian',
    weight: 3,
    when: (c) => c.circadianSlot === 'morning',
    text: 'Ready once coffee kicks in?',
  },
  {
    id: 'morn-briefing',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'morning',
    text: 'Morning briefing, zero fluff.',
  },
  {
    id: 'morn-stress-test',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'morning',
    text: 'Clear light, thorny questions.',
  },
  {
    id: 'morn-on-desk',
    category: 'circadian',
    weight: 3,
    when: (c) => c.circadianSlot === 'morning',
    text: 'Morning. What is on the desk?',
  },
  {
    id: 'morn-named',
    category: 'circadian',
    weight: 5,
    when: (c) => c.circadianSlot === 'morning' && Boolean(c.firstName),
    text: (c) => `Morning, ${clipShort(c.firstName, 20)}.`,
  },

  // ── 4. Midday (12:00 – 13:59) ────────────────────────────────────────────
  {
    id: 'noon-halftime',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'midday',
    text: 'Halftime check-in over lunch?',
  },
  {
    id: 'noon-powering-through',
    category: 'circadian',
    weight: 3,
    when: (c) => c.circadianSlot === 'midday',
    text: 'Lunch break, or powering on?',
  },
  {
    id: 'noon-sharper-angle',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'midday',
    text: 'Hungry for a sharper angle?',
  },
  {
    id: 'noon-clarity',
    category: 'circadian',
    weight: 3,
    when: (c) => c.circadianSlot === 'midday',
    text: 'Noon clarity check.',
  },

  // ── 5. Afternoon (14:00 – 16:59) ─────────────────────────────────────────
  {
    id: 'aft-slump',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'afternoon',
    text: 'Past the afternoon slump yet?',
  },
  {
    id: 'aft-deep-work',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'afternoon',
    text: 'Deep work. Bring a problem.',
  },
  {
    id: 'aft-second-wind',
    category: 'circadian',
    weight: 3,
    playful: true,
    when: (c) => c.circadianSlot === 'afternoon',
    text: 'Second wind or third espresso?',
  },
  {
    id: 'aft-desk-check',
    category: 'circadian',
    weight: 3,
    when: (c) => c.circadianSlot === 'afternoon',
    text: 'What still feels half-baked?',
  },
  {
    id: 'aft-named',
    category: 'circadian',
    weight: 5,
    when: (c) => c.circadianSlot === 'afternoon' && Boolean(c.firstName),
    text: (c) => `Afternoon, ${clipShort(c.firstName, 18)}.`,
  },

  // ── 6. Golden Hour (17:00 – 18:59) ───────────────────────────────────────
  {
    id: 'gold-thinking',
    category: 'circadian',
    weight: 5,
    when: (c) => c.circadianSlot === 'goldenHour',
    text: 'Golden hour thinking.',
  },
  {
    id: 'gold-twilight',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'goldenHour',
    text: 'One question before dusk?',
  },
  {
    id: 'gold-synthesis',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'goldenHour',
    text: 'Five o’clock clarity check.',
  },
  {
    id: 'gold-last-thread',
    category: 'circadian',
    weight: 3,
    when: (c) => c.circadianSlot === 'goldenHour',
    text: 'Dusk desk — one last thread?',
  },

  // ── 7. Evening (19:00 – 21:59) ───────────────────────────────────────────
  {
    id: 'eve-unhurried',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'evening',
    text: 'Unhurried evening thinking.',
  },
  {
    id: 'eve-off-clock',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'evening',
    text: 'Off the clock, still curious?',
  },
  {
    id: 'eve-minus-algo',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'evening',
    text: 'Reading, minus the algorithm.',
  },
  {
    id: 'eve-philosophy-debug',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'evening',
    text: 'Law, Spinoza, or broken code?',
  },
  {
    id: 'eve-named',
    category: 'circadian',
    weight: 5,
    when: (c) => c.circadianSlot === 'evening' && Boolean(c.firstName),
    text: (c) => `Evening, ${clipShort(c.firstName, 20)}.`,
  },

  // ── 8. Late Night (22:00 – 23:59) ────────────────────────────────────────
  {
    id: 'night-hits-different',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'lateNight',
    text: 'Night air, sharper questions.',
  },
  {
    id: 'night-winding-down',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'lateNight',
    text: 'Winding down, or starting?',
  },
  {
    id: 'night-rabbit-hole',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'lateNight',
    text: 'One rabbit hole before sleep?',
  },
  {
    id: 'night-tabs-open',
    category: 'circadian',
    weight: 4,
    playful: true,
    when: (c) => c.circadianSlot === 'lateNight',
    text: 'Still got twenty tabs open?',
  },

  // ── 9. Temporal Landmarks & Fresh-Start Triggers ─────────────────────────
  {
    id: 'land-monday-reset',
    category: 'landmark',
    weight: 5,
    when: (c) => c.dayOfWeek === 1 && c.hour < 13,
    text: 'Monday reset. What matters?',
  },
  {
    id: 'land-monday-hypothesis',
    category: 'landmark',
    weight: 4,
    when: (c) => c.dayOfWeek === 1,
    text: 'New week, cleaner priors.',
  },
  {
    id: 'land-midweek',
    category: 'landmark',
    weight: 3,
    when: (c) => c.dayOfWeek === 3,
    text: 'Midweek reality check.',
  },
  {
    id: 'land-friday-escape',
    category: 'landmark',
    weight: 5,
    playful: true,
    when: (c) => c.dayOfWeek === 5 && c.hour >= 14,
    text: 'Friday off the spreadsheet?',
  },
  {
    id: 'land-friday-one-question',
    category: 'landmark',
    weight: 4,
    when: (c) => c.dayOfWeek === 5,
    text: 'One last Friday question?',
  },
  {
    id: 'land-weekend-best',
    category: 'landmark',
    weight: 5,
    when: (c) => c.dayOfWeek === 0 || c.dayOfWeek === 6,
    text: 'Weekend curiosity hits best.',
  },
  {
    id: 'land-saturday-no-meetings',
    category: 'landmark',
    weight: 4,
    when: (c) => c.dayOfWeek === 6,
    text: 'Saturday. Zero meetings.',
  },
  {
    id: 'land-sunday-slow-read',
    category: 'landmark',
    weight: 4,
    when: (c) => c.dayOfWeek === 0 && c.hour < 18,
    text: 'Sunday slow-read hours.',
  },
  {
    id: 'land-sunday-eve',
    category: 'landmark',
    weight: 5,
    when: (c) => c.dayOfWeek === 0 && c.hour >= 18,
    text: 'Sunday reset before Monday.',
  },
  {
    id: 'land-month-start',
    category: 'landmark',
    weight: 5,
    when: (c) => c.dayOfMonth === 1,
    text: 'New month, tougher questions.',
  },
  {
    id: 'land-new-year',
    category: 'landmark',
    weight: 5,
    when: (c) => c.month === 0 && c.dayOfMonth <= 10,
    text: 'New year, cleaner priors.',
  },
  {
    id: 'land-winter-reading',
    category: 'landmark',
    weight: 3,
    when: (c) => c.season === 'winter',
    text: 'Winter weather for deep reads.',
  },
  {
    id: 'land-autumn-sharp',
    category: 'landmark',
    weight: 3,
    when: (c) => c.season === 'autumn',
    text: 'Autumn light, long arguments.',
  },

  // ── 10. Timezone & Geographic Atmosphere (Overt & Non-Creepy) ────────────
  {
    id: 'reg-london-meridian',
    category: 'region',
    weight: 5,
    when: (c) => c.regionBucket === 'london',
    text: 'London hours — tea poured?',
  },
  {
    id: 'reg-london-cambridge',
    category: 'region',
    weight: 4,
    when: (c) => c.regionBucket === 'london',
    text: 'Greenwich hours. Rain outside?',
  },
  {
    id: 'reg-bangkok-slow',
    category: 'region',
    weight: 5,
    when: (c) => c.regionBucket === 'bangkok',
    text: 'Bangkok time — think clearly.',
  },
  {
    id: 'reg-bangkok-evening',
    category: 'region',
    weight: 5,
    when: (c) => c.regionBucket === 'bangkok' && c.hour >= 17,
    text: 'Chao Phraya twilight.',
  },
  {
    id: 'reg-bangkok-iced',
    category: 'region',
    weight: 4,
    when: (c) => c.regionBucket === 'bangkok' && c.hour >= 7 && c.hour < 17,
    text: 'Bangkok desk — iced espresso?',
  },
  {
    id: 'reg-europe-geneva',
    category: 'region',
    weight: 4,
    when: (c) => c.regionBucket === 'europe',
    text: (c) =>
      c.cityLabel
        ? `${clipShort(c.cityLabel, 12)} time — law or code?`
        : 'European hours. Test a thesis.',
  },
  {
    id: 'reg-americas-clock',
    category: 'region',
    weight: 4,
    when: (c) => c.regionBucket === 'americas',
    text: (c) =>
      c.cityLabel
        ? `${clipShort(c.cityLabel, 13)} — in focus today?`
        : 'Across the pond today?',
  },
  {
    id: 'reg-sea-clock',
    category: 'region',
    weight: 4,
    when: (c) => c.regionBucket === 'south_east_asia',
    text: (c) =>
      c.cityLabel ? `${clipShort(c.cityLabel, 14)} hours — welcome.` : 'Southeast Asia hours.',
  },
  {
    id: 'reg-south-asia-colombo',
    category: 'region',
    weight: 4,
    when: (c) => c.regionBucket === 'south_asia',
    text: (c) =>
      c.cityLabel
        ? `${clipShort(c.cityLabel, 12)} hours — tea ready?`
        : 'South Asian hours — tea ready?',
  },
  {
    id: 'reg-east-asia',
    category: 'region',
    weight: 4,
    when: (c) => c.regionBucket === 'east_asia',
    text: (c) =>
      c.cityLabel ? `${clipShort(c.cityLabel, 12)} clock — digging in?` : 'East Asia hours — ready.',
  },
  {
    id: 'reg-oceania',
    category: 'region',
    weight: 4,
    when: (c) => c.regionBucket === 'oceania',
    text: (c) =>
      c.cityLabel ? `Tomorrow calling, ${clipShort(c.cityLabel, 12)}?` : 'Ahead of the global clock.',
  },
  {
    id: 'reg-city-fallback',
    category: 'region',
    weight: 3,
    when: (c) => Boolean(c.cityLabel) && c.regionBucket === 'global',
    text: (c) => `Checking in from ${clipShort(c.cityLabel, 13)}.`,
  },

  // ── 11. Visitor Cadence, Auth Name & History Measures ────────────────────
  {
    id: 'cad-first-timer-chair',
    category: 'cadence',
    weight: 5,
    when: (c) => c.threadCount === 0 && c.visitCount <= 1,
    text: 'Pull up a chair. Start sharp.',
  },
  {
    id: 'cad-first-timer-sparring',
    category: 'cadence',
    weight: 4,
    when: (c) => c.threadCount === 0 && c.visitCount <= 1,
    text: 'First visit? Start anywhere.',
  },
  {
    id: 'cad-back-at-it-named',
    category: 'cadence',
    weight: 6,
    when: (c) => Boolean(c.firstName) && (c.threadCount >= 1 || c.visitCount >= 2),
    text: (c) => `Back at it, ${clipShort(c.firstName, 18)}.`,
  },
  {
    id: 'cad-back-same-day',
    category: 'cadence',
    weight: 5,
    when: (c) => c.hoursSinceLastVisit !== null && c.hoursSinceLastVisit < 6 && c.visitCount >= 2,
    text: 'Back for a sharper angle?',
  },
  {
    id: 'cad-back-after-gap',
    category: 'cadence',
    weight: 5,
    when: (c) => c.hoursSinceLastVisit !== null && c.hoursSinceLastVisit >= 24 * 7,
    text: 'Been a while. What changed?',
  },
  {
    id: 'cad-streak',
    category: 'cadence',
    weight: 5,
    when: (c) => c.consecutiveDays >= 3,
    text: (c) => `Day ${c.consecutiveDays} streak. Momentum holds.`,
  },
  {
    id: 'cad-power-threads',
    category: 'cadence',
    weight: 4,
    when: (c) => c.threadCount >= 4,
    text: (c) => `${c.threadCount} threads in. Test me harder.`,
  },
  {
    id: 'cad-returning-anon',
    category: 'cadence',
    weight: 4,
    when: (c) => c.visitCount >= 2 && !c.firstName,
    text: 'Round two. What is next?',
  },

  // ── 12. Thinking Effort, Theme & Corpus Context ─────────────────────────
  {
    id: 'ctx-fast-mode',
    category: 'context',
    weight: 3,
    when: (c) => c.thinkingEffort === 'fast',
    text: 'Fast mode. Crisp answers.',
  },
  {
    id: 'ctx-medium-mode',
    category: 'context',
    weight: 5,
    when: (c) => c.thinkingEffort === 'medium',
    text: 'Medium depth on standby.',
  },
  {
    id: 'ctx-deep-mode',
    category: 'context',
    weight: 6,
    when: (c) => c.thinkingEffort === 'deep',
    text: 'Deep reasoning active.',
  },
  {
    id: 'ctx-dark-night',
    category: 'context',
    weight: 4,
    when: (c) => c.theme === 'dark' && (c.hour >= 19 || c.hour < 6),
    text: 'Dark room for dense ideas.',
  },
  {
    id: 'ctx-corpus-count',
    category: 'context',
    weight: 4,
    when: (c) => c.corpusCount >= 50,
    text: (c) => `${c.corpusCount} notes indexed. Probe any.`,
  },
  {
    id: 'ctx-british-spelling',
    category: 'context',
    weight: 3,
    playful: true,
    when: (c) => !c.isBritishLocale,
    text: 'Mind the extra “u”s today.',
  },

  // ── 13. Engaging Questions, Wit & First-Principles Prompts (Always Valid) ─
  {
    id: 'wit-how-help',
    category: 'wit',
    weight: 3,
    text: 'How can I help you think?',
  },
  {
    id: 'wit-break-argument',
    category: 'wit',
    weight: 4,
    text: 'What should we stress-test?',
  },
  {
    id: 'wit-thorny',
    category: 'wit',
    weight: 4,
    text: 'Bring a thornier question.',
  },
  {
    id: 'wit-mid-thought',
    category: 'wit',
    weight: 4,
    text: 'Skip preamble. Start sharp.',
  },
  {
    id: 'wit-provoke-wrong',
    category: 'wit',
    weight: 4,
    text: 'Show me where I got it wrong.',
  },
  {
    id: 'wit-menu-triad',
    category: 'wit',
    weight: 3,
    playful: true,
    text: 'Philosophy, law, or bad code?',
  },
  {
    id: 'wit-unstated-assumption',
    category: 'wit',
    weight: 4,
    text: 'Got an unstated premise?',
  },
  {
    id: 'wit-hunch-or-thesis',
    category: 'wit',
    weight: 3,
    text: 'Rough hunch, or draft thesis?',
  },
  {
    id: 'wit-reading-between',
    category: 'wit',
    weight: 3,
    text: 'Read between the lines today?',
  },
  {
    id: 'wit-incentives',
    category: 'wit',
    weight: 3,
    text: 'Trace the incentives first.',
  },
  {
    id: 'wit-small-talk-optional',
    category: 'wit',
    weight: 4,
    text: 'Sharp questions, zero fluff.',
  },
  {
    id: 'wit-evidence-receipt',
    category: 'wit',
    weight: 3,
    text: 'Receipts or paradoxes today?',
  },
  {
    id: 'wit-consequences',
    category: 'wit',
    weight: 3,
    text: 'Trace second-order effects.',
  },
  {
    id: 'wit-spinoza-to-python',
    category: 'wit',
    weight: 3,
    playful: true,
    text: 'Spinoza or Python today?',
  },
  {
    id: 'wit-control-arch',
    category: 'wit',
    weight: 3,
    text: 'Start past polite consensus.',
  },
  {
    id: 'wit-ask-twice',
    category: 'wit',
    weight: 3,
    text: 'Break the premise early.',
  },
];

export function getEligibleGreetings(signals: ResolvedVisitorSignals): GreetingEntry[] {
  const seriousOnly =
    signals.thinkingEffort === 'deep' ||
    signals.voiceStyle === 'academic' ||
    signals.voiceStyle === 'blunt';
  return GREETING_REPOSITORY.filter(
    (entry) => (!seriousOnly || !entry.playful) && (!entry.when || entry.when(signals))
  );
}

export function buildGreetingKicker(signals: ResolvedVisitorSignals): string {
  const parts: string[] = [signals.formattedTime];

  if (signals.cityLabel) {
    parts.push(`${signals.cityLabel} time`);
  } else {
    parts.push(signals.dayName);
  }

  if (signals.thinkingEffort !== 'fast') {
    const labelMap: Record<ThinkingEffort, string> = {
      fast: 'Fast',
      medium: 'Medium depth',
      deep: 'Deep Reasoning',
    };
    parts.push(labelMap[signals.thinkingEffort]);
  } else if (signals.voiceStyle && signals.voiceStyle !== 'standard') {
    const legacyMap: Record<VoiceStyle, string> = {
      standard: 'Fast',
      blunt: 'Blunt mode',
      academic: 'Legal & IR',
      mentor: 'Candid mode',
    };
    parts.push(legacyMap[signals.voiceStyle]);
  } else if (signals.visitCount >= 3) {
    parts.push(`Visit #${signals.visitCount}`);
  } else if (signals.threadCount > 0) {
    parts.push(`${signals.threadCount} ${signals.threadCount === 1 ? 'thread' : 'threads'}`);
  } else {
    parts.push(`${signals.corpusCount} essays indexed`);
  }

  return parts.join(' · ');
}

function getRecentGreetingIds(): string[] {
  if (typeof sessionStorage === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(RECENT_GREETINGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function rememberGreetingId(id: string): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const next = [...getRecentGreetingIds().filter((x) => x !== id), id].slice(-12);
    sessionStorage.setItem(RECENT_GREETINGS_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage failures
  }
}

export function selectDynamicGreeting(input: GreetingVisitorInput = {}): SelectedGreeting {
  const signals = resolveVisitorSignals(input);
  const eligible = getEligibleGreetings(signals);
  const recentIds = new Set([...getRecentGreetingIds(), ...(input.excludeIds ?? [])]);

  let pool = eligible.filter((g) => !recentIds.has(g.id));
  if (pool.length === 0) {
    pool = eligible;
  }

  let chosen: GreetingEntry;
  if (typeof input.preferredIndex === 'number' && Number.isFinite(input.preferredIndex)) {
    const idx = Math.abs(Math.floor(input.preferredIndex)) % pool.length;
    chosen = pool[idx];
  } else {
    const weighted: GreetingEntry[] = [];
    for (const item of pool) {
      const w = Math.max(1, Math.min(6, item.weight ?? 2));
      for (let i = 0; i < w; i += 1) {
        weighted.push(item);
      }
    }
    const pickIdx = Math.floor(Math.random() * weighted.length);
    chosen = weighted[pickIdx] ?? pool[0];
  }

  if (!input.skipVisitTracking) {
    rememberGreetingId(chosen.id);
  }

  const headline = typeof chosen.text === 'function' ? chosen.text(signals) : chosen.text;
  return {
    id: chosen.id,
    headline,
    kicker: buildGreetingKicker(signals),
    category: chosen.category,
    signals,
  };
}
