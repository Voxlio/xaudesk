/**
 * News cache.
 *
 * The calendar is fetched once and reused: the feed changes a few times a day,
 * the strategy runs far more often than that, and the free feed deserves to be
 * treated politely. More importantly the cache is the *fallback* — when the
 * network fails, a slightly stale calendar is far better than no calendar.
 *
 * The store is an interface rather than a direct Prisma call so the adapter can
 * be tested without a database, and so a future deployment could swap in Redis
 * without touching the adapter.
 */

export interface CachedNewsPayload {
  weekKey: string;
  /** Raw response body exactly as fetched, so re-parsing is always possible. */
  payload: string;
  /** Unix seconds UTC. */
  fetchedAt: number;
}

export interface NewsCacheStore {
  read(source: string, weekKey: string): Promise<CachedNewsPayload | null>;
  write(entry: CachedNewsPayload & { source: string }): Promise<void>;
  /**
   * Newest entry for this source, whatever week it belongs to. The last-resort
   * fallback: if the network is down on a Monday, last week's calendar still
   * tells us roughly where the high-impact releases sit.
   */
  readNewest(source: string): Promise<CachedNewsPayload | null>;
}

/** In-memory store. Used by tests and as the default when there is no DB. */
export class MemoryNewsCacheStore implements NewsCacheStore {
  private readonly entries = new Map<string, CachedNewsPayload & { source: string }>();

  private static key(source: string, weekKey: string): string {
    return `${source}::${weekKey}`;
  }

  async read(source: string, weekKey: string): Promise<CachedNewsPayload | null> {
    return this.entries.get(MemoryNewsCacheStore.key(source, weekKey)) ?? null;
  }

  async write(entry: CachedNewsPayload & { source: string }): Promise<void> {
    this.entries.set(MemoryNewsCacheStore.key(entry.source, entry.weekKey), { ...entry });
  }

  async readNewest(source: string): Promise<CachedNewsPayload | null> {
    let newest: CachedNewsPayload | null = null;

    for (const entry of this.entries.values()) {
      if (entry.source !== source) continue;
      if (newest === null || entry.fetchedAt > newest.fetchedAt) newest = entry;
    }

    return newest;
  }

  /** Test helper. */
  get size(): number {
    return this.entries.size;
  }
}

/**
 * The slice of the generated Prisma client this store needs.
 *
 * Typed structurally rather than by importing `PrismaClient` so that nothing
 * here depends on `prisma generate` having been run. `source_weekKey` is the
 * compound selector Prisma derives from `@@unique([source, weekKey])`.
 */
export interface NewsCacheDelegate {
  findUnique(args: {
    where: { source_weekKey: { source: string; weekKey: string } };
  }): Promise<{ weekKey: string; payload: string; fetchedAt: Date } | null>;

  findFirst(args: {
    where: { source: string };
    orderBy: { fetchedAt: 'desc' };
  }): Promise<{ weekKey: string; payload: string; fetchedAt: Date } | null>;

  upsert(args: {
    where: { source_weekKey: { source: string; weekKey: string } };
    create: { source: string; weekKey: string; payload: string; fetchedAt: Date };
    update: { payload: string; fetchedAt: Date };
  }): Promise<unknown>;
}

export class PrismaNewsCacheStore implements NewsCacheStore {
  constructor(private readonly delegate: NewsCacheDelegate) {}

  async read(source: string, weekKey: string): Promise<CachedNewsPayload | null> {
    const row = await this.delegate.findUnique({
      where: { source_weekKey: { source, weekKey } },
    });
    return row === null ? null : toPayload(row);
  }

  async readNewest(source: string): Promise<CachedNewsPayload | null> {
    const row = await this.delegate.findFirst({
      where: { source },
      orderBy: { fetchedAt: 'desc' },
    });
    return row === null ? null : toPayload(row);
  }

  async write(entry: CachedNewsPayload & { source: string }): Promise<void> {
    const fetchedAt = new Date(entry.fetchedAt * 1000);
    await this.delegate.upsert({
      where: { source_weekKey: { source: entry.source, weekKey: entry.weekKey } },
      create: {
        source: entry.source,
        weekKey: entry.weekKey,
        payload: entry.payload,
        fetchedAt,
      },
      update: { payload: entry.payload, fetchedAt },
    });
  }
}

function toPayload(row: {
  weekKey: string;
  payload: string;
  fetchedAt: Date;
}): CachedNewsPayload {
  return {
    weekKey: row.weekKey,
    payload: row.payload,
    fetchedAt: Math.floor(row.fetchedAt.getTime() / 1000),
  };
}
