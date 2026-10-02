import type { Candle } from '../../data/types';
import {
  normalizeCandles,
  normalizeCandlesStrict,
  parseNumber,
  parseUtcTimestamp,
  validateCandle,
} from '../../data/normalize';
import { candleAt } from '../helpers';

describe('validateCandle', () => {
  it('accepts a coherent bar', () => {
    expect(validateCandle(candleAt(0, { open: 2400, high: 2405, low: 2398, close: 2402 }))).toBeNull();
  });

  it('rejects a high below the low', () => {
    const bad = candleAt(0, { open: 2400, high: 2390, low: 2398, close: 2395 });
    expect(validateCandle(bad)).toMatch(/high .* is below low/);
  });

  it('rejects a high below the open or close', () => {
    const bad = candleAt(0, { open: 2400, high: 2399, low: 2390, close: 2395 });
    expect(validateCandle(bad)).toMatch(/below open\/close/);
  });

  it('rejects a low above the open or close', () => {
    const bad = candleAt(0, { open: 2400, high: 2410, low: 2405, close: 2402 });
    expect(validateCandle(bad)).toMatch(/above open\/close/);
  });

  it('rejects non-finite prices', () => {
    const bad = { time: 1_700_000_000, open: 2400, high: Number.NaN, low: 2390, close: 2395 };
    expect(validateCandle(bad)).toMatch(/not a finite number/);
  });

  it('catches a millisecond timestamp passed as seconds', () => {
    // The single most likely integration bug, so it gets its own guard.
    const bad = { time: 1_759_276_800_000, open: 2400, high: 2405, low: 2398, close: 2402 };
    expect(validateCandle(bad)).toMatch(/looks like milliseconds/);
  });

  it('rejects non-positive prices', () => {
    const bad = { time: 1_700_000_000, open: 0, high: 1, low: 0, close: 1 };
    expect(validateCandle(bad)).toMatch(/positive/);
  });
});

describe('normalizeCandles', () => {
  it('sorts bars oldest to newest', () => {
    const shuffled = [
      candleAt(2, { open: 2402, high: 2406, low: 2400, close: 2404 }),
      candleAt(0, { open: 2400, high: 2403, low: 2398, close: 2401 }),
      candleAt(1, { open: 2401, high: 2404, low: 2399, close: 2402 }),
    ];

    const { candles } = normalizeCandles(shuffled);

    expect(candles.map((candle) => candle.time)).toEqual([
      shuffled[1]?.time,
      shuffled[2]?.time,
      shuffled[0]?.time,
    ]);
  });

  it('de-duplicates by open time, keeping the last occurrence', () => {
    // Providers re-send the currently-forming bar; the newer copy must win.
    const stale = candleAt(0, { open: 2400, high: 2403, low: 2398, close: 2401 });
    const fresh = candleAt(0, { open: 2400, high: 2409, low: 2398, close: 2408 });

    const { candles } = normalizeCandles([stale, fresh]);

    expect(candles).toHaveLength(1);
    expect(candles[0]?.close).toBe(2408);
    expect(candles[0]?.high).toBe(2409);
  });

  it('throws on a malformed bar by default', () => {
    const bad = candleAt(1, { open: 2400, high: 2390, low: 2398, close: 2395 });

    expect(() => normalizeCandles([bad])).toThrow(/Invalid candle at index 0/);
  });

  it('can drop malformed bars instead, reporting what it dropped', () => {
    const good = candleAt(0, { open: 2400, high: 2403, low: 2398, close: 2401 });
    const bad = candleAt(1, { open: 2400, high: 2390, low: 2398, close: 2395 });

    const { candles, dropped } = normalizeCandles([good, bad], { onInvalid: 'drop' });

    expect(candles).toHaveLength(1);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.index).toBe(1);
    expect(dropped[0]?.reason).toMatch(/high/);
  });

  it('trims to the newest N bars', () => {
    const series: Candle[] = Array.from({ length: 10 }, (_, i) =>
      candleAt(i, { open: 2400 + i, high: 2405 + i, low: 2395 + i, close: 2401 + i }),
    );

    const { candles } = normalizeCandles(series, { limit: 3 });

    expect(candles).toHaveLength(3);
    expect(candles.map((candle) => candle.close)).toEqual([2408, 2409, 2410]);
  });

  it('leaves a shorter series alone when a limit is given', () => {
    const series = [candleAt(0, { open: 2400, high: 2403, low: 2398, close: 2401 })];
    expect(normalizeCandlesStrict(series, 50)).toHaveLength(1);
  });

  it('handles an empty input', () => {
    expect(normalizeCandlesStrict([])).toEqual([]);
  });
});

describe('parseUtcTimestamp', () => {
  it('treats a bare datetime as UTC, not local time', () => {
    // If this ever parsed as local time, every news-window and session check
    // would silently shift by the host machine's offset.
    expect(parseUtcTimestamp('2026-09-18 23:00:00')).toBe(
      Date.UTC(2026, 8, 18, 23, 0, 0) / 1000,
    );
  });

  it('accepts a date-only value as midnight UTC', () => {
    expect(parseUtcTimestamp('2026-09-18')).toBe(Date.UTC(2026, 8, 18) / 1000);
  });

  it('accepts ISO form with a T separator and an explicit Z', () => {
    expect(parseUtcTimestamp('2026-09-18T23:00:00Z')).toBe(
      Date.UTC(2026, 8, 18, 23, 0, 0) / 1000,
    );
  });

  it('honours an explicit offset', () => {
    expect(parseUtcTimestamp('2026-09-18T18:00:00-05:00')).toBe(
      Date.UTC(2026, 8, 18, 23, 0, 0) / 1000,
    );
  });

  it('returns whole seconds, not milliseconds', () => {
    expect(parseUtcTimestamp('1970-01-01 00:00:01')).toBe(1);
  });

  it('throws on unparseable input', () => {
    expect(() => parseUtcTimestamp('not a date')).toThrow(/Unparseable timestamp/);
  });
});

describe('parseNumber', () => {
  it('accepts numbers and numeric strings', () => {
    expect(parseNumber(2400.5, 'open')).toBe(2400.5);
    expect(parseNumber('2400.5', 'open')).toBe(2400.5);
    expect(parseNumber('  2400.5  ', 'open')).toBe(2400.5);
  });

  it('rejects empty, null, and non-numeric values', () => {
    expect(() => parseNumber('', 'open')).toThrow(/open is not a number/);
    expect(() => parseNumber(null, 'high')).toThrow(/high is not a number/);
    expect(() => parseNumber(undefined, 'low')).toThrow(/low is not a number/);
    expect(() => parseNumber('abc', 'close')).toThrow(/close is not a number/);
  });

  it('rejects non-finite numbers', () => {
    expect(() => parseNumber(Number.NaN, 'open')).toThrow(/not finite/);
    expect(() => parseNumber(Number.POSITIVE_INFINITY, 'open')).toThrow(/not finite/);
  });
});
