import { NextResponse } from 'next/server';
import { authorizeCronRequest } from '../../../../lib/cronAuth';
import { refreshTradeOutcomes } from '../../../../lib/tradeOutcomes';

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
    const result = await refreshTradeOutcomes();
    return NextResponse.json({
      ok: true,
      task: 'hourly-outcomes',
      source: result.source,
      candlesChecked: result.candlesChecked,
      ideasChecked: result.ideasChecked,
      newlyClosed: result.newlyClosed,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}