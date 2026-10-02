import type { NewsAdapter } from '../types';
import { MemoryNewsCacheStore, PrismaNewsCacheStore, type NewsCacheStore } from './cache';
import { EmptyNewsAdapter, FixtureNewsAdapter } from './fixture';
import { ForexFactoryAdapter, DEFAULT_FOREX_FACTORY_URL } from './forexFactory';

export {
  ForexFactoryAdapter,
  DEFAULT_FOREX_FACTORY_URL,
  FOREX_FACTORY_SOURCE,
} from './forexFactory';
export type {
  ForexFactoryConfig,
  NewsFetchResult,
  NewsFetchOrigin,
} from './forexFactory';
export {
  FixtureNewsAdapter,
  EmptyNewsAdapter,
  buildFixtureWeek,
  mondayOf,
} from './fixture';
export type { NewsFixtureOptions } from './fixture';
export {
  MemoryNewsCacheStore,
  PrismaNewsCacheStore,
} from './cache';
export type { NewsCacheStore, CachedNewsPayload, NewsCacheDelegate } from './cache';
export {
  parseFeed,
  parseEvent,
  parseImpact,
  parseEconomicValue,
  isoWeekKey,
} from './parse';
export type { RawForexFactoryEvent, ParseFeedResult, ParseIssue } from './parse';

/**
 * News adapter selection, mirroring data/price/index.ts.
 *
 * Note the default differs from the price adapter's: news defaults to the real
 * ForexFactory feed because it needs no API key, so there is nothing to
 * configure and no risk of silently serving synthetic data to someone who
 * expected live data — the feed either works or the adapter reports a degraded
 * read. Set NEWS_ADAPTER=fixture for offline work.
 */

export type NewsAdapterName = 'forexfactory' | 'fixture' | 'empty';

export function isNewsAdapterName(value: unknown): value is NewsAdapterName {
  return value === 'forexfactory' || value === 'fixture' || value === 'empty';
}

export interface ResolveNewsAdapterOptions {
  /** Overrides NEWS_ADAPTER. */
  adapter?: NewsAdapterName;
  /** Overrides process.env, mainly for tests. */
  env?: Record<string, string | undefined>;
  /**
   * Cache backing for the ForexFactory adapter. Defaults to in-memory.
   *
   * Pass a function to build it lazily. The fixture and empty adapters need no
   * store at all, and a caller whose store needs a database should not have to
   * open one just to select an adapter that will never touch it.
   */
  store?: NewsCacheStore | (() => NewsCacheStore);
}

export function getNewsAdapter(options: ResolveNewsAdapterOptions = {}): NewsAdapter {
  const env = options.env ?? process.env;
  const requested = options.adapter ?? env.NEWS_ADAPTER ?? 'forexfactory';

  if (!isNewsAdapterName(requested)) {
    throw new Error(
      `unknown NEWS_ADAPTER "${requested}" (expected "forexfactory", "fixture" or "empty")`,
    );
  }

  // Resolved before the store is built, so a lazy store is never constructed for
  // an adapter that does not use one.
  if (requested === 'fixture') return new FixtureNewsAdapter();
  if (requested === 'empty') return new EmptyNewsAdapter();

  const store = typeof options.store === 'function' ? options.store() : options.store;

  return new ForexFactoryAdapter({
    url: env.FOREX_FACTORY_URL ?? DEFAULT_FOREX_FACTORY_URL,
    cacheTtlSeconds: parsePositiveInt(env.NEWS_CACHE_TTL_SECONDS) ?? 1800,
    store: store ?? new MemoryNewsCacheStore(),
  });
}

/**
 * Build a Prisma-backed cache store from an injected client.
 *
 * Takes the client as an argument rather than importing it so that nothing in
 * data/news depends on `prisma generate` having been run — the adapter is fully
 * usable (and testable) with the in-memory store alone.
 */
export function createPrismaNewsStore(client: {
  newsCache: ConstructorParameters<typeof PrismaNewsCacheStore>[0];
}): NewsCacheStore {
  return new PrismaNewsCacheStore(client.newsCache);
}

function parsePositiveInt(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;

  return parsed;
}
