# XAU Desk — Phase 3 status

Date: 2026-10-03. Companion to `REVIEW-2026-10-02.md`, which defines the finding IDs used here.

## What this pass covered

The agreed scope was the "safety block": the two criticals, the four highs that corrupt either a live order or the published track record, and the two cheap exposure fixes. All eight are now implemented and, for the first time, **verified by execution rather than by reading**.

| ID | Finding | State |
|---|---|---|
| C1 | News cache inert; `NewsCache` never written | Fixed and covered |
| C2 | Feed outage silently disabled the blackout | Fixed and covered |
| H1 | Stop loss could sit inside the entry zone | Fixed and covered |
| H2 | R-multiple understated by one R on every win | Fixed and covered |
| H3 | TP2/TP3 unreachable, so the ladder was fiction | Fixed and covered |
| H4 | Ideas judged against out-of-range bars; no expiry | Fixed and covered |
| H6 | `PUT /api/settings` unauthenticated | Fixed and covered |
| H8 | `GET /api/history` performed writes | Fixed and covered |

Two findings outside that scope were also closed because they were the only failing tests left and both were one-line decisions rather than design work: **M2** (fixture percent change did not round-trip) and **M4** (fundamental dead-band applied in normalized rather than raw units). **M1** and **M3** were already fixed before this pass.

**M20** is now flagged rather than fixed, as agreed: every HFM contract assumption in `risk/index.ts` carries an explicit "NOT YET VERIFIED" block naming what must be confirmed against the live symbol specification. No behaviour changed.

## Decisions recorded

The outcome convention is **furthest level reached, full close there**. `findTradeOutcome` scans every bar, records the highest rung reached before the stop, resolves a same-bar stop-and-target against the trade, and does not let a later stop undo a rung already reached. R is always derived from prices — never from the rung's label, which is what made every win read as +1R against a 2R/3R/4R ladder.

The fundamental dead-band lives in **each input's own units, applied before normalization**. A dead-band on the normalized value has a different real-world threshold for every component, because it divides by that component's `notable` scale; that is why a −0.04% dollar-proxy drift was being scored as genuine disagreement and dropping published confidence from 80 to 50.

Idea expiry is **120 H1 bars**, i.e. five 24-hour trading days. Counting bars rather than calendar days is deliberate, since gold trades 24/5 and a date deadline would need weekend arithmetic. This number is a chosen default, not a confirmed desk rule.

`ADMIN_SECRET` is deliberately **separate from `CRON_SECRET`**. The admin token is typed into a browser form and so lives in more places than a server-to-server cron token; sharing one value would widen the cron token's exposure every time somebody saved a setting. An unset secret refuses with 503 rather than authorizing.

## How it was verified

`npm run typecheck` passes clean, including with `--incremental false`.

The sandbox cannot run the project's own toolchain: `node_modules` was installed on Windows, so `vitest` dies on a missing `@rollup/rollup-linux-x64-gnu`, `next build` cannot run, and the npm registry is unreachable. The suite was therefore executed **unmodified** under Node 22's `--experimental-transform-types` with a vitest-compatible shim supplying the globals that `vitest.config.ts` injects. Result: **21 files, 366 tests, 0 failures.**

Because that harness is newly written, it was checked against deliberate regressions rather than trusted. Nine mutations were applied one at a time — each one re-breaking a specific fix from this pass — and the suite caught **all nine**, with the baseline restored green afterwards. That tests both that the harness discriminates and that every fix in the safety block is genuinely covered rather than merely present.

Please still run `npm test` on Windows before committing. The harness is a good cross-check, not a substitute for the real runner.

## What remains, in the review's suggested order

The next real work is **H7** (no rate limiting anywhere, and the Twelve Data free tier is 8 requests/minute and 800/day, so a handful of requests takes the daily idea offline) together with **L7**, since the unused `CandleCache` model is exactly the cache `/api/backtest` needs.

Then the remaining medium group: **M6** (no maximum lot cap and no margin check — a $0.05 stop at 2% of $1,000 sizes 400 cent lots with nothing objecting) and **M7** (position-value math re-implemented outside `/risk`, correct only by the 1-cent-lot-equals-1-ounce coincidence) are the two with real teeth. **M5**, **M8**, **M13** through **M19** are hygiene. **M9** through **M11** are toolchain: no ESLint config, no lockfile, no migrations.

**H5** and **M12** stay last by design. The backtest is an H4 EMA/RSI baseline that never calls `createTradeIdea` or `calculateCentLots` — no confluence gate, no fundamental bias, no news blackout, no lot step — so its equity curve cannot be reproduced by the real cent account. Making it honest is a larger piece of work than everything above combined, and until it is done the `/backtest` page should be read as a benchmark rather than as this system's track record.

One housekeeping note: the repo has no `.gitattributes`, and the working tree is CRLF while the index is LF, so `git diff` reports all 34 files as fully rewritten and real changes are invisible without `--ignore-cr-at-eol`. A `* text=auto eol=lf` renormalization commit would fix this permanently.

---

Educational tool only. Not financial advice.
