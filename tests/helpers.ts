import type { Candle, NewsEvent } from '../data/types';

/**
 * Shared test helpers.
 *
 * `parallelCandles` builds bars whose high and low sit a fixed distance either
 * side of a mid price. That makes swing detection trivially predictable — a
 * local maximum in the mid series is a swing high and nothing else — so the
 * structure tests assert on hand-reasoned pivots instead of on whatever the
 * implementation happens to produce.
 */

export const BASE_TIME = Date.UTC(2026, 0, 5, 0, 0, 0) / 1000; // Mon 2026-01-05 UTC
export const HOUR = 3600;

export function candleAt(index: number, parts: Omit<Candle, 'time'>): Candle {
  return { time: BASE_TIME + index * HOUR, ...parts };
}

/**
 * Bars centred on `mids`: open = close = mid, high = mid + halfRange,
 * low = mid - halfRange.
 *
 * Open and close are deliberately equal so that high and low track the mid
 * series exactly. Any other choice (e.g. open = previous close) would make the
 * high depend on two mids at once and the "local maximum == swing high"
 * property would no longer hold.
 */
export function parallelCandles(mids: readonly number[], halfRange = 0.5): Candle[] {
  return mids.map((mid, index) => ({
    time: BASE_TIME + index * HOUR,
    open: mid,
    high: mid + halfRange,
    low: mid - halfRange,
    close: mid,
  }));
}

/** Await a promise that is expected to reject, and return the error. */
export async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected the promise to reject, but it resolved');
}

// ---------------------------------------------------------------------------
// News helpers
// ---------------------------------------------------------------------------

/**
 * Wednesday 2026-10-07 12:00:00 UTC — mid-week and mid-session, so tests can
 * place releases both before and after "now" without crossing a weekend.
 */
export const NEWS_NOW = Date.UTC(2026, 9, 7, 12, 0, 0) / 1000;

export const MINUTE = 60;

/**
 * A USD high-impact release, by default published and exactly on forecast.
 *
 * Defaulting to "no surprise" matters: a test that cares about one field should
 * not accidentally inherit a directional bias from the others.
 */
export function newsEvent(parts: Partial<NewsEvent> = {}): NewsEvent {
  return {
    title: 'CPI m/m',
    country: 'USD',
    impact: 'HIGH',
    time: NEWS_NOW - HOUR,
    actual: '0.2%',
    forecast: '0.2%',
    previous: '0.2%',
    ...parts,
  };
}

/** A fetch stand-in returning a fixed body, recording the URLs it was called with. */
export interface FakeFetch {
  impl: typeof fetch;
  calls: string[];
}

export function fakeJsonFetch(
  body: unknown,
  options: { status?: number; raw?: string } = {},
): FakeFetch {
  const calls: string[] = [];

  const impl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(options.raw ?? JSON.stringify(body), {
      status: options.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  return { impl, calls };
}

/** A fetch stand-in that always rejects, to exercise failure paths. */
export function failingFetch(message = 'network down'): FakeFetch {
  const calls: string[] = [];

  const impl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    throw new Error(message);
  }) as unknown as typeof fetch;

  return { impl, calls };
}
