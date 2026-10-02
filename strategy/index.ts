import type { MacroAdapter, NewsAdapter, NewsCalendarRead, NewsEvent } from '../data/types';
import {
  blackoutStatus,
  calendarUnavailableBlackout,
  type BlackoutOptions,
  type BlackoutStatus,
} from './blackout';
import {
  scoreFundamentals,
  type FundamentalScore,
  type FundamentalScoreOptions,
} from './fundamental';

export {
  blackoutStatus,
  blackoutWindows,
  calendarUnavailableBlackout,
  isBlackoutRelevant,
  isTradeBlocked,
  DEFAULT_BLACKOUT_MINUTES,
} from './blackout';
export type { BlackoutOptions, BlackoutStatus, BlackoutWindow } from './blackout';

export {
  scoreFundamentals,
  IMPACT_WEIGHTS,
  COMPONENT_WEIGHTS,
  REFERENCE_NEWS_WEIGHT,
  USD_PROXY_NOTABLE_PERCENT,
  US10Y_NOTABLE_CHANGE,
  RECENCY_HALF_LIFE_HOURS,
  MAX_EVENT_AGE_HOURS,
  NEUTRAL_THRESHOLD,
} from './fundamental';
export type {
  FundamentalScore,
  FundamentalScoreOptions,
  GoldBias,
  ScoredEvent,
  UnscoredEvent,
  ScoreComponent,
  ComponentKey,
} from './fundamental';

export { createTradeIdea, enforceCurrentBlackout } from './tradeIdea';
export type {
  TradeDirection,
  DirectionalBias,
  ConfluenceEvidence,
  TimeframeRead,
  TradeIdea,
  CreateTradeIdeaOptions,
  EnforceBlackoutOptions,
} from './tradeIdea';

export {
  findIndicatorSpec,
  allIndicatorSpecs,
  normalizeTitle,
} from './indicatorTable';
export type { IndicatorSpec, Polarity } from './indicatorTable';

/**
 * The fundamental layer, assembled.
 *
 * One call that fetches the calendar and macro readings, scores them, and
 * evaluates the blackout — the three things the entry logic needs before it can
 * decide anything. Kept separate from `scoreFundamentals` so that function
 * stays pure and trivially testable.
 */

export interface FundamentalRead {
  score: FundamentalScore;
  blackout: BlackoutStatus;
  events: NewsEvent[];
  /**
   * False when no calendar could be read at all, as opposed to a calendar that
   * was read and contained nothing. When false the blackout is forced on.
   */
  calendarAvailable: boolean;
  /** True when the fundamental layer alone forbids a trade right now. */
  tradeAllowed: boolean;
  /** Everything the UI needs to explain the state, already in prose. */
  summary: string;
}

export interface FundamentalReadOptions {
  news: NewsAdapter;
  macro?: MacroAdapter | null;
  /** Evaluation time, unix seconds UTC. Defaults to now. */
  at?: number;
  score?: Omit<FundamentalScoreOptions, 'at' | 'macro'>;
  blackout?: BlackoutOptions;
}

/**
 * Read a calendar from any adapter, preserving whether we actually got one.
 *
 * Three cases, and the distinction between the last two is the whole point:
 * an adapter that implements `fetchCalendar` tells us directly; one that only
 * implements `fetchThisWeek` leaves us inferring, and an empty result from such
 * an adapter has to be read as unavailable; and an adapter that throws despite
 * the no-throw contract is unavailable with its message attached.
 */
export async function readCalendar(adapter: NewsAdapter): Promise<NewsCalendarRead> {
  try {
    if (typeof adapter.fetchCalendar === 'function') {
      return await adapter.fetchCalendar();
    }

    const events = await adapter.fetchThisWeek();
    if (events.length > 0) return { events, available: true, reason: null };

    return {
      events: [],
      available: false,
      reason:
        `the ${adapter.name} calendar returned no events and cannot report whether ` +
        'it reached its source',
    };
  } catch (cause) {
    return {
      events: [],
      available: false,
      reason: `the ${adapter.name} calendar threw (${
        cause instanceof Error ? cause.message : String(cause)
      })`,
    };
  }
}

export async function readFundamentals(
  options: FundamentalReadOptions,
): Promise<FundamentalRead> {
  const at = options.at ?? Math.floor(Date.now() / 1000);

  // Neither adapter throws by contract, so no try/catch here would be a bug
  // waiting to happen — but a custom adapter might, and a fundamental outage
  // must not take down the idea. Hence the defensive fallbacks.
  const calendar = await readCalendar(options.news);
  const events = calendar.events;
  const macro =
    options.macro == null
      ? null
      : await safely(() => options.macro!.fetchSnapshot(), {
        usdProxy: null,
          us10y: null,
          unavailable: [
          { instrument: 'USD_PROXY' as const, reason: 'macro adapter threw' },
            { instrument: 'US10Y' as const, reason: 'macro adapter threw' },
          ],
        });

  const score = scoreFundamentals(events, { ...options.score, at, macro });

  // Losing the calendar forces the blackout on rather than off. A missing
  // macro reading only degrades the score; a missing calendar removes our only
  // view of a hard rule, so it has to stand the trade down.
  const blackout = calendar.available
    ? blackoutStatus(events, at, options.blackout ?? {})
    : calendarUnavailableBlackout(calendar.reason ?? 'cause not reported');

  return {
    score,
    blackout,
    events,
    calendarAvailable: calendar.available,
    tradeAllowed: !blackout.blocked,
    summary: blackout.blocked
      ? `${blackout.reason ?? 'Blackout active.'} ${score.reason}`
      : score.reason,
  };
}

async function safely<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch {
    return fallback;
  }
}
