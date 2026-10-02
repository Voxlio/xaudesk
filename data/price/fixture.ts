import {
  PriceAdapterError,
  type Candle,
  type CandleRequest,
  type PriceAdapter,
  type Timeframe,
} from '../types';
import { normalizeCandlesStrict, parseNumber, parseUtcTimestamp } from '../normalize';

/**
 * Fixture price adapter: serves candles from CSV (or an in-memory array).
 *
 * This is the adapter tests and offline development run against. Because the
 * fixture CSVs are generated from a fixed seed, results are reproducible —
 * which is also what makes it a usable baseline for /backtest.
 */

/** Maps a timeframe to its fixture filename in data/fixtures. */
export const FIXTURE_FILES: Record<Timeframe, string> = {
  M15: 'xauusd-m15.csv',
  H1: 'xauusd-h1.csv',
  H4: 'xauusd-h4.csv',
  D1: 'xauusd-d1.csv',
};

const REQUIRED_COLUMNS = ['time', 'open', 'high', 'low', 'close'] as const;

/**
 * Parse `time,open,high,low,close[,volume]` CSV.
 *
 * `time` may be a UTC datetime ("2026-09-18 23:00:00", "2026-09-18") or a raw
 * unix-seconds integer. Blank lines and `#` comments are ignored.
 */
export function parseCandleCsv(text: string): Candle[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

  const headerLine = lines.shift();
  if (headerLine === undefined) throw new Error('CSV is empty');

  const header = headerLine.split(',').map((column) => column.trim().toLowerCase());
  for (const column of REQUIRED_COLUMNS) {
    if (!header.includes(column)) {
      throw new Error(`CSV is missing required column "${column}" (header: ${headerLine})`);
    }
  }

  const indexOf = (column: string): number => header.indexOf(column);
  const columnIndex = {
    time: indexOf('time'),
    open: indexOf('open'),
    high: indexOf('high'),
    low: indexOf('low'),
    close: indexOf('close'),
    volume: indexOf('volume'),
  };

  return lines.map((line, row) => {
    const cells = line.split(',').map((cell) => cell.trim());

    const cell = (index: number, field: string): string => {
      const value = cells[index];
      if (value === undefined || value === '') {
        throw new Error(`CSV row ${row + 2}: missing ${field}`);
      }
      return value;
    };

    try {
      const rawTime = cell(columnIndex.time, 'time');
      const candle: Candle = {
        time: /^\d+$/.test(rawTime) ? Number(rawTime) : parseUtcTimestamp(rawTime),
        open: parseNumber(cell(columnIndex.open, 'open'), 'open'),
        high: parseNumber(cell(columnIndex.high, 'high'), 'high'),
        low: parseNumber(cell(columnIndex.low, 'low'), 'low'),
        close: parseNumber(cell(columnIndex.close, 'close'), 'close'),
      };

      if (columnIndex.volume !== -1) {
        const rawVolume = cells[columnIndex.volume];
        if (rawVolume !== undefined && rawVolume !== '') {
          const volume = Number(rawVolume);
          if (Number.isFinite(volume) && volume > 0) candle.volume = volume;
        }
      }

      return candle;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`CSV row ${row + 2}: ${reason}`);
    }
  });
}

export interface FixtureAdapterConfig {
  /** Pre-parsed candles per timeframe. */
  candles: Partial<Record<Timeframe, readonly Candle[]>>;
  symbol?: string;
  name?: string;
}

export class FixturePriceAdapter implements PriceAdapter {
  readonly name: string;
  readonly symbol: string;

  private readonly candles: Map<Timeframe, Candle[]>;

  constructor(config: FixtureAdapterConfig) {
    this.name = config.name ?? 'fixture';
    this.symbol = config.symbol ?? 'XAUUSD';
    this.candles = new Map();

    for (const [timeframe, series] of Object.entries(config.candles)) {
      if (series === undefined) continue;
      // Normalize up front so a hand-edited fixture fails loudly at construction
      // rather than halfway through a backtest.
      this.candles.set(timeframe as Timeframe, normalizeCandlesStrict(series));
    }
  }

  /** Build an adapter from raw CSV text keyed by timeframe. */
  static fromCsv(
    sources: Partial<Record<Timeframe, string>>,
    options: { symbol?: string; name?: string } = {},
  ): FixturePriceAdapter {
    const candles: Partial<Record<Timeframe, Candle[]>> = {};
    for (const [timeframe, text] of Object.entries(sources)) {
      if (text === undefined) continue;
      candles[timeframe as Timeframe] = parseCandleCsv(text);
    }
    return new FixturePriceAdapter({ candles, ...options });
  }

  availableTimeframes(): Timeframe[] {
    return [...this.candles.keys()];
  }

  async fetchCandles(request: CandleRequest): Promise<Candle[]> {
    const series = this.candles.get(request.timeframe);
    if (series === undefined) {
      throw new PriceAdapterError(
        this.name,
        `no fixture loaded for timeframe "${request.timeframe}" ` +
          `(have: ${this.availableTimeframes().join(', ') || 'none'})`,
      );
    }

    const { limit } = request;
    if (typeof limit === 'number' && limit >= 0 && series.length > limit) {
      return series.slice(series.length - limit);
    }
    return [...series];
  }
}

/**
 * Load every fixture CSV from disk. Node-only (uses node:fs), so call it from
 * server code, scripts, or tests — never from a client component.
 */
export async function createFixtureAdapterFromDisk(
  directory?: string,
): Promise<FixturePriceAdapter> {
  const [{ readFile }, { dirname, join }, { fileURLToPath }] = await Promise.all([
    import('node:fs/promises'),
    import('node:path'),
    import('node:url'),
  ]);

  const baseDir = directory ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

  const sources: Partial<Record<Timeframe, string>> = {};
  await Promise.all(
    (Object.keys(FIXTURE_FILES) as Timeframe[]).map(async (timeframe) => {
      const file = join(baseDir, FIXTURE_FILES[timeframe]);
      try {
        sources[timeframe] = await readFile(file, 'utf8');
      } catch (error) {
        throw new PriceAdapterError('fixture', `could not read ${file}`, { cause: error });
      }
    }),
  );

  return FixturePriceAdapter.fromCsv(sources);
}
