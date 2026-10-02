import type { Candle } from '../../data/types';
import { atr, atrPercent, trueRange } from '../../indicators/atr';
import { candleAt } from '../helpers';

/**
 * Hand-computed reference set.
 *
 *  i  open  high  low   close   TR
 *  0  9     10    8     9       null  (no previous close)
 *  1  9     12    9     11      max(3, |12-9|=3,    |9-9|=0)      = 3
 *  2  12    13    12    12.5    max(1, |13-11|=2,   |12-11|=1)    = 2
 *  3  12    12    11    11.5    max(1, |12-12.5|=.5,|11-12.5|=1.5)= 1.5
 *
 * ATR period 2:  atr[2] = (3 + 2)/2 = 2.5
 *                atr[3] = (2.5*1 + 1.5)/2 = 2.0
 */
const REFERENCE: Candle[] = [
  candleAt(0, { open: 9, high: 10, low: 8, close: 9 }),
  candleAt(1, { open: 9, high: 12, low: 9, close: 11 }),
  candleAt(2, { open: 12, high: 13, low: 12, close: 12.5 }),
  candleAt(3, { open: 12, high: 12, low: 11, close: 11.5 }),
];

describe('trueRange', () => {
  it('matches the hand-computed ranges', () => {
    expect(trueRange(REFERENCE)).toEqual([null, 3, 2, 1.5]);
  });

  it('is undefined on the first bar, which has no previous close', () => {
    expect(trueRange(REFERENCE)[0]).toBeNull();
  });

  it('accounts for gaps: TR exceeds the bar range when price gaps away', () => {
    const gapped: Candle[] = [
      candleAt(0, { open: 2400, high: 2402, low: 2398, close: 2400 }),
      // Sunday-open gap: the whole bar trades above the previous close.
      candleAt(1, { open: 2420, high: 2423, low: 2419, close: 2422 }),
    ];

    const ranges = trueRange(gapped);
    const barRange = 2423 - 2419; // 4

    expect(ranges[1] as number).toBeCloseTo(23, 10); // |2423 - 2400|
    expect(ranges[1] as number).toBeGreaterThan(barRange);
  });

  it('handles an empty series', () => {
    expect(trueRange([])).toEqual([]);
  });
});

describe('atr', () => {
  it('matches the hand-computed Wilder series', () => {
    const result = atr(REFERENCE, 2);

    expect(result).toHaveLength(4);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2] as number).toBeCloseTo(2.5, 10);
    expect(result[3] as number).toBeCloseTo(2.0, 10);
  });

  it('places the first value at index period, since TR starts at index 1', () => {
    const bars = Array.from({ length: 20 }, (_, i) =>
      candleAt(i, { open: 2400, high: 2401, low: 2399, close: 2400 }),
    );

    const result = atr(bars, 14);

    for (let i = 0; i < 14; i += 1) expect(result[i]).toBeNull();
    expect(result[14]).not.toBeNull();
  });

  it('equals the bar range for a constant-range, gapless series', () => {
    const bars = Array.from({ length: 10 }, (_, i) =>
      candleAt(i, { open: 2400.5, high: 2401, low: 2400, close: 2400.5 }),
    );

    const result = atr(bars, 3);

    expect(result[9] as number).toBeCloseTo(1, 10);
  });

  it('is always positive on real-looking data', () => {
    const bars = Array.from({ length: 40 }, (_, i) => {
      const mid = 2400 + Math.sin(i / 3) * 12;
      return candleAt(i, { open: mid, high: mid + 2.5, low: mid - 2.5, close: mid + 0.4 });
    });

    for (const value of atr(bars, 14)) {
      if (value === null) continue;
      expect(value).toBeGreaterThan(0);
    }
  });

  it('returns all nulls when there is not enough data', () => {
    expect(atr(REFERENCE, 4)).toEqual([null, null, null, null]);
    expect(atr([], 14)).toEqual([]);
  });

  it('rejects an invalid period', () => {
    expect(() => atr(REFERENCE, 0)).toThrow(/positive integer/);
    expect(() => atr(REFERENCE, 2.5)).toThrow(/positive integer/);
  });
});

describe('atrPercent', () => {
  it('expresses ATR as a percentage of the bar close', () => {
    const result = atrPercent(REFERENCE, 2);

    // atr[2] = 2.5, close[2] = 12.5 -> 20%
    expect(result[2] as number).toBeCloseTo(20, 10);
    // atr[3] = 2.0, close[3] = 11.5 -> 17.3913%
    expect(result[3] as number).toBeCloseTo((2 / 11.5) * 100, 10);
  });

  it('keeps the warm-up nulls of the underlying ATR', () => {
    expect(atrPercent(REFERENCE, 2)[1]).toBeNull();
  });
});
