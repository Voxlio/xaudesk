import type { Candle, NewsEvent } from '../data/types';
import { analyzeStructure, type StructureAnalysis, type SwingPoint, type Trend } from '../indicators/structure';
import { atr } from '../indicators/atr';
import { ema, latest } from '../indicators/ema';
import { rsi } from '../indicators/rsi';
import { calculateCentLots, type CentLotBreakdown } from '../risk';
import { blackoutStatus, calendarUnavailableBlackout, type BlackoutStatus } from './blackout';
import { scoreFundamentals, type FundamentalScore } from './fundamental';

export type TradeDirection = 'BUY' | 'SELL' | 'NO_TRADE';
export type DirectionalBias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface ConfluenceEvidence {
  name: 'Supply/demand zone' | 'Liquidity sweep' | 'BOS pullback' | 'RSI' | 'EMA alignment';
  passed: boolean;
  detail: string;
}

export interface TimeframeRead {
  timeframe: 'D1' | 'H4' | 'H1' | 'M15';
  close: number;
  ema50: number | null;
  ema200: number | null;
  trend: Trend;
  bias: DirectionalBias;
  lastSwingHigh: number | null;
  lastSwingLow: number | null;
}

export interface TradeIdea {
  tradeDate: string;
  symbol: string;
  direction: TradeDirection;
  entryLow: number | null;
  entryHigh: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  takeProfit3: number | null;
  riskReward: number | null;
  confidence: number;
  lotSize: number | null;
  reason: string;
  disclaimer: string;
  syntheticData: boolean;
  biasD1: DirectionalBias;
  biasH4: DirectionalBias;
  biasFundamental: DirectionalBias;
  confluences: string[];
  confluenceEvidence: ConfluenceEvidence[];
  riskMath: CentLotBreakdown | null;
  snapshot: {
    asOf: number;
    priceSource: string;
    priceCandleTimestamp: number | null;
    priceUnavailableReason: string | null;
    fundamentals: FundamentalScore;
    blackout: BlackoutStatus;
    timeframes: TimeframeRead[];
    entryPrice: number | null;
    stopDistance: number | null;
    events: NewsEvent[];
  };
}

export interface CreateTradeIdeaOptions {
  candles: Record<'D1' | 'H4' | 'H1' | 'M15', readonly Candle[]>;
  events: readonly NewsEvent[];
  fundamentals?: FundamentalScore;
  blackout?: BlackoutStatus;
  equityUsd: number | null;
  riskPercent?: number;
  centLotStep?: number;
  minimumCentLot?: number;
  at?: number;
  symbol?: string;
  priceSource?: string;
  priceCandleTimestamp?: number | null;
  priceUnavailableReason?: string | null;
  syntheticData?: boolean;
  minimumConfluences?: number;
}

export interface EnforceBlackoutOptions {
  /**
   * False when no calendar could be read. Defaults to true, so a caller that
   * passes a calendar it already holds keeps the plain behaviour; pass the flag
   * through from `readCalendar` when the events came off an adapter.
   */
  calendarAvailable?: boolean;
  /** Why the calendar is unavailable, for the reason string. */
  calendarUnavailableReason?: string | null;
}

export function enforceCurrentBlackout(
  idea: TradeIdea,
  events: readonly NewsEvent[],
  at: number,
  options: EnforceBlackoutOptions = {},
): TradeIdea {
  if (idea.direction === 'NO_TRADE') return idea;

  // A stored idea is re-checked against the calendar before it is served. If
  // the calendar is gone we can no longer confirm the idea is outside a news
  // window, and an idea we cannot confirm is not one to hand out.
  const blackout =
    options.calendarAvailable === false
      ? calendarUnavailableBlackout(options.calendarUnavailableReason ?? 'cause not reported')
      : blackoutStatus(events, at);
  if (!blackout.blocked) return idea;

  return {
    ...idea,
    direction: 'NO_TRADE',
    entryLow: null,
    entryHigh: null,
    stopLoss: null,
    takeProfit1: null,
    takeProfit2: null,
    takeProfit3: null,
    riskReward: null,
    lotSize: null,
    confluences: [],
    riskMath: null,
    reason: `No trade: ${blackout.reason ?? 'high-impact USD news blackout is active'}. The previously generated setup is invalidated for today. ${idea.reason}`,
    snapshot: { ...idea.snapshot, asOf: at, blackout, events: [...events] },
  };
}

const DISCLAIMER =
  'Educational tool only. Not financial advice or a recommendation. Trading leveraged XAU/USD can result in substantial losses.';
const MINIMUM_CONFLUENCES = 3;

export function createTradeIdea(options: CreateTradeIdeaOptions): TradeIdea {
  const at = options.at ?? Math.floor(Date.now() / 1000);
  const tradeDate = new Date(at * 1000).toISOString().slice(0, 10);
  const fundamentals = options.fundamentals ?? scoreFundamentals(options.events, { at });
  const blackout = options.blackout ?? blackoutStatus(options.events, at);
  const timeframes = (['D1', 'H4', 'H1', 'M15'] as const).map((timeframe) =>
    readTimeframe(timeframe, options.candles[timeframe]),
  );
  const daily = timeframes[0]!;
  const fourHour = timeframes[1]!;
  const technicalBias = daily.bias !== 'NEUTRAL' && daily.bias === fourHour.bias
    ? daily.bias
    : 'NEUTRAL';
  const entry = evaluateConfluences(options.candles.H1, options.candles.M15, technicalBias);
  const evidence = entry.evidence;
  const passed = evidence.filter((item) => item.passed);
  const minimumConfluences = options.minimumConfluences ?? MINIMUM_CONFLUENCES;
  const confidence = Math.round((passed.length / evidence.length) * 50 + fundamentals.confidence * 0.5);
  const snapshot = {
    asOf: at,
    priceSource: options.priceSource ?? 'unknown',
    priceCandleTimestamp: options.priceCandleTimestamp ?? options.candles.M15.at(-1)?.time ?? null,
    priceUnavailableReason: options.priceUnavailableReason ?? null,
    fundamentals,
    blackout,
    timeframes,
    entryPrice: entry.price,
    stopDistance: null as number | null,
    events: [...options.events],
  };
  const base: Omit<TradeIdea, 'reason' | 'snapshot'> = {
    tradeDate,
    symbol: options.symbol ?? 'XAUUSD',
    direction: 'NO_TRADE',
    entryLow: null,
    entryHigh: null,
    stopLoss: null,
    takeProfit1: null,
    takeProfit2: null,
    takeProfit3: null,
    riskReward: null,
    confidence,
    lotSize: null,
    disclaimer: DISCLAIMER,
    syntheticData: options.syntheticData ?? false,
    biasD1: daily.bias,
    biasH4: fourHour.bias,
    biasFundamental: fundamentals.goldBias,
    confluences: passed.map((item) => item.name),
    confluenceEvidence: evidence,
    riskMath: null,
  };

  const explanation = [
    `D1 ${daily.bias.toLowerCase()} (close ${format(daily.close)}, EMA50 ${formatNullable(daily.ema50)}, EMA200 ${formatNullable(daily.ema200)}, ${daily.trend});`,
    `H4 ${fourHour.bias.toLowerCase()} (close ${format(fourHour.close)}, EMA50 ${formatNullable(fourHour.ema50)}, EMA200 ${formatNullable(fourHour.ema200)}, ${fourHour.trend}).`,
    fundamentals.reason,
    ...evidence.map((item) => `${item.passed ? 'Confirmed' : 'Not confirmed'}: ${item.detail}.`),
  ].join(' ');
  const noTrade = (reason: string): TradeIdea => ({
    ...base,
    reason: `${reason} ${explanation}`,
    snapshot,
  });

  if (options.priceUnavailableReason) {
    return noTrade(`Price source unavailable (${options.priceSource ?? 'XAU/USD'}): ${options.priceUnavailableReason}. No trade issued.`);
  }
  if (options.syntheticData === true) {
    return noTrade('No trade: the configured price source is synthetic fixture data, not market history.');
  }
  if (daily.bias === 'NEUTRAL' || fourHour.bias === 'NEUTRAL' || daily.bias !== fourHour.bias) {
    return noTrade('No trade: D1 and H4 technical bias are not aligned.');
  }
  if (blackout.blocked) {
    return noTrade(`No trade: ${blackout.reason ?? 'high-impact USD news blackout is active'}`);
  }
  if (fundamentals.goldBias === 'NEUTRAL' || fundamentals.goldBias !== technicalBias) {
    return noTrade('No trade: fundamental gold bias is neutral or conflicts with D1/H4.');
  }
  if (passed.length < minimumConfluences) {
    return noTrade(`No trade: ${passed.length} of ${minimumConfluences} required entry confluences confirmed.`);
  }
  if (options.equityUsd === null || !Number.isFinite(options.equityUsd) || options.equityUsd <= 0) {
    return noTrade('No trade: ACCOUNT_EQUITY_USD is not configured with a positive USD balance.');
  }

  const direction = technicalBias === 'BULLISH' ? 'BUY' : 'SELL';
  const current = options.candles.M15.at(-1)!;
  const halfZone = Math.max(entry.atr * 0.05, 0.01);
  const entryLow = round(current.close - halfZone, 2);
  const entryHigh = round(current.close + halfZone, 2);
  // Two different edges of the same zone, deliberately. Risk is measured from
  // the *worst* fill we could get, so TP and lot size use the far edge. But the
  // stop has to clear the *best* fill we could get: if it sits inside the zone,
  // a fill at the near edge is already past its own stop, which is not a trade
  // any broker would accept and not one worth taking if they did.
  const entryReference = direction === 'BUY' ? entryHigh : entryLow;
  const protectedEdge = direction === 'BUY' ? entryLow : entryHigh;
  const stopLoss = round(
    findStructuralStop(options.candles.H1, protectedEdge, entry.atr, direction),
    2,
  );
  // Checked after the rounding, not before: snapping to the quote's two decimals
  // can pull a candidate that was a fraction clear of the zone onto its edge.
  const stopClearsZone = direction === 'BUY' ? stopLoss < entryLow : stopLoss > entryHigh;
  if (!stopClearsZone) {
    return noTrade(
      `No trade: the protective stop (${format(stopLoss)}) does not sit beyond the ` +
        `${format(entryLow)}–${format(entryHigh)} entry zone, so a fill at the near ` +
        'edge would already be past it.',
    );
  }
  const stopDistance = direction === 'BUY' ? entryHigh - stopLoss : stopLoss - entryLow;
  if (!Number.isFinite(stopDistance) || stopDistance <= 0) {
    return noTrade('No trade: a valid protective stop could not be placed beyond the entry zone.');
  }

  let riskMath: CentLotBreakdown;
  try {
    riskMath = calculateCentLots({
      equityUsd: options.equityUsd,
      riskPercent: options.riskPercent ?? 1,
      stopDistanceUsdPerOunce: stopDistance,
      lotStep: options.centLotStep,
      minimumLot: options.minimumCentLot,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return noTrade(`No trade: risk inputs are invalid (${message}).`);
  }
  if (!riskMath.minimumLotFitsRisk) {
    return noTrade(
      `No trade: minimum ${riskMath.minimumLot.toFixed(2)} cent lot exceeds the $${riskMath.riskBudgetUsd.toFixed(2)} risk budget at this stop distance.`,
    );
  }

  const sign = direction === 'BUY' ? 1 : -1;
  const takeProfit1 = round(entryReference + sign * stopDistance * 2, 2);
  const takeProfit2 = round(entryReference + sign * stopDistance * 3, 2);
  const takeProfit3 = round(entryReference + sign * stopDistance * 4, 2);
  const riskReward = round(Math.abs(takeProfit1 - entryReference) / stopDistance, 2);
  if (riskReward < 2) {
    return noTrade('No trade: rounded TP1 does not preserve the required minimum 1:2 reward-to-risk.');
  }

  snapshot.stopDistance = stopDistance;
  const riskReason =
    `Risk math: $${riskMath.equityUsd.toFixed(2)} USD equity (${riskMath.terminalBalanceCents.toFixed(0)} account cents) × ` +
    `${riskMath.riskPercent}% = $${riskMath.riskBudgetUsd.toFixed(2)} risk; ` +
    `stop distance $${stopDistance.toFixed(2)}/oz; ${riskMath.centLots.toFixed(2)} cent lots = ` +
    `${riskMath.positionOunces.toFixed(2)} oz; modeled loss $${riskMath.modeledRiskUsd.toFixed(2)}.`;

  return {
    ...base,
    direction,
    entryLow,
    entryHigh,
    stopLoss,
    takeProfit1,
    takeProfit2,
    takeProfit3,
    riskReward,
    lotSize: riskMath.centLots,
    reason:
      `${direction} setup: aligned D1/H4 and ${passed.length} entry confluences. ${explanation} ` +
      `Entry zone ${entryLow.toFixed(2)}–${entryHigh.toFixed(2)}, SL ${stopLoss.toFixed(2)}, ` +
      `TP1 ${takeProfit1.toFixed(2)} (${riskReward.toFixed(2)}R), TP2 ${takeProfit2.toFixed(2)}, ` +
      `TP3 ${takeProfit3.toFixed(2)}. ${riskReason}`,
    confluences: passed.map((item) => item.name),
    confluenceEvidence: evidence,
    riskMath,
    snapshot,
  };
}

function readTimeframe(timeframe: TimeframeRead['timeframe'], candles: readonly Candle[]): TimeframeRead {
  const closes = candles.map((candle) => candle.close);
  const ema50 = latest(ema(closes, 50));
  const ema200 = latest(ema(closes, 200));
  const structure = analyzeStructure(candles);
  const close = candles.at(-1)?.close ?? 0;
  let bias: DirectionalBias = 'NEUTRAL';
  if (ema50 !== null && ema200 !== null) {
    if (structure.trend === 'uptrend' && close > ema50 && ema50 > ema200) bias = 'BULLISH';
    if (structure.trend === 'downtrend' && close < ema50 && ema50 < ema200) bias = 'BEARISH';
  }
  return {
    timeframe,
    close,
    ema50,
    ema200,
    trend: structure.trend,
    bias,
    lastSwingHigh: structure.lastSwingHigh?.price ?? null,
    lastSwingLow: structure.lastSwingLow?.price ?? null,
  };
}

function evaluateConfluences(
  hourly: readonly Candle[],
  fifteenMinute: readonly Candle[],
  bias: DirectionalBias,
): { evidence: ConfluenceEvidence[]; price: number; atr: number } {
  const current = fifteenMinute.at(-1);
  const price = current?.close ?? 0;
  const currentAtr = latest(atr(fifteenMinute)) ?? 0;
  const bullish = bias === 'BULLISH';
  const bearish = bias === 'BEARISH';
  const direction = bullish ? 'bullish' : 'bearish';
  const hourlyStructure = analyzeStructure(hourly);
  const entryStructure = analyzeStructure(fifteenMinute);
  const confirmedSwings = hourlyStructure.swings.filter(
    (swing) => swing.confirmedAtIndex < hourly.length && swing.index >= hourly.length - 100,
  );
  const zones = confirmedSwings
    .filter((swing) => (bullish && swing.kind === 'low') || (bearish && swing.kind === 'high'))
    .map((swing) => ({ swing, zone: zoneAt(hourly[swing.index]!, swing.kind) }));
  const hourlyAtr = latest(atr(hourly)) ?? currentAtr;
  const tolerance = Math.max(hourlyAtr * 0.5, currentAtr * 0.5);
  const matchingZone = zones.find(({ zone }) => price >= zone.low - tolerance && price <= zone.high + tolerance);
  const sweep = findRecentSweep(fifteenMinute, entryStructure.swings, bullish, 4);
  const pullback = findBosPullback(fifteenMinute, entryStructure, bullish, Math.max(currentAtr * 0.25, 0.01));

  const hourlyCloses = hourly.map((candle) => candle.close);
  const entryCloses = fifteenMinute.map((candle) => candle.close);
  const hourlyRsi = latest(rsi(hourlyCloses));
  const entryRsi = latest(rsi(entryCloses));
  const rsiPass = bullish
    ? hourlyRsi !== null && entryRsi !== null && hourlyRsi > 50 && entryRsi > 50 && entryRsi < 70
    : bearish && hourlyRsi !== null && entryRsi !== null && hourlyRsi < 50 && entryRsi < 50 && entryRsi > 30;

  const hourlyEma50 = latest(ema(hourlyCloses, 50));
  const hourlyEma200 = latest(ema(hourlyCloses, 200));
  const entryEma20 = latest(ema(entryCloses, 20));
  const entryEma50 = latest(ema(entryCloses, 50));
  const hourlyClose = hourly.at(-1)?.close ?? 0;
  const emaPass = bullish
    ? hourlyEma50 !== null && hourlyEma200 !== null && entryEma20 !== null && entryEma50 !== null &&
      hourlyClose > hourlyEma50 && hourlyEma50 > hourlyEma200 && price > entryEma20 && price > entryEma50
    : bearish && hourlyEma50 !== null && hourlyEma200 !== null && entryEma20 !== null && entryEma50 !== null &&
      hourlyClose < hourlyEma50 && hourlyEma50 < hourlyEma200 && price < entryEma20 && price < entryEma50;

  return {
    evidence: [
      {
        name: 'Supply/demand zone',
        passed: matchingZone !== undefined && bias !== 'NEUTRAL',
        detail: matchingZone === undefined
          ? `price ${format(price)} is not within ${format(tolerance)} of a confirmed ${bullish ? 'demand' : 'supply'} zone`
          : `price ${format(price)} is near confirmed ${bullish ? 'demand' : 'supply'} zone ${format(matchingZone.zone.low)}–${format(matchingZone.zone.high)} from swing at ${new Date(matchingZone.swing.time * 1000).toISOString()}`,
      },
      {
        name: 'Liquidity sweep',
        passed: sweep !== null && bias !== 'NEUTRAL',
        detail: sweep === null
          ? `no recent ${direction} liquidity sweep reclaimed a confirmed swing level`
          : `${direction} sweep reclaimed ${format(sweep.level)}; close ${format(sweep.close)} on ${new Date(sweep.time * 1000).toISOString()}`,
      },
      {
        name: 'BOS pullback',
        passed: pullback !== null && bias !== 'NEUTRAL',
        detail: pullback === null
          ? `no ${direction} break-of-structure retest confirmed`
          : `${direction} break retested ${format(pullback.level)}; close ${format(pullback.close)} on ${new Date(pullback.time * 1000).toISOString()}`,
      },
      {
        name: 'RSI',
        passed: rsiPass,
        detail: `H1 RSI ${formatNullable(hourlyRsi, 1)}, M15 RSI ${formatNullable(entryRsi, 1)}; ${direction} momentum ${rsiPass ? 'confirmed' : 'not confirmed'}`,
      },
      {
        name: 'EMA alignment',
        passed: emaPass,
        detail: `H1 close ${format(hourlyClose)}, EMA50 ${formatNullable(hourlyEma50)}, EMA200 ${formatNullable(hourlyEma200)}; M15 close ${format(price)}, EMA20 ${formatNullable(entryEma20)}, EMA50 ${formatNullable(entryEma50)}`,
      },
    ],
    price,
    atr: currentAtr,
  };
}

function zoneAt(candle: Candle, kind: SwingPoint['kind']): { low: number; high: number } {
  return kind === 'low'
    ? { low: candle.low, high: Math.min(candle.open, candle.close) }
    : { low: Math.max(candle.open, candle.close), high: candle.high };
}

function findRecentSweep(
  candles: readonly Candle[],
  swings: readonly SwingPoint[],
  bullish: boolean,
  barsBack: number,
): { level: number; close: number; time: number } | null {
  const start = Math.max(0, candles.length - barsBack);
  for (let index = candles.length - 1; index >= start; index -= 1) {
    const candle = candles[index]!;
    const kind = bullish ? 'low' : 'high';
    const swing = swings
      .filter((point) => point.kind === kind && point.confirmedAtIndex < index && point.index >= index - 48)
      .at(-1);
    if (swing === undefined) continue;
    if (bullish && candle.low < swing.price && candle.close > swing.price) {
      return { level: swing.price, close: candle.close, time: candle.time };
    }
    if (!bullish && candle.high > swing.price && candle.close < swing.price) {
      return { level: swing.price, close: candle.close, time: candle.time };
    }
  }
  return null;
}

function findBosPullback(
  candles: readonly Candle[],
  structure: StructureAnalysis,
  bullish: boolean,
  tolerance: number,
): { level: number; close: number; time: number } | null {
  const direction = bullish ? 'bullish' : 'bearish';
  const last = candles.at(-1);
  if (last === undefined) return null;
  const recentBreak = structure.breaks
    .filter((item) => item.direction === direction && item.index >= candles.length - 12 && item.index < candles.length - 1)
    .at(-1);
  if (recentBreak === undefined) return null;
  const level = recentBreak.brokenSwing.price;
  const touched = last.low <= level + tolerance && last.high >= level - tolerance;
  const holds = bullish ? last.close >= level : last.close <= level;
  return touched && holds ? { level, close: last.close, time: last.time } : null;
}

/**
 * The last swing beyond the entry, padded, or an ATR fallback.
 *
 * `nearEdge` is the edge of the entry zone the stop has to stay beyond — the low
 * for a BUY, the high for a SELL — not the current price. Measuring from the
 * price instead would accept a swing that sits *inside* the quoted zone, because
 * a swing low between `entryLow` and the close is below the close and so looks
 * valid. The caller re-checks this after rounding; the check here exists so a
 * zone-invading swing falls back to a usable stop rather than failing the idea.
 */
function findStructuralStop(
  candles: readonly Candle[],
  nearEdge: number,
  atrValue: number,
  direction: 'BUY' | 'SELL',
): number {
  const structure = analyzeStructure(candles);
  const swings = direction === 'BUY' ? structure.swingLows : structure.swingHighs;
  const latestSwing = [...swings].reverse().find((swing) => swing.confirmedAtIndex < candles.length);
  const fallback = direction === 'BUY' ? nearEdge - atrValue * 1.5 : nearEdge + atrValue * 1.5;
  if (latestSwing === undefined) return fallback;
  const candidate = direction === 'BUY'
    ? latestSwing.price - atrValue * 0.1
    : latestSwing.price + atrValue * 0.1;
  const distance = Math.abs(nearEdge - candidate);
  if (direction === 'BUY' ? candidate >= nearEdge : candidate <= nearEdge) return fallback;
  return distance <= atrValue * 3 ? candidate : fallback;
}

function format(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : 'unavailable';
}

function formatNullable(value: number | null, digits = 2): string {
  return value === null ? 'unavailable' : format(value, digits);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}