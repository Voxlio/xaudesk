import type { Candle } from '../data/types';
import { atr } from '../indicators/atr';
import { ema } from '../indicators/ema';
import { rsi } from '../indicators/rsi';

export type TradeSide = 'long' | 'short';
export type ExitReason = 'stop-loss' | 'take-profit' | 'end-of-period';

export interface BacktestOptions {
  initialBalance?: number;
  riskPercent?: number;
  spreadDollars?: number;
  slippageDollars?: number;
  fastEmaPeriod?: number;
  slowEmaPeriod?: number;
  rsiPeriod?: number;
  atrPeriod?: number;
  stopAtrMultiple?: number;
  rewardRiskMultiple?: number;
  trainFraction?: number;
}

export interface BacktestTrade {
  side: TradeSide;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  ounces: number;
  pnl: number;
  exitReason: ExitReason;
}

export interface EquityPoint {
  time: number;
  equity: number;
}

export interface BacktestMetrics {
  initialBalance: number;
  endingBalance: number;
  netProfit: number;
  profitFactor: number | null;
  winRate: number;
  maxDrawdownDollars: number;
  maxDrawdownPercent: number;
  tradeCount: number;
}

export interface BacktestSegment {
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
}

export interface BacktestResult {
  splitIndex: number;
  splitTime: number;
  totalBars: number;
  inSample: BacktestSegment;
  outOfSample: BacktestSegment;
}

interface OpenPosition {
  side: TradeSide;
  entryTime: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  ounces: number;
}

const DEFAULTS = {
  initialBalance: 100,
  riskPercent: 1,
  spreadDollars: 0.3,
  slippageDollars: 0.1,
  fastEmaPeriod: 50,
  slowEmaPeriod: 200,
  rsiPeriod: 14,
  atrPeriod: 14,
  stopAtrMultiple: 1.5,
  rewardRiskMultiple: 2,
  trainFraction: 0.7,
} as const;

/** Replay a causal H4 EMA/RSI baseline over chronological 70/30 segments. */
export function runBacktest(
  candles: readonly Candle[],
  options: BacktestOptions = {},
): BacktestResult {
  const settings: Required<BacktestOptions> = { ...DEFAULTS, ...options };
  validateInputs(candles, settings);

  const splitIndex = Math.floor(candles.length * settings.trainFraction);
  const closes = candles.map((candle) => candle.close);
  const fastEma = ema(closes, settings.fastEmaPeriod);
  const slowEma = ema(closes, settings.slowEmaPeriod);
  const rsiSeries = rsi(closes, settings.rsiPeriod);
  const atrSeries = atr(candles, settings.atrPeriod);

  return {
    splitIndex,
    splitTime: candles[splitIndex]!.time,
    totalBars: candles.length,
    inSample: simulateSegment(candles, 0, splitIndex, settings, {
      fastEma,
      slowEma,
      rsi: rsiSeries,
      atr: atrSeries,
    }),
    outOfSample: simulateSegment(candles, splitIndex, candles.length, settings, {
      fastEma,
      slowEma,
      rsi: rsiSeries,
      atr: atrSeries,
    }),
  };
}

function validateInputs(candles: readonly Candle[], settings: Required<BacktestOptions>): void {
  if (candles.length < settings.slowEmaPeriod + 3) {
    throw new Error(`backtest needs at least ${settings.slowEmaPeriod + 3} candles`);
  }
  if (!Number.isFinite(settings.initialBalance) || settings.initialBalance <= 0) {
    throw new Error('initialBalance must be greater than zero');
  }
  if (!Number.isFinite(settings.riskPercent) || settings.riskPercent <= 0 || settings.riskPercent > 100) {
    throw new Error('riskPercent must be between 0 and 100');
  }
  if (!Number.isFinite(settings.spreadDollars) || settings.spreadDollars < 0) {
    throw new Error('spreadDollars must be zero or greater');
  }
  if (!Number.isFinite(settings.slippageDollars) || settings.slippageDollars < 0) {
    throw new Error('slippageDollars must be zero or greater');
  }
  if (!Number.isFinite(settings.trainFraction) || settings.trainFraction <= 0 || settings.trainFraction >= 1) {
    throw new Error('trainFraction must be between zero and one');
  }
  for (let index = 1; index < candles.length; index += 1) {
    if (candles[index]!.time <= candles[index - 1]!.time) {
      throw new Error('candles must be strictly chronological');
    }
  }
}

function simulateSegment(
  candles: readonly Candle[],
  startIndex: number,
  endIndex: number,
  settings: Required<BacktestOptions>,
  indicators: {
    fastEma: (number | null)[];
    slowEma: (number | null)[];
    rsi: (number | null)[];
    atr: (number | null)[];
  },
): BacktestSegment {
  let balance = settings.initialBalance;
  let position: OpenPosition | null = null;
  let canEnterNextBar = false;
  let lastEntryDay = '';
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [
    { time: candles[startIndex]!.time, equity: settings.initialBalance },
  ];
  const exitFeePerOunce = settings.spreadDollars / 2 + settings.slippageDollars;

  for (let index = startIndex; index < endIndex; index += 1) {
    const candle = candles[index]!;

    if (
      position === null &&
      canEnterNextBar &&
      index > startIndex &&
      balance > 0
    ) {
      const signalIndex = index - 1;
      const side = signalAt(signalIndex, candles, indicators);
      const utcDay = new Date(candle.time * 1000).toISOString().slice(0, 10);
      if (side !== null && utcDay !== lastEntryDay) {
        const signalAtr = indicators.atr[signalIndex];
        if (signalAtr != null && signalAtr > 0) {
          const entryFeePerOunce = exitFeePerOunce;
          const entryPrice = candle.open + (side === 'long' ? entryFeePerOunce : -entryFeePerOunce);
          const stopLoss =
            candles[signalIndex]!.close +
            (side === 'long' ? -1 : 1) * signalAtr * settings.stopAtrMultiple;
          const riskPerOunce =
            (side === 'long' ? entryPrice - stopLoss : stopLoss - entryPrice) + exitFeePerOunce;

          if (riskPerOunce > 0) {
            const ounces = (balance * settings.riskPercent) / 100 / riskPerOunce;
            const takeProfit =
              entryPrice +
              (side === 'long' ? 1 : -1) *
                (exitFeePerOunce + riskPerOunce * settings.rewardRiskMultiple);
            position = {
              side,
              entryTime: candle.time,
              entryPrice,
              stopLoss,
              takeProfit,
              ounces,
            };
            lastEntryDay = utcDay;
          }
        }
      }
    }

    if (position !== null) {
      const exit = findExit(position, candle, exitFeePerOunce);
      if (exit !== null) {
        const pnl = position.side === 'long'
          ? (exit.price - position.entryPrice) * position.ounces
          : (position.entryPrice - exit.price) * position.ounces;
        balance += pnl;
        trades.push({
          side: position.side,
          entryTime: position.entryTime,
          exitTime: candle.time,
          entryPrice: position.entryPrice,
          exitPrice: exit.price,
          stopLoss: position.stopLoss,
          takeProfit: position.takeProfit,
          ounces: position.ounces,
          pnl,
          exitReason: exit.reason,
        });
        position = null;
      }
    }

    canEnterNextBar = position === null;
    const floatingPnl = position === null ? 0 : markToMarket(position, candle.close, exitFeePerOunce);
    equityCurve.push({ time: candle.time, equity: balance + floatingPnl });
  }

  if (position !== null) {
    const lastCandle = candles[endIndex - 1]!;
    const exitPrice = liquidate(position, lastCandle.close, exitFeePerOunce);
    const pnl = position.side === 'long'
      ? (exitPrice - position.entryPrice) * position.ounces
      : (position.entryPrice - exitPrice) * position.ounces;
    balance += pnl;
    trades.push({
      side: position.side,
      entryTime: position.entryTime,
      exitTime: lastCandle.time,
      entryPrice: position.entryPrice,
      exitPrice,
      stopLoss: position.stopLoss,
      takeProfit: position.takeProfit,
      ounces: position.ounces,
      pnl,
      exitReason: 'end-of-period',
    });
    equityCurve[equityCurve.length - 1] = { time: lastCandle.time, equity: balance };
  }

  return {
    metrics: calculateMetrics(settings.initialBalance, balance, trades, equityCurve),
    trades,
    equityCurve,
  };
}

function signalAt(
  index: number,
  candles: readonly Candle[],
  indicators: {
    fastEma: (number | null)[];
    slowEma: (number | null)[];
    rsi: (number | null)[];
  },
): TradeSide | null {
  if (index < 1) return null;
  const fast = indicators.fastEma[index];
  const slow = indicators.slowEma[index];
  const rsiNow = indicators.rsi[index];
  const rsiPrevious = indicators.rsi[index - 1];
  if (fast == null || slow == null || rsiNow == null || rsiPrevious == null) return null;

  const close = candles[index]!.close;
  if (fast > slow && close > fast && rsiPrevious <= 50 && rsiNow > 50) return 'long';
  if (fast < slow && close < fast && rsiPrevious >= 50 && rsiNow < 50) return 'short';
  return null;
}

function findExit(
  position: OpenPosition,
  candle: Candle,
  exitFeePerOunce: number,
): { price: number; reason: ExitReason } | null {
  if (position.side === 'long') {
    const stopHit = candle.low <= position.stopLoss;
    const targetHit = candle.high >= position.takeProfit;
    if (stopHit) {
      const marketPrice = candle.open < position.stopLoss ? candle.open : position.stopLoss;
      return { price: marketPrice - exitFeePerOunce, reason: 'stop-loss' };
    }
    if (targetHit) {
      const marketPrice = candle.open > position.takeProfit ? candle.open : position.takeProfit;
      return { price: marketPrice - exitFeePerOunce, reason: 'take-profit' };
    }
  } else {
    const stopHit = candle.high >= position.stopLoss;
    const targetHit = candle.low <= position.takeProfit;
    if (stopHit) {
      const marketPrice = candle.open > position.stopLoss ? candle.open : position.stopLoss;
      return { price: marketPrice + exitFeePerOunce, reason: 'stop-loss' };
    }
    if (targetHit) {
      const marketPrice = candle.open < position.takeProfit ? candle.open : position.takeProfit;
      return { price: marketPrice + exitFeePerOunce, reason: 'take-profit' };
    }
  }
  return null;
}

function liquidate(position: OpenPosition, marketPrice: number, fee: number): number {
  return position.side === 'long' ? marketPrice - fee : marketPrice + fee;
}

function markToMarket(position: OpenPosition, close: number, fee: number): number {
  const liquidationPrice = liquidate(position, close, fee);
  return position.side === 'long'
    ? (liquidationPrice - position.entryPrice) * position.ounces
    : (position.entryPrice - liquidationPrice) * position.ounces;
}

function calculateMetrics(
  initialBalance: number,
  endingBalance: number,
  trades: readonly BacktestTrade[],
  equityCurve: readonly EquityPoint[],
): BacktestMetrics {
  const grossProfit = trades.reduce((sum, trade) => sum + Math.max(0, trade.pnl), 0);
  const grossLoss = trades.reduce((sum, trade) => sum + Math.max(0, -trade.pnl), 0);
  let peak = initialBalance;
  let maxDrawdownDollars = 0;
  let maxDrawdownPercent = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    const drawdown = peak - point.equity;
    maxDrawdownDollars = Math.max(maxDrawdownDollars, drawdown);
    if (peak > 0) maxDrawdownPercent = Math.max(maxDrawdownPercent, (drawdown / peak) * 100);
  }

  return {
    initialBalance,
    endingBalance,
    netProfit: endingBalance - initialBalance,
    profitFactor: grossLoss === 0 ? null : grossProfit / grossLoss,
    winRate: trades.length === 0 ? 0 : (trades.filter((trade) => trade.pnl > 0).length / trades.length) * 100,
    maxDrawdownDollars,
    maxDrawdownPercent,
    tradeCount: trades.length,
  };
}