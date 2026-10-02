import { NextResponse } from 'next/server';
import { authorizeCronRequest } from '../../../../lib/cronAuth';
import { getDailyTradeIdea } from '../../../../strategy/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const authorization = authorizeCronRequest(request);
  if (authorization !== 'authorized') {
    return NextResponse.json(
      { error: authorization === 'unconfigured' ? 'CRON_SECRET is not configured.' : 'Unauthorized.' },
      { status: authorization === 'unconfigured' ? 503 : 401 },
    );
  }

  try {
    const idea = await getDailyTradeIdea();
    return NextResponse.json({
      ok: true,
      task: 'daily-idea',
      tradeDate: idea.tradeDate,
      direction: idea.direction,
      symbol: idea.symbol,
      source: idea.snapshot.priceSource,
      syntheticData: idea.syntheticData,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}