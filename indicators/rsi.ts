import type { IndicatorSeries } from './ema';

/**
 * Relative Strength Index, Wilder's original formulation.
 *
 * Warm-up: RSI needs `period` price CHANGES, so the first defined value lands
 * at index `period` (i.e. you need period + 1 closes). The seed is a simple
 * average of the first `period` gains and losses; every bar after that is
 * Wilder-smoothed. This matches MetaTrader's RSI.
 */

/** Convert a smoothed gain/loss pair into an RSI reading. */
function rsiFromAverages(averageGain: number, averageLoss: number): number {
  // No losses at all: by convention RSI pins to 100 — except on a perfectly
  // flat series, where "maximum strength" would be nonsense, so it reads 50.
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;

  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}

export function rsi(values: readonly number[], period = 14): IndicatorSeries {
  if (!Number.isInteger(period) || period < 1) {
    throw new Error(`rsi: period must be a positive integer (got ${period})`);
  }

  const out: IndicatorSeries = new Array(values.length).fill(null);
  // Need period changes, which needs period + 1 values.
  if (values.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = (values[i] as number) - (values[i - 1] as number);
    if (change > 0) gainSum += change;
    else lossSum -= change; // change <= 0, so this adds |change|
  }

  let averageGain = gainSum / period;
  let averageLoss = lossSum / period;
  out[period] = rsiFromAverages(averageGain, averageLoss);

  for (let i = period + 1; i < values.length; i += 1) {
    const change = (values[i] as number) - (values[i - 1] as number);
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;

    out[i] = rsiFromAverages(averageGain, averageLoss);
  }

  return out;
}

/** Overbought / oversold / neutral against the usual 70-30 thresholds. */
export type RsiZone = 'overbought' | 'oversold' | 'neutral';

export function rsiZone(value: number | null, upper = 70, lower = 30): RsiZone | null {
  if (value === null) return null;
  if (value >= upper) return 'overbought';
  if (value <= lower) return 'oversold';
  return 'neutral';
}
