import { NextResponse } from 'next/server';
import { DISCLAIMER_SHORT } from '../../../lib/disclaimer';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({
    ok: true,
    service: 'xau-desk',
    time: new Date().toISOString(),
    disclaimer: DISCLAIMER_SHORT,
  });
}
