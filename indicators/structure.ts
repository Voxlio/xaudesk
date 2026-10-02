import type { Candle } from '../data/types';

/**
 * Market structure: swing pivots, trend classification, and break of structure.
 *
 * Pivots are detected with the fractal rule: bar `i` is a swing high when its
 * high is strictly greater than the highs of the `lookback` bars on BOTH sides.
 * Requiring right-side bars is what makes this non-repainting — a pivot is only
 * knowable `lookback` bars after it forms, which is recorded on each swing as
 * `confirmedAtIndex`. The BOS scan respects that, so it can never "see" a pivot
 * before the market did. That property is what keeps /backtest honest.
 */

export type SwingKind = 'high' | 'low';

export interface SwingPoint {
  kind: SwingKind;
  /** Bar index that formed the pivot. */
  index: number;
  /** Open time of the forming bar, unix seconds UTC. */
  time: number;
  /** The pivot price: the bar's high for a swing high, its low for a swing low. */
  price: number;
  /** Earliest bar index at which this pivot could be known (`index + lookback`). */
  confirmedAtIndex: number;
}

export type Trend = 'uptrend' | 'downtrend' | 'range';

export type BreakDirection = 'bullish' | 'bearish';

export interface StructureBreak {
  index: number;
  time: number;
  direction: BreakDirection;
  /** The price that did the breaking (close, or high/low in "wick" mode). */
  breakPrice: number;
  brokenSwing: SwingPoint;
}

export interface StructureOptions {
  /** Bars required either side of a pivot. Default 2. */
  lookback?: number;
  /**
   * Whether a break needs a candle BODY beyond the level ("close", default,
   * stricter) or merely a wick ("wick", earlier but noisier).
   */
  breakOn?: 'close' | 'wick';
}

export interface StructureAnalysis {
  lookback: number;
  breakOn: 'close' | 'wick';
  /** All pivots, ordered by forming index. */
  swings: SwingPoint[];
  swingHighs: SwingPoint[];
  swingLows: SwingPoint[];
  lastSwingHigh: SwingPoint | null;
  lastSwingLow: SwingPoint | null;
  trend: Trend;
  breaks: StructureBreak[];
  lastBreak: StructureBreak | null;
}

function resolveLookback(lookback: number): number {
  if (!Number.isInteger(lookback) || lookback < 1) {
    throw new Error(`structure: lookback must be a positive integer (got ${lookback})`);
  }
  return lookback;
}

/**
 * Fractal swing detection.
 *
 * Comparison is strict on both sides, so a flat double-top plateau yields no
 * pivot rather than two. That is the conservative choice: an ambiguous level is
 * better ignored than counted twice when we're deciding whether structure broke.
 *
 * A single bar can be both a swing high and a swing low (an outside bar that
 * engulfs its neighbours); both pivots are returned.
 */
export function findSwingPoints(
  candles: readonly Candle[],
  lookback = 2,
): SwingPoint[] {
  const span = resolveLookback(lookback);
  const swings: SwingPoint[] = [];

  for (let i = span; i < candles.length - span; i += 1) {
    const candle = candles[i] as Candle;

    let isHigh = true;
    let isLow = true;

    for (let offset = 1; offset <= span; offset += 1) {
      const left = candles[i - offset] as Candle;
      const right = candles[i + offset] as Candle;

      if (candle.high <= left.high || candle.high <= right.high) isHigh = false;
      if (candle.low >= left.low || candle.low >= right.low) isLow = false;

      if (!isHigh && !isLow) break;
    }

    if (isHigh) {
      swings.push({
        kind: 'high',
        index: i,
        time: candle.time,
        price: candle.high,
        confirmedAtIndex: i + span,
      });
    }
    if (isLow) {
      swings.push({
        kind: 'low',
        index: i,
        time: candle.time,
        price: candle.low,
        confirmedAtIndex: i + span,
      });
    }
  }

  return swings;
}

/**
 * Trend from the last two pivots of each kind:
 * higher highs AND higher lows → uptrend; lower highs AND lower lows →
 * downtrend; anything mixed (or not enough pivots) → range.
 *
 * Demanding agreement from both highs and lows is the point — a higher high on
 * a lower low is an expanding range, not a trend, and it is exactly the context
 * where a trend-following entry gets chopped up.
 */
export function classifyTrend(
  swingHighs: readonly SwingPoint[],
  swingLows: readonly SwingPoint[],
): Trend {
  if (swingHighs.length < 2 || swingLows.length < 2) return 'range';

  const previousHigh = swingHighs[swingHighs.length - 2] as SwingPoint;
  const lastHigh = swingHighs[swingHighs.length - 1] as SwingPoint;
  const previousLow = swingLows[swingLows.length - 2] as SwingPoint;
  const lastLow = swingLows[swingLows.length - 1] as SwingPoint;

  const higherHigh = lastHigh.price > previousHigh.price;
  const higherLow = lastLow.price > previousLow.price;

  if (higherHigh && higherLow) return 'uptrend';
  if (!higherHigh && !higherLow) {
    // Guard against equal pivots being read as a downtrend.
    const lowerHigh = lastHigh.price < previousHigh.price;
    const lowerLow = lastLow.price < previousLow.price;
    return lowerHigh && lowerLow ? 'downtrend' : 'range';
  }
  return 'range';
}

/**
 * Walk the candles forward, tracking the most recent CONFIRMED pivot on each
 * side, and record a break each time price trades through it.
 *
 * A level is consumed once broken (so one swing high yields at most one bullish
 * BOS), and a newer pivot supersedes an unbroken older one — the structure that
 * matters is always the most recent.
 */
function findBreaks(
  candles: readonly Candle[],
  swings: readonly SwingPoint[],
  breakOn: 'close' | 'wick',
): StructureBreak[] {
  const swingsByConfirmation = new Map<number, SwingPoint[]>();
  for (const swing of swings) {
    const bucket = swingsByConfirmation.get(swing.confirmedAtIndex);
    if (bucket === undefined) swingsByConfirmation.set(swing.confirmedAtIndex, [swing]);
    else bucket.push(swing);
  }

  const breaks: StructureBreak[] = [];
  let activeHigh: SwingPoint | null = null;
  let activeLow: SwingPoint | null = null;

  for (let i = 0; i < candles.length; i += 1) {
    // Pivots become visible only at their confirmation bar.
    for (const swing of swingsByConfirmation.get(i) ?? []) {
      if (swing.kind === 'high') activeHigh = swing;
      else activeLow = swing;
    }

    const candle = candles[i] as Candle;
    const upPrice = breakOn === 'close' ? candle.close : candle.high;
    const downPrice = breakOn === 'close' ? candle.close : candle.low;

    if (activeHigh !== null && upPrice > activeHigh.price) {
      breaks.push({
        index: i,
        time: candle.time,
        direction: 'bullish',
        breakPrice: upPrice,
        brokenSwing: activeHigh,
      });
      activeHigh = null;
    }

    if (activeLow !== null && downPrice < activeLow.price) {
      breaks.push({
        index: i,
        time: candle.time,
        direction: 'bearish',
        breakPrice: downPrice,
        brokenSwing: activeLow,
      });
      activeLow = null;
    }
  }

  return breaks;
}

/** Full structure read for one timeframe. */
export function analyzeStructure(
  candles: readonly Candle[],
  options: StructureOptions = {},
): StructureAnalysis {
  const lookback = resolveLookback(options.lookback ?? 2);
  const breakOn = options.breakOn ?? 'close';

  const swings = findSwingPoints(candles, lookback);
  const swingHighs = swings.filter((swing) => swing.kind === 'high');
  const swingLows = swings.filter((swing) => swing.kind === 'low');
  const breaks = findBreaks(candles, swings, breakOn);

  return {
    lookback,
    breakOn,
    swings,
    swingHighs,
    swingLows,
    lastSwingHigh: swingHighs.at(-1) ?? null,
    lastSwingLow: swingLows.at(-1) ?? null,
    trend: classifyTrend(swingHighs, swingLows),
    breaks,
    lastBreak: breaks.at(-1) ?? null,
  };
}
