import { runBacktest } from '../backtest/engine';
import type { Candle } from '../data/types';

function risingSeries(length: number): Candle[] {
  return Array.from({ length }, (_, index) => {
    const close = index < 10 ? 100 : 101;
    return {
      time: 1_800_000_000 + index * 4 * 60 * 60,
      open: index === 0 ? close : index < 10 ? 100 : index === 10 ? 100 : 101,
      high: index === 11 ? 110 : close + 0.5,
      low: index === 11 ? 90 : close - 0.5,
      close,
    };
  });
}

describe('runBacktest', () => {
  const shortWarmup = {
    fastEmaPeriod: 3,
    slowEmaPeriod: 5,
    rsiPeriod: 2,
    atrPeriod: 2,
    spreadDollars: 0.3,
    slippageDollars: 0.1,
  };

  it('uses a chronological 70/30 split and starts each segment at $100', () => {
    const result = runBacktest(risingSeries(40), shortWarmup);

    expect(result.splitIndex).toBe(28);
    expect(result.inSample.equityCurve[0]?.equity).toBe(100);
    expect(result.outOfSample.equityCurve[0]?.equity).toBe(100);
    expect(result.inSample.trades.length).toBeGreaterThan(0);
    expect(result.outOfSample.trades).toHaveLength(0);
  });

  it('charges spread and slippage, risks equity percentage, and resolves ambiguous bars against the trade', () => {
    const result = runBacktest(risingSeries(40), shortWarmup);
    const trade = result.inSample.trades[0];

    expect(trade).toBeDefined();
    expect(trade!.entryPrice).toBeGreaterThan(101);
    expect(trade!.exitReason).toBe('stop-loss');
    expect(trade!.pnl).toBeLessThan(0);
    expect(result.inSample.metrics.endingBalance).toBeLessThan(100);
    expect(result.inSample.metrics.maxDrawdownDollars).toBeGreaterThan(0);
  });

  it('rejects unordered candles and invalid split settings', () => {
    const candles = risingSeries(40);
    expect(() => runBacktest([candles[1]!, candles[0]!, ...candles.slice(2)], shortWarmup)).toThrow(
      /strictly chronological/,
    );
    expect(() => runBacktest(candles, { ...shortWarmup, trainFraction: 1 })).toThrow(
      /trainFraction/,
    );
  });
});