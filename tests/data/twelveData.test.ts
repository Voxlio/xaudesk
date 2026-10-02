import { PriceAdapterError } from '../../data/types';
import { TwelveDataAdapter } from '../../data/price/twelveData';
import { captureError } from '../helpers';

/**
 * Every test here injects a fake `fetch`, so the suite never touches the
 * network or burns the provider's 8-requests-per-minute free tier.
 */
interface FakeFetch {
  impl: typeof fetch;
  calls: string[];
}

function fakeFetch(body: unknown, options: { status?: number; raw?: string } = {}): FakeFetch {
  const calls: string[] = [];

  const impl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const payload = options.raw ?? JSON.stringify(body);
    return new Response(payload, {
      status: options.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  return { impl, calls };
}

function adapter(fetchImpl: typeof fetch): TwelveDataAdapter {
  return new TwelveDataAdapter({ apiKey: 'test-key', fetchImpl });
}

const OK_BODY = {
  meta: { symbol: 'XAU/USD', interval: '1h' },
  status: 'ok',
  values: [
    // Deliberately newest-first, which is Twelve Data's default ordering.
    { datetime: '2026-09-18 02:00:00', open: '2404.0', high: '2409.5', low: '2403.0', close: '2408.0' },
    { datetime: '2026-09-18 01:00:00', open: '2402.0', high: '2405.5', low: '2401.0', close: '2404.0' },
    { datetime: '2026-09-18 00:00:00', open: '2400.0', high: '2403.5', low: '2399.0', close: '2402.0' },
  ],
};

describe('TwelveDataAdapter construction', () => {
  it('requires an API key', () => {
    expect(() => new TwelveDataAdapter({ apiKey: '' })).toThrow(/apiKey is required/);
  });

  it('defaults to the XAU/USD symbol', () => {
    expect(adapter(fakeFetch(OK_BODY).impl).symbol).toBe('XAU/USD');
  });

  it('reports a stable adapter name for auditing', () => {
    expect(adapter(fakeFetch(OK_BODY).impl).name).toBe('twelvedata');
  });
});

describe('TwelveDataAdapter.buildUrl', () => {
  it('maps our timeframes onto provider intervals', () => {
    const instance = adapter(fakeFetch(OK_BODY).impl);

    expect(instance.buildUrl({ timeframe: 'M15' })).toContain('interval=15min');
    expect(instance.buildUrl({ timeframe: 'H1' })).toContain('interval=1h');
    expect(instance.buildUrl({ timeframe: 'H4' })).toContain('interval=4h');
    expect(instance.buildUrl({ timeframe: 'D1' })).toContain('interval=1day');
  });

  it('pins the request to UTC and ascending order', () => {
    const url = adapter(fakeFetch(OK_BODY).impl).buildUrl({ timeframe: 'H1' });

    expect(url).toContain('timezone=UTC');
    expect(url).toContain('order=ASC');
  });

  it('passes the API key and the requested size', () => {
    const url = adapter(fakeFetch(OK_BODY).impl).buildUrl({ timeframe: 'H1', limit: 120 });

    expect(url).toContain('apikey=test-key');
    expect(url).toContain('outputsize=120');
  });

  it('clamps an absurd limit rather than sending it on', () => {
    const url = adapter(fakeFetch(OK_BODY).impl).buildUrl({ timeframe: 'H1', limit: 99_999 });
    expect(url).toContain('outputsize=5000');
  });

  it('allows a per-request symbol override', () => {
    const url = adapter(fakeFetch(OK_BODY).impl).buildUrl({ timeframe: 'H1', symbol: 'XAG/USD' });
    expect(url).toContain('symbol=XAG%2FUSD');
  });

  it('rejects an unknown timeframe', () => {
    const instance = adapter(fakeFetch(OK_BODY).impl);
    // Cast models a bad value arriving from an untyped boundary (query string).
    expect(() => instance.buildUrl({ timeframe: 'M5' as 'H1' })).toThrow(/unsupported timeframe/);
  });
});

describe('TwelveDataAdapter.fetchCandles', () => {
  it('parses string prices and sorts the provider payload oldest-first', async () => {
    const fake = fakeFetch(OK_BODY);

    const candles = await adapter(fake.impl).fetchCandles({ timeframe: 'H1' });

    expect(candles).toHaveLength(3);
    expect(candles.map((candle) => candle.close)).toEqual([2402, 2404, 2408]);
    expect(candles[0]?.time).toBe(Date.UTC(2026, 8, 18, 0, 0, 0) / 1000);
    expect(candles[2]?.time).toBe(Date.UTC(2026, 8, 18, 2, 0, 0) / 1000);
    expect(typeof candles[0]?.open).toBe('number');
    expect(fake.calls).toHaveLength(1);
  });

  it('omits volume when the provider sends none, as it does for spot gold', async () => {
    const candles = await adapter(fakeFetch(OK_BODY).impl).fetchCandles({ timeframe: 'H1' });

    expect(candles[0]?.volume).toBeUndefined();
  });

  it('keeps a real volume figure when one is present', async () => {
    const body = {
      status: 'ok',
      values: [
        { datetime: '2026-09-18 00:00:00', open: 2400, high: 2403, low: 2399, close: 2402, volume: '1500' },
      ],
    };

    const candles = await adapter(fakeFetch(body).impl).fetchCandles({ timeframe: 'H1' });

    expect(candles[0]?.volume).toBe(1500);
  });

  it('applies the limit after normalising', async () => {
    const candles = await adapter(fakeFetch(OK_BODY).impl).fetchCandles({
      timeframe: 'H1',
      limit: 2,
    });

    expect(candles).toHaveLength(2);
    // The newest two, still oldest-first.
    expect(candles.map((candle) => candle.close)).toEqual([2404, 2408]);
  });

  it('surfaces an application error returned inside a 200 response', async () => {
    // Twelve Data reports most failures with HTTP 200 and status: "error".
    const body = { code: 400, message: '**symbol** not found', status: 'error' };

    const error = await captureError(
      adapter(fakeFetch(body).impl).fetchCandles({ timeframe: 'H1' }),
    );

    expect(error).toBeInstanceOf(PriceAdapterError);
    expect(error.message).toContain('provider error 400');
    expect(error.message).toContain('not found');
    expect((error as PriceAdapterError).rateLimited).toBe(false);
  });

  it('flags an HTTP 429 as rate limiting so callers can back off', async () => {
    const error = await captureError(
      adapter(fakeFetch({}, { status: 429 }).impl).fetchCandles({ timeframe: 'H1' }),
    );

    expect(error).toBeInstanceOf(PriceAdapterError);
    expect((error as PriceAdapterError).rateLimited).toBe(true);
  });

  it('flags an in-body 429 as rate limiting too', async () => {
    const body = { code: 429, message: 'API credits limit reached', status: 'error' };

    const error = await captureError(
      adapter(fakeFetch(body).impl).fetchCandles({ timeframe: 'H1' }),
    );

    expect((error as PriceAdapterError).rateLimited).toBe(true);
  });

  it('rejects a response with no values array', async () => {
    const error = await captureError(
      adapter(fakeFetch({ status: 'ok' }).impl).fetchCandles({ timeframe: 'H1' }),
    );

    expect(error.message).toMatch(/missing a "values" array/);
  });

  it('rejects a response body that is not JSON', async () => {
    const fake = fakeFetch(null, { raw: '<html>502 Bad Gateway</html>' });

    const error = await captureError(adapter(fake.impl).fetchCandles({ timeframe: 'H1' }));

    expect(error.message).toMatch(/not valid JSON/);
  });

  it('names the offending bar when one is malformed', async () => {
    const body = {
      status: 'ok',
      values: [
        { datetime: '2026-09-18 00:00:00', open: 2400, high: 2403, low: 2399, close: 2402 },
        { datetime: '2026-09-18 01:00:00', open: 2402, high: 2405, low: 2401, close: 'n/a' },
      ],
    };

    const error = await captureError(
      adapter(fakeFetch(body).impl).fetchCandles({ timeframe: 'H1' }),
    );

    expect(error.message).toMatch(/values\[1\]/);
    expect(error.message).toMatch(/close is not a number/);
  });

  it('rejects a bar whose OHLC is incoherent', async () => {
    const body = {
      status: 'ok',
      values: [
        // high below low — normalisation must catch this, not the indicators.
        { datetime: '2026-09-18 00:00:00', open: 2400, high: 2390, low: 2399, close: 2395 },
      ],
    };

    const error = await captureError(
      adapter(fakeFetch(body).impl).fetchCandles({ timeframe: 'H1' }),
    );

    expect(error.message).toMatch(/Invalid candle/);
  });

  it('wraps a network failure instead of leaking it', async () => {
    const exploding = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;

    const error = await captureError(
      adapter(exploding).fetchCandles({ timeframe: 'H1' }),
    );

    expect(error).toBeInstanceOf(PriceAdapterError);
    expect(error.message).toMatch(/network request failed/);
    expect((error as PriceAdapterError).cause).toBeInstanceOf(Error);
  });
});
