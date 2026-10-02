/**
 * Moving averages.
 *
 * Every indicator in this folder returns an array the SAME LENGTH as its input,
 * with `null` for bars where the value is not yet defined (the warm-up period).
 * That alignment is deliberate: `ema(closes, 200)[i]` always refers to the same
 * bar as `candles[i]`, so the strategy layer can never accidentally compare an
 * indicator value against the wrong candle — a classic off-by-N backtest bug.
 */

export type IndicatorSeries = (number | null)[];

function assertPeriod(period: number, name: string): void {
  if (!Number.isInteger(period) || period < 1) {
    throw new Error(`${name}: period must be a positive integer (got ${period})`);
  }
}

/** Simple moving average. */
export function sma(values: readonly number[], period: number): IndicatorSeries {
  assertPeriod(period, 'sma');

  const out: IndicatorSeries = new Array(values.length).fill(null);
  if (values.length < period) return out;

  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i] as number;
    if (i >= period) sum -= values[i - period] as number;
    if (i >= period - 1) out[i] = sum / period;
  }

  return out;
}

/**
 * Exponential moving average, seeded with the SMA of the first `period` values.
 *
 * The first defined value lands at index `period - 1`. Seeding with an SMA
 * (rather than with values[0]) is the convention MetaTrader and TradingView use,
 * so the 50/200 EMAs here line up with what you see on an HFM chart.
 *
 *   k = 2 / (period + 1)
 *   ema[i] = values[i] * k + ema[i-1] * (1 - k)
 */
export function ema(values: readonly number[], period: number): IndicatorSeries {
  assertPeriod(period, 'ema');

  const out: IndicatorSeries = new Array(values.length).fill(null);
  if (values.length < period) return out;

  const k = 2 / (period + 1);

  let seed = 0;
  for (let i = 0; i < period; i += 1) seed += values[i] as number;
  let previous = seed / period;
  out[period - 1] = previous;

  for (let i = period; i < values.length; i += 1) {
    previous = (values[i] as number) * k + previous * (1 - k);
    out[i] = previous;
  }

  return out;
}

/**
 * Wilder's smoothing (a.k.a. RMA / SMMA), the recursive average underneath RSI
 * and ATR. Equivalent to an EMA with k = 1/period.
 *
 *   rma[i] = (rma[i-1] * (period - 1) + values[i]) / period
 */
export function wilderSmooth(values: readonly number[], period: number): IndicatorSeries {
  assertPeriod(period, 'wilderSmooth');

  const out: IndicatorSeries = new Array(values.length).fill(null);
  if (values.length < period) return out;

  let seed = 0;
  for (let i = 0; i < period; i += 1) seed += values[i] as number;
  let previous = seed / period;
  out[period - 1] = previous;

  for (let i = period; i < values.length; i += 1) {
    previous = (previous * (period - 1) + (values[i] as number)) / period;
    out[i] = previous;
  }

  return out;
}

/** Last non-null value of a series, or null if it never warmed up. */
export function latest(series: IndicatorSeries): number | null {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const value = series[i];
    if (value !== null && value !== undefined) return value;
  }
  return null;
}
