import { findTradeOutcome, OUTCOME_HORIZON_BARS, realisedR, scoreIdeaWindow } from '../lib/outcomes';
import type { Candle } from '../data/types';

const HOUR = 3600;
const WINDOW_START = 1_800_000_000;

function bar(parts: Partial<Candle> = {}): Candle {
  return {
    time: WINDOW_START,
    open: 100,
    high: 105,
    low: 95,
    close: 102,
    ...parts,
  };
}

/** Sequential bars, one hour apart, so exit times are distinguishable. */
function series(...parts: Partial<Candle>[]): Candle[] {
  return parts.map((part, index) => bar({ time: WINDOW_START + index * HOUR, ...part }));
}

/** `length` quiet bars from the start of the window, touching nothing. */
function quietWindow(length: number): Candle[] {
  return Array.from({ length }, (_, index) =>
    bar({ time: WINDOW_START + index * HOUR, high: 105, low: 95 }),
  );
}

const LONG_TARGETS = [110, 120, 130];
const SHORT_TARGETS = [90, 80, 70];

describe('findTradeOutcome', () => {
  it('reports the furthest target a bar reached, not the nearest', () => {
    // Previously this returned TP1 on the first match, which made TP2 and TP3
    // unreachable and scored every multi-target trade as a one-rung win. A high
    // of 121 cleared 120, and price had to trade through 110 to get there, so
    // TP2 is known to have been reached without assuming any intra-bar order.
    expect(findTradeOutcome('BUY', [bar({ low: 99, high: 121 })], 90, LONG_TARGETS)).toEqual({
      result: 'TP2', price: 120, time: 1_800_000_000,
    });
    expect(findTradeOutcome('SELL', [bar({ low: 79, high: 101 })], 110, SHORT_TARGETS)).toEqual({
      result: 'TP2', price: 80, time: 1_800_000_000,
    });
  });

  it('reaches the top of the ladder', () => {
    expect(findTradeOutcome('BUY', [bar({ low: 99, high: 131 })], 90, LONG_TARGETS)).toMatchObject({
      result: 'TP3', price: 130,
    });
    expect(findTradeOutcome('SELL', [bar({ low: 69, high: 101 })], 110, SHORT_TARGETS)).toMatchObject({
      result: 'TP3', price: 70,
    });
  });

  it('upgrades a target reached on a later bar', () => {
    const candles = series(
      { low: 99, high: 111 }, // TP1
      { low: 108, high: 121 }, // TP2
    );

    expect(findTradeOutcome('BUY', candles, 90, LONG_TARGETS)).toEqual({
      result: 'TP2', price: 120, time: 1_800_000_000 + 3600,
    });
  });

  it('never downgrades: a pullback that reaches nothing leaves the best rung standing', () => {
    const candles = series(
      { low: 99, high: 121 }, // TP2
      { low: 99, high: 105 }, // nothing
    );

    expect(findTradeOutcome('BUY', candles, 90, LONG_TARGETS)).toMatchObject({
      result: 'TP2', time: 1_800_000_000,
    });
  });

  it('stops scanning once the top rung is reached', () => {
    // Without the early exit the stop on the second bar would overwrite a result
    // that had already been banked.
    const candles = series(
      { low: 99, high: 131 }, // TP3
      { low: 50, high: 60 }, // would be a stop
    );

    expect(findTradeOutcome('BUY', candles, 90, LONG_TARGETS)).toMatchObject({
      result: 'TP3', time: 1_800_000_000,
    });
  });

  it('does not turn a trade that already banked a rung into a loss', () => {
    // The idea publishes three targets, so TP1 being reached means that rung was
    // closed in profit before the stop was ever in play. Calling the whole trade
    // a loss would misreport it worse than calling it a partial win.
    const candles = series(
      { low: 99, high: 111 }, // TP1
      { low: 89, high: 100 }, // stop
    );

    expect(findTradeOutcome('BUY', candles, 90, LONG_TARGETS)).toEqual({
      result: 'TP1', price: 110, time: 1_800_000_000,
    });
  });

  it('resolves a candle that touches both stop and target against the trade', () => {
    // Unchanged, and deliberately so: within ONE bar the order is unknowable, and
    // scoring the optimistic branch is how a backtest flatters itself.
    expect(findTradeOutcome('BUY', [bar({ low: 89, high: 111 })], 90, LONG_TARGETS)).toMatchObject({ result: 'SL', price: 90 });
    expect(findTradeOutcome('SELL', [bar({ low: 89, high: 111 })], 110, SHORT_TARGETS)).toMatchObject({ result: 'SL', price: 110 });
  });

  it('reports a loss when the stop comes first', () => {
    const candles = series(
      { low: 99, high: 105 }, // nothing
      { low: 89, high: 100 }, // stop
    );

    expect(findTradeOutcome('BUY', candles, 90, LONG_TARGETS)).toEqual({
      result: 'SL', price: 90, time: 1_800_000_000 + 3600,
    });
  });

  it('leaves a trade open when no exit level is touched', () => {
    expect(findTradeOutcome('BUY', [bar()], 90, LONG_TARGETS)).toBeNull();
    expect(findTradeOutcome('BUY', [], 90, LONG_TARGETS)).toBeNull();
  });

  it('ignores unpublished rungs of the ladder', () => {
    // A no-trade-grade idea can carry a partial ladder. An unset rung must not be
    // treated as reached, and must not stop the scan from ending at TP1.
    expect(findTradeOutcome('BUY', [bar({ low: 99, high: 125 })], 90, [110, null, null])).toEqual({
      result: 'TP1', price: 110, time: 1_800_000_000,
    });
    expect(findTradeOutcome('BUY', [bar({ low: 99, high: 125 })], 90, [null, null, null])).toBeNull();
  });
});

describe('realisedR', () => {
  it('reads the published ladder as 2R, 3R and 4R', () => {
    // The whole point of the fix. Entry 2000, stop 1990, so R is 10 and the
    // ladder sits at 2020/2030/2040. Reading the rung number instead gave
    // 1R/2R/3R and understated every win by a full R.
    expect(realisedR('BUY', 2000, 1990, 2020)).toBe(2);
    expect(realisedR('BUY', 2000, 1990, 2030)).toBe(3);
    expect(realisedR('BUY', 2000, 1990, 2040)).toBe(4);
  });

  it('mirrors for a short', () => {
    expect(realisedR('SELL', 2000, 2010, 1980)).toBe(2);
    expect(realisedR('SELL', 2000, 2010, 1970)).toBe(3);
  });

  it('puts a stop exit at exactly -1, with no special case', () => {
    expect(realisedR('BUY', 2000, 1990, 1990)).toBe(-1);
    expect(realisedR('SELL', 2000, 2010, 2010)).toBe(-1);
  });

  it('handles a stop that is not a round fraction of the exit', () => {
    // Real stops come off structure, not off the ladder, so R is rarely integral.
    expect(realisedR('BUY', 2186.12, 2182.28, 2193.8)).toBe(2);
    expect(realisedR('BUY', 2186.12, 2182.28, 2190)).toBe(1.01);
  });

  it('is scratch-free: zero risk yields null, not zero', () => {
    // A zero-risk trade has no R to be a multiple of. Returning 0 would show up
    // in the history as a break-even trade that actually never had a stop.
    expect(realisedR('BUY', 2000, 2000, 2020)).toBeNull();
    expect(realisedR('BUY', 2000, 1990, Number.NaN)).toBeNull();
    expect(realisedR('BUY', Number.NaN, 1990, 2020)).toBeNull();
  });

  it('rounds to two decimals so stored history stays readable', () => {
    expect(realisedR('BUY', 100, 97, 102)).toBe(0.67);
    expect(realisedR('BUY', 100, 97, 102, 4)).toBe(0.6667);
  });
});

describe('scoreIdeaWindow', () => {
  it('refuses to score an idea published before the window begins', () => {
    // The bug this replaces: `time > since` keeps the ENTIRE window when `since`
    // predates it, so the idea was scored against bars from weeks after its life
    // and written down as a win.
    const candles = series({ low: 99, high: 111 });
    const olderThanWindow = WINDOW_START - HOUR;

    expect(scoreIdeaWindow('BUY', candles, olderThanWindow, 90, LONG_TARGETS)).toEqual({
      status: 'INDETERMINATE', hit: null, barsConsidered: 0,
    });
    // Proof the window really would have produced a confident answer.
    expect(findTradeOutcome('BUY', candles, 90, LONG_TARGETS)).toMatchObject({ result: 'TP1' });
  });

  it('refuses when there is no window at all', () => {
    expect(scoreIdeaWindow('BUY', [], WINDOW_START, 90, LONG_TARGETS)).toMatchObject({
      status: 'INDETERMINATE',
    });
  });

  it('scores an idea the window does cover', () => {
    const candles = series({ low: 99, high: 100 }, { low: 99, high: 121 });

    expect(scoreIdeaWindow('BUY', candles, WINDOW_START, 90, LONG_TARGETS)).toMatchObject({
      status: 'WIN',
      hit: { result: 'TP2', price: 120 },
      barsConsidered: 1,
    });
  });

  it('reports a loss through the same path', () => {
    const candles = series({ low: 89, high: 100 }, { low: 89, high: 100 });

    expect(scoreIdeaWindow('BUY', candles, WINDOW_START, 90, LONG_TARGETS)).toMatchObject({
      status: 'LOSS',
      hit: { result: 'SL', price: 90 },
    });
  });

  it('leaves an idea open while its horizon is still running', () => {
    const scored = scoreIdeaWindow(
      'BUY', quietWindow(OUTCOME_HORIZON_BARS), WINDOW_START, 90, LONG_TARGETS,
    );

    expect(scored.status).toBe('OPEN');
    expect(scored.barsConsidered).toBe(OUTCOME_HORIZON_BARS - 1);
  });

  it('voids an idea that outlived its horizon untouched', () => {
    // One more bar than the boundary above. Without this an un-hit idea is
    // re-scored against each new day's bars until something eventually drifts
    // through a level months later, and that gets recorded as the trade's result.
    const scored = scoreIdeaWindow(
      'BUY', quietWindow(OUTCOME_HORIZON_BARS + 1), WINDOW_START, 90, LONG_TARGETS,
    );

    expect(scored.status).toBe('EXPIRED');
    expect(scored.hit).toBeNull();
    expect(scored.barsConsidered).toBe(OUTCOME_HORIZON_BARS);
  });

  it('ignores price action beyond the horizon', () => {
    const candles = quietWindow(OUTCOME_HORIZON_BARS + 11);
    // A stop touched well after the idea should have been voided.
    candles[OUTCOME_HORIZON_BARS + 5] = bar({
      time: WINDOW_START + (OUTCOME_HORIZON_BARS + 5) * HOUR, low: 50, high: 60,
    });

    expect(scoreIdeaWindow('BUY', candles, WINDOW_START, 90, LONG_TARGETS)).toMatchObject({
      status: 'EXPIRED', hit: null,
    });
    // And the same bars DO decide it once the horizon is wide enough to reach them,
    // which is what shows the horizon is the thing doing the work.
    expect(
      scoreIdeaWindow('BUY', candles, WINDOW_START, 90, LONG_TARGETS, { horizonBars: 1000 }),
    ).toMatchObject({ status: 'LOSS', hit: { result: 'SL' } });
  });
});
