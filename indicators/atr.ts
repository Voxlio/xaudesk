import type { Candle } from '../data/types';
import type { IndicatorSeries } from './ema';

/**
 * True Range and Average True Range (Wilder).
 *
 * ATR drives stop placement and the "is this range tradeable today" check, so
 * its warm-up convention matters. True Range needs a PREVIOUS close, so TR is
 * undefined on bar 0, and the first ATR value lands at index `period`
 * (the average of TR[1..period]). Same convention as MetaTrader.
 */

/**
 * TR = max(high - low, |high - prevClose|, |low - prevClose|)
 *
 * The prevClose terms are what make TR gap-aware: after a Sunday-open gap in
 * gold, high - low alone would badly understate the real move.
 */
export function trueRange(candles: readonly Candle[]): IndicatorSeries {
  const out: IndicatorSeries = new Array(candles.length).fill(null);

  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i] as Candle;
    const previousClose = (candles[i - 1] as Candle).close;

    out[i] = Math.max(
      current.high - current.low,
      Math.abs(current.high - previousClose),
      Math.abs(current.low - previousClose),
    );
  }

  return out;
}

export function atr(candles: readonly Candle[], period = 14): IndicatorSeries {
  if (!Number.isInteger(period) || period < 1) {
    throw new Error(`atr: period must be a positive integer (got ${period})`);
  }

  const out: IndicatorSeries = new Array(candles.length).fill(null);
  // Need `period` true ranges, and TR starts at index 1.
  if (candles.length <= period) return out;

  const ranges = trueRange(candles);

  let seed = 0;
  for (let i = 1; i <= period; i += 1) seed += ranges[i] as number;
  let previous = seed / period;
  out[period] = previous;

  for (let i = period + 1; i < candles.length; i += 1) {
    previous = (previous * (period - 1) + (ranges[i] as number)) / period;
    out[i] = previous;
  }

  return out;
}

/**
 * ATR as a percentage of price — the comparable form. A 12-dollar ATR means
 * something different at gold 1800 than at gold 2500.
 */
export function atrPercent(candles: readonly Candle[], period = 14): IndicatorSeries {
  const absolute = atr(candles, period);

  return absolute.map((value, index) => {
    if (value === null) return null;
    const close = (candles[index] as Candle).close;
    if (close === 0) return null;
    return (value / close) * 100;
  });
}
