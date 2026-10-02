import { NextResponse } from 'next/server';
import { getPriceAdapter } from '../../../data/price';
import { PriceAdapterError, isTimeframe } from '../../../data/types';
import { indicatorSnapshot } from '../../../indicators';
import { DISCLAIMER_SHORT } from '../../../lib/disclaimer';

/**
 * GET /api/candles?timeframe=H1&limit=300&series=false
 *
 * Returns candles plus the indicator snapshot for one timeframe. `series=true`
 * includes the full indicator arrays (for charting); the default omits them to
 * keep the payload small.
 */

export const dynamic = 'force-dynamic';

const MAX_LIMIT = 1000;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const timeframe = params.get('timeframe') ?? 'H1';
  if (!isTimeframe(timeframe)) {
    return NextResponse.json(
      { error: `invalid timeframe "${timeframe}" (expected M15, H1, H4 or D1)` },
      { status: 400 },
    );
  }

  const rawLimit = params.get('limit');
  const parsedLimit = rawLimit === null ? 300 : Number(rawLimit);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_LIMIT) {
    return NextResponse.json(
      { error: `invalid limit "${rawLimit}" (expected an integer 1-${MAX_LIMIT})` },
      { status: 400 },
    );
  }

  const includeSeries = params.get('series') === 'true';

  try {
    const adapter = await getPriceAdapter();
    const candles = await adapter.fetchCandles({ timeframe, limit: parsedLimit });
    const snapshot = indicatorSnapshot(candles);

    const { series, structure, ...summary } = snapshot;

    return NextResponse.json({
      source: adapter.name,
      symbol: adapter.symbol,
      timeframe,
      candles,
      indicators: summary,
      structure: {
        trend: structure.trend,
        lastSwingHigh: structure.lastSwingHigh,
        lastSwingLow: structure.lastSwingLow,
        lastBreak: structure.lastBreak,
        swingCount: structure.swings.length,
      },
      ...(includeSeries ? { series } : {}),
      disclaimer: DISCLAIMER_SHORT,
    });
  } catch (cause) {
    if (cause instanceof PriceAdapterError) {
      // 429 lets a caller back off; 502 marks it as an upstream failure rather
      // than a bug in this service.
      return NextResponse.json(
        { error: cause.message, adapter: cause.adapter, rateLimited: cause.rateLimited },
        { status: cause.rateLimited ? 429 : 502 },
      );
    }
    throw cause;
  }
}
