// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import {
  buildGreetingKicker,
  getCircadianSlot,
  getEligibleGreetings,
  GREETING_REPOSITORY,
  parseTimeZoneMeta,
  resolveSeason,
  resolveVisitorSignals,
  selectDynamicGreeting,
} from '../src/data/greetings';
import { getTimeGreeting } from '../src/data/persona';
import { WelcomeScreen } from '../src/components/WelcomeScreen';

describe('Dynamic contextual greeting repository', () => {
  const roots: Array<{ root: Root; container: HTMLDivElement }> = [];

  afterEach(() => {
    while (roots.length > 0) {
      const item = roots.pop()!;
      act(() => item.root.unmount());
      item.container.remove();
    }
    sessionStorage.clear();
    localStorage.clear();
  });

  it('contains a broad repository across circadian, landmark, region, cadence, context, and wit categories', () => {
    expect(GREETING_REPOSITORY.length).toBeGreaterThanOrEqual(70);
    const categories = new Set(GREETING_REPOSITORY.map((g) => g.category));
    expect(categories).toEqual(new Set(['circadian', 'landmark', 'region', 'cadence', 'context', 'wit']));
  });

  it('maps hours accurately across all 8 circadian bands', () => {
    expect(getCircadianSlot(2)).toBe('weeHours');
    expect(getCircadianSlot(6)).toBe('earlyDawn');
    expect(getCircadianSlot(10)).toBe('morning');
    expect(getCircadianSlot(12)).toBe('midday');
    expect(getCircadianSlot(15)).toBe('afternoon');
    expect(getCircadianSlot(17)).toBe('goldenHour');
    expect(getCircadianSlot(20)).toBe('evening');
    expect(getCircadianSlot(23)).toBe('lateNight');
  });

  it('resolves timezone cities, regions, and southern-hemisphere season inversion cleanly', () => {
    expect(parseTimeZoneMeta('Asia/Bangkok')).toEqual({ cityLabel: 'Bangkok', regionBucket: 'bangkok' });
    expect(parseTimeZoneMeta('Europe/London')).toEqual({ cityLabel: 'London', regionBucket: 'london' });
    expect(parseTimeZoneMeta('America/New_York')).toEqual({ cityLabel: 'New York', regionBucket: 'americas' });
    expect(parseTimeZoneMeta('Etc/UTC')).toEqual({ cityLabel: '', regionBucket: 'global' });

    expect(resolveSeason(6, 'Europe/London')).toBe('summer');
    expect(resolveSeason(6, 'Australia/Sydney')).toBe('winter');
  });

  it('surfaces contextual matches including time, city, thinking effort, and signed-in first name', () => {
    const bangkokEvening = resolveVisitorSignals({
      now: new Date(2026, 10, 18, 21, 15, 0),
      timeZone: 'Asia/Bangkok',
      userName: 'Sarah Connor',
      isAuthenticated: true,
      threadCount: 2,
      thinkingEffort: 'deep',
      skipVisitTracking: true,
    });

    const eligibleIds = getEligibleGreetings(bangkokEvening).map((g) => g.id);
    expect(eligibleIds).toContain('reg-bangkok-evening');
    expect(eligibleIds).toContain('cad-back-at-it-named');
    expect(eligibleIds).toContain('ctx-deep-mode');

    const kicker = buildGreetingKicker(bangkokEvening);
    expect(kicker).toContain('21:15');
    expect(kicker).toContain('Bangkok time');
    expect(kicker).toContain('Deep Reasoning');

    const picked = selectDynamicGreeting({
      now: new Date(2026, 10, 18, 17, 30, 0),
      timeZone: 'Europe/London',
      skipVisitTracking: true,
    });
    expect(picked.headline.length).toBeGreaterThan(5);
    expect(getTimeGreeting({ skipVisitTracking: true })).toBeTruthy();
  });

  it('avoids immediate repeats across consecutive selections using session history', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 6; i += 1) {
      const pick = selectDynamicGreeting({
        now: new Date(2026, 10, 18, 17, 30, 0),
        timeZone: 'Asia/Bangkok',
      });
      expect(seen.has(pick.id)).toBe(false);
      seen.add(pick.id);
    }
  });

  it('keeps every greeting variation concise (<= 32 chars) for single-line hero display', () => {
    const longSignals = resolveVisitorSignals({
      now: new Date(2026, 10, 18, 3, 33, 0),
      timeZone: 'America/Los_Angeles',
      userName: 'Alexander Hamilton',
      isAuthenticated: true,
      threadCount: 12,
      thinkingEffort: 'fast',
      corpusCount: 143,
      skipVisitTracking: true,
    });
    const noCitySignals = {
      ...longSignals,
      cityLabel: '',
      firstName: 'Christopherson-Alexandervon',
      consecutiveDays: 14,
    };

    for (const entry of GREETING_REPOSITORY) {
      const renderedLong = typeof entry.text === 'function' ? entry.text(longSignals) : entry.text;
      expect(renderedLong.length, `${entry.id} (with long city/name): "${renderedLong}"`).toBeLessThanOrEqual(32);
      expect(renderedLong.trim().length, `${entry.id} non-empty`).toBeGreaterThan(0);

      const renderedFallback = typeof entry.text === 'function' ? entry.text(noCitySignals) : entry.text;
      expect(renderedFallback.length, `${entry.id} (no-city fallback): "${renderedFallback}"`).toBeLessThanOrEqual(32);
    }
  });

  it('renders only the centered avatar above the concise hero headline (no eyebrow pill)', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push({ root, container });

    act(() => {
      root.render(
        <WelcomeScreen
          inputValue=""
          onInputChange={vi.fn()}
          onSubmitPrompt={vi.fn()}
          onStop={vi.fn()}
          isStreaming={false}
          engineId="oss-reasoning"
          webSearchEnabled={true}
          onSelectEngine={vi.fn()}
          onToggleWebSearch={vi.fn()}
          onOpenSettings={vi.fn()}
          thinkingEffort="fast"
          onChangeThinkingEffort={vi.fn()}
          onOpenDossierPicker={vi.fn()}
          userName="Avi"
          isAuthenticated={true}
          threadCount={3}
          inputRef={{ current: null }}
        />
      );
    });

    expect(container.querySelector('.welcome-eyebrow')).toBeNull();
    const badgeRow = container.querySelector('.welcome-badge-row');
    expect(badgeRow).not.toBeNull();
    expect(badgeRow?.querySelector('.welcome-avatar')).not.toBeNull();
    expect(badgeRow?.children.length).toBe(1);

    const firstHeadline = container.querySelector('.welcome-heading-line')?.textContent?.trim() ?? '';
    expect(firstHeadline.length).toBeGreaterThan(5);
    expect(firstHeadline.length).toBeLessThanOrEqual(32);
  });
});
