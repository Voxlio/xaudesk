import { EmptyNewsAdapter, FixtureNewsAdapter } from '../../data/news/fixture';
import { FixtureMacroAdapter } from '../../data/macro/fixture';
import type {
  MacroAdapter,
  MacroReading,
  MacroSnapshot,
  MacroUnavailable,
  NewsAdapter,
} from '../../data/types';
import { scoreFundamentals } from '../../strategy/fundamental';
import { readFundamentals } from '../../strategy/index';
import { newsEvent, NEWS_NOW } from '../helpers';

/**
 * The Fundamental Score.
 *
 * Every number asserted here was worked out by hand from the documented
 * formula, not read off a run. Where a figure looks arbitrary the comment above
 * it shows the arithmetic, because the point of this layer is that none of it is
 * a black box.
 *
 * Events are placed exactly at `at` wherever the test is not about recency, so
 * the recency weight is exactly 1 and the arithmetic stays legible.
 */

const HOURS = 3600;

interface MacroParts {
  /** USD proxy daily return in percent. Omit to make it unavailable. */
  usdProxyPercent?: number;
  /** DGS10 daily change in basis points. Omit to make it unavailable. */
  us10yBp?: number;
}

/**
 * A macro snapshot built the same way the real adapter builds one, so
 * `changePercent` and `changeAbsolute` stay consistent with each other rather
 * than being independently invented.
 */
function macroSnapshot(parts: MacroParts = {}): MacroSnapshot {
  const unavailable: MacroUnavailable[] = [];
  let usdProxy: MacroReading | null = null;
  let us10y: MacroReading | null = null;

  if (parts.usdProxyPercent === undefined) {
    unavailable.push({ instrument: 'USD_PROXY', reason: 'not on this plan' });
  } else {
    const last = 28.79;
    const reference = last / (1 + parts.usdProxyPercent / 100);
    usdProxy = {
      instrument: 'USD_PROXY',
      symbol: 'UUP',
      source: 'Twelve Data UUP ETF',
      last,
      reference,
      changeAbsolute: last - reference,
      changePercent: parts.usdProxyPercent,
      asOf: NEWS_NOW,
      lookbackBars: 5,
    };
  }

  if (parts.us10yBp === undefined) {
    unavailable.push({ instrument: 'US10Y', reason: 'not on this plan' });
  } else {
    const last = 4.21;
    const changeAbsolute = parts.us10yBp / 100;
    const reference = last - changeAbsolute;
    us10y = {
      instrument: 'US10Y',
      symbol: 'DGS10',
      source: 'FRED DGS10',
      last,
      reference,
      changeAbsolute,
      changePercent: (changeAbsolute / Math.abs(reference)) * 100,
      asOf: NEWS_NOW,
      lookbackBars: 1,
    };
  }

  return { usdProxy, us10y, unavailable };
}

describe('scoreFundamentals with nothing to go on', () => {
  it('returns a neutral, zero-confidence read rather than guessing', () => {
    const score = scoreFundamentals([], { at: NEWS_NOW });

    expect(score.usdScore).toBe(0);
    expect(score.goldBias).toBe('NEUTRAL');
    expect(score.confidence).toBe(0);
    expect(score.components).toEqual([]);
    expect(score.asOf).toBe(NEWS_NOW);
  });

  it('names all three missing inputs', () => {
    const score = scoreFundamentals([], { at: NEWS_NOW });

    expect(score.missing).toHaveLength(3);
    expect(score.missing[0]).toBe('no calendar data available');
    expect(score.missing[1]).toBe('USD proxy (UUP) unavailable (no macro adapter configured)');
    expect(score.missing[2]).toBe('US10Y unavailable (no macro adapter configured)');
  });

  it('says so in the reason instead of reporting a confident neutral', () => {
    const score = scoreFundamentals([], { at: NEWS_NOW });

    expect(score.reason).toMatch(/^No fundamental read:/);
    expect(score.reason).toMatch(/Treat as technical-only/);
  });
});

describe('news event scoring', () => {
  it('normalises a surprise against the indicator scale', () => {
    // CPI m/m 0.4 vs 0.2 forecast: a 0.2 miss against a 0.15 notable surprise,
    // so the normalised value clamps at the maximum of 1.
    const score = scoreFundamentals([newsEvent({ time: NEWS_NOW, actual: '0.4%' })], {
      at: NEWS_NOW,
    });

    const [cpi] = score.scored;
    expect(cpi?.surprise).toBeCloseTo(0.2, 10);
    expect(cpi?.notableSurprise).toBe(0.15);
    expect(cpi?.normalized).toBe(1);
    expect(cpi?.impactWeight).toBe(1);
    expect(cpi?.recencyWeight).toBe(1);
    expect(cpi?.ageHours).toBe(0);
    expect(score.usdScore).toBe(100);
  });

  it('scales linearly below the notable surprise', () => {
    // 0.25 vs 0.20 is a 0.05 miss — a third of CPI's 0.15 notable surprise.
    const score = scoreFundamentals([newsEvent({ time: NEWS_NOW, actual: '0.25%' })], {
      at: NEWS_NOW,
    });

    expect(score.scored[0]?.normalized).toBeCloseTo(1 / 3, 10);
    expect(score.usdScore).toBe(33.3);
  });

  it('inverts polarity where a lower print is dollar-strong', () => {
    // Unemployment Rate 4.1 vs 4.2: a 0.1 beat on a 0.2 scale, inverted, so
    // +0.5 for the dollar. Getting this backwards would invert the trade.
    const score = scoreFundamentals(
      [
        newsEvent({
          title: 'Unemployment Rate',
          time: NEWS_NOW,
          actual: '4.1%',
          forecast: '4.2%',
        }),
      ],
      { at: NEWS_NOW },
    );

    expect(score.scored[0]?.polarity).toBe('negative');
    expect(score.scored[0]?.normalized).toBeCloseTo(0.5, 10);
    expect(score.scored[0]?.note).toMatch(/inverted: lower is stronger/);
    expect(score.usdScore).toBe(50);
    expect(score.goldBias).toBe('BEARISH');
  });

  it('derives gold bias by inverting the dollar', () => {
    // CPI 0.0 vs 0.2: a cold print, dollar-negative, bullish gold.
    const score = scoreFundamentals([newsEvent({ time: NEWS_NOW, actual: '0.0%' })], {
      at: NEWS_NOW,
    });

    expect(score.usdScore).toBe(-100);
    expect(score.goldBias).toBe('BULLISH');
    expect(score.reason).toMatch(/bullish for gold/);
    expect(score.reason).toMatch(/dollar is offered/);
  });

  it('averages disagreeing releases by weight', () => {
    // CPI beat (+1, weight 1) against an unemployment-rate miss (-0.5, weight
    // 1): Σ(w·s)=0.5 over Σw=2, so +0.25 → a usdScore of 25.
    const score = scoreFundamentals(
      [
        newsEvent({ time: NEWS_NOW, actual: '0.4%' }),
        newsEvent({
          title: 'Unemployment Rate',
          time: NEWS_NOW,
          actual: '4.3%',
          forecast: '4.2%',
        }),
      ],
      { at: NEWS_NOW },
    );

    expect(score.scored).toHaveLength(2);
    expect(score.usdScore).toBe(25);
  });

  it('leads with the strongest contributor', () => {
    const score = scoreFundamentals(
      [
        newsEvent({
          title: 'Core Retail Sales m/m',
          impact: 'MEDIUM',
          time: NEWS_NOW,
          actual: '0.4%',
          forecast: '0.3%',
        }),
        newsEvent({ time: NEWS_NOW, actual: '0.4%' }),
      ],
      { at: NEWS_NOW },
    );

    // So the reason string opens with what actually moved the number.
    expect(score.scored[0]?.event.title).toBe('CPI m/m');
    expect(score.reason).toMatch(/Drivers: CPI m\/m/);
  });

  it('damps thin evidence instead of letting one release max out the score', () => {
    // A medium-impact release (weight 0.4) with a huge beat. A plain weighted
    // mean would read +1.0 because it is the only thing in the average; the
    // weight floor of 1.0 holds it to 0.4.
    const score = scoreFundamentals(
      [
        newsEvent({
          title: 'Core Retail Sales m/m',
          impact: 'MEDIUM',
          time: NEWS_NOW,
          actual: '1.5%',
          forecast: '0.3%',
        }),
      ],
      { at: NEWS_NOW },
    );

    expect(score.scored[0]?.normalized).toBe(1);
    expect(score.scored[0]?.weight).toBeCloseTo(0.4, 10);
    expect(score.usdScore).toBe(40);
    expect(score.components[0]?.detail).toMatch(/thin — score damped toward neutral/);
  });

  it('halves a release’s weight after one half-life', () => {
    const score = scoreFundamentals(
      [newsEvent({ time: NEWS_NOW - 24 * HOURS, actual: '0.4%' })],
      { at: NEWS_NOW },
    );

    expect(score.scored[0]?.ageHours).toBe(24);
    expect(score.scored[0]?.recencyWeight).toBeCloseTo(0.5, 10);
    // Weight 0.5 is below the floor, so the score is damped to 50 rather than
    // staying at the +1 the surprise alone would imply.
    expect(score.usdScore).toBe(50);
  });

  it('accepts a half-life override for backtest sweeps', () => {
    const score = scoreFundamentals(
      [newsEvent({ time: NEWS_NOW - 24 * HOURS, actual: '0.4%' })],
      { at: NEWS_NOW, halfLifeHours: 48 },
    );

    expect(score.scored[0]?.recencyWeight).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it('ignores a release older than the cutoff', () => {
    const score = scoreFundamentals(
      [newsEvent({ time: NEWS_NOW - 100 * HOURS, actual: '0.4%' })],
      { at: NEWS_NOW },
    );

    expect(score.scored).toEqual([]);
    // Dropped for age, not a data problem, so it is not listed as unscored.
    expect(score.unscored).toEqual([]);
    expect(score.missing[0]).toBe('no scoreable USD releases in the last 72h');
  });

  it('refuses to read a release that has not happened yet', () => {
    // The guard that stops a backtest reading tomorrow's payrolls. The actual
    // is present and would score +1, and is still ignored.
    const score = scoreFundamentals(
      [newsEvent({ time: NEWS_NOW + 1 * HOURS, actual: '0.4%' })],
      { at: NEWS_NOW },
    );

    expect(score.scored).toEqual([]);
    expect(score.usdScore).toBe(0);
  });

  it('counts a release landing exactly at the evaluation time', () => {
    const score = scoreFundamentals([newsEvent({ time: NEWS_NOW, actual: '0.4%' })], {
      at: NEWS_NOW,
    });
    expect(score.scored).toHaveLength(1);
  });
});

describe('events that cannot be scored', () => {
  function reasonFor(parts: Parameters<typeof newsEvent>[0]): string | undefined {
    const score = scoreFundamentals([newsEvent({ time: NEWS_NOW, ...parts })], {
      at: NEWS_NOW,
    });
    return score.unscored[0]?.reason;
  }

  it('reports a release with no actual', () => {
    expect(reasonFor({ actual: null })).toBe('no actual published');
  });

  it('reports a release with no forecast to compare against', () => {
    expect(reasonFor({ forecast: null })).toBe('no forecast to compare against');
  });

  it('reports figures it cannot parse', () => {
    expect(reasonFor({ actual: 'n/a' })).toMatch(/unparseable figures/);
  });

  it('reports an indicator missing from the table rather than guessing polarity', () => {
    // The rule that keeps the score honest: a wrong polarity is worse than no
    // opinion, so an unknown indicator is excluded and named.
    expect(reasonFor({ title: 'Crude Oil Inventories', actual: '-1.2M', forecast: '0.4M' })).toBe(
      'not in the indicator table, so polarity and scale are unknown',
    );
  });

  it('reports a tentative or all-day entry', () => {
    expect(reasonFor({ time: null })).toMatch(/no scheduled time/);
  });

  it('stays silent about other currencies', () => {
    // Listing every EUR release as unscored would bury the entries that matter.
    const score = scoreFundamentals(
      [newsEvent({ country: 'EUR', time: NEWS_NOW, actual: '0.4%' })],
      { at: NEWS_NOW },
    );

    expect(score.scored).toEqual([]);
    expect(score.unscored).toEqual([]);
  });

  it('stays silent about non-economic entries', () => {
    const score = scoreFundamentals(
      [newsEvent({ title: 'Bank Holiday', impact: 'NONE', time: NEWS_NOW })],
      { at: NEWS_NOW },
    );

    expect(score.unscored).toEqual([]);
  });

  it('can be pointed at another currency', () => {
    const score = scoreFundamentals(
      [newsEvent({ country: 'EUR', time: NEWS_NOW, actual: '0.4%' })],
      { at: NEWS_NOW, currency: 'eur' },
    );

    expect(score.scored).toHaveLength(1);
  });
});

describe('macro components', () => {
  it('scores the UUP return and daily DGS10 change, reporting live source and dates', () => {
    // UUP +0.25% on a 0.5% notable move is +0.5; DGS10 +5bp on a
    // 5bp daily notable move clamps at +1. Weights renormalise to 70/30.
    const score = scoreFundamentals([], {
      at: NEWS_NOW,
      macro: macroSnapshot({ usdProxyPercent: 0.25, us10yBp: 5 }),
    });

    expect(score.components.map((item) => item.key)).toEqual(['usdProxy', 'us10y']);
    expect(score.components[0]?.value).toBeCloseTo(0.5, 10);
    expect(score.components[1]?.value).toBe(1);
    expect(score.usdScore).toBe(70);
    expect(score.reason).toMatch(/Twelve Data UUP ETF \(UUP\).*\+0\.250% daily change, observation 2026-10-07/);
    expect(score.reason).toMatch(/FRED DGS10 4\.21%, \+5\.0bp daily change, observation 2026-10-07/);
  });

  it('clamps an extreme move and inverts gold accordingly', () => {
    const score = scoreFundamentals([], {
      at: NEWS_NOW,
      macro: macroSnapshot({ usdProxyPercent: -2 }),
    });

    expect(score.components).toHaveLength(1);
    expect(score.components[0]?.value).toBe(-1);
    expect(score.usdScore).toBe(-100);
    expect(score.goldBias).toBe('BULLISH');
  });

  it('passes the adapter’s own reason through to missing', () => {
    const score = scoreFundamentals([], { at: NEWS_NOW, macro: macroSnapshot({}) });

    expect(score.missing).toContain('USD proxy (UUP) unavailable (not on this plan)');
    expect(score.missing).toContain('US10Y unavailable (not on this plan)');
  });

  it('renormalises over whatever is available', () => {
    // News alone: the 0.5 news weight carries the whole score, so a +1 news
    // read still reaches +100 rather than being diluted by absent macro.
    const score = scoreFundamentals([newsEvent({ time: NEWS_NOW, actual: '0.4%' })], {
      at: NEWS_NOW,
      macro: macroSnapshot({}),
    });

    expect(score.components).toHaveLength(1);
    expect(score.usdScore).toBe(100);
  });
});

describe('confidence', () => {
  it('caps at coverage when inputs are missing', () => {
    // News only is half the intended evidence, so 50 however strong the signal.
    const score = scoreFundamentals([newsEvent({ time: NEWS_NOW, actual: '0.4%' })], {
      at: NEWS_NOW,
    });

    expect(score.usdScore).toBe(100);
    expect(score.confidence).toBe(50);
  });

  it('reaches 100 only when every input is present and agrees', () => {
    const score = scoreFundamentals([newsEvent({ time: NEWS_NOW, actual: '0.4%' })], {
      at: NEWS_NOW,
      macro: macroSnapshot({ usdProxyPercent: 0.4, us10yBp: 4 }),
    });

    expect(score.components).toHaveLength(3);
    expect(score.confidence).toBe(100);
  });

  it('discounts a component pointing the other way', () => {
    // News +1 (0.5) and US10Y +0.8 (0.2) against UUP at -1 (0.3):
    // score = 0.5 - 0.3 + 0.16 = +0.36, and 0.3 of 1.0 opposes it, so
    // confidence = 100 × coverage 1.0 × agreement 0.7.
    const score = scoreFundamentals([newsEvent({ time: NEWS_NOW, actual: '0.4%' })], {
      at: NEWS_NOW,
      macro: macroSnapshot({ usdProxyPercent: -0.75, us10yBp: 4 }),
    });

    expect(score.usdScore).toBe(36);
    expect(score.confidence).toBe(70);
  });

  it('does not treat noise as disagreement', () => {
    // A UUP drift of -0.04% is below the agreement threshold, so coverage
    // alone decides: 0.8 of the intended weight is present.
    const score = scoreFundamentals([newsEvent({ time: NEWS_NOW, actual: '0.4%' })], {
      at: NEWS_NOW,
      macro: macroSnapshot({ usdProxyPercent: -0.04 }),
    });

    expect(score.confidence).toBe(80);
  });

  it('can be fully confident about a zero', () => {
    // Every input present, every input flat. "No bias" is a real answer and
    // deserves to be reported as a confident one — not confused with "no data".
    const score = scoreFundamentals([newsEvent({ time: NEWS_NOW })], {
      at: NEWS_NOW,
      macro: macroSnapshot({ usdProxyPercent: 0, us10yBp: 0 }),
    });

    expect(score.scored).toHaveLength(1);
    expect(score.usdScore).toBe(0);
    expect(score.goldBias).toBe('NEUTRAL');
    expect(score.confidence).toBe(100);
  });
});

describe('neutral band', () => {
  it('reads a small score as no directional bias', () => {
    // 0.21 vs 0.20 is a 0.01 miss: +6.7, inside the 15-point neutral band.
    const score = scoreFundamentals([newsEvent({ time: NEWS_NOW, actual: '0.21%' })], {
      at: NEWS_NOW,
    });

    expect(score.usdScore).toBe(6.7);
    expect(score.goldBias).toBe('NEUTRAL');
    expect(score.reason).toMatch(/mixed for gold/);
    expect(score.reason).toMatch(/below the 15 threshold/);
  });

  it('honours a tighter threshold', () => {
    const score = scoreFundamentals([newsEvent({ time: NEWS_NOW, actual: '0.21%' })], {
      at: NEWS_NOW,
      neutralThreshold: 5,
    });

    expect(score.goldBias).toBe('BEARISH');
  });
});

describe('reason string', () => {
  it('cites the figures as published rather than reformatting them', () => {
    const score = scoreFundamentals([newsEvent({ time: NEWS_NOW, actual: '0.4%' })], {
      at: NEWS_NOW,
      macro: macroSnapshot({ usdProxyPercent: 0.4, us10yBp: 4 }),
    });

    expect(score.reason).toMatch(/CPI m\/m 0\.4% vs 0\.2% forecast/);
    expect(score.reason).toMatch(/above forecast, USD positive/);
    expect(score.reason).toMatch(/bearish for gold/);
    expect(score.reason).toMatch(/Confidence 100\/100/);
  });

  it('discloses what was missing', () => {
    const score = scoreFundamentals([newsEvent({ time: NEWS_NOW, actual: '0.4%' })], {
      at: NEWS_NOW,
    });

    expect(score.reason).toMatch(/Missing: USD proxy \(UUP\) unavailable[^;]*; US10Y unavailable/);
  });

  it('says "in line" when a release matches forecast', () => {
    const score = scoreFundamentals([newsEvent({ time: NEWS_NOW })], { at: NEWS_NOW });
    expect(score.scored[0]?.note).toMatch(/in line, neutral for USD/);
  });
});

describe('readFundamentals', () => {
  /** Friday 2026-10-09 18:00 UTC — after the fixture week's last release. */
  const FRIDAY_EVENING = Date.UTC(2026, 9, 9, 18, 0, 0) / 1000;
  const PAYROLLS = Date.UTC(2026, 9, 9, 12, 30, 0) / 1000;

  it('reads the fixture’s hot-data week as bearish gold', async () => {
    const read = await readFundamentals({
      news: new FixtureNewsAdapter({ anchor: FRIDAY_EVENING }),
      at: FRIDAY_EVENING,
    });

    expect(read.score.goldBias).toBe('BEARISH');
    expect(read.score.usdScore).toBeGreaterThan(15);
    expect(read.tradeAllowed).toBe(true);
    expect(read.summary).toBe(read.score.reason);
  });

  it('blocks inside the payrolls window and leads the summary with it', async () => {
    const read = await readFundamentals({
      news: new FixtureNewsAdapter({ anchor: PAYROLLS }),
      at: PAYROLLS,
    });

    expect(read.blackout.blocked).toBe(true);
    expect(read.tradeAllowed).toBe(false);
    expect(read.summary).toMatch(/^No-trade window:/);
    // The score is still computed — the blackout gates the trade, not the read.
    expect(read.score.scored.length).toBeGreaterThan(0);
  });

  it('never scores an event dated after the evaluation time', async () => {
    // The invariant that matters most for the backtest, asserted against the
    // fixture mid-week when half the calendar is still in the future.
    const midweek = Date.UTC(2026, 9, 7, 13, 0, 0) / 1000;
    const read = await readFundamentals({
      news: new FixtureNewsAdapter({ anchor: midweek }),
      at: midweek,
    });

    expect(read.score.scored.length).toBeGreaterThan(0);
    for (const item of read.score.scored) {
      expect(item.event.time).toBeLessThanOrEqual(midweek);
    }
  });

  it('combines both adapters at full coverage', async () => {
    const read = await readFundamentals({
      news: new FixtureNewsAdapter({ anchor: FRIDAY_EVENING }),
      macro: new FixtureMacroAdapter({ asOf: FRIDAY_EVENING }),
      at: FRIDAY_EVENING,
    });

    expect(read.score.components.map((item) => item.key)).toEqual(['news', 'usdProxy', 'us10y']);
    expect(read.score.confidence).toBe(100);
    expect(read.score.missing).toEqual([]);
  });

  it('stands the trade down when no calendar could be read', async () => {
    // Changed deliberately from "degrades to a technical-only read": the score
    // still degrades to technical-only, but losing the calendar also means
    // losing sight of the news blackout, and that is a hard rule. Blocking is
    // the point — EmptyNewsAdapter reports unavailable, not "a quiet week".
    const read = await readFundamentals({ news: new EmptyNewsAdapter(), at: NEWS_NOW });

    expect(read.events).toEqual([]);
    expect(read.score.reason).toMatch(/technical-only/);
    expect(read.calendarAvailable).toBe(false);
    expect(read.blackout.blocked).toBe(true);
    expect(read.tradeAllowed).toBe(false);
    expect(read.summary).toMatch(/news calendar is unavailable/);
  });

  it('still trades a calendar that was read and simply has nothing in it', async () => {
    // The other side of the same coin, and the reason availability has to be a
    // separate signal from emptiness: a week we genuinely read as quiet must not
    // be confused with a week we failed to fetch.
    const quiet: NewsAdapter = {
      name: 'quiet',
      async fetchThisWeek() {
        return [];
      },
      async fetchCalendar() {
        return { events: [], available: true, reason: null };
      },
    };

    const read = await readFundamentals({ news: quiet, at: NEWS_NOW });

    expect(read.calendarAvailable).toBe(true);
    expect(read.blackout.blocked).toBe(false);
    expect(read.tradeAllowed).toBe(true);
  });

  it('survives an adapter that breaks its no-throw contract', async () => {
    // Both adapters promise never to throw. A third-party one might anyway, and
    // a fundamental outage must not take down the idea.
    const brokenNews: NewsAdapter = {
      name: 'broken-news',
      async fetchThisWeek() {
        throw new Error('boom');
      },
    };
    const brokenMacro: MacroAdapter = {
      name: 'broken-macro',
      async fetchSnapshot() {
        throw new Error('boom');
      },
    };

    const read = await readFundamentals({
      news: brokenNews,
      macro: brokenMacro,
      at: NEWS_NOW,
    });

    expect(read.events).toEqual([]);
    expect(read.score.components).toEqual([]);
    expect(read.score.missing).toContain('USD proxy (UUP) unavailable (macro adapter threw)');
    // It survives — it does not throw, and the score is still assembled. But a
    // news adapter that threw has given us no calendar, so the trade stands
    // down rather than proceeding blind.
    expect(read.calendarAvailable).toBe(false);
    expect(read.tradeAllowed).toBe(false);
    expect(read.blackout.reason).toMatch(/broken-news calendar threw \(boom\)/);
  });

  it('infers unavailability when an adapter cannot report it', async () => {
    // No fetchCalendar, and an empty result. Between "nothing scheduled" and
    // "never reached the feed" the safe reading is the second one.
    const silent: NewsAdapter = {
      name: 'silent',
      async fetchThisWeek() {
        return [];
      },
    };

    const read = await readFundamentals({ news: silent, at: NEWS_NOW });

    expect(read.calendarAvailable).toBe(false);
    expect(read.tradeAllowed).toBe(false);
  });
});
