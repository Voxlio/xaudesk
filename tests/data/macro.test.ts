import { FixtureMacroAdapter, PartialMacroAdapter, UnavailableMacroAdapter } from '../../data/macro/fixture';
import { getMacroAdapter } from '../../data/macro/index';
import { FredMacroAdapter, parseObservation } from '../../data/macro/fred';
import { LiveMacroAdapter } from '../../data/macro/live';
import { TwelveDataUsdProxyAdapter } from '../../data/macro/twelveData';
import { fakeJsonFetch, failingFetch, NEWS_NOW } from '../helpers';

const UUP_SERIES = {
  status: 'ok',
  values: [
    { datetime: '2026-10-08', close: '28.79' },
    { datetime: '2026-10-07', close: '28.70' },
  ],
};

const FRED_OBSERVATIONS = {
  observations: [
    { date: '2026-10-08', value: '.' },
    { date: '2026-10-07', value: '4.12' },
    { date: '2026-10-06', value: '.' },
    { date: '2026-10-05', value: '4.08' },
  ],
};

describe('TwelveDataUsdProxyAdapter', () => {
  it('requires a key and computes a daily UUP percentage change with source timestamp', async () => {
    expect(() => new TwelveDataUsdProxyAdapter({ apiKey: ' ' })).toThrow(/requires an apiKey/);
    const fetched = fakeJsonFetch(UUP_SERIES);
    const reading = await new TwelveDataUsdProxyAdapter({ apiKey: 'test-key', fetchImpl: fetched.impl }).fetchUup();

    expect(reading.instrument).toBe('USD_PROXY');
    expect(reading.symbol).toBe('UUP');
    expect(reading.source).toBe('Twelve Data UUP ETF');
    expect(reading.last).toBe(28.79);
    expect(reading.reference).toBe(28.7);
    expect(reading.changePercent).toBeCloseTo(((28.79 - 28.7) / 28.7) * 100, 10);
    expect(reading.asOf).toBeGreaterThan(0);
    const url = new URL(fetched.calls[0]!);
    expect(url.searchParams.get('symbol')).toBe('UUP');
    expect(url.searchParams.get('outputsize')).toBe('2');
  });

  it('reports plan and malformed-series errors to the live fallback path', async () => {
    const denied = fakeJsonFetch({ status: 'error', message: 'symbol not available' });
    await expect(new TwelveDataUsdProxyAdapter({ apiKey: 'test-key', fetchImpl: denied.impl }).fetchUup()).rejects.toThrow(/UUP: symbol not available/);
    const oneClose = fakeJsonFetch({ values: [{ datetime: '2026-10-08', close: '28.79' }] });
    await expect(new TwelveDataUsdProxyAdapter({ apiKey: 'test-key', fetchImpl: oneClose.impl }).fetchUup()).rejects.toThrow(/need two daily closes/);
  });
});

describe('FredMacroAdapter', () => {
  it('parses numeric observations and skips FRED dot values', () => {
    expect(parseObservation({ date: '2026-10-08', value: '.' })).toBeNull();
    expect(parseObservation({ date: '2026-10-08', value: '4.12' })).toEqual({
      time: Date.UTC(2026, 9, 8) / 1000,
      value: 4.12,
    });
    expect(parseObservation({ date: '2026-10-08', value: 'not-a-number' })).toBeNull();
  });

  it('requests DGS10 observations and uses the newest two valid values as a daily change', async () => {
    const fetched = fakeJsonFetch(FRED_OBSERVATIONS);
    const adapter = new FredMacroAdapter({ apiKey: 'fred-test-key', fetchImpl: fetched.impl });
    const reading = await adapter.fetchUs10y();

    expect(reading.instrument).toBe('US10Y');
    expect(reading.symbol).toBe('DGS10');
    expect(reading.source).toBe('FRED DGS10');
    expect(reading.last).toBe(4.12);
    expect(reading.reference).toBe(4.08);
    expect(reading.changeAbsolute).toBeCloseTo(0.04, 10);
    expect(reading.lookbackBars).toBe(1);
    expect(reading.asOf).toBe(Date.UTC(2026, 9, 7) / 1000);
    const url = new URL(fetched.calls[0]!);
    expect(url.searchParams.get('series_id')).toBe('DGS10');
    expect(url.searchParams.get('sort_order')).toBe('desc');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(url.searchParams.get('api_key')).toBe('fred-test-key');
  });

  it('rejects a series with fewer than two valid observations', async () => {
    const fetched = fakeJsonFetch({ observations: [{ date: '2026-10-08', value: '.' }] });
    const adapter = new FredMacroAdapter({ apiKey: 'fred-test-key', fetchImpl: fetched.impl });
    await expect(adapter.fetchUs10y()).rejects.toThrow(/fewer than two numeric observations/);
  });
});

describe('LiveMacroAdapter', () => {
  it('uses UUP and DGS10, and caches the readings for the configured TTL', async () => {
    const twelve = fakeJsonFetch(UUP_SERIES);
    const fred = fakeJsonFetch(FRED_OBSERVATIONS);
    let now = NEWS_NOW * 1000;
    const adapter = new LiveMacroAdapter({
      twelveDataApiKey: 'td-key',
      fredApiKey: 'fred-key',
      twelveDataFetch: twelve.impl,
      fredFetch: fred.impl,
      cacheTtlMs: 60_000,
      now: () => now,
    });

    const first = await adapter.fetchSnapshot();
    const again = await adapter.fetchSnapshot();
    expect(first.usdProxy?.symbol).toBe('UUP');
    expect(first.us10y?.symbol).toBe('DGS10');
    expect(again).toBe(first);
    expect(twelve.calls).toHaveLength(1);
    expect(fred.calls).toHaveLength(1);

    now += 61_000;
    await adapter.fetchSnapshot();
    expect(twelve.calls).toHaveLength(2);
    expect(fred.calls).toHaveLength(2);
  });

  it('falls back from UUP to FRED DTWEXBGS when the ETF is unavailable', async () => {
    const denied = fakeJsonFetch({ status: 'error', message: 'symbol unavailable' });
    const fred = fakeJsonFetch({ observations: [
      { date: '2026-10-08', value: '120.2' },
      { date: '2026-10-07', value: '120.0' },
    ] });
    const adapter = new LiveMacroAdapter({
      twelveDataApiKey: 'td-key', fredApiKey: 'fred-key',
      twelveDataFetch: denied.impl, fredFetch: fred.impl,
    });
    const snapshot = await adapter.fetchSnapshot();

    expect(snapshot.usdProxy?.symbol).toBe('DTWEXBGS');
    expect(snapshot.usdProxy?.source).toMatch(/FRED DTWEXBGS/);
    expect(snapshot.usdProxy?.changePercent).toBeCloseTo((0.2 / 120) * 100, 10);
    // The test was wrong, not the code: the US 10-year is DGS10 whatever the USD
    // proxy had to fall back to. Asserting DTWEXBGS here meant a failing suite was
    // the normal state, which is how the three real bugs beside it stayed hidden.
    expect(snapshot.us10y?.symbol).toBe('DGS10');
    expect(fred.calls).toHaveLength(2);
    // By series, not by position. Both FRED reads are in flight at once, so which
    // one is recorded first depends on scheduling — the fallback is issued only
    // after UUP rejects, so it is usually second.
    const series = fred.calls.map((url) => new URL(url).searchParams.get('series_id'));
    expect([...series].sort()).toEqual(['DGS10', 'DTWEXBGS']);
  });

  it('marks missing live inputs unavailable without fixture substitution', async () => {
    const adapter = new LiveMacroAdapter({
      twelveDataApiKey: 'td-key',
      twelveDataFetch: failingFetch('network down').impl,
    });
    const snapshot = await adapter.fetchSnapshot();
    expect(snapshot.usdProxy).toBeNull();
    expect(snapshot.us10y).toBeNull();
    expect(snapshot.unavailable.map((item) => item.instrument)).toEqual(['USD_PROXY', 'US10Y']);
    expect(snapshot.unavailable[0]?.reason).toMatch(/network down/);
    expect(snapshot.unavailable[0]?.reason).toMatch(/FRED_API_KEY is not configured/);
    expect(snapshot.unavailable[1]?.reason).toBe('FRED_API_KEY is not configured');
  });

  it('orders unavailable instruments by instrument, not by which call failed first', async () => {
    // The companion to the test above, with the failure timings inverted: there,
    // US10Y failed instantly (no key) while USD_PROXY waited on a network error;
    // here DGS10 rejects before DTWEXBGS does. The reported order has to be the
    // same both ways, because callers index into `unavailable` and render
    // `unavailable[0]`. While the two readers shared one array this flipped.
    const calls: string[] = [];
    const staggered = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const delay = url.includes('DGS10') ? 0 : 20;
      await new Promise((resolve) => setTimeout(resolve, delay));
      throw new Error(`series unavailable after ${delay}ms`);
    }) as unknown as typeof fetch;

    const adapter = new LiveMacroAdapter({ fredApiKey: 'fred-key', fredFetch: staggered });
    const snapshot = await adapter.fetchSnapshot();

    expect(calls.some((url) => url.includes('DTWEXBGS'))).toBe(true);
    expect(calls.some((url) => url.includes('DGS10'))).toBe(true);
    expect(snapshot.unavailable.map((item) => item.instrument)).toEqual(['USD_PROXY', 'US10Y']);
    expect(snapshot.unavailable[0]?.reason).toMatch(/FRED DTWEXBGS failed/);
    expect(snapshot.unavailable[1]?.reason).toMatch(/series unavailable/);
  });

  it('does not cache a total source failure', async () => {
    const fetcher = failingFetch('network down');
    const adapter = new LiveMacroAdapter({
      twelveDataApiKey: 'td-key', fredApiKey: 'fred-key',
      twelveDataFetch: fetcher.impl, fredFetch: fetcher.impl,
    });
    await adapter.fetchSnapshot();
    await adapter.fetchSnapshot();
    expect(fetcher.calls.length).toBeGreaterThanOrEqual(4);
  });
});

describe('macro fixtures and adapter resolution', () => {
  it('keeps explicitly synthetic data source-labeled', async () => {
    const snapshot = await new FixtureMacroAdapter({ usdProxyChangePercent: 0.4, asOf: NEWS_NOW }).fetchSnapshot();
    expect(snapshot.usdProxy?.symbol).toBe('SYNTHETIC-USD-PROXY');
    expect(snapshot.usdProxy?.source).toMatch(/Synthetic/);
    expect(snapshot.usdProxy?.changePercent).toBeCloseTo(0.4, 10);
    expect(snapshot.usdProxy?.asOf).toBe(NEWS_NOW);
  });

  it('reports both instruments as unavailable and supports partial test fixtures', async () => {
    const empty = await new UnavailableMacroAdapter('no plan').fetchSnapshot();
    expect(empty.usdProxy).toBeNull();
    expect(empty.us10y).toBeNull();
    expect(empty.unavailable.map((item) => item.instrument)).toEqual(['USD_PROXY', 'US10Y']);
    const partial = await new PartialMacroAdapter(['USD_PROXY']).fetchSnapshot();
    expect(partial.usdProxy).not.toBeNull();
    expect(partial.us10y).toBeNull();
  });

  it('defaults to unavailable and selects the live adapter explicitly', async () => {
    const unavailable = await getMacroAdapter({ env: {} }).fetchSnapshot();
    expect(unavailable.usdProxy).toBeNull();
    expect(unavailable.unavailable[0]?.reason).toMatch(/not configured/);
    const live = getMacroAdapter({ env: { MACRO_ADAPTER: 'live' } });
    expect(live.name).toBe('UUP + FRED');
  });
});