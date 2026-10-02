import { MemoryNewsCacheStore } from '../../data/news/cache';
import { ForexFactoryAdapter } from '../../data/news/forexFactory';
import { isoWeekKey } from '../../data/news/parse';
import { fakeJsonFetch, failingFetch, NEWS_NOW } from '../helpers';

/**
 * The ForexFactory adapter's one hard contract: `fetchThisWeek` never throws.
 *
 * Most of this file is therefore about failure. Every path through the fallback
 * chain — fresh cache, network, stale cache, any cache, empty — gets a test,
 * because the chain is the whole value of the adapter and a silent regression
 * in it would only show up as a mysteriously missing fundamental bias.
 */

const FEED = [
  {
    title: 'CPI m/m',
    country: 'USD',
    date: '2026-10-07T08:30:00-04:00',
    impact: 'High',
    forecast: '0.2%',
    previous: '0.3%',
    actual: '0.4%',
  },
  {
    title: 'Main Refinancing Rate',
    country: 'EUR',
    date: '2026-10-08T07:45:00-04:00',
    impact: 'High',
    forecast: '2.15%',
    previous: '2.40%',
  },
];

function adapter(
  fetchImpl: typeof fetch,
  options: { store?: MemoryNewsCacheStore; now?: number; ttl?: number } = {},
) {
  const now = options.now ?? NEWS_NOW;
  return new ForexFactoryAdapter({
    fetchImpl,
    store: options.store ?? new MemoryNewsCacheStore(),
    now: () => now,
    cacheTtlSeconds: options.ttl ?? 1800,
    url: 'https://example.test/ff_calendar_thisweek.json',
  });
}

describe('ForexFactoryAdapter happy path', () => {
  it('fetches, parses and reports a network origin', async () => {
    const fetchImpl = fakeJsonFetch(FEED);
    const result = await adapter(fetchImpl.impl).fetchDetailed();

    expect(result.origin).toBe('network');
    expect(result.ageSeconds).toBe(0);
    expect(result.error).toBeNull();
    expect(result.events).toHaveLength(2);
    expect(result.events[0]?.title).toBe('CPI m/m');
    expect(result.events[0]?.time).toBe(Date.UTC(2026, 9, 7, 12, 30, 0) / 1000);
  });

  it('requests the configured URL and asks for JSON', async () => {
    const fetchImpl = fakeJsonFetch(FEED);
    await adapter(fetchImpl.impl).fetchThisWeek();

    expect(fetchImpl.calls).toHaveLength(1);
    expect(fetchImpl.calls[0]).toBe('https://example.test/ff_calendar_thisweek.json');
  });

  it('records the result on lastResult for the UI to show', async () => {
    const instance = adapter(fakeJsonFetch(FEED).impl);
    expect(instance.lastResult).toBeNull();

    await instance.fetchThisWeek();
    expect(instance.lastResult?.origin).toBe('network');
  });

  it('caches a successful read under the ISO week key', async () => {
    const store = new MemoryNewsCacheStore();
    await adapter(fakeJsonFetch(FEED).impl, { store }).fetchThisWeek();

    const cached = await store.read('forexfactory', isoWeekKey(NEWS_NOW));
    expect(cached).not.toBeNull();
    expect(cached?.fetchedAt).toBe(NEWS_NOW);
    // The raw body is stored, not the parsed events, so a parser fix can be
    // applied to already-cached data.
    expect(JSON.parse(cached?.payload ?? 'null')).toEqual(FEED);
  });
});

describe('ForexFactoryAdapter caching', () => {
  it('serves a fresh cache without touching the network', async () => {
    const store = new MemoryNewsCacheStore();
    await store.write({
      source: 'forexfactory',
      weekKey: isoWeekKey(NEWS_NOW),
      payload: JSON.stringify(FEED),
      fetchedAt: NEWS_NOW - 600,
    });

    const fetchImpl = fakeJsonFetch([]);
    const result = await adapter(fetchImpl.impl, { store }).fetchDetailed();

    expect(result.origin).toBe('cache-fresh');
    expect(result.ageSeconds).toBe(600);
    expect(result.events).toHaveLength(2);
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('re-fetches once the TTL has expired', async () => {
    const store = new MemoryNewsCacheStore();
    await store.write({
      source: 'forexfactory',
      weekKey: isoWeekKey(NEWS_NOW),
      payload: JSON.stringify([]),
      fetchedAt: NEWS_NOW - 1801,
    });

    const fetchImpl = fakeJsonFetch(FEED);
    const result = await adapter(fetchImpl.impl, { store }).fetchDetailed();

    expect(result.origin).toBe('network');
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('treats a payload exactly at the TTL boundary as stale', async () => {
    const store = new MemoryNewsCacheStore();
    await store.write({
      source: 'forexfactory',
      weekKey: isoWeekKey(NEWS_NOW),
      payload: JSON.stringify(FEED),
      fetchedAt: NEWS_NOW - 1800,
    });

    const fetchImpl = fakeJsonFetch(FEED);
    const result = await adapter(fetchImpl.impl, { store }).fetchDetailed();
    expect(result.origin).toBe('network');
  });
});

describe('ForexFactoryAdapter failure handling', () => {
  it('falls back to a stale cache when the network fails', async () => {
    const store = new MemoryNewsCacheStore();
    await store.write({
      source: 'forexfactory',
      weekKey: isoWeekKey(NEWS_NOW),
      payload: JSON.stringify(FEED),
      fetchedAt: NEWS_NOW - 7200,
    });

    const result = await adapter(failingFetch().impl, { store }).fetchDetailed();

    expect(result.origin).toBe('cache-stale');
    expect(result.ageSeconds).toBe(7200);
    expect(result.error).toBe('network down');
    expect(result.events).toHaveLength(2);
  });

  it("falls back to another week's cache when this week has none", async () => {
    const store = new MemoryNewsCacheStore();
    await store.write({
      source: 'forexfactory',
      weekKey: '2026-W40',
      payload: JSON.stringify(FEED),
      fetchedAt: NEWS_NOW - 8 * 24 * 3600,
    });

    const result = await adapter(failingFetch().impl, { store }).fetchDetailed();

    expect(result.origin).toBe('cache-stale');
    expect(result.events).toHaveLength(2);
    // Being honest about the age is the point — a week-old calendar is usable
    // for locating releases but the caller needs to know.
    expect(result.ageSeconds).toBe(8 * 24 * 3600);
  });

  it('returns an empty calendar rather than throwing when everything fails', async () => {
    const result = await adapter(failingFetch('ENOTFOUND').impl).fetchDetailed();

    expect(result.origin).toBe('empty');
    expect(result.events).toEqual([]);
    expect(result.error).toBe('ENOTFOUND');
    expect(result.warnings[0]).toMatch(/fundamental bias will be unavailable/);
  });

  it('never rejects, whatever the failure', async () => {
    // The contract, asserted directly.
    const events = await adapter(failingFetch().impl).fetchThisWeek();
    expect(events).toEqual([]);
  });

  it('reports the calendar unavailable when it has nothing at all', async () => {
    // What makes the blackout able to fail closed: the adapter distinguishes
    // "we got nothing" from "the week is quiet".
    const read = await adapter(failingFetch('ENOTFOUND').impl).fetchCalendar();

    expect(read.available).toBe(false);
    expect(read.events).toEqual([]);
    expect(read.reason).toMatch(/ENOTFOUND/);
    expect(read.reason).toMatch(/no cached week was available/);
  });

  it('reports the calendar available on a live read', async () => {
    const read = await adapter(fakeJsonFetch(FEED).impl).fetchCalendar();

    expect(read.available).toBe(true);
    expect(read.reason).toBeNull();
    expect(read.events.length).toBeGreaterThan(0);
  });

  it('reports the calendar available when it falls back to a stale cache', async () => {
    // A stale calendar is still a calendar — the fallback chain exists precisely
    // so an outage does not have to stand the trade down.
    const store = new MemoryNewsCacheStore();
    await adapter(fakeJsonFetch(FEED).impl, { store }).fetchDetailed();

    const read = await adapter(failingFetch().impl, { store }).fetchCalendar();

    expect(read.available).toBe(true);
    expect(read.events.length).toBeGreaterThan(0);
  });

  it('treats a non-200 response as a failure', async () => {
    const fetchImpl = fakeJsonFetch(FEED, { status: 503 });
    const result = await adapter(fetchImpl.impl).fetchDetailed();

    expect(result.origin).toBe('empty');
    expect(result.error).toMatch(/HTTP 503/);
  });

  it('handles an HTML error page where JSON was expected', async () => {
    const fetchImpl = fakeJsonFetch(null, { raw: '<html>rate limited</html>' });
    const result = await adapter(fetchImpl.impl).fetchDetailed();

    expect(result.events).toEqual([]);
    expect(result.warnings).toContain('feed body was not valid JSON');
  });

  it('does not cache a payload that parsed to nothing', async () => {
    // Caching an error page would poison the fallback for a full TTL, which is
    // worse than having no cache at all.
    const store = new MemoryNewsCacheStore();
    const fetchImpl = fakeJsonFetch(null, { raw: '<html>nope</html>' });

    await adapter(fetchImpl.impl, { store }).fetchDetailed();
    expect(store.size).toBe(0);
  });

  it('survives a cache store that is itself broken', async () => {
    const broken = {
      async read(): Promise<never> {
        throw new Error('db locked');
      },
      async readNewest(): Promise<never> {
        throw new Error('db locked');
      },
      async write(): Promise<never> {
        throw new Error('db locked');
      },
    };

    const instance = new ForexFactoryAdapter({
      fetchImpl: fakeJsonFetch(FEED).impl,
      store: broken,
      now: () => NEWS_NOW,
    });

    const result = await instance.fetchDetailed();
    expect(result.origin).toBe('network');
    expect(result.events).toHaveLength(2);
  });

  it('reports skipped entries as warnings without losing good ones', async () => {
    const fetchImpl = fakeJsonFetch([FEED[0], { country: 'USD', date: 'x' }]);
    const result = await adapter(fetchImpl.impl).fetchDetailed();

    expect(result.events).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/skipped 1 malformed entry/);
  });
});
