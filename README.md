# XAU Desk

One XAU/USD trade idea per day, for an HFM Cent account. Educational tool — not
financial advice.

The app builds a daily, auditable trade idea, calculates HFM Cent position size,
and provides a historical backtest. Fixture price candles are synthetic and
will never produce an actionable idea.

## Getting started

```bash
npm install
cp .env.example .env
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run dev       # http://localhost:3000
```

XAU/USD OHLC candles come from Twelve Data's `time_series` endpoint for D1, H4,
H1, and M15. `PRICE_ADAPTER` accepts `twelvedata` (also the default when unset);
the application runtime does not accept `fixture`. A valid
`TWELVE_DATA_API_KEY` is required. The fixture adapter is imported directly by
tests only. If the live source fails or credentials are missing, the app saves
and displays a `NO_TRADE` idea with `Price source unavailable` and the provider
reason; it never substitutes fixture prices.

## Layout

| Path          | Contents                                                     |
| ------------- | ------------------------------------------------------------ |
| `data/`       | Price and news adapters behind swappable interfaces          |
| `indicators/` | EMA, RSI, ATR, swing structure — pure functions, no I/O      |
| `strategy/`   | D1/H4 bias, fundamentals, H1/M15 confluences, daily idea      |
| `risk/`       | Auditable HFM Cent lot math in USD equity units                |
| `backtest/`   | Candle replay, costs, 70/30 split, holdout equity curve       |
| `app/`        | Next.js App Router pages and `app/api/*` routes              |
| `prisma/`     | SQLite schema                                                |
| `tests/`      | Vitest suites                                                |

## Two contracts worth knowing before you add code

**Adapters, not providers.** Everything downstream imports from `data/types.ts`
and never touches a provider payload. Swapping Twelve Data for another feed means
writing one class that satisfies `PriceAdapter`; no strategy code changes.
`Candle.time` is always the bar's **open** time in unix **seconds UTC** —
validation rejects millisecond timestamps explicitly, since that mistake is
otherwise silent and shifts every bar by decades.

**Indicator series are index-aligned.** Every indicator returns an array the same
length as its input, with `null` through the warm-up period. So `rsi14[i]` always
describes `candles[i]`, and there is no offset arithmetic at the call site. If you
add an indicator, keep this property — the structure and backtest code assume it.

A third property matters for anything that replays history: swing pivots carry
`confirmedAtIndex`, and the break-of-structure scan refuses to use a pivot before
that bar. Structure therefore **does not repaint**, which is the usual reason a
backtest looks better than live trading.

## Tests

Unit tests cover the indicator formulas, adapter failure modes, fundamental
scoring, strategy hard gates, Cent lot arithmetic, and backtest execution.

Covered: hand-computed EMA/RSI/ATR/pivot reference values; warm-up boundaries;
degenerate inputs (flat series, empty series, period 1, series shorter than the
period); the Twelve Data failure modes (HTTP 429, error returned inside an HTTP
200, non-JSON body, malformed bar, network failure) with an injected `fetch` so
no test touches the network; CSV parsing; and end-to-end indicator runs over the
real fixtures.

`npm test` runs it. Two notes on things that are easy to get wrong here:

- A flat series reads **RSI 50**, not 100. Zero gains and zero losses is not
  maximum strength.
- Do not test "EMA reacts faster than SMA" on a linear ramp. Both lag by
  `(period - 1) / 2` and converge to the same value, so the comparison is decided
  by floating-point noise. Use a step change. (I wrote that test wrong first and
  left a comment at the site so it does not come back.)

Configure `ACCOUNT_EQUITY_USD` in dollars, never with the cent-denominated
terminal display. Use `npm run db:push` after schema changes and `npm run
db:generate` to refresh Prisma Client. Details and model assumptions are in
`strategy/README.md`, `risk/README.md`, and `backtest/README.md`.

## Scheduled jobs

On Vercel, `vercel.json` runs `/api/cron/daily` at 06:00 UTC every day (before
the 08:00 London open in both GMT and BST) and `/api/cron/outcomes` at minute 0
of every hour. Both endpoints require `Authorization: Bearer <CRON_SECRET>`;
set a strong `CRON_SECRET` in the deployment environment before enabling the
jobs. Vercel supplies this authorization header when `CRON_SECRET` is set.
The daily task is idempotent by UTC trade date, and the outcome task uses the
same H1 reconciliation as the History page. For local testing, set the secret
in `.env` and call either GET endpoint with that Bearer header.
