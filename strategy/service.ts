import { getMacroAdapter } from '../data/macro';
import { getPriceAdapter } from '../data/price';
import type { Candle, Timeframe } from '../data/types';
import { newsAdapter } from '../lib/newsAdapter';
import { prisma } from '../lib/prisma';
import { createTradeIdea, enforceCurrentBlackout, readCalendar, readFundamentals, type TradeIdea } from './index';

const CANDLE_LIMITS: Record<Timeframe, number> = {
  D1: 300,
  H4: 400,
  H1: 400,
  M15: 400,
};
const PRICE_UNAVAILABLE_RETRY_SECONDS = 5 * 60;

export function shouldRetryPriceUnavailable(
  snapshot: Pick<TradeIdea['snapshot'], 'asOf' | 'priceUnavailableReason'>,
  at: number,
): boolean {
  return snapshot.priceUnavailableReason !== null &&
    at - snapshot.asOf >= PRICE_UNAVAILABLE_RETRY_SECONDS;
}

export async function getDailyTradeIdea(at = Math.floor(Date.now() / 1000)): Promise<TradeIdea> {
  const tradeDate = new Date(at * 1000).toISOString().slice(0, 10);
  const existing = await prisma.tradeIdea.findUnique({ where: { tradeDate } });
  let priceAdapter: Awaited<ReturnType<typeof getPriceAdapter>> | null = null;
  let adapterFailure: string | null = null;
  try {
    priceAdapter = await getPriceAdapter();
  } catch (cause) {
    adapterFailure = cause instanceof Error ? cause.message : String(cause);
  }

  if (existing !== null) {
    const cachedIdea = restoreIdea(existing);
    if (priceAdapter === null) {
      const unavailable = await buildPriceUnavailableIdea(at, adapterFailure ?? 'live adapter could not be initialized');
      await prisma.tradeIdea.update({ where: { tradeDate }, data: persistenceData(unavailable) });
      return unavailable;
    }
    const priceUnavailableRetryDue = shouldRetryPriceUnavailable(cachedIdea.snapshot, at);
    if (
      cachedIdea.syntheticData ||
      cachedIdea.snapshot.priceSource !== priceAdapter.name ||
      priceUnavailableRetryDue
    ) {
      await prisma.tradeIdea.delete({ where: { tradeDate } });
    } else {
      if (cachedIdea.direction !== 'NO_TRADE') {
      const currentCalendar = await readCalendar(newsAdapter());
      const protectedIdea = enforceCurrentBlackout(cachedIdea, currentCalendar.events, at, {
        calendarAvailable: currentCalendar.available,
        calendarUnavailableReason: currentCalendar.reason,
      });
      if (protectedIdea.direction === 'NO_TRADE') {
        await prisma.tradeIdea.update({
          where: { tradeDate },
          data: persistenceData(protectedIdea),
        });
        return protectedIdea;
      }
      }
      return cachedIdea;
    }
  }

  if (priceAdapter === null) {
    const unavailable = await buildPriceUnavailableIdea(at, adapterFailure ?? 'live adapter could not be initialized');
    return saveNewIdea(unavailable);
  }

  let candlesByTimeframe: Record<Timeframe, Candle[]>;
  try {
    candlesByTimeframe = await fetchCandles(priceAdapter);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    const unavailable = await buildPriceUnavailableIdea(at, reason, priceAdapter.name);
    return saveNewIdea(unavailable);
  }
  const lastM15 = candlesByTimeframe.M15.at(-1);
  if (lastM15 === undefined) {
    const unavailable = await buildPriceUnavailableIdea(at, 'the provider returned no M15 candles', priceAdapter.name);
    return saveNewIdea(unavailable);
  }

  const fundamentalRead = await readFundamentals({
    news: newsAdapter(),
    macro: getMacroAdapter(),
    at,
  });
  const settings = await prisma.appSettings.findUnique({ where: { id: 'default' } });
  const equityUsd = settings?.equityUsd ?? parsePositive(process.env.ACCOUNT_EQUITY_USD);
  const configuredRisk = settings?.riskPercent ?? parsePositive(process.env.ACCOUNT_RISK_PERCENT ?? process.env.RISK_PERCENT);
  const idea = createTradeIdea({
    candles: candlesByTimeframe,
    events: fundamentalRead.events,
    fundamentals: fundamentalRead.score,
    blackout: fundamentalRead.blackout,
    equityUsd,
    riskPercent: configuredRisk ?? 1,
    centLotStep: settings?.centLotStep ?? parsePositive(process.env.ACCOUNT_CENT_LOT_STEP) ?? 0.01,
    minimumCentLot: settings?.centLotMin ?? parsePositive(process.env.ACCOUNT_CENT_MIN_LOT) ?? 0.01,
    at,
    symbol: priceAdapter.symbol,
    priceSource: priceAdapter.name,
    priceCandleTimestamp: lastM15.time,
  });

  return saveNewIdea(idea);
}

async function saveNewIdea(idea: TradeIdea): Promise<TradeIdea> {
  const tradeDate = idea.tradeDate;
  try {
    await prisma.tradeIdea.create({ data: persistenceData(idea) });
    return idea;
  } catch (cause) {
    if (isUniqueConflict(cause)) {
      const winner = await prisma.tradeIdea.findUnique({ where: { tradeDate } });
      if (winner !== null) return restoreIdea(winner);
    }
    throw cause;
  }
}

async function buildPriceUnavailableIdea(
  at: number,
  reason: string,
  attemptedSource = 'unavailable',
): Promise<TradeIdea> {
  const fundamentalRead = await readFundamentals({
    news: newsAdapter(),
    macro: getMacroAdapter(),
    at,
  });
  const emptyCandles: Record<Timeframe, Candle[]> = { D1: [], H4: [], H1: [], M15: [] };
  return createTradeIdea({
    candles: emptyCandles,
    events: fundamentalRead.events,
    fundamentals: fundamentalRead.score,
    blackout: fundamentalRead.blackout,
    equityUsd: null,
    at,
    symbol: 'XAUUSD',
    priceSource: attemptedSource,
    priceCandleTimestamp: null,
    priceUnavailableReason: reason,
  });
}

async function fetchCandles(adapter: Awaited<ReturnType<typeof getPriceAdapter>>): Promise<Record<Timeframe, Candle[]>> {
  const entries = await Promise.all(
    (Object.keys(CANDLE_LIMITS) as Timeframe[]).map(async (timeframe) => [
      timeframe,
      await adapter.fetchCandles({ timeframe, limit: CANDLE_LIMITS[timeframe] }),
    ] as const),
  );
  return Object.fromEntries(entries) as Record<Timeframe, Candle[]>;
}

function restoreIdea(row: Awaited<ReturnType<typeof prisma.tradeIdea.findUnique>> & object): TradeIdea {
  const stored = JSON.parse(row.snapshot ?? '{}') as {
    snapshot?: TradeIdea['snapshot'];
    riskMath?: TradeIdea['riskMath'];
    confluenceEvidence?: TradeIdea['confluenceEvidence'];
    disclaimer?: string;
    syntheticData?: boolean;
  };
  return {
    tradeDate: row.tradeDate,
    symbol: row.symbol,
    direction: row.direction as TradeIdea['direction'],
    entryLow: row.entryLow,
    entryHigh: row.entryHigh,
    stopLoss: row.stopLoss,
    takeProfit1: row.takeProfit1,
    takeProfit2: row.takeProfit2,
    takeProfit3: row.takeProfit3,
    riskReward: row.riskReward,
    confidence: row.confidence,
    lotSize: row.lotSize,
    reason: row.reason,
    disclaimer: stored.disclaimer ?? 'Educational tool only. Not financial advice.',
    syntheticData: stored.syntheticData ?? false,
    biasD1: (row.biasD1 ?? 'NEUTRAL') as TradeIdea['biasD1'],
    biasH4: (row.biasH4 ?? 'NEUTRAL') as TradeIdea['biasH4'],
    biasFundamental: (row.biasFundamental ?? 'NEUTRAL') as TradeIdea['biasFundamental'],
    confluences: JSON.parse(row.confluences ?? '[]') as string[],
    confluenceEvidence: stored.confluenceEvidence ?? [],
    riskMath: stored.riskMath ?? null,
    snapshot: stored.snapshot ?? {
      asOf: Math.floor(row.createdAt.getTime() / 1000),
      priceSource: 'stored',
      priceCandleTimestamp: null,
      priceUnavailableReason: null,
      fundamentals: {} as TradeIdea['snapshot']['fundamentals'],
      blackout: {} as TradeIdea['snapshot']['blackout'],
      timeframes: [],
      entryPrice: null,
      stopDistance: null,
      events: [],
    },
  };
}

function parsePositive(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function persistenceData(idea: TradeIdea) {
  return {
    tradeDate: idea.tradeDate,
    symbol: idea.symbol,
    direction: idea.direction,
    entryLow: idea.entryLow,
    entryHigh: idea.entryHigh,
    stopLoss: idea.stopLoss,
    takeProfit1: idea.takeProfit1,
    takeProfit2: idea.takeProfit2,
    takeProfit3: idea.takeProfit3,
    riskReward: idea.riskReward,
    confidence: idea.confidence,
    lotSize: idea.lotSize,
    reason: idea.reason,
    snapshot: JSON.stringify({
      snapshot: idea.snapshot,
      riskMath: idea.riskMath,
      confluenceEvidence: idea.confluenceEvidence,
      disclaimer: idea.disclaimer,
      syntheticData: idea.syntheticData,
    }),
    biasD1: idea.biasD1,
    biasH4: idea.biasH4,
    biasFundamental: idea.biasFundamental,
    confluences: JSON.stringify(idea.confluences),
  };
}