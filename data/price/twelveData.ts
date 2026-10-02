import {
  PriceAdapterError,
  type Candle,
  type CandleRequest,
  type PriceAdapter,
  type Timeframe,
} from '../types';
import { normalizeCandlesStrict, parseNumber, parseUtcTimestamp } from '../normalize';

/**
 * Twelve Data price adapter (https://twelvedata.com).
 *
 * Free tier: 8 requests/minute, 800/day — so cache aggressively upstream and
 * never call this in a loop. Returns XAU/USD spot OHLC.
 *
 * `fetchImpl` is injectable purely so tests never touch the network.
 */

const DEFAULT_BASE_URL = 'https://api.twelvedata.com';

/** Our timeframe → Twelve Data's `interval` parameter. */
const INTERVAL_BY_TIMEFRAME: Record<Timeframe, string> = {
  M15: '15min',
  H1: '1h',
  H4: '4h',
  D1: '1day',
};

export interface TwelveDataConfig {
  apiKey: string;
  /** Provider symbol. Twelve Data uses a slash: "XAU/USD". */
  symbol?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Abort the request after this many ms. */
  timeoutMs?: number;
}

interface TwelveDataValue {
  datetime?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
  volume?: unknown;
}

interface TwelveDataResponse {
  status?: unknown;
  code?: unknown;
  message?: unknown;
  values?: unknown;
}

export class TwelveDataAdapter implements PriceAdapter {
  readonly name = 'twelvedata';
  readonly symbol: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: TwelveDataConfig) {
    if (!config.apiKey) {
      throw new PriceAdapterError('twelvedata', 'apiKey is required (set TWELVE_DATA_API_KEY)');
    }
    this.apiKey = config.apiKey;
    this.symbol = config.symbol ?? 'XAU/USD';
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = config.timeoutMs ?? 10_000;

    if (typeof this.fetchImpl !== 'function') {
      throw new PriceAdapterError('twelvedata', 'no fetch implementation available');
    }
  }

  /** Build the request URL. Exposed for assertions in tests. */
  buildUrl(request: CandleRequest): string {
    // Annotated as possibly undefined on purpose: `timeframe` can arrive from
    // an untyped boundary such as a query string, so the lookup really can miss.
    const interval: string | undefined = INTERVAL_BY_TIMEFRAME[request.timeframe];
    if (interval === undefined) {
      throw new PriceAdapterError('twelvedata', `unsupported timeframe "${request.timeframe}"`);
    }

    const params = new URLSearchParams({
      symbol: request.symbol ?? this.symbol,
      interval,
      outputsize: String(Math.min(Math.max(request.limit ?? 300, 1), 5000)),
      timezone: 'UTC',
      order: 'ASC',
      format: 'JSON',
      apikey: this.apiKey,
    });

    return `${this.baseUrl}/time_series?${params.toString()}`;
  }

  async fetchCandles(request: CandleRequest): Promise<Candle[]> {
    const url = this.buildUrl(request);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { accept: 'application/json' },
      });
    } catch (error) {
      throw new PriceAdapterError('twelvedata', 'network request failed', { cause: error });
    }

    // HTTP-level rate limiting.
    if (response.status === 429) {
      throw new PriceAdapterError('twelvedata', 'rate limit exceeded (HTTP 429)', {
        rateLimited: true,
      });
    }

    let body: TwelveDataResponse;
    try {
      body = (await response.json()) as TwelveDataResponse;
    } catch (error) {
      throw new PriceAdapterError('twelvedata', 'response was not valid JSON', { cause: error });
    }

    // Twelve Data reports application errors in a 200 body, so check the
    // payload regardless of HTTP status.
    if (body.status === 'error' || typeof body.code === 'number') {
      const code = typeof body.code === 'number' ? body.code : response.status;
      const message = typeof body.message === 'string' ? body.message : 'unknown provider error';
      throw new PriceAdapterError('twelvedata', `provider error ${code}: ${message}`, {
        rateLimited: code === 429,
      });
    }

    if (!response.ok) {
      throw new PriceAdapterError('twelvedata', `HTTP ${response.status}`);
    }

    if (!Array.isArray(body.values)) {
      throw new PriceAdapterError('twelvedata', 'response is missing a "values" array');
    }

    const candles = (body.values as TwelveDataValue[]).map((value, index) =>
      mapValue(value, index),
    );

    return normalizeCandlesStrict(candles, request.limit);
  }
}

function mapValue(value: TwelveDataValue, index: number): Candle {
  try {
    if (typeof value?.datetime !== 'string') {
      throw new Error('datetime is missing or not a string');
    }

    const candle: Candle = {
      time: parseUtcTimestamp(value.datetime),
      open: parseNumber(value.open, 'open'),
      high: parseNumber(value.high, 'high'),
      low: parseNumber(value.low, 'low'),
      close: parseNumber(value.close, 'close'),
    };

    // Spot gold usually has no volume; only attach it when real.
    if (value.volume !== undefined && value.volume !== null && value.volume !== '') {
      const volume = Number(value.volume);
      if (Number.isFinite(volume) && volume > 0) candle.volume = volume;
    }

    return candle;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new PriceAdapterError('twelvedata', `malformed bar at values[${index}]: ${reason}`, {
      cause: error,
    });
  }
}
