/**
 * Core data contracts. Everything downstream (/indicators, /strategy, /risk,
 * /backtest) depends only on these types — never on a provider's payload shape.
 * That is what makes the adapters swappable.
 */

/** Timeframes the strategy uses: D1/H4 for bias, H1/M15 for entry. */
export type Timeframe = 'M15' | 'H1' | 'H4' | 'D1';

export const TIMEFRAMES: readonly Timeframe[] = ['M15', 'H1', 'H4', 'D1'] as const;

export function isTimeframe(value: unknown): value is Timeframe {
  return typeof value === 'string' && (TIMEFRAMES as readonly string[]).includes(value);
}

/** Approximate duration of one bar, in seconds. Used for gap checks. */
export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  M15: 15 * 60,
  H1: 60 * 60,
  H4: 4 * 60 * 60,
  D1: 24 * 60 * 60,
};

/**
 * A single OHLC bar.
 *
 * `time` is the bar's OPEN time as a Unix timestamp in **seconds, UTC**.
 * Seconds (not milliseconds) because that is what Lightweight Charts expects,
 * and UTC because gold sessions and news times are reasoned about in UTC.
 */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface CandleRequest {
  timeframe: Timeframe;
  /** Max bars to return, most recent last. Adapters may return fewer. */
  limit?: number;
  /** Provider-agnostic symbol override; defaults to the adapter's symbol. */
  symbol?: string;
}

/**
 * A price source. Implementations must return candles sorted oldest → newest,
 * de-duplicated, and OHLC-consistent (see normalizeCandles).
 */
export interface PriceAdapter {
  /** Stable identifier, e.g. "twelvedata" or "fixture". Recorded on ideas. */
  readonly name: string;
  readonly symbol: string;
  fetchCandles(request: CandleRequest): Promise<Candle[]>;
}

/** Thrown by adapters so callers can distinguish provider failures from bugs. */
export class PriceAdapterError extends Error {
  readonly adapter: string;
  /** True when the provider signalled a rate limit / quota exhaustion. */
  readonly rateLimited: boolean;

  constructor(
    adapter: string,
    message: string,
    options: { cause?: unknown; rateLimited?: boolean } = {},
  ) {
    // The underlying error goes through the standard ES2022 `cause` option, so
    // it shows up in stack traces rather than only on a custom field.
    super(`[${adapter}] ${message}`, { cause: options.cause });
    this.name = 'PriceAdapterError';
    this.adapter = adapter;
    this.rateLimited = options.rateLimited ?? false;
  }
}

// ---------------------------------------------------------------------------
// News contracts (adapter implementation lives in data/news — see its README).
// Declared here so /strategy can be typed against the fundamental bias before
// the ForexFactory adapter is wired up.
// ---------------------------------------------------------------------------

export type NewsImpact = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export const NEWS_IMPACTS: readonly NewsImpact[] = ['HIGH', 'MEDIUM', 'LOW', 'NONE'] as const;

export interface NewsEvent {
  /** Event title, e.g. "Core CPI m/m". */
  title: string;
  /**
   * Currency code, e.g. "USD". Named `country` because that is what the
   * ForexFactory feed calls the field, but it carries a currency, not a nation.
   */
  country: string;
  impact: NewsImpact;
  /** Scheduled release time, Unix seconds UTC. Null for "all day"/tentative. */
  time: number | null;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
}

/**
 * A calendar read, with the one distinction the blackout rule depends on.
 *
 * `available: false` means no calendar was obtained at all. That is *not* the
 * same as a successfully-read week that happens to contain no qualifying
 * releases. The first case means we cannot see whether a high-impact print is
 * minutes away, so the blackout fails closed; the second means we looked and
 * there is nothing there, so trading proceeds. An empty `events` array cannot
 * carry that difference on its own, which is why it has to cross the adapter
 * boundary explicitly.
 */
export interface NewsCalendarRead {
  events: NewsEvent[];
  available: boolean;
  /** Why no calendar was obtained. Null when `available` is true. */
  reason: string | null;
}

export interface NewsAdapter {
  readonly name: string;
  /** Must never throw on network failure — fall back to cache, then []. */
  fetchThisWeek(): Promise<NewsEvent[]>;
  /**
   * Optional. The same read, plus whether a calendar was obtained at all.
   *
   * Adapters that cannot tell an outage from a quiet week may omit this. Callers
   * must then treat an empty calendar as unavailable, because between "no news
   * this week" and "we never reached the feed" that is the safe reading.
   */
  fetchCalendar?(): Promise<NewsCalendarRead>;
}

// ---------------------------------------------------------------------------
// Macro contracts (USD proxy, US10Y) — implementation in data/macro.
//
// These are *optional* inputs to the fundamental score. Unlike price data, a
// missing reading degrades the score rather than failing the request, so the
// adapter reports per-instrument unavailability instead of throwing.
// ---------------------------------------------------------------------------

/** Macro instruments the fundamental bias reads. */
export type MacroInstrument = 'USD_PROXY' | 'US10Y';

export const MACRO_INSTRUMENTS: readonly MacroInstrument[] = ['USD_PROXY', 'US10Y'] as const;

/**
 * One instrument's recent move.
 *
 * `last` is the newest close and `reference` the close `lookbackBars` bars
 * earlier, so `changeAbsolute = last - reference`. For US10Y values are
 * percentage points (4.21 means 4.21%); multiply the daily change by 100 for
 * basis points. `source` names the actual provider/dataset.
 */
export interface MacroReading {
  instrument: MacroInstrument;
  /** Provider symbol actually used, recorded so ideas are auditable. */
  symbol: string;
  /** Provider/dataset name, e.g. "Twelve Data UUP ETF" or "FRED DGS10". */
  source: string;
  last: number;
  reference: number;
  changeAbsolute: number;
  changePercent: number;
  /** Open time of the newest bar, Unix seconds UTC. */
  asOf: number;
  lookbackBars: number;
}

export interface MacroUnavailable {
  instrument: MacroInstrument;
  /** Human-readable cause, surfaced in the idea's reason string. */
  reason: string;
}

/**
 * Both readings, with explicit gaps. A caller should treat `null` as "no
 * opinion from this input", never as zero — a flat USD proxy and an unavailable one are
 * very different pieces of evidence.
 */
export interface MacroSnapshot {
  usdProxy: MacroReading | null;
  us10y: MacroReading | null;
  unavailable: MacroUnavailable[];
}

export interface MacroRequest {
  /** How many daily bars back the `reference` close is taken from. Default 5. */
  lookbackBars?: number;
}

export interface MacroAdapter {
  readonly name: string;
  /** Must never throw — report gaps via `MacroSnapshot.unavailable`. */
  fetchSnapshot(request?: MacroRequest): Promise<MacroSnapshot>;
}
