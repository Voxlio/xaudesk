# /data/news — ForexFactory calendar adapter

Not implemented yet. The contracts it must satisfy (`NewsEvent`, `NewsAdapter`,
`NewsImpact`) already live in `data/types.ts`, so `/strategy` can be written
against the fundamental bias before this lands.

When implementing:

- Fetch the public JSON feed only: `https://nfs.faireconomy.media/ff_calendar_thisweek.json`
  (`FOREX_FACTORY_URL`). Never scrape the HTML site.
- Cache every successful response in the `NewsCache` table, keyed by ISO week.
  TTL comes from `NEWS_CACHE_TTL_SECONDS` (default 30 minutes).
- `fetchThisWeek()` must never throw. On a network or parse failure, fall back to
  the newest cached payload; if there is no cache, return `[]` and let the
  strategy degrade to a technical-only read rather than failing the whole idea.
- Feed timestamps carry an offset. Normalise to unix seconds UTC via
  `parseUtcTimestamp` so the "no trades within 30 minutes of high-impact news"
  rule compares like with like.
- `impact` in the feed is a string (`"High"`, `"Medium"`, `"Low"`, `"Holiday"`).
  Map it onto `NewsImpact`; treat anything unrecognised as `NONE` and log it
  rather than guessing.
