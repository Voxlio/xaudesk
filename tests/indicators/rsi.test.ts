import { rsi, rsiZone } from '../../indicators/rsi';

describe('rsi', () => {
  /**
   * Hand-computed reference, period 3, closes [10, 11, 10.5, 11.5, 12, 11, 11.8].
   *
   * changes: +1, -0.5, +1, +0.5, -1, +0.8
   *
   * Seed at index 3 from the first 3 changes:
   *   avgGain = (1 + 0 + 1)/3 = 2/3      avgLoss = (0 + 0.5 + 0)/3 = 1/6
   *   RS = 4                             RSI = 100 - 100/5 = 80
   * index 4 (+0.5):
   *   avgGain = (2/3*2 + 0.5)/3 = 11/18  avgLoss = (1/6*2 + 0)/3 = 1/9
   *   RS = 5.5                           RSI = 100 - 100/6.5 = 84.615385
   * index 5 (-1):
   *   avgGain = (11/18*2)/3 = 11/27      avgLoss = (1/9*2 + 1)/3 = 11/27
   *   RS = 1                             RSI = 50
   * index 6 (+0.8):
   *   avgGain = (11/27*2 + 0.8)/3 = 218/405
   *   avgLoss = (11/27*2 + 0)/3   = 110/405
   *   RS = 218/110                       RSI = 100 - 11000/328 = 66.463415
   */
  it('matches a hand-computed Wilder series', () => {
    const result = rsi([10, 11, 10.5, 11.5, 12, 11, 11.8], 3);

    expect(result).toHaveLength(7);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]).toBeNull();
    expect(result[3] as number).toBeCloseTo(80, 10);
    expect(result[4] as number).toBeCloseTo(84.615385, 6);
    expect(result[5] as number).toBeCloseTo(50, 10);
    expect(result[6] as number).toBeCloseTo(66.463415, 6);
  });

  it('places the first value at index period (needs period + 1 closes)', () => {
    const closes = Array.from({ length: 16 }, (_, i) => 100 + (i % 2 === 0 ? i : -i));

    const result = rsi(closes, 14);

    for (let i = 0; i < 14; i += 1) expect(result[i]).toBeNull();
    expect(result[14]).not.toBeNull();
    expect(result[15]).not.toBeNull();
  });

  it('pins to 100 when there are no losses', () => {
    const rising = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(rsi(rising, 14)[19]).toBe(100);
  });

  it('pins to 0 when there are no gains', () => {
    const falling = Array.from({ length: 20 }, (_, i) => 100 - i);
    expect(rsi(falling, 14)[19]).toBe(0);
  });

  it('reads 50 on a perfectly flat series rather than 100', () => {
    // Zero losses would naively imply "maximum strength"; on a flat series
    // that is meaningless, so the neutral reading is correct.
    const flat = new Array(20).fill(2400) as number[];
    expect(rsi(flat, 14)[19]).toBe(50);
  });

  it('stays within 0-100 on realistic data', () => {
    const closes = [
      2401.5, 2408.2, 2399.7, 2412.4, 2418.9, 2411.3, 2425.6, 2431.2, 2422.8, 2416.4,
      2428.1, 2439.5, 2444.2, 2436.7, 2448.3, 2455.1, 2441.9, 2433.6, 2447.2, 2459.8,
      2452.3, 2464.7, 2471.1, 2458.9, 2466.4,
    ];

    for (const value of rsi(closes, 14)) {
      if (value === null) continue;
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('returns all nulls when there is not enough data', () => {
    expect(rsi([1, 2, 3], 3)).toEqual([null, null, null]);
    expect(rsi([], 14)).toEqual([]);
  });

  it('rejects an invalid period', () => {
    expect(() => rsi([1, 2, 3], 0)).toThrow(/positive integer/);
    expect(() => rsi([1, 2, 3], 1.5)).toThrow(/positive integer/);
  });
});

describe('rsiZone', () => {
  it('classifies against the 70/30 thresholds', () => {
    expect(rsiZone(72)).toBe('overbought');
    expect(rsiZone(70)).toBe('overbought');
    expect(rsiZone(50)).toBe('neutral');
    expect(rsiZone(30)).toBe('oversold');
    expect(rsiZone(12)).toBe('oversold');
  });

  it('honours custom thresholds', () => {
    expect(rsiZone(62, 60, 40)).toBe('overbought');
    expect(rsiZone(62)).toBe('neutral');
  });

  it('passes null through for a series that has not warmed up', () => {
    expect(rsiZone(null)).toBeNull();
  });
});
