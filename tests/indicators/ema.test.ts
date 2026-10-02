import { ema, latest, sma, wilderSmooth } from '../../indicators/ema';

describe('sma', () => {
  it('averages a trailing window, first value at index period - 1', () => {
    // (1+2+3)/3=2, (2+3+4)/3=3, (3+4+5)/3=4
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('returns all nulls when there is not enough data', () => {
    expect(sma([1, 2], 3)).toEqual([null, null]);
  });

  it('handles an empty series', () => {
    expect(sma([], 14)).toEqual([]);
  });
});

describe('ema', () => {
  it('matches a hand-computed series (SMA seed, k = 2/(period+1))', () => {
    // period 3 -> k = 0.5, seed = SMA(1,2,3) = 2
    //   i=3: 4*0.5 + 2*0.5 = 3
    //   i=4: 5*0.5 + 3*0.5 = 4
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('is aligned to the input: length is preserved and warm-up is null', () => {
    const closes = [10, 11, 12, 13, 14, 15, 16];
    const result = ema(closes, 5);

    expect(result).toHaveLength(closes.length);
    for (let i = 0; i < 4; i += 1) expect(result[i]).toBeNull();
    expect(result[4]).toBe(12); // SMA(10..14)
  });

  it('degenerates to the raw series when period is 1', () => {
    expect(ema([3, 7, 2], 1)).toEqual([3, 7, 2]);
  });

  it('leaves a constant series unchanged', () => {
    // Asserted with a tolerance rather than toEqual: k = 2/3 is not exactly
    // representable in binary floating point, so insisting on an exact 5 would
    // be testing IEEE 754 rounding rather than the indicator.
    const result = ema([5, 5, 5, 5], 2);

    expect(result[0]).toBeNull();
    for (let i = 1; i < result.length; i += 1) {
      expect(result[i] as number).toBeCloseTo(5, 10);
    }
  });

  it('returns all nulls when there is not enough data', () => {
    expect(ema([1, 2], 3)).toEqual([null, null]);
    expect(ema([], 3)).toEqual([]);
  });

  it('reacts to a step change faster than the SMA', () => {
    // Note: a straight linear ramp is NOT a valid test of this. On a constant
    // slope both averages settle at exactly the same lag of (period-1)/2, so
    // they converge and the comparison is a coin flip on floating-point noise.
    // A step change is what actually separates them.
    const stepUp = [...new Array(30).fill(100), ...new Array(5).fill(110)] as number[];

    const emaUp = latest(ema(stepUp, 10)) as number;
    const smaUp = latest(sma(stepUp, 10)) as number;

    expect(smaUp).toBeCloseTo(105, 10); // 5 bars at 110, 5 still at 100
    expect(emaUp).toBeGreaterThan(smaUp);
    expect(emaUp).toBeLessThan(110); // still lagging; it has not caught up

    // Symmetrically on the way down.
    const stepDown = [...new Array(30).fill(110), ...new Array(5).fill(100)] as number[];

    const emaDown = latest(ema(stepDown, 10)) as number;
    const smaDown = latest(sma(stepDown, 10)) as number;

    expect(emaDown).toBeLessThan(smaDown);
    expect(emaDown).toBeGreaterThan(100);
  });

  it('rejects a non-positive or fractional period', () => {
    expect(() => ema([1, 2, 3], 0)).toThrow(/positive integer/);
    expect(() => ema([1, 2, 3], -5)).toThrow(/positive integer/);
    expect(() => ema([1, 2, 3], 2.5)).toThrow(/positive integer/);
  });
});

describe('wilderSmooth', () => {
  it('matches a hand-computed series', () => {
    // period 2 -> seed = (1+2)/2 = 1.5 at index 1
    //   i=2: (1.5*1 + 3)/2 = 2.25
    expect(wilderSmooth([1, 2, 3], 2)).toEqual([null, 1.5, 2.25]);
  });

  it('smooths more slowly than an EMA of the same period', () => {
    // Wilder uses k = 1/period vs the EMA's 2/(period+1), so after a step up
    // the Wilder average sits below the EMA.
    const step = [10, 10, 10, 10, 20, 20, 20];

    const wilderLast = latest(wilderSmooth(step, 3)) as number;
    const emaLast = latest(ema(step, 3)) as number;

    expect(wilderLast).toBeLessThan(emaLast);
  });
});

describe('latest', () => {
  it('returns the last defined value', () => {
    expect(latest([null, 1, 2])).toBe(2);
  });

  it('skips trailing nulls', () => {
    expect(latest([null, 7, null])).toBe(7);
  });

  it('returns null for a series that never warmed up', () => {
    expect(latest([null, null])).toBeNull();
    expect(latest([])).toBeNull();
  });
});
