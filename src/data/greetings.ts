import type { EngineId, ThemeMode, VoiceStyle } from '../types/chat';
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
  voiceStyle: VoiceStyle;
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
    voiceStyle: input.voiceStyle ?? 'standard',
    engineId: input.engineId ?? 'oss-reasoning',
    theme: input.theme ?? 'dark',
    corpusCount: input.corpusCount ?? KNOWLEDGE_META.totalEntries,
  };
}

/**
 * Curated repository of context-aware, witty, and intellectually engaging hero greetings
 * spanning circadian bands, temporal landmarks, timezone regions, visitor cadence, and mode cues.
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
    text: 'The sharpest footnotes get written after midnight.',
  },
  {
    id: 'wee-named-owl',
    category: 'circadian',
    weight: 5,
    when: (c) => c.circadianSlot === 'weeHours' && Boolean(c.firstName),
    text: (c) => `Still awake, ${c.firstName}?`,
  },
  {
    id: 'wee-sleep-or-hubris',
    category: 'circadian',
    weight: 4,
    playful: true,
    when: (c) => c.circadianSlot === 'weeHours',
    text: (c) => `${c.formattedTime} clarity — or ${c.formattedTime} hubris?`,
  },
  {
    id: 'wee-quiet-world',
    category: 'circadian',
    weight: 3,
    playful: true,
    when: (c) => c.circadianSlot === 'weeHours',
    text: 'Up suspiciously late — or impossibly early?',
  },
  {
    id: 'wee-tea-stubbornness',
    category: 'circadian',
    weight: 3,
    playful: true,
    when: (c) => c.circadianSlot === 'weeHours',
    text: 'Deep-night desk. Coffee, tea, or sheer stubbornness?',
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
    text: 'Quiet hours before the noise begins.',
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
    text: (c) => `Early start, ${c.firstName}.`,
  },

  // ── 3. Morning (08:00 – 11:59) ───────────────────────────────────────────
  {
    id: 'morn-coffee-kick',
    category: 'circadian',
    weight: 3,
    when: (c) => c.circadianSlot === 'morning',
    text: 'Ready once the coffee kicks in?',
  },
  {
    id: 'morn-briefing',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'morning',
    text: 'Morning briefing, minus the fluff.',
  },
  {
    id: 'morn-stress-test',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'morning',
    text: 'Clear morning light for thorny questions.',
  },
  {
    id: 'morn-on-desk',
    category: 'circadian',
    weight: 3,
    when: (c) => c.circadianSlot === 'morning',
    text: 'Fresh morning page — what is on the desk?',
  },
  {
    id: 'morn-named',
    category: 'circadian',
    weight: 5,
    when: (c) => c.circadianSlot === 'morning' && Boolean(c.firstName),
    text: (c) => `Morning, ${c.firstName}. What deserves real focus today?`,
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
    text: 'Midday pause — or powering straight through?',
  },
  {
    id: 'noon-sharper-angle',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'midday',
    text: 'Stepping out of endless tabs for a sharper angle?',
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
    text: 'Deep-work hour. Bring a proper problem.',
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
    text: 'Afternoon desk check — what still feels half-baked?',
  },
  {
    id: 'aft-named',
    category: 'circadian',
    weight: 5,
    when: (c) => c.circadianSlot === 'afternoon' && Boolean(c.firstName),
    text: (c) => `Afternoon, ${c.firstName}. What are we pulling apart today?`,
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
    text: 'Catching dusk before calling it a day?',
  },
  {
    id: 'gold-synthesis',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'goldenHour',
    text: 'Five o’clock synthesis beats tomorrow’s panic.',
  },
  {
    id: 'gold-last-thread',
    category: 'circadian',
    weight: 3,
    when: (c) => c.circadianSlot === 'goldenHour',
    text: 'Dusk over the desk — one last crisp thread?',
  },

  // ── 7. Evening (19:00 – 21:59) ───────────────────────────────────────────
  {
    id: 'eve-unhurried',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'evening',
    text: 'Quiet evening for unhurried thinking.',
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
    text: 'Evening reading, minus the social-feed algorithm.',
  },
  {
    id: 'eve-philosophy-debug',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'evening',
    text: 'Evening shift: jurisprudence, Spinoza, or stubborn code?',
  },
  {
    id: 'eve-named',
    category: 'circadian',
    weight: 5,
    when: (c) => c.circadianSlot === 'evening' && Boolean(c.firstName),
    text: (c) => `Evening, ${c.firstName}. What is keeping the mind occupied?`,
  },

  // ── 8. Late Night (22:00 – 23:59) ────────────────────────────────────────
  {
    id: 'night-hits-different',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'lateNight',
    text: 'Late-night curiosity hits differently.',
  },
  {
    id: 'night-winding-down',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'lateNight',
    text: 'Winding down, or just getting started?',
  },
  {
    id: 'night-rabbit-hole',
    category: 'circadian',
    weight: 4,
    when: (c) => c.circadianSlot === 'lateNight',
    text: 'One honest rabbit hole before sleep?',
  },
  {
    id: 'night-tabs-open',
    category: 'circadian',
    weight: 4,
    playful: true,
    when: (c) => c.circadianSlot === 'lateNight',
    text: 'Night-owl hours — what is keeping twenty tabs open?',
  },

  // ── 9. Temporal Landmarks & Fresh-Start Triggers ─────────────────────────
  {
    id: 'land-monday-reset',
    category: 'landmark',
    weight: 5,
    when: (c) => c.dayOfWeek === 1 && c.hour < 13,
    text: 'Monday reset — what is actually worth solving this week?',
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
    text: 'Midweek reality check — what holds up under scrutiny?',
  },
  {
    id: 'land-friday-escape',
    category: 'landmark',
    weight: 5,
    playful: true,
    when: (c) => c.dayOfWeek === 5 && c.hour >= 14,
    text: 'Friday escape from spreadsheets?',
  },
  {
    id: 'land-friday-one-question',
    category: 'landmark',
    weight: 4,
    when: (c) => c.dayOfWeek === 5,
    text: 'Before the weekend — one proper question?',
  },
  {
    id: 'land-weekend-best',
    category: 'landmark',
    weight: 5,
    when: (c) => c.dayOfWeek === 0 || c.dayOfWeek === 6,
    text: 'Weekend curiosity is usually the sharpest kind.',
  },
  {
    id: 'land-saturday-no-meetings',
    category: 'landmark',
    weight: 4,
    when: (c) => c.dayOfWeek === 6,
    text: 'Saturday thoughts, zero committee meetings.',
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
    text: 'Sunday evening reset — mapping the week ahead?',
  },
  {
    id: 'land-month-start',
    category: 'landmark',
    weight: 5,
    when: (c) => c.dayOfMonth === 1,
    text: 'First of the month — clean slate for tougher questions.',
  },
  {
    id: 'land-new-year',
    category: 'landmark',
    weight: 5,
    when: (c) => c.month === 0 && c.dayOfMonth <= 10,
    text: 'Fresh calendar. Which assumptions are we retiring this year?',
  },
  {
    id: 'land-winter-reading',
    category: 'landmark',
    weight: 3,
    when: (c) => c.season === 'winter',
    text: 'Winter desk weather — good day for deep reading.',
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
    text: 'Checking in from London time — tea poured?',
  },
  {
    id: 'reg-london-cambridge',
    category: 'region',
    weight: 4,
    when: (c) => c.regionBucket === 'london',
    text: 'Greenwich meridian hours. Rain outside, first principles inside?',
  },
  {
    id: 'reg-bangkok-slow',
    category: 'region',
    weight: 5,
    when: (c) => c.regionBucket === 'bangkok',
    text: 'Bangkok time — slowing down enough to look clearly?',
  },
  {
    id: 'reg-bangkok-evening',
    category: 'region',
    weight: 5,
    when: (c) => c.regionBucket === 'bangkok' && c.hour >= 17,
    text: 'Chao Phraya twilight suits thornier questions.',
  },
  {
    id: 'reg-bangkok-iced',
    category: 'region',
    weight: 4,
    when: (c) => c.regionBucket === 'bangkok' && c.hour >= 7 && c.hour < 17,
    text: 'Thailand hours — iced espresso and a live thesis?',
  },
  {
    id: 'reg-europe-geneva',
    category: 'region',
    weight: 4,
    when: (c) => c.regionBucket === 'europe',
    text: (c) =>
      c.cityLabel
        ? `Joining from ${c.cityLabel} time — treaty prose or system design?`
        : 'Continental hours — treaty prose or system architecture?',
  },
  {
    id: 'reg-americas-clock',
    category: 'region',
    weight: 4,
    when: (c) => c.regionBucket === 'americas',
    text: (c) =>
      c.cityLabel
        ? `Across the pond on ${c.cityLabel} time — what is in focus?`
        : 'Across the Atlantic — what is on your desk today?',
  },
  {
    id: 'reg-sea-clock',
    category: 'region',
    weight: 4,
    when: (c) => c.regionBucket === 'south_east_asia',
    text: (c) =>
      c.cityLabel ? `Hello from Southeast Asian hours (${c.cityLabel}).` : 'Southeast Asian hours — welcome in.',
  },
  {
    id: 'reg-south-asia-colombo',
    category: 'region',
    weight: 4,
    when: (c) => c.regionBucket === 'south_asia',
    text: (c) =>
      c.cityLabel
        ? `On ${c.cityLabel} time today — tea on, questions ready?`
        : 'South Asian hours — tea on, questions ready?',
  },
  {
    id: 'reg-east-asia',
    category: 'region',
    weight: 4,
    when: (c) => c.regionBucket === 'east_asia',
    text: (c) => (c.cityLabel ? `${c.cityLabel} clock — deep into something good?` : 'East Asia hours — ready when you are.'),
  },
  {
    id: 'reg-oceania',
    category: 'region',
    weight: 4,
    when: (c) => c.regionBucket === 'oceania',
    text: (c) =>
      c.cityLabel ? `Future calling from ${c.cityLabel} time — what is first on your mind?` : 'Ahead of the global clock today.',
  },
  {
    id: 'reg-city-fallback',
    category: 'region',
    weight: 3,
    when: (c) => Boolean(c.cityLabel) && c.regionBucket === 'global',
    text: (c) => `Checking in on ${c.cityLabel} time.`,
  },

  // ── 11. Visitor Cadence, Auth Name & History Measures ────────────────────
  {
    id: 'cad-first-timer-chair',
    category: 'cadence',
    weight: 5,
    when: (c) => c.threadCount === 0 && c.visitCount <= 1,
    text: 'Pull up a chair — I have read my own archive so you do not have to.',
  },
  {
    id: 'cad-first-timer-sparring',
    category: 'cadence',
    weight: 4,
    when: (c) => c.threadCount === 0 && c.visitCount <= 1,
    text: 'First visit here? Start anywhere.',
  },
  {
    id: 'cad-back-at-it-named',
    category: 'cadence',
    weight: 6,
    when: (c) => Boolean(c.firstName) && (c.threadCount >= 1 || c.visitCount >= 2),
    text: (c) => `Back at it, ${c.firstName}.`,
  },
  {
    id: 'cad-back-same-day',
    category: 'cadence',
    weight: 5,
    when: (c) => c.hoursSinceLastVisit !== null && c.hoursSinceLastVisit < 6 && c.visitCount >= 2,
    text: 'Back already — another angle occurred to you?',
  },
  {
    id: 'cad-back-after-gap',
    category: 'cadence',
    weight: 5,
    when: (c) => c.hoursSinceLastVisit !== null && c.hoursSinceLastVisit >= 24 * 7,
    text: 'Been a little while. What changed since last time?',
  },
  {
    id: 'cad-streak',
    category: 'cadence',
    weight: 5,
    when: (c) => c.consecutiveDays >= 3,
    text: (c) => `Day ${c.consecutiveDays} back on the desk — momentum looks good.`,
  },
  {
    id: 'cad-power-threads',
    category: 'cadence',
    weight: 4,
    when: (c) => c.threadCount >= 4,
    text: (c) => `${c.threadCount} conversations in and counting — bring a tougher test.`,
  },
  {
    id: 'cad-returning-anon',
    category: 'cadence',
    weight: 4,
    when: (c) => c.visitCount >= 2 && !c.firstName,
    text: 'Round two — continuing a thread or opening a clean frontier?',
  },

  // ── 12. Voice, Theme & Corpus Context ────────────────────────────────────
  {
    id: 'ctx-blunt-mode',
    category: 'context',
    weight: 6,
    when: (c) => c.voiceStyle === 'blunt',
    text: 'Blunt mode on — skip the diplomacy, bring the thesis.',
  },
  {
    id: 'ctx-academic-mode',
    category: 'context',
    weight: 6,
    when: (c) => c.voiceStyle === 'academic',
    text: 'Treaty prose and footnotes on standby.',
  },
  {
    id: 'ctx-mentor-mode',
    category: 'context',
    weight: 6,
    when: (c) => c.voiceStyle === 'mentor',
    text: 'Coffee-table candour mode. What are you wrestling with?',
  },
  {
    id: 'ctx-dark-night',
    category: 'context',
    weight: 4,
    when: (c) => c.theme === 'dark' && (c.hour >= 19 || c.hour < 6),
    text: 'Obsidian mode on. Quiet room for dense ideas.',
  },
  {
    id: 'ctx-corpus-count',
    category: 'context',
    weight: 4,
    when: (c) => c.corpusCount >= 50,
    text: (c) => `${c.corpusCount} essays & notes indexed — challenge any claim.`,
  },
  {
    id: 'ctx-british-spelling',
    category: 'context',
    weight: 3,
    playful: true,
    when: (c) => !c.isBritishLocale,
    text: 'Pardon the extra “u”s — thinking in British English.',
  },

  // ── 13. Engaging Questions, Wit & First-Principles Prompts (Always Valid) ─
  {
    id: 'wit-how-help',
    category: 'wit',
    weight: 3,
    text: 'How can I help you think clearly today?',
  },
  {
    id: 'wit-break-argument',
    category: 'wit',
    weight: 4,
    text: 'Which argument are you hoping I will stress-test?',
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
    text: 'No preamble needed — start mid-thought.',
  },
  {
    id: 'wit-provoke-wrong',
    category: 'wit',
    weight: 4,
    text: 'Convince me I got something wrong in my essays.',
  },
  {
    id: 'wit-menu-triad',
    category: 'wit',
    weight: 3,
    playful: true,
    text: 'Philosophy, international law, or code that refuses to compile?',
  },
  {
    id: 'wit-unstated-assumption',
    category: 'wit',
    weight: 4,
    text: 'Got an unstated assumption? Let us pull the thread.',
  },
  {
    id: 'wit-hunch-or-thesis',
    category: 'wit',
    weight: 3,
    text: 'Half-formed hunch, or fully drafted thesis?',
  },
  {
    id: 'wit-reading-between',
    category: 'wit',
    weight: 3,
    text: 'What are we reading between the lines of today?',
  },
  {
    id: 'wit-incentives',
    category: 'wit',
    weight: 3,
    text: 'Follow the incentives first; evaluate the slogans after.',
  },
  {
    id: 'wit-small-talk-optional',
    category: 'wit',
    weight: 4,
    text: 'Sharp questions welcome; small talk optional.',
  },
  {
    id: 'wit-evidence-receipt',
    category: 'wit',
    weight: 3,
    text: 'Show me the receipt, or bring the paradox.',
  },
  {
    id: 'wit-consequences',
    category: 'wit',
    weight: 3,
    text: 'Wait until the second-order effects show up — let us trace them.',
  },
  {
    id: 'wit-spinoza-to-python',
    category: 'wit',
    weight: 3,
    playful: true,
    text: 'Spinoza on the desk, or Python in the terminal?',
  },
  {
    id: 'wit-control-arch',
    category: 'wit',
    weight: 3,
    text: 'Good conversation starts where polite consensus stops.',
  },
  {
    id: 'wit-ask-twice',
    category: 'wit',
    weight: 3,
    text: 'Always cheaper to challenge a premise here than in production.',
  },
];

export function getEligibleGreetings(signals: ResolvedVisitorSignals): GreetingEntry[] {
  const seriousOnly = signals.voiceStyle === 'academic' || signals.voiceStyle === 'blunt';
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

  if (signals.voiceStyle !== 'standard') {
    const labelMap: Record<VoiceStyle, string> = {
      standard: 'Standard',
      blunt: 'Blunt mode',
      academic: 'Legal & IR',
      mentor: 'Candid mode',
    };
    parts.push(labelMap[signals.voiceStyle]);
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
