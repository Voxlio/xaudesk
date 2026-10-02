import type { NewsAdapter, NewsCalendarRead, NewsEvent } from '../types';
import { MemoryNewsCacheStore, type NewsCacheStore } from './cache';
import { isoWeekKey, parseFeed } from './parse';

/**
 * ForexFactory calendar adapter.
 *
 * Reads the public JSON feed only — the HTML site is never scraped, per the
 * project rules and the site's own terms.
 *
 * The contract that shapes this whole file: `fetchThisWeek` must never throw.
 * The fundamental bias is one of three inputs to an idea, and a calendar outage
 * should downgrade the idea to a technical-only read, not fail it. So every
 * failure path resolves to the best available data:
 *
 *     fresh cache -> network -> this week's stale cache -> newest cache -> []
 *
 * The one thing it will NOT do is pretend. `lastResult` records which of those
 * paths was taken and how old the data is, so the reason string can say
 * "calendar is 14h stale" rather than quietly implying a clean read.
 */

export const FOREX_FACTORY_SOURCE = 'forexfactory';

export const DEFAULT_FOREX_FACTORY_URL =
  'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

/** Where the returned calendar came from. */
export type NewsFetchOrigin = 'cache-fresh' | 'network' | 'cache-stale' | 'empty';

export interface NewsFetchResult {
  events: NewsEvent[];
  origin: NewsFetchOrigin;
  /** Age of the data in seconds; 0 for a live network read. */
  ageSeconds: number;
  /** Set when the network attempt failed, for logging and the reason string. */
  error: string | null;
  /** Non-fatal parse problems: entries skipped, impacts not recognised. */
  warnings: string[];
}

export interface ForexFactoryConfig {
  url?: string;
  /** Seconds a cached payload is served without re-fetching. Default 1800. */
  cacheTtlSeconds?: number;
  store?: NewsCacheStore;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected for tests; returns unix seconds UTC. */
  now?: () => number;
  timeoutMs?: number;
}

export class ForexFactoryAdapter implements NewsAdapter {
  readonly name = FOREX_FACTORY_SOURCE;

  private readonly url: string;
  private readonly cacheTtlSeconds: number;
  private readonly store: NewsCacheStore;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;

  /** Details of the most recent fetch, for the UI and the idea snapshot. */
  private last: NewsFetchResult | null = null;

  constructor(config: ForexFactoryConfig = {}) {
    this.url = config.url ?? DEFAULT_FOREX_FACTORY_URL;
    this.cacheTtlSeconds = config.cacheTtlSeconds ?? 1800;
    this.store = config.store ?? new MemoryNewsCacheStore();
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.now = config.now ?? (() => Math.floor(Date.now() / 1000));
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  get lastResult(): NewsFetchResult | null {
    return this.last;
  }

  /** Never throws. See the class comment for the fallback chain. */
  async fetchThisWeek(): Promise<NewsEvent[]> {
    const result = await this.fetchDetailed();
    return result.events;
  }

  /**
   * Same read, plus whether a calendar was obtained at all. Never throws.
   *
   * `origin: 'empty'` is the one outcome that means we have nothing: the network
   * failed (or returned unusable data) and no cached week existed to fall back
   * on. Every other origin — including a successfully parsed week with no
   * qualifying releases — counts as available.
   */
  async fetchCalendar(): Promise<NewsCalendarRead> {
    const result = await this.fetchDetailed();

    if (result.origin !== 'empty') {
      return { events: result.events, available: true, reason: null };
    }

    return {
      events: [],
      available: false,
      reason:
        result.error === null
          ? 'the calendar feed returned no usable data and no cached week was available'
          : `the calendar feed could not be read (${result.error}) and no cached week was available`,
    };
  }

  /** Same as fetchThisWeek but keeps the provenance. Also never throws. */
  async fetchDetailed(): Promise<NewsFetchResult> {
    const now = this.now();
    const weekKey = isoWeekKey(now);

    // 1. A fresh cache entry short-circuits the network entirely.
    const cached = await this.readCacheSafely(weekKey);
    if (cached !== null && now - cached.fetchedAt < this.cacheTtlSeconds) {
      return this.record({
        ...this.decode(cached.payload),
        origin: 'cache-fresh',
        ageSeconds: now - cached.fetchedAt,
        error: null,
      });
    }

    // 2. Try the network.
    let networkError: string | null = null;
    try {
      const body = await this.fetchBody();
      const decoded = this.decode(body);

      // Only cache a payload that actually parsed into something usable.
      // Caching an error page would poison the fallback for a full TTL.
      if (decoded.events.length > 0) {
        await this.writeCacheSafely({
          source: this.name,
          weekKey,
          payload: body,
          fetchedAt: now,
        });
      } else {
        decoded.warnings.push('feed parsed to zero events; not cached');
      }

      return this.record({ ...decoded, origin: 'network', ageSeconds: 0, error: null });
    } catch (error) {
      networkError = error instanceof Error ? error.message : String(error);
    }

    // 3. Stale cache for this week beats nothing.
    if (cached !== null) {
      return this.record({
        ...this.decode(cached.payload),
        origin: 'cache-stale',
        ageSeconds: now - cached.fetchedAt,
        error: networkError,
      });
    }

    // 4. Any cached week at all beats nothing.
    const newest = await this.readNewestSafely();
    if (newest !== null) {
      return this.record({
        ...this.decode(newest.payload),
        origin: 'cache-stale',
        ageSeconds: now - newest.fetchedAt,
        error: networkError,
      });
    }

    // 5. Give up, loudly but without throwing.
    return this.record({
      events: [],
      origin: 'empty',
      ageSeconds: 0,
      error: networkError,
      warnings: ['no calendar available; fundamental bias will be unavailable'],
    });
  }

  private async fetchBody(): Promise<string> {
    const response = await this.fetchImpl(this.url, {
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: { accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`feed returned HTTP ${response.status}`);
    }

    return response.text();
  }

  private decode(body: string): { events: NewsEvent[]; warnings: string[] } {
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return { events: [], warnings: ['feed body was not valid JSON'] };
    }

    const { events, issues, unknownImpacts } = parseFeed(payload);
    const warnings: string[] = [];

    if (issues.length > 0) {
      const sample = issues
        .slice(0, 3)
        .map((issue) => `${issue.title ?? `#${issue.index}`}: ${issue.reason}`)
        .join('; ');
      warnings.push(`skipped ${issues.length} malformed ${plural(issues.length, 'entry', 'entries')} (${sample})`);
    }
    if (unknownImpacts.length > 0) {
      warnings.push(`unrecognised impact ${plural(unknownImpacts.length, 'label', 'labels')}: ${unknownImpacts.join(', ')}`);
    }

    return { events, warnings };
  }

  private record(result: NewsFetchResult): NewsFetchResult {
    this.last = result;
    return result;
  }

  // A cache that is itself broken must not defeat the point of the cache, so
  // store failures degrade to "no cache" rather than propagating.

  private async readCacheSafely(weekKey: string) {
    try {
      return await this.store.read(this.name, weekKey);
    } catch {
      return null;
    }
  }

  private async readNewestSafely() {
    try {
      return await this.store.readNewest(this.name);
    } catch {
      return null;
    }
  }

  private async writeCacheSafely(
    entry: Parameters<NewsCacheStore['write']>[0],
  ): Promise<void> {
    try {
      await this.store.write(entry);
    } catch {
      // Losing the write only costs us the next fallback, not this response.
    }
  }
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}
