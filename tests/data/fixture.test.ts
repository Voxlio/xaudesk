import { PriceAdapterError, TIMEFRAMES, type Timeframe } from '../../data/types';
import { validateCandle } from '../../data/normalize';
import {
  FixturePriceAdapter,
  createFixtureAdapterFromDisk,
  parseCandleCsv,
} from '../../data/price/fixture';
import { atr } from '../../indicators/atr';
import { ema, latest } from '../../indicators/ema';
import { rsi } from '../../indicators/rsi';
import { analyzeStructure } from '../../indicators/structure';
import { captureError } from '../helpers';

const CSV = `time,open,high,low,close
2026-09-18 00:00:00,2400.00,2403.50,2399.00,2402.00
2026-09-18 01:00:00,2402.00,2405.50,2401.00,2404.00
2026-09-18 02:00:00,2404.00,2409.50,2403.00,2408.00
`;

describe('parseCandleCsv', () => {
  it('parses a well-formed file', () => {
    const candles = parseCandleCsv(CSV);

    expect(candles).toHaveLength(3);
    expect(candles[0]?.time).toBe(Date.UTC(2026, 8, 18, 0, 0, 0) / 1000);
    expect(candles[0]?.open).toBe(2400);
    expect(candles[2]?.close).toBe(2408);
  });

  it('reads columns by name, not by position', () => {
    const reordered = `close,time,low,open,high
2402.00,2026-09-18 00:00:00,2399.00,2400.00,2403.50
`;

    const candles = parseCandleCsv(reordered);

    expect(candles[0]?.open).toBe(2400);
    expect(candles[0]?.high).toBe(2403.5);
    expect(candles[0]?.low).toBe(2399);
    expect(candles[0]?.close).toBe(2402);
  });

  it('accepts a raw unix-seconds timestamp', () => {
    const csv = 'time,open,high,low,close\n1758153600,2400,2403,2399,2402\n';
    expect(parseCandleCsv(csv)[0]?.time).toBe(1_758_153_600);
  });

  it('picks up an optional volume column', () => {
    const csv = 'time,open,high,low,close,volume\n2026-09-18,2400,2403,2399,2402,1200\n';
    expect(parseCandleCsv(csv)[0]?.volume).toBe(1200);
  });

  it('ignores blank lines and # comments', () => {
    const csv = `# XAU/USD H1
time,open,high,low,close

2026-09-18 00:00:00,2400,2403,2399,2402

`;
    expect(parseCandleCsv(csv)).toHaveLength(1);
  });

  it('rejects a file missing a required column', () => {
    const csv = 'time,open,high,close\n2026-09-18,2400,2403,2402\n';
    expect(() => parseCandleCsv(csv)).toThrow(/missing required column "low"/);
  });

  it('rejects an empty file', () => {
    expect(() => parseCandleCsv('')).toThrow(/CSV is empty/);
  });

  it('names the offending line number on a bad row', () => {
    const csv = 'time,open,high,low,close\n2026-09-18,2400,2403,2399,oops\n';
    // Row 2 of the file: header is row 1.
    expect(() => parseCandleCsv(csv)).toThrow(/CSV row 2/);
  });

  it('reports a missing cell rather than coercing it to zero', () => {
    const csv = 'time,open,high,low,close\n2026-09-18,2400,2403,,2402\n';
    expect(() => parseCandleCsv(csv)).toThrow(/missing low/);
  });
});

describe('FixturePriceAdapter', () => {
  const build = (): FixturePriceAdapter => FixturePriceAdapter.fromCsv({ H1: CSV });

  it('serves the configured timeframe', async () => {
    const candles = await build().fetchCandles({ timeframe: 'H1' });

    expect(candles).toHaveLength(3);
    expect(candles.map((candle) => candle.close)).toEqual([2402, 2404, 2408]);
  });

  it('returns the newest N bars when a limit is given', async () => {
    const candles = await build().fetchCandles({ timeframe: 'H1', limit: 2 });

    expect(candles.map((candle) => candle.close)).toEqual([2404, 2408]);
  });

  it('reports which timeframes it holds', () => {
    expect(build().availableTimeframes()).toEqual(['H1']);
  });

  it('errors helpfully for a timeframe it was not given', async () => {
    const error = await captureError(build().fetchCandles({ timeframe: 'D1' }));

    expect(error).toBeInstanceOf(PriceAdapterError);
    expect(error.message).toMatch(/no fixture loaded for timeframe "D1"/);
    expect(error.message).toMatch(/have: H1/);
  });

  it('fails at construction time on a malformed fixture', () => {
    // A hand-edited fixture should blow up immediately, not midway through a
    // backtest run.
    const broken = `time,open,high,low,close
2026-09-18 00:00:00,2400,2390,2399,2395
`;
    expect(() => FixturePriceAdapter.fromCsv({ H1: broken })).toThrow(/Invalid candle/);
  });

  it('sorts and de-duplicates whatever it is handed', async () => {
    const messy = `time,open,high,low,close
2026-09-18 02:00:00,2404,2409.5,2403,2408
2026-09-18 00:00:00,2400,2403.5,2399,2402
2026-09-18 02:00:00,2404,2411.0,2403,2410
`;

    const candles = await FixturePriceAdapter.fromCsv({ H1: messy }).fetchCandles({
      timeframe: 'H1',
    });

    expect(candles).toHaveLength(2);
    expect(candles.map((candle) => candle.close)).toEqual([2402, 2410]);
  });

  it('hands back a copy, so a caller cannot corrupt the fixture', async () => {
    const instance = build();

    const first = await instance.fetchCandles({ timeframe: 'H1' });
    first.pop();
    const second = await instance.fetchCandles({ timeframe: 'H1' });

    expect(second).toHaveLength(3);
  });
});

describe('fixture files on disk', () => {
  it('loads every timeframe', async () => {
    const instance = await createFixtureAdapterFromDisk();

    expect(instance.availableTimeframes().sort()).toEqual([...TIMEFRAMES].sort());
  });

  it('contains only valid, strictly ascending bars', async () => {
    const instance = await createFixtureAdapterFromDisk();

    for (const timeframe of TIMEFRAMES) {
      const candles = await instance.fetchCandles({ timeframe });

      expect(candles.length).toBeGreaterThan(100);

      for (let i = 0; i < candles.length; i += 1) {
        const candle = candles[i];
        if (candle === undefined) throw new Error('unexpected hole in the series');
        expect(validateCandle(candle)).toBeNull();
        if (i > 0) {
          const previous = candles[i - 1];
          if (previous === undefined) throw new Error('unexpected hole in the series');
          expect(candle.time).toBeGreaterThan(previous.time);
        }
      }
    }
  });

  it('sits in a plausible price range for gold', async () => {
    const instance = await createFixtureAdapterFromDisk();
    const candles = await instance.fetchCandles({ timeframe: 'D1' });

    for (const candle of candles) {
      expect(candle.low).toBeGreaterThan(1000);
      expect(candle.high).toBeLessThan(5000);
    }
  });

  it('supports the full indicator set end to end', async () => {
    // The real point of this test: 200 bars of H1 is enough to warm up a
    // 200-EMA, and every indicator produces a usable value on real-shaped data.
    const instance = await createFixtureAdapterFromDisk();
    const candles = await instance.fetchCandles({ timeframe: 'H1' });
    const closes = candles.map((candle) => candle.close);

    const ema50 = latest(ema(closes, 50));
    const ema200 = latest(ema(closes, 200));
    const rsi14 = latest(rsi(closes, 14));
    const atr14 = latest(atr(candles, 14));
    const structure = analyzeStructure(candles, { lookback: 2 });

    const lastClose = closes.at(-1) as number;
    const lows = candles.map((candle) => candle.low);
    const highs = candles.map((candle) => candle.high);

    // A moving average must sit inside the range it averages.
    expect(ema50 as number).toBeGreaterThan(Math.min(...lows));
    expect(ema50 as number).toBeLessThan(Math.max(...highs));
    expect(ema200 as number).toBeGreaterThan(Math.min(...lows));
    expect(ema200 as number).toBeLessThan(Math.max(...highs));

    expect(rsi14 as number).toBeGreaterThan(0);
    expect(rsi14 as number).toBeLessThan(100);

    // ATR on H1 gold should be a few dollars, not cents and not hundreds.
    expect(atr14 as number).toBeGreaterThan(0);
    expect(atr14 as number).toBeLessThan(lastClose * 0.05);

    expect(structure.swingHighs.length).toBeGreaterThan(5);
    expect(structure.swingLows.length).toBeGreaterThan(5);
    expect(['uptrend', 'downtrend', 'range']).toContain(structure.trend);

    // The non-repainting invariant, checked against real data this time.
    for (const item of structure.breaks) {
      expect(item.index).toBeGreaterThanOrEqual(item.brokenSwing.confirmedAtIndex);
    }
  });

  it('warms up the 200-EMA only on timeframes with enough history', async () => {
    const instance = await createFixtureAdapterFromDisk();

    const shortSeries = await instance.fetchCandles({ timeframe: 'H1', limit: 150 });
    const closes = shortSeries.map((candle) => candle.close);

    expect(latest(ema(closes, 200))).toBeNull();
    expect(latest(ema(closes, 50))).not.toBeNull();
  });

  it('errors clearly when the fixture directory is wrong', async () => {
    const error = await captureError(createFixtureAdapterFromDisk('/definitely/not/here'));

    expect(error).toBeInstanceOf(PriceAdapterError);
    expect(error.message).toMatch(/could not read/);
  });
});

describe('timeframe guard', () => {
  it('lists exactly the timeframes the strategy uses', () => {
    const expected: Timeframe[] = ['M15', 'H1', 'H4', 'D1'];
    expect([...TIMEFRAMES]).toEqual(expected);
  });
});
