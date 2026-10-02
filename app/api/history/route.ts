import { NextResponse } from 'next/server';
import { readTradeHistory } from '../../../lib/tradeOutcomes';

export const dynamic = 'force-dynamic';

/**
 * Read-only. Viewing the journal must not change it.
 *
 * This used to call `refreshTradeOutcomes`, so every unauthenticated page view
 * spent an upstream price request and wrote one row per open idea — and the
 * recorded outcome of a trade depended on when somebody happened to open the
 * page. Scoring is now `/api/cron/outcomes` alone; `outcomesCheckedAt` tells the
 * page how stale that job's last run is.
 */
export async function GET() {
  try {
    return NextResponse.json(await readTradeHistory());
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}