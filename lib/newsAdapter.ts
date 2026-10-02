import { createPrismaNewsStore, getNewsAdapter } from '../data/news';
import type { NewsCacheStore } from '../data/news';
import type { NewsAdapter } from '../data/types';
import { prisma } from './prisma';

/**
 * The application's single news adapter.
 *
 * Two things are going on here, and both exist because the ForexFactory
 * adapter's cache lives on the *instance* rather than being global.
 *
 * It is memoised. Building a fresh adapter per call hands every call an empty
 * cache, which means the 30-minute fresh-cache short-circuit never fires (so the
 * free feed gets hit two or three times per idea) and, far worse, the
 * stale-cache and newest-cache fallbacks have nothing in them. The adapter's
 * whole documented fallback chain — fresh cache, network, stale cache, newest
 * cache, empty — collapses to "network or nothing".
 *
 * And it is backed by the NewsCache table rather than memory, so the cache
 * survives a restart and a serverless cold start. An in-memory cache in a
 * function that may be cold on every invocation is close to no cache at all,
 * which is exactly the state that leaves a feed outage with nothing to fall
 * back on.
 *
 * `data/news` stays free of any Prisma import by design, so the client is
 * injected from here — the layer that already owns it.
 */

let instance: NewsAdapter | null = null;

export interface NewsAdapterOptions {
  /**
   * Cache store factory. Defaults to the NewsCache table. Injected by tests so
   * they never need a database — and lazy so it is not built for the fixture or
   * empty adapters, which have no cache.
   */
  store?: () => NewsCacheStore;
}

export function newsAdapter(options: NewsAdapterOptions = {}): NewsAdapter {
  if (instance === null) {
    instance = getNewsAdapter({
      store: options.store ?? (() => createPrismaNewsStore(prisma)),
    });
  }

  return instance;
}

/** Test seam. Drops the memoised instance so the next call rebuilds it. */
export function resetNewsAdapter(): void {
  instance = null;
}
