import type { Candle } from '../data/types';

export interface TrackedOutcome {
  result: 'SL' | 'TP1' | 'TP2' | 'TP3';
  price: number;
  time: number;
}

/**
 * Realised R, from prices.
 *
 * R is the entry-to-stop distance; the multiple is how many of those the exit
 * covered. Deriving it from prices rather than from the rung's number is the
 * whole point — the published ladder sits at 2R/3R/4R, so reading "TP1" as 1R
 * understated every win by a full R and would have silently desynced again the
 * next time the ladder moved. A stop exit falls out as exactly -1 with no
 * special case.
 *
 * `entryPrice` should be the worst fill in the quoted zone, the same edge the
 * idea measured its risk from, so this R is comparable to the published RR.
 *
 * Null rather than 0 when risk is zero or either price is unusable: there is no
 * R to be a multiple of, and 0 would read as a scratch trade.
 */
export function realisedR(
  direction: 'BUY' | 'SELL',
  entryPrice: number,
  stopLoss: number,
  exitPrice: number,
  digits = 2,
): number | null {
  const risk = Math.abs(entryPrice - stopLoss);
  if (!(risk > 0) || !Number.isFinite(exitPrice) || !Number.isFinite(entryPrice)) return null;

  const signed = (exitPrice - entryPrice) * (direction === 'BUY' ? 1 : -1);
  const factor = 10 ** digits;
  return Math.round((signed / risk) * factor) / factor;
}

/**
 * Replay bars against a trade's exit levels and report how far it got.
 *
 * Three rules, and all three exist because a bar reports only its extremes and
 * never the order in which price visited them.
 *
 * Within one bar, a stop and a target both being touched resolves AGAINST the
 * trade. The order is unknowable and scoring the optimistic branch is precisely
 * how a backtest flatters itself.
 *
 * Within one bar, the furthest target reached is the one recorded. This needs no
 * ordering assumption at all: if the high cleared TP2 then price traded through
 * TP1 to get there.
 *
 * Across bars, a target already reached is not undone by a later stop. The
 * published idea is a three-rung ladder, so reaching TP1 means that rung was
 * closed in profit before the stop was ever in play; calling the whole trade a
 * loss would be a worse lie than calling it a partial win. The scan ends at that
 * stop and reports the best rung actually reached.
 *
 * Returning on the first target hit — which is what this did before — made TP2
 * and TP3 unreachable, so every multi-target trade was scored as a 1-rung win.
 */
export function findTradeOutcome(
  direction: 'BUY' | 'SELL',
  candles: readonly Candle[],
  stop: number,
  targets: readonly (number | null)[],
): TrackedOutcome | null {
  const long = direction === 'BUY';

  // The last rung that was actually published. A ladder may be partly unset.
  let furthestIndex = -1;
  for (let index = 0; index < targets.length; index += 1) {
    const price = targets[index];
    if (price !== null && price !== undefined) furthestIndex = index;
  }

  let bestIndex = -1;
  let best: TrackedOutcome | null = null;

  for (const candle of candles) {
    if (long ? candle.low <= stop : candle.high >= stop) {
      return best ?? { result: 'SL', price: stop, time: candle.time };
    }

    // Highest rung this bar reached. Scanned in full rather than short-circuited
    // so a ladder whose rungs are out of order is still read by its labels.
    let reachedIndex = -1;
    for (let index = 0; index < targets.length; index += 1) {
      const price = targets[index];
      if (price === null || price === undefined) continue;
      if (long ? candle.high >= price : candle.low <= price) reachedIndex = index;
    }

    if (reachedIndex > bestIndex) {
      bestIndex = reachedIndex;
      best = {
        result: `TP${reachedIndex + 1}` as TrackedOutcome['result'],
        price: targets[reachedIndex] as number,
        time: candle.time,
      };
    }

    // Nothing left to reach, so later bars cannot change the answer.
    if (bestIndex >= 0 && bestIndex === furthestIndex) return best;
  }

  return best;
}

/**
 * How many bars of the scored timeframe an idea stays live before it is voided.
 *
 * 120 H1 bars is five 24-hour trading days. Counting BARS rather than wall-clock
 * days is deliberate: gold trades 24/5, so a calendar deadline would either eat
 * a weekend or need weekend arithmetic, while a bar count is exactly "five days
 * of market" however the feed spaces its candles.
 *
 * This number is a chosen default, not a confirmed rule — it is the one thing to
 * change if the desk wants a different holding period.
 */
export const OUTCOME_HORIZON_BARS = 120;

export type OutcomeStatus = 'OPEN' | 'WIN' | 'LOSS' | 'NO_TRADE' | 'EXPIRED' | 'INDETERMINATE';

export interface ScoredOutcome {
  status: OutcomeStatus;
  hit: TrackedOutcome | null;
  /** Bars actually replayed: the idea's life, capped at the horizon. */
  barsConsidered: number;
}

/**
 * Decide an idea's outcome from a window of bars, or decline to.
 *
 * Two refusals, both of which used to be silent wins and losses.
 *
 * If the window begins AFTER the idea was published it contains no bar from the
 * idea's own life. The naive `time > since` filter keeps every bar in that case,
 * so the idea gets scored against price action from weeks later and written down
 * as a WIN or a LOSS. There is no honest answer here, so the status says so.
 *
 * And an idea that never touched a level does not stay open forever. Once the
 * full horizon of bars has elapsed it is voided; before that it is still live.
 * Without this an un-hit idea is re-scored against each new day's bars until
 * something eventually drifts through a level, months later.
 */
export function scoreIdeaWindow(
  direction: 'BUY' | 'SELL',
  candles: readonly Candle[],
  since: number,
  stop: number,
  targets: readonly (number | null)[],
  options: { horizonBars?: number } = {},
): ScoredOutcome {
  const horizonBars = options.horizonBars ?? OUTCOME_HORIZON_BARS;
  const windowStart = candles[0]?.time;

  if (windowStart === undefined || since < windowStart) {
    return { status: 'INDETERMINATE', hit: null, barsConsidered: 0 };
  }

  const afterEntry = candles.filter((candle) => candle.time > since);
  const lifetime = afterEntry.slice(0, horizonBars);
  const hit = findTradeOutcome(direction, lifetime, stop, targets);

  if (hit !== null) {
    return {
      status: hit.result === 'SL' ? 'LOSS' : 'WIN',
      hit,
      barsConsidered: lifetime.length,
    };
  }

  return {
    status: afterEntry.length >= horizonBars ? 'EXPIRED' : 'OPEN',
    hit: null,
    barsConsidered: lifetime.length,
  };
}
