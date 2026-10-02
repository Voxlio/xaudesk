import type { MacroReading } from '../types';
import { parseNumber, parseUtcTimestamp } from '../normalize';

const DEFAULT_BASE_URL = 'https://api.twelvedata.com';

interface TwelveDataValue {
  datetime?: unknown;
  close?: unknown;
}

interface TwelveDataSeries {
  status?: unknown;
  message?: unknown;
  values?: unknown;
}

export interface TwelveDataUsdProxyConfig {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class TwelveDataUsdProxyAdapter {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: TwelveDataUsdProxyConfig) {
    if (config.apiKey.trim() === '') throw new Error('TwelveDataUsdProxyAdapter requires an apiKey');
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  async fetchUup(): Promise<MacroReading> {
    const url = new URL('/time_series', this.baseUrl);
    url.searchParams.set('symbol', 'UUP');
    url.searchParams.set('interval', '1day');
    url.searchParams.set('outputsize', '2');
    url.searchParams.set('timezone', 'UTC');
    url.searchParams.set('order', 'DESC');
    url.searchParams.set('apikey', this.apiKey);
    const response = await this.fetchImpl(url.toString(), {
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: { accept: 'application/json' },
    });
    const body = await response.json().catch(() => null) as TwelveDataSeries | null;
    if (body === null || typeof body !== 'object') throw new Error(`UUP: non-JSON response (HTTP ${response.status})`);
    if (!response.ok || body.status === 'error') {
      throw new Error(`UUP: ${typeof body.message === 'string' ? body.message : `HTTP ${response.status}`}`);
    }
    if (!Array.isArray(body.values)) throw new Error('UUP: response contained no values array');

    const values = body.values
      .map(parseTwelveDataValue)
      .filter((item): item is { time: number; value: number } => item !== null)
      .sort((left, right) => right.time - left.time);
    const latest = values[0];
    const previous = values[1];
    if (latest === undefined || previous === undefined) throw new Error(`UUP: need two daily closes, got ${values.length}`);
    if (previous.value === 0) throw new Error('UUP: previous daily close is zero');

    return {
      instrument: 'USD_PROXY',
      symbol: 'UUP',
      source: 'Twelve Data UUP ETF',
      last: latest.value,
      reference: previous.value,
      changeAbsolute: latest.value - previous.value,
      changePercent: ((latest.value - previous.value) / Math.abs(previous.value)) * 100,
      asOf: latest.time,
      lookbackBars: 1,
    };
  }
}

function parseTwelveDataValue(item: unknown): { time: number; value: number } | null {
  if (item === null || typeof item !== 'object') return null;
  const value = item as TwelveDataValue;
  try {
    return {
      time: parseUtcTimestamp(String(value.datetime)),
      value: parseNumber(value.close, 'UUP close'),
    };
  } catch {
    return null;
  }
}