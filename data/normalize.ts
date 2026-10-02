import type { Candle } from './types';

/**
 * Candle hygiene. Providers send duplicated bars, out-of-order bars, strings
 * instead of numbers, and the occasional bar where high < low. Every adapter
 * funnels through here so the indicators can trust their input.
 */

export interface CandleValidationIssue {
  index: number;
  reason: string;
}

/** Structural check: finite numbers and a coherent OHLC relationship. */
export function validateCandle(candle: Candle): string | null {
  const { time, open, high, low, close } = candle;

  for (const [key, value] of Object.entries({ time, open, high, low, close })) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return `${key} is not a finite number (got ${String(value)})`;
    }
  }
  if (time <= 0) return `time must be a positive unix timestamp (got ${time})`;
  // Guards against milliseconds being passed where seconds are expected.
  if (time > 1e11) return `time looks like milliseconds, expected seconds (got ${time})`;
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0) return 'prices must be positive';
  if (high < low) return `high (${high}) is below low (${low})`;
  if (high < open || high < close) return `high (${high}) is below open/close`;
  if (low > open || low > close) return `low (${low}) is above open/close`;

  return null;
}

export function isValidCandle(candle: Candle): boolean {
  return validateCandle(candle) === null;
}

export interface NormalizeOptions {
  /**
   * What to do with malformed bars.
   * "throw" (default) surfaces provider bugs loudly; "drop" is for backtests
   * over long historical ranges where one bad bar shouldn't halt the run.
   */
  onInvalid?: 'throw' | 'drop';
  /** Keep only the newest `limit` bars, after sorting and de-duplicating. */
  limit?: number;
}

export interface NormalizeResult {
  candles: Candle[];
  dropped: CandleValidationIssue[];
}

/**
 * Sort ascending by open time, de-duplicate (last write wins, since providers
 * resend the forming bar), validate, and optionally trim to the newest N.
 */
export function normalizeCandles(
  input: readonly Candle[],
  options: NormalizeOptions = {},
): NormalizeResult {
  const { onInvalid = 'throw', limit } = options;
  const dropped: CandleValidationIssue[] = [];

  const byTime = new Map<number, Candle>();

  input.forEach((candle, index) => {
    const problem = validateCandle(candle);
    if (problem !== null) {
      if (onInvalid === 'throw') {
        throw new Error(`Invalid candle at index ${index}: ${problem}`);
      }
      dropped.push({ index, reason: problem });
      return;
    }
    // Later entries overwrite earlier ones with the same open time: a provider
    // re-sending the currently-forming bar should win.
    byTime.set(candle.time, candle);
  });

  let candles = [...byTime.values()].sort((a, b) => a.time - b.time);

  if (typeof limit === 'number' && limit >= 0 && candles.length > limit) {
    candles = candles.slice(candles.length - limit);
  }

  return { candles, dropped };
}

/** Convenience wrapper when you only want the candles. */
export function normalizeCandlesStrict(
  input: readonly Candle[],
  limit?: number,
): Candle[] {
  return normalizeCandles(input, { onInvalid: 'throw', limit }).candles;
}

/** Parse "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DD" as UTC → unix seconds. */
export function parseUtcTimestamp(value: string): number {
  const trimmed = value.trim();
  const iso = trimmed.includes(' ') ? trimmed.replace(' ', 'T') : trimmed;
  const withZone = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso)
    ? iso
    : `${iso.length === 10 ? `${iso}T00:00:00` : iso}Z`;

  const ms = Date.parse(withZone);
  if (Number.isNaN(ms)) throw new Error(`Unparseable timestamp: "${value}"`);
  return Math.floor(ms / 1000);
}

/** Strict numeric coercion — providers love sending numbers as strings. */
export function parseNumber(value: unknown, field: string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${field} is not finite`);
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`${field} is not a number (got ${JSON.stringify(value)})`);
}
