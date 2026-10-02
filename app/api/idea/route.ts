import { NextResponse } from 'next/server';
import { getDailyTradeIdea } from '../../../strategy/service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await getDailyTradeIdea());
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}