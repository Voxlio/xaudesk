import { NextResponse } from 'next/server';
import { authorizeAdminRequest } from '../../../lib/cronAuth';
import { prisma } from '../../../lib/prisma';

export const dynamic = 'force-dynamic';

const SETTINGS_ID = 'default';

export async function GET() {
  try {
    const saved = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ID } });
    return NextResponse.json({
      equityUsd: saved?.equityUsd ?? parsePositive(process.env.ACCOUNT_EQUITY_USD),
      riskPercent: saved?.riskPercent ?? parsePositive(process.env.ACCOUNT_RISK_PERCENT ?? process.env.RISK_PERCENT) ?? 1,
      centLotStep: saved?.centLotStep ?? parsePositive(process.env.ACCOUNT_CENT_LOT_STEP) ?? 0.01,
      centLotMin: saved?.centLotMin ?? parsePositive(process.env.ACCOUNT_CENT_MIN_LOT) ?? 0.01,
      symbol: saved?.symbol ?? 'XAUUSD',
      priceSource: process.env.PRICE_ADAPTER ?? 'twelvedata',
      macroSource: process.env.MACRO_ADAPTER === 'live' ? 'UUP (Twelve Data) + FRED DGS10' : process.env.MACRO_ADAPTER ?? 'unavailable',
      newsSource: process.env.NEWS_ADAPTER ?? 'forexfactory',
      hasPriceApiKey: Boolean(process.env.TWELVE_DATA_API_KEY?.trim()),
      hasFredApiKey: Boolean(process.env.FRED_API_KEY?.trim()),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  // These four fields drive every published lot size, and this route is reachable
  // by anyone who can reach the deployment. Authorization comes before the body is
  // even read, and an unset ADMIN_SECRET refuses rather than waves everyone
  // through.
  const authorization = authorizeAdminRequest(request);
  if (authorization !== 'authorized') {
    return NextResponse.json(
      {
        error: authorization === 'unconfigured'
          ? 'ADMIN_SECRET is not configured, so settings cannot be changed.'
          : 'Unauthorized.',
      },
      { status: authorization === 'unconfigured' ? 503 : 401 },
    );
  }

  try {
    const body = await request.json() as Record<string, unknown>;
    const equityUsd = body.equityUsd === null || body.equityUsd === '' ? null : Number(body.equityUsd);
    const riskPercent = Number(body.riskPercent);
    const centLotStep = Number(body.centLotStep);
    const centLotMin = Number(body.centLotMin);

    if (equityUsd !== null && (!Number.isFinite(equityUsd) || equityUsd <= 0)) {
      return NextResponse.json({ error: 'Equity must be a positive USD amount or blank.' }, { status: 400 });
    }
    if (!Number.isFinite(riskPercent) || riskPercent < 1 || riskPercent > 2) {
      return NextResponse.json({ error: 'Risk per trade must be between 1% and 2%.' }, { status: 400 });
    }
    if (!Number.isFinite(centLotStep) || centLotStep <= 0 || !Number.isFinite(centLotMin) || centLotMin <= 0) {
      return NextResponse.json({ error: 'Lot minimum and step must be positive.' }, { status: 400 });
    }
    if (body.symbol !== 'XAUUSD') {
      return NextResponse.json({ error: 'Only XAU/USD is supported.' }, { status: 400 });
    }

    const settings = await prisma.appSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, equityUsd, riskPercent, centLotStep, centLotMin, symbol: 'XAUUSD' },
      update: { equityUsd, riskPercent, centLotStep, centLotMin, symbol: 'XAUUSD' },
    });
    return NextResponse.json({
      equityUsd: settings.equityUsd,
      riskPercent: settings.riskPercent,
      centLotStep: settings.centLotStep,
      centLotMin: settings.centLotMin,
      symbol: settings.symbol,
      saved: true,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

function parsePositive(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}