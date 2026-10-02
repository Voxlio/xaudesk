import type { Candle } from '../../data/types';
import { atr } from '../../indicators/atr';
import { blackoutStatus } from '../../strategy/blackout';
import { scoreFundamentals } from '../../strategy/fundamental';
import { createTradeIdea, enforceCurrentBlackout } from '../../strategy/tradeIdea';
import { NEWS_NOW, newsEvent } from '../helpers';

function risingCandles(length: number, offset = 0): Candle[] {
  const wave = [0, 2, 4, 6, 8, 6, 4, 2];
  return Array.from({ length }, (_, index) => {
    const close = 1800 + offset + Math.floor(index / wave.length) * 10 + wave[index % wave.length]!;
    const open = close;
    return {
      time: NEWS_NOW - (length - index) * 900,
      open,
      high: Math.max(open, close) + 0.35,
      low: Math.min(open, close) - 0.35,
      close,
    };
  });
}

/**
 * Rewrites the tail of a series so its last confirmed swing low is `low`.
 *
 * Index `length - 3` is the last bar the fractal rule can confirm as a pivot
 * (lookback 2 needs two bars either side), so a V bottoming there is the swing
 * low the stop search reads.
 */
function withFinalSwingLow(candles: readonly Candle[], low: number): Candle[] {
  const out = [...candles];
  const offsets = [3, 2, 1, 0, 1, 2];
  const start = out.length - offsets.length;

  offsets.forEach((offset, position) => {
    const barLow = low + offset;
    out[start + position] = {
      time: out[start + position]!.time,
      open: barLow + 1,
      high: barLow + 1.35,
      low: barLow,
      close: barLow + 1,
    };
  });

  return out;
}

function inputs() {
  return {
    candles: {
      D1: risingCandles(260, 0),
      H4: risingCandles(260, 20),
      H1: risingCandles(260, 40),
      M15: risingCandles(260, 60),
    },
    events: [],
    equityUsd: 100,
    at: NEWS_NOW,
    priceSource: 'test',
  };
}

describe('createTradeIdea', () => {
  it('builds the full directional idea and cent-lot breakdown when hard gates align', () => {
    const event = newsEvent({ time: NEWS_NOW - 3600, actual: '0.0%', forecast: '0.2%' });
    const idea = createTradeIdea({
      ...inputs(),
      events: [event],
      fundamentals: scoreFundamentals([event], { at: NEWS_NOW }),
      minimumConfluences: 0,
    });

    expect(idea.direction).toBe('BUY');
    expect(idea.entryLow).not.toBeNull();
    expect(idea.stopLoss).toBeLessThan(idea.entryLow as number);
    expect(idea.takeProfit1).toBeGreaterThan(idea.entryHigh as number);
    expect(idea.riskReward).toBeGreaterThanOrEqual(2);
    expect(idea.lotSize).toBeGreaterThan(0);
    expect(idea.reason).toContain('Risk math: $100.00 USD equity');
    expect(idea.riskMath?.terminalBalanceCents).toBe(10_000);
  });

  it('keeps the protective stop clear of the entry zone when structure sits inside it', () => {
    // The entry zone is the M15 close plus or minus 0.05 ATR, and the stop search
    // pads the last swing low down by 0.1 ATR. So a swing low 0.075 ATR *above*
    // the close pads down to 0.025 ATR *below* it — below the close, which was
    // the only thing the old guard compared against, but still inside the quoted
    // zone. A fill at the near edge would already be past its own stop.
    const base = inputs();
    const lastM15 = base.candles.M15.at(-1)!;
    const m15Atr = atr(base.candles.M15).at(-1)!;
    const swingLow = lastM15.close + m15Atr * 0.075;
    const event = newsEvent({ time: NEWS_NOW - 3600, actual: '0.0%', forecast: '0.2%' });

    const idea = createTradeIdea({
      ...base,
      candles: { ...base.candles, H1: withFinalSwingLow(base.candles.H1, swingLow) },
      events: [event],
      fundamentals: scoreFundamentals([event], { at: NEWS_NOW }),
      minimumConfluences: 0,
    });

    expect(idea.direction).toBe('BUY');
    // The setup really is the bad one: the unguarded candidate is inside the zone.
    expect(swingLow - m15Atr * 0.1).toBeGreaterThan(idea.entryLow as number);
    expect(swingLow - m15Atr * 0.1).toBeLessThan(lastM15.close);
    // And the stop that ships is not.
    expect(idea.stopLoss as number).toBeLessThan(idea.entryLow as number);
  });

  it('stands down when no stop can be placed clear of the entry zone', () => {
    // A motionless M15 series has zero ATR, so the zone collapses to its minimum
    // 0.01 either side and the ATR fallback for the stop has zero distance to
    // travel. There is nowhere left to put a stop, and the honest answer is no
    // trade rather than a stop sitting on the near edge.
    const base = inputs();
    const flatM15 = base.candles.M15.map((candle) => ({
      time: candle.time,
      open: 1000,
      high: 1000,
      low: 1000,
      close: 1000,
    }));
    const event = newsEvent({ time: NEWS_NOW - 3600, actual: '0.0%', forecast: '0.2%' });

    const idea = createTradeIdea({
      ...base,
      candles: { ...base.candles, M15: flatM15 },
      events: [event],
      fundamentals: scoreFundamentals([event], { at: NEWS_NOW }),
      minimumConfluences: 0,
    });

    expect(idea.direction).toBe('NO_TRADE');
    expect(idea.reason).toMatch(/does not sit beyond the .* entry zone/);
    expect(idea.stopLoss).toBeNull();
    expect(idea.lotSize).toBeNull();
  });

  it('returns the full auditable no-trade object when fundamental bias is neutral', () => {
    const idea = createTradeIdea(inputs());

    expect(idea.direction).toBe('NO_TRADE');
    expect(idea.tradeDate).toBe('2026-10-07');
    expect(idea.biasFundamental).toBe('NEUTRAL');
    expect(idea.reason).toContain('fundamental gold bias is neutral');
    expect(idea.confluenceEvidence).toHaveLength(5);
    expect(idea.snapshot.timeframes).toHaveLength(4);
    expect(idea.disclaimer).toContain('Not financial advice');
  });

  it('requires at least three confirmed entry confluences', () => {
    const event = newsEvent({ time: NEWS_NOW - 3600, actual: '0.0%', forecast: '0.2%' });
    const idea = createTradeIdea({
      ...inputs(),
      events: [event],
      fundamentals: scoreFundamentals([event], { at: NEWS_NOW }),
    });

    expect(idea.direction).toBe('NO_TRADE');
    expect(idea.reason).toMatch(/of 3 required entry confluences/);
  });

  it('blocks an otherwise directional idea during the high-impact USD blackout', () => {
    const event = newsEvent({ time: NEWS_NOW, actual: '0.0%', forecast: '0.2%' });
    const events = [event];
    const fundamentals = scoreFundamentals(events, { at: NEWS_NOW });
    const idea = createTradeIdea({
      ...inputs(),
      events,
      fundamentals,
      blackout: blackoutStatus(events, NEWS_NOW),
      minimumConfluences: 0,
    });

    expect(fundamentals.goldBias).toBe('BULLISH');
    expect(idea.direction).toBe('NO_TRADE');
    expect(idea.reason).toContain('No-trade window');
  });

  it('does not manufacture a position when the account balance is missing', () => {
    const event = newsEvent({ time: NEWS_NOW - 3600, actual: '0.0%', forecast: '0.2%' });
    const idea = createTradeIdea({
      ...inputs(),
      events: [event],
      fundamentals: scoreFundamentals([event], { at: NEWS_NOW }),
      equityUsd: null,
      minimumConfluences: 0,
    });

    expect(idea.direction).toBe('NO_TRADE');
    expect(idea.reason).toContain('ACCOUNT_EQUITY_USD');
    expect(idea.lotSize).toBeNull();
  });

  it('refuses an otherwise valid setup when price candles are synthetic', () => {
    const event = newsEvent({ time: NEWS_NOW - 3600, actual: '0.0%', forecast: '0.2%' });
    const idea = createTradeIdea({
      ...inputs(),
      events: [event],
      fundamentals: scoreFundamentals([event], { at: NEWS_NOW }),
      minimumConfluences: 0,
      syntheticData: true,
    });

    expect(idea.direction).toBe('NO_TRADE');
    expect(idea.reason).toContain('synthetic fixture data');
  });

  it('returns auditable NO_TRADE when live price candles are unavailable', () => {
    const emptyCandles: ReturnType<typeof inputs>['candles'] = {
      D1: [],
      H4: [],
      H1: [],
      M15: [],
    };
    const idea = createTradeIdea({
      ...inputs(),
      candles: emptyCandles,
      priceSource: 'twelvedata',
      priceCandleTimestamp: null,
      priceUnavailableReason: '[twelvedata] network request failed',
    });

    expect(idea.direction).toBe('NO_TRADE');
    expect(idea.reason).toContain('Price source unavailable');
    expect(idea.reason).toContain('network request failed');
    expect(idea.snapshot.priceSource).toBe('twelvedata');
    expect(idea.snapshot.priceCandleTimestamp).toBeNull();
    expect(idea.entryLow).toBeNull();
  });

  it('invalidates a stored directional idea when a later news blackout begins', () => {
    const releaseTime = NEWS_NOW + 3600;
    const oldNews = newsEvent({ time: NEWS_NOW - 3600, actual: '0.0%', forecast: '0.2%' });
    const oldIdea = createTradeIdea({
      ...inputs(),
      events: [oldNews],
      fundamentals: scoreFundamentals([oldNews], { at: NEWS_NOW }),
      at: NEWS_NOW,
      minimumConfluences: 0,
    });
    const upcoming = newsEvent({ time: releaseTime });
    const blocked = enforceCurrentBlackout(oldIdea, [upcoming], releaseTime - 30 * 60);

    expect(oldIdea.direction).toBe('BUY');
    expect(blocked.direction).toBe('NO_TRADE');
    expect(blocked.entryLow).toBeNull();
    expect(blocked.riskMath).toBeNull();
    expect(blocked.reason).toContain('invalidated for today');
  });

  it('invalidates a stored directional idea when the calendar can no longer be read', () => {
    // A stored idea is re-checked against the calendar before it is served. If
    // the calendar is gone we cannot confirm the idea is outside a news window,
    // and an idea we cannot confirm is not one to hand out.
    const oldNews = newsEvent({ time: NEWS_NOW - 3600, actual: '0.0%', forecast: '0.2%' });
    const oldIdea = createTradeIdea({
      ...inputs(),
      events: [oldNews],
      fundamentals: scoreFundamentals([oldNews], { at: NEWS_NOW }),
      at: NEWS_NOW,
      minimumConfluences: 0,
    });

    const blocked = enforceCurrentBlackout(oldIdea, [], NEWS_NOW + 3600, {
      calendarAvailable: false,
      calendarUnavailableReason: 'feed returned HTTP 503',
    });

    expect(oldIdea.direction).toBe('BUY');
    expect(blocked.direction).toBe('NO_TRADE');
    expect(blocked.lotSize).toBeNull();
    expect(blocked.reason).toMatch(/news calendar is unavailable/);
    expect(blocked.reason).toMatch(/feed returned HTTP 503/);
  });

  it('leaves a stored idea alone when the calendar is read and quiet', () => {
    // The flag has to default to "available" so a caller passing a calendar it
    // already holds keeps the plain behaviour.
    const oldNews = newsEvent({ time: NEWS_NOW - 3600, actual: '0.0%', forecast: '0.2%' });
    const oldIdea = createTradeIdea({
      ...inputs(),
      events: [oldNews],
      fundamentals: scoreFundamentals([oldNews], { at: NEWS_NOW }),
      at: NEWS_NOW,
      minimumConfluences: 0,
    });

    expect(enforceCurrentBlackout(oldIdea, [], NEWS_NOW + 3600)).toBe(oldIdea);
    expect(
      enforceCurrentBlackout(oldIdea, [], NEWS_NOW + 3600, { calendarAvailable: true }),
    ).toBe(oldIdea);
  });
});