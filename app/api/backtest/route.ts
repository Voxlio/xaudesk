import { NextResponse } from 'next/server';
import { runBacktest } from '../../../backtest/engine';
import { getPriceAdapter } from '../../../data/price';
import { PriceAdapterError } from '../../../data/types';
import { DISCLAIMER_SHORT } from '../../../lib/disclaimer';

export const dynamic = 'force-dynamic';

const MONTHS_OPTIONS = [12, 24] as const;
const MAX_H4_BARS = 5000;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const rawMonths = params.get('months') ?? '12';
  const months = Number(rawMonths);
  if (!MONTHS_OPTIONS.includes(months as (typeof MONTHS_OPTIONS)[number])) {
    return NextResponse.json({ error: 'months must be 12 or 24' }, { status: 400 });
  }

  try {
    const adapter = await getPriceAdapter();
    const available = await adapter.fetchCandles({ timeframe: 'H4', limit: MAX_H4_BARS });
    const latestTime = available.at(-1)?.time;
    if (latestTime === undefined) {
      return NextResponse.json({ error: 'The price source returned no H4 candles.' }, { status: 422 });
    }

    const cutoff = new Date(latestTime * 1000);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
    const candles = available.filter((candle) => candle.time >= Math.floor(cutoff.getTime() / 1000));
    const result = runBacktest(candles);

    return NextResponse.json({
      ...result,
      source: adapter.name,
      symbol: adapter.symbol,
      timeframe: 'H4',
      months,
      from: candles[0]!.time,
      to: candles.at(-1)!.time,
      synthetic: adapter.name === 'fixture',
      assumptions: {
        initialBalanceUsd: 100,
        riskPercent: 1,
        spreadDollars: 0.3,
        slippageDollarsPerExecution: 0.1,
        strategy: 'H4 EMA trend and price alignment with RSI-50 cross; 1.5 ATR stop and net 2R target.',
      },
      disclaimer: DISCLAIMER_SHORT,
    });
  } catch (cause) {
    if (cause instanceof PriceAdapterError) {
      return NextResponse.json(
        { error: cause.message, adapter: cause.adapter, rateLimited: cause.rateLimited },
        { status: cause.rateLimited ? 429 : 502 },
      );
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    return NextResponse.json({ error: message }, { status: 422 });
  }
}