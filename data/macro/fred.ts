import type { MacroInstrument, MacroReading } from '../types';
import { parseUtcTimestamp } from '../normalize';

const DEFAULT_FRED_URL = 'https://api.stlouisfed.org/fred/series/observations';

interface FredObservation {
  date?: unknown;
  value?: unknown;
}

interface FredResponse {
  error_code?: unknown;
  error_message?: unknown;
  observations?: unknown;
}

export interface FredAdapterConfig {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class FredMacroAdapter {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: FredAdapterConfig) {
    if (config.apiKey.trim() === '') throw new Error('FredMacroAdapter requires an apiKey');
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? DEFAULT_FRED_URL;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  async fetchLatestPair(seriesId: string): Promise<{ latest: { time: number; value: number }; previous: { time: number; value: number } }> {
    const url = new URL(this.baseUrl);
    url.searchParams.set('series_id', seriesId);
    url.searchParams.set('api_key', this.apiKey);
    url.searchParams.set('file_type', 'json');
    url.searchParams.set('sort_order', 'desc');
    url.searchParams.set('limit', '10');
    const response = await this.fetchImpl(url.toString(), {
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: { accept: 'application/json' },
    });
    const body = await response.json().catch(() => null) as FredResponse | null;
    if (body === null || typeof body !== 'object') throw new Error(`${seriesId}: FRED returned non-JSON (HTTP ${response.status})`);
    if (!response.ok || body.error_code !== undefined) {
      const message = typeof body.error_message === 'string' ? body.error_message : `HTTP ${response.status}`;
      throw new Error(`${seriesId}: FRED ${message}`);
    }
    if (!Array.isArray(body.observations)) throw new Error(`${seriesId}: FRED response contained no observations array`);

    const valid = body.observations
      .map(parseObservation)
      .filter((observation): observation is { time: number; value: number } => observation !== null)
      .sort((left, right) => right.time - left.time);
    const latest = valid[0];
    const previous = valid[1];
    if (latest === undefined || previous === undefined) {
      throw new Error(`${seriesId}: fewer than two numeric observations in the latest 10 records`);
    }
    return { latest, previous };
  }

  async fetchUs10y(): Promise<MacroReading> {
    const { latest, previous } = await this.fetchLatestPair('DGS10');
    const changeAbsolute = latest.value - previous.value;
    return {
      instrument: 'US10Y',
      symbol: 'DGS10',
      source: 'FRED DGS10',
      last: latest.value,
      reference: previous.value,
      changeAbsolute,
      changePercent: previous.value === 0 ? 0 : (changeAbsolute / Math.abs(previous.value)) * 100,
      asOf: latest.time,
      lookbackBars: 1,
    };
  }

  async fetchBroadDollarProxy(): Promise<MacroReading> {
    const { latest, previous } = await this.fetchLatestPair('DTWEXBGS');
    const changeAbsolute = latest.value - previous.value;
    return {
      instrument: 'USD_PROXY' satisfies MacroInstrument,
      symbol: 'DTWEXBGS',
      source: 'FRED DTWEXBGS (broad dollar index)',
      last: latest.value,
      reference: previous.value,
      changeAbsolute,
      changePercent: previous.value === 0 ? 0 : (changeAbsolute / Math.abs(previous.value)) * 100,
      asOf: latest.time,
      lookbackBars: 1,
    };
  }
}

export function parseObservation(value: unknown): { time: number; value: number } | null {
  if (value === null || typeof value !== 'object') return null;
  const observation = value as FredObservation;
  if (typeof observation.date !== 'string' || typeof observation.value !== 'string') return null;
  if (observation.value.trim() === '.' || observation.value.trim() === '') return null;
  const parsed = Number(observation.value);
  if (!Number.isFinite(parsed)) return null;
  try {
    return { time: parseUtcTimestamp(observation.date), value: parsed };
  } catch {
    return null;
  }
}