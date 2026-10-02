import { getPriceAdapter } from '../data/price';
import { prisma } from './prisma';
import { OUTCOME_HORIZON_BARS, realisedR, scoreIdeaWindow } from './outcomes';

interface StoredSnapshot {
  snapshot?: { asOf?: number };
}

/** H1 bars fetched to score against — about 41 days of market. */
const OUTCOME_WINDOW_BARS = 1000;

export async function refreshTradeOutcomes() {
  const [ideas, adapter] = await Promise.all([
    prisma.tradeIdea.findMany({ include: { outcome: true }, orderBy: { tradeDate: 'desc' } }),
    getPriceAdapter(),
  ]);
  const candles = await adapter.fetchCandles({ timeframe: 'H1', limit: OUTCOME_WINDOW_BARS });
  let checked = 0;
  let closed = 0;
  let unscorable = 0;
  let expired = 0;

  for (const idea of ideas) {
    if (idea.outcome !== null && idea.outcome.status !== 'OPEN') continue;
    if (idea.direction !== 'BUY' && idea.direction !== 'SELL') {
      await prisma.tradeOutcome.upsert({
        where: { tradeIdeaId: idea.id },
        create: { tradeIdeaId: idea.id, status: 'NO_TRADE' },
        update: { status: 'NO_TRADE' },
      });
      checked += 1;
      continue;
    }

    const snapshot = JSON.parse(idea.snapshot ?? '{}') as StoredSnapshot;
    const since = snapshot.snapshot?.asOf ?? Math.floor(idea.createdAt.getTime() / 1000);
    const entryPrice = idea.direction === 'BUY' ? idea.entryHigh : idea.entryLow;
    const targets = [idea.takeProfit1, idea.takeProfit2, idea.takeProfit3];
    if (entryPrice === null || idea.stopLoss === null || idea.lotSize === null) continue;

    // Refuses to answer when the window does not cover the idea's life, and
    // voids an idea that outlived its horizon. See scoreIdeaWindow.
    const scored = scoreIdeaWindow(idea.direction, candles, since, idea.stopLoss, targets);
    const hit = scored.hit;
    const sign = idea.direction === 'BUY' ? 1 : -1;
    const pnlUsd = hit === null ? null : (hit.price - entryPrice) * sign * idea.lotSize;
    const data = {
      tradeIdeaId: idea.id,
      entryPrice,
      status: scored.status,
      result: hit?.result ?? null,
      exitPrice: hit?.price ?? null,
      pnlUsd,
      rMultiple: hit === null
        ? null
        : realisedR(idea.direction, entryPrice, idea.stopLoss, hit.price),
      exitTime: hit?.time ?? null,
    };
    await prisma.tradeOutcome.upsert({
      where: { tradeIdeaId: idea.id },
      create: data,
      update: data,
    });
    checked += 1;
    if (hit !== null) closed += 1;
    if (scored.status === 'INDETERMINATE') unscorable += 1;
    if (scored.status === 'EXPIRED') expired += 1;
  }

  return {
    source: adapter.name,
    candlesChecked: candles.length,
    ideasChecked: checked,
    newlyClosed: closed,
    /** Ideas the fetched window could not cover, so they were not scored. */
    unscorable,
    /** Ideas voided for outliving their horizon without touching a level. */
    expired,
    ...(await readTradeHistory()),
  };
}

/**
 * The history as stored. Reads only.
 *
 * Split out of `refreshTradeOutcomes` so `GET /api/history` can serve a page view
 * without mutating anything. That route used to call the refresh, which meant an
 * unauthenticated GET fired one upstream price request plus an upsert per idea on
 * every ordinary page navigation — N+1 writes that grow with history. Scoring now
 * belongs to `/api/cron/outcomes` alone.
 */
export async function readTradeHistory() {
  const [rows, settings] = await Promise.all([
    prisma.tradeIdea.findMany({
      include: { outcome: true },
      orderBy: [{ tradeDate: 'desc' }, { createdAt: 'desc' }],
    }),
    prisma.appSettings.findUnique({ where: { id: 'default' } }),
  ]);
  const configuredEquity = Number(process.env.ACCOUNT_EQUITY_USD);

  // Now that a read no longer scores, the page has to be able to say how fresh
  // the outcomes are — otherwise a stalled refresh job looks like a quiet market.
  let outcomesCheckedAt: number | null = null;
  for (const row of rows) {
    if (row.outcome === null) continue;
    const at = Math.floor(row.outcome.checkedAt.getTime() / 1000);
    if (outcomesCheckedAt === null || at > outcomesCheckedAt) outcomesCheckedAt = at;
  }

  return {
    startingEquityUsd: settings?.equityUsd ?? (Number.isFinite(configuredEquity) && configuredEquity > 0 ? configuredEquity : 100),
    outcomeHorizonBars: OUTCOME_HORIZON_BARS,
    outcomesCheckedAt,
    rows,
  };
}