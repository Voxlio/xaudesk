import type { Candle } from '../../data/types';
import {
  analyzeStructure,
  classifyTrend,
  findSwingPoints,
  type SwingPoint,
} from '../../indicators/structure';
import { candleAt, parallelCandles } from '../helpers';

/**
 * These use `parallelCandles`, where high = mid + 0.5 and low = mid - 0.5, so a
 * local maximum in the mid series is a swing high and a local minimum is a
 * swing low — pivots can be read straight off the numbers.
 */

const prices = (swings: readonly SwingPoint[]): number[] => swings.map((swing) => swing.price);
const indexes = (swings: readonly SwingPoint[]): number[] => swings.map((swing) => swing.index);

describe('findSwingPoints', () => {
  it('finds a single fractal high with lookback 1', () => {
    const candles = parallelCandles([100, 103, 101]);

    const swings = findSwingPoints(candles, 1);

    expect(swings).toHaveLength(1);
    expect(swings[0]?.kind).toBe('high');
    expect(swings[0]?.index).toBe(1);
    expect(swings[0]?.price).toBe(103.5); // the bar's high, not its close
    expect(swings[0]?.time).toBe(candles[1]?.time);
  });

  it('never marks the first or last `lookback` bars, which have no confirmation', () => {
    // 108 at index 0 is the highest high in the series but cannot be a pivot:
    // there are no bars to its left.
    const candles = parallelCandles([108, 100, 102, 99]);

    const swings = findSwingPoints(candles, 1);

    expect(indexes(swings)).not.toContain(0);
    expect(indexes(swings)).not.toContain(3);
  });

  it('records when each pivot becomes knowable', () => {
    const candles = parallelCandles([100, 103, 101, 99, 104]);

    const swings = findSwingPoints(candles, 2);

    for (const swing of swings) {
      expect(swing.confirmedAtIndex).toBe(swing.index + 2);
    }
  });

  it('ignores a flat double top rather than reporting two pivots', () => {
    // Strict comparison on both sides: an ambiguous plateau yields nothing.
    const candles = parallelCandles([100, 103, 103, 100]);

    const swings = findSwingPoints(candles, 1);

    expect(swings.filter((swing) => swing.kind === 'high')).toHaveLength(0);
  });

  it('reports an engulfing outside bar as both a high and a low', () => {
    const candles: Candle[] = [
      candleAt(0, { open: 9.5, high: 10, low: 9, close: 9.5 }),
      candleAt(1, { open: 9.5, high: 12, low: 7, close: 11 }),
      candleAt(2, { open: 9.5, high: 10, low: 9, close: 9.5 }),
    ];

    const swings = findSwingPoints(candles, 1);

    expect(swings).toHaveLength(2);
    expect(swings.map((swing) => swing.kind).sort()).toEqual(['high', 'low']);
    expect(swings.every((swing) => swing.index === 1)).toBe(true);
  });

  it('requires more agreement as lookback grows', () => {
    //                           0    1    2    3    4    5    6
    const candles = parallelCandles([100, 101, 100, 104, 100, 101, 100]);

    // With lookback 1, the small bump at index 1 and 5 both qualify.
    expect(indexes(findSwingPoints(candles, 1).filter((s) => s.kind === 'high'))).toEqual([
      1, 3, 5,
    ]);
    // With lookback 3, only the dominant pivot at index 3 survives.
    expect(indexes(findSwingPoints(candles, 3).filter((s) => s.kind === 'high'))).toEqual([3]);
  });

  it('returns nothing for a series shorter than the confirmation window', () => {
    expect(findSwingPoints(parallelCandles([100, 101]), 2)).toEqual([]);
    expect(findSwingPoints([], 2)).toEqual([]);
  });

  it('rejects an invalid lookback', () => {
    expect(() => findSwingPoints(parallelCandles([1, 2, 3]), 0)).toThrow(/positive integer/);
    expect(() => findSwingPoints(parallelCandles([1, 2, 3]), 1.5)).toThrow(/positive integer/);
  });
});

describe('classifyTrend', () => {
  const swing = (kind: 'high' | 'low', price: number, index: number): SwingPoint => ({
    kind,
    index,
    time: index,
    price,
    confirmedAtIndex: index + 2,
  });

  it('calls higher highs plus higher lows an uptrend', () => {
    const highs = [swing('high', 100, 1), swing('high', 110, 5)];
    const lows = [swing('low', 90, 3), swing('low', 95, 7)];

    expect(classifyTrend(highs, lows)).toBe('uptrend');
  });

  it('calls lower highs plus lower lows a downtrend', () => {
    const highs = [swing('high', 110, 1), swing('high', 100, 5)];
    const lows = [swing('low', 95, 3), swing('low', 90, 7)];

    expect(classifyTrend(highs, lows)).toBe('downtrend');
  });

  it('calls a higher high on a lower low a range, not a trend', () => {
    // An expanding range. Treating it as a trend is exactly how a
    // trend-following entry gets chopped up, so it must not be one.
    const highs = [swing('high', 100, 1), swing('high', 110, 5)];
    const lows = [swing('low', 90, 3), swing('low', 85, 7)];

    expect(classifyTrend(highs, lows)).toBe('range');
  });

  it('treats equal pivots as a range rather than a trend', () => {
    const highs = [swing('high', 100, 1), swing('high', 100, 5)];
    const lows = [swing('low', 90, 3), swing('low', 90, 7)];

    expect(classifyTrend(highs, lows)).toBe('range');
  });

  it('falls back to range without two pivots of each kind', () => {
    expect(classifyTrend([swing('high', 100, 1)], [swing('low', 90, 3)])).toBe('range');
    expect(classifyTrend([], [])).toBe('range');
  });
});

describe('analyzeStructure', () => {
  it('classifies a higher-high / higher-low sequence as an uptrend', () => {
    //                                0    1*   2*   3*   4*   5*   6
    const candles = parallelCandles([100, 98, 102, 99, 105, 101, 108]);

    const result = analyzeStructure(candles, { lookback: 1 });

    expect(indexes(result.swingHighs)).toEqual([2, 4]);
    expect(prices(result.swingHighs)).toEqual([102.5, 105.5]);
    expect(indexes(result.swingLows)).toEqual([1, 3, 5]);
    expect(prices(result.swingLows)).toEqual([97.5, 98.5, 100.5]);
    expect(result.trend).toBe('uptrend');
    expect(result.lastSwingHigh?.index).toBe(4);
    expect(result.lastSwingLow?.index).toBe(5);
  });

  it('classifies a lower-high / lower-low sequence as a downtrend', () => {
    const candles = parallelCandles([108, 101, 105, 99, 102, 98, 100]);

    const result = analyzeStructure(candles, { lookback: 1 });

    expect(prices(result.swingHighs)).toEqual([105.5, 102.5]);
    expect(result.trend).toBe('downtrend');
  });

  it('classifies mixed structure as a range', () => {
    // Higher highs (102.5 -> 105.5) but lower lows (94.5 -> 89.5).
    const candles = parallelCandles([100, 98, 102, 95, 105, 90, 103]);

    const result = analyzeStructure(candles, { lookback: 1 });

    expect(result.trend).toBe('range');
  });

  it('detects a bullish break of structure on the closing bar', () => {
    //                                0    1    2    3    4    5
    const candles = parallelCandles([100, 98, 102, 99, 103, 106]);
    // Swing high at index 2 sits at 102.5 and is confirmed at index 3.
    // Index 4 closes at 103 > 102.5 -> one bullish break, nothing bearish.

    const result = analyzeStructure(candles, { lookback: 1 });

    expect(result.breaks).toHaveLength(1);
    expect(result.breaks[0]?.direction).toBe('bullish');
    expect(result.breaks[0]?.index).toBe(4);
    expect(result.breaks[0]?.breakPrice).toBe(103);
    expect(result.breaks[0]?.brokenSwing.index).toBe(2);
    expect(result.breaks[0]?.brokenSwing.price).toBe(102.5);
    expect(result.lastBreak?.direction).toBe('bullish');
  });

  it('detects a bearish break of structure', () => {
    //                                0    1    2    3    4    5
    const candles = parallelCandles([100, 102, 98, 101, 97, 94]);
    // Swing low at index 2 sits at 97.5, confirmed at index 3.
    // Index 4 closes at 97 < 97.5 -> bearish break.

    const result = analyzeStructure(candles, { lookback: 1 });

    const bearish = result.breaks.filter((item) => item.direction === 'bearish');
    expect(bearish).toHaveLength(1);
    expect(bearish[0]?.index).toBe(4);
    expect(bearish[0]?.brokenSwing.index).toBe(2);
  });

  it('breaks a level at most once', () => {
    // After index 4 takes 102.5, the later closes at 104 and 107 must not
    // re-report the same swing high.
    const candles = parallelCandles([100, 98, 102, 99, 103, 104, 107]);

    const result = analyzeStructure(candles, { lookback: 1 });

    const bullish = result.breaks.filter((item) => item.direction === 'bullish');
    const brokenIndexes = bullish.map((item) => item.brokenSwing.index);

    expect(new Set(brokenIndexes).size).toBe(brokenIndexes.length);
  });

  it('never breaks a pivot before that pivot was knowable', () => {
    // The non-repainting guarantee: with lookback 2 a pivot is only visible two
    // bars after it forms, so no break may be dated earlier than that.
    const candles = parallelCandles([
      100, 104, 99, 106, 97, 108, 95, 110, 93, 112, 91, 114, 101, 99, 118, 96, 120,
    ]);

    const result = analyzeStructure(candles, { lookback: 2 });

    expect(result.breaks.length).toBeGreaterThan(0);
    for (const item of result.breaks) {
      expect(item.index).toBeGreaterThanOrEqual(item.brokenSwing.confirmedAtIndex);
      expect(item.brokenSwing.confirmedAtIndex).toBe(item.brokenSwing.index + 2);
    }
  });

  it('breaks on a wick that the close does not confirm', () => {
    // Swing high at index 2 sits at 102.5. Index 4 pokes above it (high 103)
    // but closes back below at 100 — a liquidity sweep, not a body break.
    const candles: Candle[] = [
      candleAt(0, { open: 100, high: 100.5, low: 99.5, close: 100 }),
      candleAt(1, { open: 98, high: 98.5, low: 97.5, close: 98 }),
      candleAt(2, { open: 102, high: 102.5, low: 101.5, close: 102 }),
      candleAt(3, { open: 99, high: 99.5, low: 98.5, close: 99 }),
      candleAt(4, { open: 100, high: 103, low: 99, close: 100 }),
      candleAt(5, { open: 100, high: 100.7, low: 99.8, close: 100.2 }),
    ];

    const byClose = analyzeStructure(candles, { lookback: 1, breakOn: 'close' });
    const byWick = analyzeStructure(candles, { lookback: 1, breakOn: 'wick' });

    expect(byClose.breaks).toHaveLength(0);
    expect(byClose.breakOn).toBe('close');

    expect(byWick.breaks).toHaveLength(1);
    expect(byWick.breaks[0]?.direction).toBe('bullish');
    expect(byWick.breaks[0]?.index).toBe(4);
    expect(byWick.breaks[0]?.breakPrice).toBe(103);
    expect(byWick.breaks[0]?.brokenSwing.index).toBe(2);
    expect(byWick.breakOn).toBe('wick');
  });

  it('reports a range with no breaks for a series too short to form pivots', () => {
    const result = analyzeStructure(parallelCandles([100, 101]), { lookback: 2 });

    expect(result.swings).toEqual([]);
    expect(result.breaks).toEqual([]);
    expect(result.trend).toBe('range');
    expect(result.lastSwingHigh).toBeNull();
    expect(result.lastSwingLow).toBeNull();
    expect(result.lastBreak).toBeNull();
  });

  it('handles an empty series', () => {
    const result = analyzeStructure([]);

    expect(result.swings).toEqual([]);
    expect(result.trend).toBe('range');
    expect(result.lookback).toBe(2);
  });
});
