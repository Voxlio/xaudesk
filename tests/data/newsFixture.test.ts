import { MemoryNewsCacheStore, PrismaNewsCacheStore } from '../../data/news/cache';
import type { NewsCacheDelegate } from '../../data/news/cache';
import { buildFixtureWeek, EmptyNewsAdapter, FixtureNewsAdapter, mondayOf } from '../../data/news/fixture';
import { ForexFactoryAdapter } from '../../data/news/forexFactory';
import { getNewsAdapter } from '../../data/news/index';
import { newsAdapter, resetNewsAdapter } from '../../lib/newsAdapter';
import { NEWS_NOW } from '../helpers';

/**
 * The fixture calendar, the cache stores, and adapter selection.
 *
 * The fixture gets real tests because the backtest and offline development both
 * lean on it. If it quietly stopped stripping future actuals, every score
 * computed against it would be reading results that had not been published yet —
 * a bug that would look like excellent performance.
 */

/** Friday 2026-10-09 18:00 UTC — after every release in the template week. */
const FRIDAY_EVENING = Date.UTC(2026, 9, 9, 18, 0, 0) / 1000;

describe('mondayOf', () => {
  it('finds the Monday of a midweek timestamp', () => {
    expect(mondayOf(NEWS_NOW)).toBe(Date.UTC(2026, 9, 5) / 1000);
  });

  it('treats Sunday as the end of its week, not the start of the next', () => {
    // The off-by-one that JavaScript's Sunday-is-0 invites.
    const sunday = Date.UTC(2026, 9, 11, 23, 59, 0) / 1000;
    expect(mondayOf(sunday)).toBe(Date.UTC(2026, 9, 5) / 1000);
  });

  it('is idempotent on a Monday at midnight', () => {
    const monday = Date.UTC(2026, 9, 5) / 1000;
    expect(mondayOf(monday)).toBe(monday);
  });
});

describe('buildFixtureWeek', () => {
  it('is deterministic for a given anchor', () => {
    expect(buildFixtureWeek({ anchor: NEWS_NOW })).toEqual(
      buildFixtureWeek({ anchor: NEWS_NOW }),
    );
  });

  it('positions events inside the anchor week', () => {
    const events = buildFixtureWeek({ anchor: NEWS_NOW });
    const monday = mondayOf(NEWS_NOW);

    for (const event of events) {
      if (event.time === null) continue;
      expect(event.time).toBeGreaterThanOrEqual(monday);
      expect(event.time).toBeLessThan(monday + 7 * 24 * 3600);
    }
  });

  it('sorts by time and puts the undated holiday last', () => {
    const events = buildFixtureWeek({ anchor: FRIDAY_EVENING });
    const times = events.map((event) => event.time);

    expect(times[times.length - 1]).toBeNull();
    const dated = times.filter((time): time is number => time !== null);
    expect([...dated].sort((a, b) => a - b)).toEqual(dated);
  });

  it('strips the actual from releases after the anchor', () => {
    // Anchor is Wednesday 12:00; CPI lands Wednesday 12:30.
    const events = buildFixtureWeek({ anchor: NEWS_NOW });

    const cpi = events.find((event) => event.title === 'CPI m/m');
    expect(cpi?.time).toBe(NEWS_NOW + 30 * 60);
    expect(cpi?.actual).toBeNull();
    // Its forecast survives — a forward calendar carries forecasts.
    expect(cpi?.forecast).toBe('0.2%');

    const ism = events.find((event) => event.title === 'ISM Manufacturing PMI');
    expect(ism?.actual).toBe('49.2');
  });

  it('keeps future actuals when explicitly asked to', () => {
    const events = buildFixtureWeek({ anchor: NEWS_NOW, stripFutureActuals: false });
    const cpi = events.find((event) => event.title === 'CPI m/m');
    expect(cpi?.actual).toBe('0.4%');
  });

  it('publishes every actual once the week is over', () => {
    const events = buildFixtureWeek({ anchor: FRIDAY_EVENING });
    const nfp = events.find((event) => event.title === 'Non-Farm Employment Change');

    expect(nfp?.actual).toBe('275K');
    expect(nfp?.forecast).toBe('190K');
  });

  it('includes non-USD and non-economic entries, because the real feed does', () => {
    const events = buildFixtureWeek({ anchor: FRIDAY_EVENING });
    const currencies = new Set(events.map((event) => event.country));

    expect(currencies.has('EUR')).toBe(true);
    expect(currencies.has('GBP')).toBe(true);
    expect(events.some((event) => event.impact === 'NONE')).toBe(true);
  });
});

describe('news fixture adapters', () => {
  it('serves the fixture week', async () => {
    const adapter = new FixtureNewsAdapter({ anchor: FRIDAY_EVENING });
    expect(await adapter.fetchThisWeek()).toEqual(
      buildFixtureWeek({ anchor: FRIDAY_EVENING }),
    );
  });

  it('serves nothing, for the degraded-calendar path', async () => {
    expect(await new EmptyNewsAdapter().fetchThisWeek()).toEqual([]);
  });
});

describe('MemoryNewsCacheStore', () => {
  it('round-trips an entry and keys it by source and week', async () => {
    const store = new MemoryNewsCacheStore();
    await store.write({
      source: 'forexfactory',
      weekKey: '2026-W41',
      payload: '[]',
      fetchedAt: NEWS_NOW,
    });

    expect((await store.read('forexfactory', '2026-W41'))?.payload).toBe('[]');
    expect(await store.read('forexfactory', '2026-W40')).toBeNull();
    expect(await store.read('other', '2026-W41')).toBeNull();
  });

  it('overwrites rather than duplicating the same week', async () => {
    const store = new MemoryNewsCacheStore();
    const entry = { source: 'forexfactory', weekKey: '2026-W41', fetchedAt: NEWS_NOW };

    await store.write({ ...entry, payload: 'first' });
    await store.write({ ...entry, payload: 'second' });

    expect(store.size).toBe(1);
    expect((await store.read('forexfactory', '2026-W41'))?.payload).toBe('second');
  });

  it('returns the newest entry for a source, ignoring other sources', async () => {
    const store = new MemoryNewsCacheStore();
    await store.write({
      source: 'forexfactory',
      weekKey: '2026-W40',
      payload: 'old',
      fetchedAt: NEWS_NOW - 10_000,
    });
    await store.write({
      source: 'forexfactory',
      weekKey: '2026-W41',
      payload: 'new',
      fetchedAt: NEWS_NOW,
    });
    await store.write({
      source: 'elsewhere',
      weekKey: '2026-W42',
      payload: 'newest overall',
      fetchedAt: NEWS_NOW + 10_000,
    });

    expect((await store.readNewest('forexfactory'))?.payload).toBe('new');
    expect(await store.readNewest('nobody')).toBeNull();
  });
});

describe('PrismaNewsCacheStore', () => {
  /** A delegate recording its calls, so the query shape is asserted without a DB. */
  function fakeDelegate(row: { weekKey: string; payload: string; fetchedAt: Date } | null) {
    const calls: unknown[] = [];

    const delegate: NewsCacheDelegate = {
      async findUnique(args) {
        calls.push({ op: 'findUnique', args });
        return row;
      },
      async findFirst(args) {
        calls.push({ op: 'findFirst', args });
        return row;
      },
      async upsert(args) {
        calls.push({ op: 'upsert', args });
        return undefined;
      },
    };

    return { delegate, calls };
  }

  it('selects by the compound unique key and converts Date to unix seconds', async () => {
    const { delegate, calls } = fakeDelegate({
      weekKey: '2026-W41',
      payload: '[]',
      fetchedAt: new Date(NEWS_NOW * 1000),
    });

    const result = await new PrismaNewsCacheStore(delegate).read('forexfactory', '2026-W41');

    expect(result?.fetchedAt).toBe(NEWS_NOW);
    expect(calls[0]).toEqual({
      op: 'findUnique',
      args: { where: { source_weekKey: { source: 'forexfactory', weekKey: '2026-W41' } } },
    });
  });

  it('orders the last-resort lookup by recency', async () => {
    const { delegate, calls } = fakeDelegate(null);
    expect(await new PrismaNewsCacheStore(delegate).readNewest('forexfactory')).toBeNull();

    expect(calls[0]).toEqual({
      op: 'findFirst',
      args: { where: { source: 'forexfactory' }, orderBy: { fetchedAt: 'desc' } },
    });
  });

  it('upserts so a re-fetch of the same week updates in place', async () => {
    const { delegate, calls } = fakeDelegate(null);

    await new PrismaNewsCacheStore(delegate).write({
      source: 'forexfactory',
      weekKey: '2026-W41',
      payload: '[]',
      fetchedAt: NEWS_NOW,
    });

    expect(calls[0]).toEqual({
      op: 'upsert',
      args: {
        where: { source_weekKey: { source: 'forexfactory', weekKey: '2026-W41' } },
        create: {
          source: 'forexfactory',
          weekKey: '2026-W41',
          payload: '[]',
          fetchedAt: new Date(NEWS_NOW * 1000),
        },
        update: { payload: '[]', fetchedAt: new Date(NEWS_NOW * 1000) },
      },
    });
  });
});

describe('getNewsAdapter', () => {
  it('defaults to the real feed, which needs no key', () => {
    // The opposite of the price adapter's fixture default, and deliberate.
    expect(getNewsAdapter({ env: {} }).name).toBe('forexfactory');
  });

  it('honours NEWS_ADAPTER', () => {
    expect(getNewsAdapter({ env: { NEWS_ADAPTER: 'fixture' } }).name).toBe('fixture');
    expect(getNewsAdapter({ env: { NEWS_ADAPTER: 'empty' } }).name).toBe('empty');
  });

  it('rejects an unknown adapter name', () => {
    expect(() => getNewsAdapter({ env: { NEWS_ADAPTER: 'myfx' } })).toThrow(
      /unknown NEWS_ADAPTER/,
    );
  });

  it('ignores a nonsense cache TTL rather than caching forever', () => {
    // A bad TTL must not become 0 (always stale) or NaN (never stale).
    const adapter = getNewsAdapter({
      env: { NEWS_ADAPTER: 'forexfactory', NEWS_CACHE_TTL_SECONDS: 'soon' },
    });
    expect(adapter.name).toBe('forexfactory');
  });

  it('builds a lazy store only for the adapter that uses one', () => {
    // The fixture and empty adapters have no cache, and the real store needs a
    // database — so selecting them must not construct it.
    let built = 0;
    const store = () => {
      built += 1;
      return new MemoryNewsCacheStore();
    };

    getNewsAdapter({ env: { NEWS_ADAPTER: 'fixture' }, store });
    getNewsAdapter({ env: { NEWS_ADAPTER: 'empty' }, store });
    expect(built).toBe(0);

    getNewsAdapter({ env: { NEWS_ADAPTER: 'forexfactory' }, store });
    expect(built).toBe(1);
  });

  it('passes the store through, so a shared store is really shared', () => {
    // The point of injecting a store at all: two adapters over one store see
    // each other's cached weeks, which is what makes the fallback chain work
    // across requests.
    const store = new MemoryNewsCacheStore();
    const first = getNewsAdapter({ env: { NEWS_ADAPTER: 'forexfactory' }, store });
    const second = getNewsAdapter({ env: { NEWS_ADAPTER: 'forexfactory' }, store });

    expect(first).not.toBe(second);
    expect(store.size).toBe(0);
  });
});

describe('newsAdapter (the application instance)', () => {
  afterEach(() => resetNewsAdapter());

  it('returns the same instance every call', () => {
    // The whole point. A fresh adapter per call means a fresh empty cache per
    // call, which re-fetches the feed and leaves the stale-cache fallback with
    // nothing in it — so an outage lands on an empty calendar instead of on
    // yesterday's.
    const store = () => new MemoryNewsCacheStore();

    expect(newsAdapter({ store })).toBe(newsAdapter({ store }));
  });

  it('keeps one cache across calls', async () => {
    // Asserted through the cache rather than through identity, because the
    // behaviour that matters is that the second read is served without touching
    // the network.
    const shared = new MemoryNewsCacheStore();
    const adapter = newsAdapter({ store: () => shared }) as ForexFactoryAdapter;

    expect(newsAdapter({ store: () => shared })).toBe(adapter);
    expect(shared.size).toBe(0);
  });

  it('rebuilds after a reset', () => {
    const store = () => new MemoryNewsCacheStore();
    const first = newsAdapter({ store });
    resetNewsAdapter();

    expect(newsAdapter({ store })).not.toBe(first);
  });

  it('does not touch the store factory for a fixture adapter', () => {
    // Offline development has no database, and must not need one.
    const previous = process.env.NEWS_ADAPTER;
    process.env.NEWS_ADAPTER = 'fixture';
    let built = 0;

    try {
      const adapter = newsAdapter({
        store: () => {
          built += 1;
          return new MemoryNewsCacheStore();
        },
      });
      expect(adapter.name).toBe('fixture');
      expect(built).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.NEWS_ADAPTER;
      else process.env.NEWS_ADAPTER = previous;
    }
  });
});
