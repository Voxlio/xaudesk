import type { Candle } from '../data/types';
import { ema, latest, sma, wilderSmooth, type IndicatorSeries } from './ema';
import { rsi, rsiZone, type RsiZone } from './rsi';
import { atr, atrPercent, trueRange } from './atr';
import { analyzeStructure, type StructureAnalysis, type Trend } from './structure';

export { ema, sma, wilderSmooth, latest } from './ema';
export type { IndicatorSeries } from './ema';
export { rsi, rsiZone } from './rsi';
export type { RsiZone } from './rsi';
export { atr, atrPercent, trueRange } from './atr';
export {
  analyzeStructure,
  classifyTrend,
  findSwingPoints,
} from './structure';
export type {
  BreakDirection,
  StructureAnalysis,
  StructureBreak,
  StructureOptions,
  SwingKind,
  SwingPoint,
  Trend,
} from './structure';

/**
 * Everything the strategy layer reads off a single timeframe, computed once.
 *
 * Series are returned alongside the latest values so the UI can draw them and
 * the strategy can explain itself — the reason string on a trade idea has to be
 * traceable to actual numbers, not a black box.
 */
export interface IndicatorSnapshot {
  bars: number;
  lastClose: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  rsi14Zone: RsiZone | null;
  atr14: number | null;
  atr14Percent: number | null;
  trend: Trend;
  structure: StructureAnalysis;
  series: {
    ema50: IndicatorSeries;
    ema200: IndicatorSeries;
    rsi14: IndicatorSeries;
    atr14: IndicatorSeries;
  };
}

export interface SnapshotOptions {
  fastEmaPeriod?: number;
  slowEmaPeriod?: number;
  rsiPeriod?: number;
  atrPeriod?: number;
  swingLookback?: number;
}

export function indicatorSnapshot(
  candles: readonly Candle[],
  options: SnapshotOptions = {},
): IndicatorSnapshot {
  const {
    fastEmaPeriod = 50,
    slowEmaPeriod = 200,
    rsiPeriod = 14,
    atrPeriod = 14,
    swingLookback = 2,
  } = options;

  const closes = candles.map((candle) => candle.close);

  const emaFast = ema(closes, fastEmaPeriod);
  const emaSlow = ema(closes, slowEmaPeriod);
  const rsiSeries = rsi(closes, rsiPeriod);
  const atrSeries = atr(candles, atrPeriod);
  const atrPercentSeries = atrPercent(candles, atrPeriod);
  const structure = analyzeStructure(candles, { lookback: swingLookback });

  const rsiLatest = latest(rsiSeries);

  return {
    bars: candles.length,
    lastClose: closes.at(-1) ?? null,
    ema50: latest(emaFast),
    ema200: latest(emaSlow),
    rsi14: rsiLatest,
    rsi14Zone: rsiZone(rsiLatest),
    atr14: latest(atrSeries),
    atr14Percent: latest(atrPercentSeries),
    trend: structure.trend,
    structure,
    series: {
      ema50: emaFast,
      ema200: emaSlow,
      rsi14: rsiSeries,
      atr14: atrSeries,
    },
  };
}

// Re-exported so callers can compute raw TR without importing from ./atr.
export const indicators = { ema, sma, wilderSmooth, rsi, atr, atrPercent, trueRange, analyzeStructure };
