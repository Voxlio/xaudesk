import type { NewsEvent, NewsImpact } from '../data/types';

/**
 * News blackout.
 *
 * The rule from CLAUDE.md: no trades within 30 minutes either side of
 * high-impact news. Per the configured scope, that means USD high-impact
 * releases only — a high-impact AUD print does not stop a gold trade.
 *
 * Two design notes worth stating because they are easy to get wrong:
 *
 * 1. The window is symmetric and *inclusive* of its edges. A release at 12:30
 *    blocks 12:00 through 13:00. Being strict here matters more than it looks:
 *    the half-hour before a release is when spreads widen and stops get run.
 *
 * 2. Events with no scheduled time are excluded entirely. The feed uses an
 *    undated entry for bank holidays, tentative releases and "all day" items.
 *    Treating those as midnight would blackout a real session for no reason.
 */

export const DEFAULT_BLACKOUT_MINUTES = 30;

export interface BlackoutOptions {
  /** Half-width of the window, in minutes. Default 30. */
  windowMinutes?: number;
  /** Impacts that trigger a blackout. Default ["HIGH"]. */
  impacts?: readonly NewsImpact[];
  /**
   * Currencies that trigger a blackout. Default ["USD"]. Pass null to mean
   * "any currency" — explicit null rather than an empty array, because an empty
   * array reads like a misconfiguration that should block nothing.
   */
  currencies?: readonly string[] | null;
}

export interface BlackoutWindow {
  event: NewsEvent;
  /** Unix seconds UTC. */
  start: number;
  end: number;
}

export interface BlackoutStatus {
  blocked: boolean;
  /** Plain-English explanation, ready for the idea's reason field. */
  reason: string | null;
  /** Windows containing `at`, soonest first. */
  active: BlackoutWindow[];
  /** When the last active window ends. Null when not blocked. */
  clearsAt: number | null;
  /** Next window starting after `at`, for a "trading resumes/pauses" notice. */
  next: BlackoutWindow | null;
  /** Minutes until `next` begins. Null when there is no next window. */
  minutesUntilNext: number | null;
}

interface ResolvedOptions {
  windowMinutes: number;
  impacts: readonly NewsImpact[];
  currencies: readonly string[] | null;
}

function resolveOptions(options: BlackoutOptions): ResolvedOptions {
  const windowMinutes = options.windowMinutes ?? DEFAULT_BLACKOUT_MINUTES;

  if (!Number.isFinite(windowMinutes) || windowMinutes < 0) {
    throw new Error(`windowMinutes must be a non-negative number (got ${windowMinutes})`);
  }

  return {
    windowMinutes,
    impacts: options.impacts ?? ['HIGH'],
    // `undefined` means "use the default"; explicit `null` means "any currency".
    currencies: options.currencies === undefined ? ['USD'] : options.currencies,
  };
}

/** Does this event trigger a blackout under these options? */
export function isBlackoutRelevant(event: NewsEvent, options: BlackoutOptions = {}): boolean {
  const resolved = resolveOptions(options);

  if (event.time === null) return false;
  if (!resolved.impacts.includes(event.impact)) return false;
  if (resolved.currencies === null) return true;

  return resolved.currencies.some(
    (currency) => currency.toUpperCase() === event.country.toUpperCase(),
  );
}

/** The blackout windows implied by a calendar, sorted by start time. */
export function blackoutWindows(
  events: readonly NewsEvent[],
  options: BlackoutOptions = {},
): BlackoutWindow[] {
  const resolved = resolveOptions(options);
  const halfWidth = resolved.windowMinutes * 60;

  return events
    .filter((event) => isBlackoutRelevant(event, options))
    .map((event) => ({
      event,
      // Non-null because isBlackoutRelevant rejects undated events.
      start: (event.time as number) - halfWidth,
      end: (event.time as number) + halfWidth,
    }))
    .sort((a, b) => a.start - b.start);
}

/**
 * Evaluate the blackout at a moment in time.
 *
 * `at` is unix seconds UTC and defaults to now. Pass it explicitly from a
 * backtest so the filter is evaluated at the bar being replayed rather than at
 * wall-clock time.
 */
export function blackoutStatus(
  events: readonly NewsEvent[],
  at: number = Math.floor(Date.now() / 1000),
  options: BlackoutOptions = {},
): BlackoutStatus {
  const windows = blackoutWindows(events, options);

  const active = windows.filter((window) => at >= window.start && at <= window.end);
  const upcoming = windows.find((window) => window.start > at) ?? null;

  const clearsAt =
    active.length === 0 ? null : Math.max(...active.map((window) => window.end));

  return {
    blocked: active.length > 0,
    reason: describe(active, at, clearsAt),
    active,
    clearsAt,
    next: upcoming,
    minutesUntilNext:
      upcoming === null ? null : Math.round(((upcoming.start - at) / 60) * 10) / 10,
  };
}

function describe(
  active: readonly BlackoutWindow[],
  at: number,
  clearsAt: number | null,
): string | null {
  if (active.length === 0 || clearsAt === null) return null;

  // Several releases routinely share a timestamp — payrolls and the
  // unemployment rate both land at 12:30 — so the message names them all
  // rather than arbitrarily picking one.
  const titles = active.map((window) => `${window.event.country} ${window.event.title}`);
  const label =
    titles.length === 1
      ? titles.join('')
      : `${titles.slice(0, -1).join(', ')} and ${titles.slice(-1).join('')}`;

  const minutesToClear = Math.max(0, Math.ceil((clearsAt - at) / 60));
  const soonest = Math.min(...active.map((window) => window.event.time as number));
  const minutesToRelease = Math.round((soonest - at) / 60);

  const timing =
    minutesToRelease > 0
      ? `due in ${minutesToRelease} min`
      : minutesToRelease === 0
        ? 'releasing now'
        : `released ${Math.abs(minutesToRelease)} min ago`;

  return `No-trade window: ${label} ${timing}; clears in ${minutesToClear} min.`;
}

/**
 * The blackout status to use when no calendar could be read at all.
 *
 * Blocked, deliberately — this is the fail-closed half of the rule. An
 * unreachable feed is not a quiet week: we cannot see whether a high-impact USD
 * release is minutes away, and "no trades 30 min around high-impact news" is a
 * hard rule, not a preference. Standing aside costs one day's idea; trading
 * blind into a payrolls print costs rather more.
 *
 * Note the asymmetry with `blackoutStatus`, which does *not* block on an empty
 * calendar. That is correct: a week successfully read as containing no
 * qualifying releases is real information. Only the absence of a read triggers
 * this. See `NewsCalendarRead` for how the two are told apart.
 */
export function calendarUnavailableBlackout(reason: string): BlackoutStatus {
  return {
    blocked: true,
    reason:
      'No trade: the news calendar is unavailable, so the 30-minute high-impact ' +
      `news blackout cannot be checked (${reason}).`,
    active: [],
    clearsAt: null,
    next: null,
    minutesUntilNext: null,
  };
}

/**
 * Convenience predicate for the strategy's hard gate.
 *
 * Deliberately returns `true` (blocked) for an *empty* calendar only when
 * `failClosed` is set, because an empty array alone cannot distinguish "nothing
 * scheduled" from "never reached the feed". Callers that can tell the difference
 * should not rely on this: ask the adapter via `fetchCalendar()` and use
 * `calendarUnavailableBlackout` for the unavailable case, which is what
 * `readFundamentals` does.
 */
export function isTradeBlocked(
  events: readonly NewsEvent[],
  at?: number,
  options: BlackoutOptions & { failClosed?: boolean } = {},
): boolean {
  if (events.length === 0) return options.failClosed === true;

  return blackoutStatus(events, at, options).blocked;
}
