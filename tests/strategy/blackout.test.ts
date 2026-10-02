import {
  blackoutStatus,
  blackoutWindows,
  calendarUnavailableBlackout,
  DEFAULT_BLACKOUT_MINUTES,
  isBlackoutRelevant,
  isTradeBlocked,
} from '../../strategy/blackout';
import { MINUTE, newsEvent, NEWS_NOW } from '../helpers';

/**
 * The 30-minute news blackout.
 *
 * Most of this file is boundary conditions, because that is where a filter like
 * this goes wrong: an exclusive edge lets a trade in at exactly T-30, and
 * treating an undated holiday as midnight blacks out a whole session for
 * nothing. Both are asserted directly.
 */

describe('calendarUnavailableBlackout', () => {
  it('blocks, and says why', () => {
    const status = calendarUnavailableBlackout('feed returned HTTP 503');

    expect(status.blocked).toBe(true);
    expect(status.reason).toMatch(/news calendar is unavailable/);
    expect(status.reason).toMatch(/feed returned HTTP 503/);
  });

  it('reports no windows, because it knows of none', () => {
    // The distinction that matters: this is "we cannot see the calendar", not
    // "there is a release right now". Inventing a window would be a lie, so the
    // block is carried by `blocked` alone.
    const status = calendarUnavailableBlackout('offline');

    expect(status.active).toEqual([]);
    expect(status.clearsAt).toBeNull();
    expect(status.next).toBeNull();
    expect(status.minutesUntilNext).toBeNull();
  });

  it('is the opposite of a calendar read as empty', () => {
    // An empty calendar that was successfully read is real information and does
    // not block. Only the absence of a read does.
    expect(blackoutStatus([], NEWS_NOW).blocked).toBe(false);
    expect(calendarUnavailableBlackout('offline').blocked).toBe(true);
  });
});

describe('isBlackoutRelevant', () => {
  it('matches a USD high-impact release', () => {
    expect(isBlackoutRelevant(newsEvent())).toBe(true);
  });

  it('ignores medium and low impact by default', () => {
    expect(isBlackoutRelevant(newsEvent({ impact: 'MEDIUM' }))).toBe(false);
    expect(isBlackoutRelevant(newsEvent({ impact: 'LOW' }))).toBe(false);
    expect(isBlackoutRelevant(newsEvent({ impact: 'NONE' }))).toBe(false);
  });

  it('ignores other currencies by default', () => {
    // The configured scope: a high-impact AUD print does not stop a gold trade.
    expect(isBlackoutRelevant(newsEvent({ country: 'AUD' }))).toBe(false);
    expect(isBlackoutRelevant(newsEvent({ country: 'EUR' }))).toBe(false);
  });

  it('matches currencies case-insensitively', () => {
    expect(isBlackoutRelevant(newsEvent({ country: 'usd' }))).toBe(true);
  });

  it('excludes an event with no scheduled time', () => {
    // Bank holidays, tentative releases and all-day items arrive undated.
    expect(isBlackoutRelevant(newsEvent({ time: null }))).toBe(false);
  });

  it('widens scope when asked', () => {
    expect(isBlackoutRelevant(newsEvent({ country: 'EUR' }), { currencies: ['USD', 'EUR'] })).toBe(
      true,
    );
    expect(isBlackoutRelevant(newsEvent({ impact: 'MEDIUM' }), { impacts: ['HIGH', 'MEDIUM'] })).toBe(
      true,
    );
  });

  it('treats explicit null currencies as "any currency"', () => {
    // undefined means "use the default"; null means "all". An empty array would
    // read like a misconfiguration, so it blocks nothing.
    expect(isBlackoutRelevant(newsEvent({ country: 'JPY' }), { currencies: null })).toBe(true);
    expect(isBlackoutRelevant(newsEvent({ country: 'USD' }), { currencies: [] })).toBe(false);
  });
});

describe('blackoutWindows', () => {
  it('centres a symmetric window on the release', () => {
    const [window] = blackoutWindows([newsEvent({ time: NEWS_NOW })]);

    expect(window?.start).toBe(NEWS_NOW - DEFAULT_BLACKOUT_MINUTES * MINUTE);
    expect(window?.end).toBe(NEWS_NOW + DEFAULT_BLACKOUT_MINUTES * MINUTE);
  });

  it('honours a custom half-width', () => {
    const [window] = blackoutWindows([newsEvent({ time: NEWS_NOW })], { windowMinutes: 45 });

    expect(window?.start).toBe(NEWS_NOW - 45 * MINUTE);
    expect(window?.end).toBe(NEWS_NOW + 45 * MINUTE);
  });

  it('sorts windows by start time regardless of feed order', () => {
    const windows = blackoutWindows([
      newsEvent({ title: 'Later', time: NEWS_NOW + 4 * 3600 }),
      newsEvent({ title: 'Earlier', time: NEWS_NOW }),
    ]);

    expect(windows.map((window) => window.event.title)).toEqual(['Earlier', 'Later']);
  });

  it('drops irrelevant events instead of producing empty windows', () => {
    const windows = blackoutWindows([
      newsEvent({ impact: 'LOW' }),
      newsEvent({ country: 'CAD' }),
      newsEvent({ time: null }),
    ]);

    expect(windows).toEqual([]);
  });

  it('rejects a negative window rather than silently inverting it', () => {
    expect(() => blackoutWindows([newsEvent()], { windowMinutes: -5 })).toThrow(
      /non-negative/,
    );
    expect(() => blackoutWindows([newsEvent()], { windowMinutes: Number.NaN })).toThrow(
      /non-negative/,
    );
  });
});

describe('blackoutStatus boundaries', () => {
  const release = NEWS_NOW;
  const events = [newsEvent({ time: release })];

  it('blocks at the exact start of the window', () => {
    // Inclusive edges. The half-hour before a release is when spreads widen,
    // so T-30 exactly must not sneak a trade in.
    expect(blackoutStatus(events, release - 30 * MINUTE).blocked).toBe(true);
  });

  it('blocks at the exact end of the window', () => {
    expect(blackoutStatus(events, release + 30 * MINUTE).blocked).toBe(true);
  });

  it('blocks at the release itself', () => {
    expect(blackoutStatus(events, release).blocked).toBe(true);
  });

  it('allows one second before the window opens', () => {
    expect(blackoutStatus(events, release - 30 * MINUTE - 1).blocked).toBe(false);
  });

  it('allows one second after the window closes', () => {
    expect(blackoutStatus(events, release + 30 * MINUTE + 1).blocked).toBe(false);
  });
});

describe('blackoutStatus reporting', () => {
  it('reports when the window clears', () => {
    const release = NEWS_NOW;
    const status = blackoutStatus([newsEvent({ time: release })], release - 10 * MINUTE);

    expect(status.clearsAt).toBe(release + 30 * MINUTE);
    expect(status.reason).toMatch(/USD CPI m\/m/);
    expect(status.reason).toMatch(/due in 10 min/);
    expect(status.reason).toMatch(/clears in 40 min/);
  });

  it('distinguishes a release that has already happened', () => {
    const status = blackoutStatus([newsEvent({ time: NEWS_NOW })], NEWS_NOW + 15 * MINUTE);
    expect(status.reason).toMatch(/released 15 min ago/);
    expect(status.reason).toMatch(/clears in 15 min/);
  });

  it('says "releasing now" at the timestamp itself', () => {
    const status = blackoutStatus([newsEvent({ time: NEWS_NOW })], NEWS_NOW);
    expect(status.reason).toMatch(/releasing now/);
  });

  it('names every release sharing the window, not just the first', () => {
    // Payrolls and the unemployment rate both land at 12:30.
    const status = blackoutStatus(
      [
        newsEvent({ title: 'Non-Farm Employment Change', time: NEWS_NOW }),
        newsEvent({ title: 'Unemployment Rate', time: NEWS_NOW }),
      ],
      NEWS_NOW,
    );

    expect(status.active).toHaveLength(2);
    expect(status.reason).toMatch(/USD Non-Farm Employment Change and USD Unemployment Rate/);
  });

  it('takes the latest end when overlapping windows stack', () => {
    const first = NEWS_NOW;
    const second = NEWS_NOW + 20 * MINUTE;

    const status = blackoutStatus(
      [newsEvent({ time: first }), newsEvent({ title: 'FOMC Statement', time: second })],
      first + 5 * MINUTE,
    );

    expect(status.active).toHaveLength(2);
    expect(status.clearsAt).toBe(second + 30 * MINUTE);
  });

  it('has no reason when nothing is active', () => {
    const status = blackoutStatus([newsEvent({ time: NEWS_NOW })], NEWS_NOW + 4 * 3600);

    expect(status.blocked).toBe(false);
    expect(status.reason).toBeNull();
    expect(status.clearsAt).toBeNull();
    expect(status.active).toEqual([]);
  });

  it('counts down to the next window', () => {
    const release = NEWS_NOW + 2 * 3600;
    const status = blackoutStatus([newsEvent({ time: release })], NEWS_NOW);

    expect(status.blocked).toBe(false);
    expect(status.next?.start).toBe(release - 30 * MINUTE);
    expect(status.minutesUntilNext).toBe(90);
  });

  it('looks past an active window to the one after it', () => {
    const now = NEWS_NOW;
    const status = blackoutStatus(
      [
        newsEvent({ time: now }),
        newsEvent({ title: 'FOMC Statement', time: now + 6 * 3600 }),
      ],
      now,
    );

    expect(status.blocked).toBe(true);
    expect(status.next?.event.title).toBe('FOMC Statement');
  });

  it('reports no next window once the calendar is behind us', () => {
    const status = blackoutStatus([newsEvent({ time: NEWS_NOW - 6 * 3600 })], NEWS_NOW);

    expect(status.next).toBeNull();
    expect(status.minutesUntilNext).toBeNull();
  });

  it('handles an empty calendar', () => {
    const status = blackoutStatus([], NEWS_NOW);

    expect(status.blocked).toBe(false);
    expect(status.reason).toBeNull();
    expect(status.next).toBeNull();
  });
});

describe('isTradeBlocked', () => {
  it('mirrors blackoutStatus when there is a calendar', () => {
    expect(isTradeBlocked([newsEvent({ time: NEWS_NOW })], NEWS_NOW)).toBe(true);
    expect(isTradeBlocked([newsEvent({ time: NEWS_NOW })], NEWS_NOW + 2 * 3600)).toBe(false);
  });

  it('permits trading on an empty calendar by default', () => {
    // An empty calendar usually means the feed was unreachable. Refusing to
    // ever trade during a feed outage would be its own kind of failure; the
    // degraded read is meant to cost confidence instead.
    expect(isTradeBlocked([], NEWS_NOW)).toBe(false);
  });

  it('stands aside on an empty calendar when told to fail closed', () => {
    expect(isTradeBlocked([], NEWS_NOW, { failClosed: true })).toBe(true);
  });

  it('does not fail closed when the calendar merely has nothing relevant', () => {
    // A calendar full of EUR releases is a successful fetch, not an outage.
    expect(
      isTradeBlocked([newsEvent({ country: 'EUR', time: NEWS_NOW })], NEWS_NOW, {
        failClosed: true,
      }),
    ).toBe(false);
  });
});
