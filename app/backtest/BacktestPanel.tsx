'use client';

import { useEffect, useState } from 'react';
import type { BacktestResult, EquityPoint } from '../../backtest/engine';

interface BacktestResponse extends BacktestResult {
  source: string;
  symbol: string;
  timeframe: string;
  months: number;
  from: number;
  to: number;
  synthetic: boolean;
  assumptions: {
    initialBalanceUsd: number;
    riskPercent: number;
    spreadDollars: number;
    slippageDollarsPerExecution: number;
    strategy: string;
  };
}

function money(value: number): string {
  return `${value < 0 ? '-' : ''}$${Math.abs(value).toFixed(2)}`;
}

function dateLabel(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function metric(value: number, suffix = ''): string {
  return `${value.toFixed(2)}${suffix}`;
}

function EquityChart({ points }: { points: EquityPoint[] }) {
  const width = 800;
  const height = 260;
  const padding = { top: 16, right: 20, bottom: 28, left: 62 };
  const values = points.map((point) => point.equity);
  const min = Math.min(...values, 100);
  const max = Math.max(...values, 100);
  const spread = max - min || 1;
  const x = (index: number) => padding.left + (index / Math.max(points.length - 1, 1)) * (width - padding.left - padding.right);
  const y = (value: number) => padding.top + ((max - value) / spread) * (height - padding.top - padding.bottom);
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(point.equity).toFixed(1)}`).join(' ');
  const startBalanceY = y(100);

  return (
    <div className="overflow-hidden">
      <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full" role="img" aria-label="Out-of-sample equity curve">
        {[0, 0.5, 1].map((fraction) => {
          const value = max - spread * fraction;
          const lineY = y(value);
          return (
            <g key={fraction}>
              <line x1={padding.left} x2={width - padding.right} y1={lineY} y2={lineY} stroke="#e5e5e5" strokeWidth="1" />
              <text x={padding.left - 10} y={lineY + 4} textAnchor="end" fill="#737373" fontSize="11">{money(value)}</text>
            </g>
          );
        })}
        {startBalanceY >= padding.top && startBalanceY <= height - padding.bottom && (
          <line x1={padding.left} x2={width - padding.right} y1={startBalanceY} y2={startBalanceY} stroke="#a3a3a3" strokeDasharray="4 4" />
        )}
        <path d={path} fill="none" stroke="#087e72" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <text x={padding.left} y={height - 5} fill="#737373" fontSize="11">{dateLabel(points[0]!.time)}</text>
        <text x={width - padding.right} y={height - 5} textAnchor="end" fill="#737373" fontSize="11">{dateLabel(points.at(-1)!.time)}</text>
      </svg>
    </div>
  );
}

function MetricBlock({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="outline-card min-w-0 p-4 sm:p-5">
      <p className="caps-label text-[#1A1A1A]/60">{label}</p>
      <p className="display-number mt-3 break-words text-2xl tabular-nums sm:text-3xl">{value}</p>
      {detail && <p className="mt-2 text-xs text-[#1A1A1A]/60">{detail}</p>}
    </div>
  );
}

export default function BacktestPanel() {
  const [months, setMonths] = useState<12 | 24>(12);
  const [data, setData] = useState<BacktestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`/api/backtest?months=${months}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
        return body as BacktestResponse;
      })
      .then(setData)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [months]);

  const metrics = data?.outOfSample.metrics;
  const profitFactor = metrics?.profitFactor === null
    ? metrics.tradeCount > 0 && metrics.netProfit > 0 ? '∞' : '—'
    : metrics?.profitFactor.toFixed(2) ?? '—';

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-neutral-200 pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Historical replay</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">XAU/USD backtest</h1>
          <p className="mt-1 text-sm text-neutral-500">H4 bars · $100 starting balance · chronological 70/30 split</p>
        </div>
        <div className="inline-flex border border-neutral-300 bg-white p-1" role="group" aria-label="History length">
          {([12, 24] as const).map((period) => (
            <button
              key={period}
              type="button"
              onClick={() => setMonths(period)}
              aria-pressed={months === period}
              className={`min-h-9 px-4 text-sm font-medium ${months === period ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'}`}
            >
              {period} months
            </button>
          ))}
        </div>
      </section>

      {loading && <p className="py-12 text-center text-sm text-neutral-500">Loading historical candles and replaying trades…</p>}
      {error && <p role="alert" className="border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}

      {data && metrics && !loading && (
        <>
          {data.synthetic && (
            <p className="border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              Synthetic fixture data from <strong>{data.source}</strong>. This is for checking the backtester only, not evidence of historical strategy performance. Set <code>PRICE_ADAPTER=twelvedata</code> and <code>TWELVE_DATA_API_KEY</code> for provider candles.
            </p>
          )}

          <div className="flex flex-wrap justify-between gap-x-8 gap-y-2 text-sm text-neutral-600">
            <p><span className="text-neutral-500">Data</span> <span className="font-medium text-neutral-900">{data.symbol} · {data.timeframe} · {data.totalBars.toLocaleString()} bars</span></p>
            <p><span className="text-neutral-500">Range</span> <span className="font-medium text-neutral-900">{dateLabel(data.from)} – {dateLabel(data.to)}</span></p>
            <p><span className="text-neutral-500">Source</span> <span className="font-medium text-neutral-900">{data.source}</span></p>
          </div>

          <section className="space-y-5" aria-labelledby="oos-heading">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-200 pb-2">
              <h2 id="oos-heading" className="text-lg font-semibold">Out-of-sample · final 30%</h2>
              <p className="text-sm text-neutral-500">From {dateLabel(data.splitTime)} · independent $100 segment balance</p>
            </div>
            <div className="grid grid-cols-2 gap-y-5 sm:grid-cols-4">
              <MetricBlock label="Net profit" value={money(metrics.netProfit)} detail={`ending ${money(metrics.endingBalance)}`} />
              <MetricBlock label="Profit factor" value={profitFactor} detail={`${metrics.tradeCount} closed trades`} />
              <MetricBlock label="Win rate" value={metric(metrics.winRate, '%')} />
              <MetricBlock label="Max drawdown" value={metric(metrics.maxDrawdownPercent, '%')} detail={money(metrics.maxDrawdownDollars)} />
            </div>
            <div className="border-y border-neutral-200 py-4">
              {data.outOfSample.equityCurve.length > 1
                ? <EquityChart points={data.outOfSample.equityCurve} />
                : <p className="py-8 text-center text-sm text-neutral-500">Not enough out-of-sample bars to draw an equity curve.</p>}
            </div>
          </section>

          <section className="space-y-4" aria-labelledby="insample-heading">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-200 pb-2">
              <h2 id="insample-heading" className="text-lg font-semibold">In-sample · first 70%</h2>
              <p className="text-sm text-neutral-500">{dateLabel(data.from)} – {dateLabel(data.splitTime)}</p>
            </div>
            <div className="grid grid-cols-2 gap-y-5 sm:grid-cols-4">
              <MetricBlock label="Net profit" value={money(data.inSample.metrics.netProfit)} detail={`ending ${money(data.inSample.metrics.endingBalance)}`} />
              <MetricBlock label="Profit factor" value={data.inSample.metrics.profitFactor?.toFixed(2) ?? '—'} detail={`${data.inSample.metrics.tradeCount} closed trades`} />
              <MetricBlock label="Win rate" value={metric(data.inSample.metrics.winRate, '%')} />
              <MetricBlock label="Max drawdown" value={metric(data.inSample.metrics.maxDrawdownPercent, '%')} detail={money(data.inSample.metrics.maxDrawdownDollars)} />
            </div>
          </section>

          <section className="space-y-2 border-t border-neutral-200 pt-4 text-xs leading-relaxed text-neutral-500">
            <h2 className="font-semibold text-neutral-700">Execution assumptions</h2>
            <p>{data.assumptions.strategy} Entries execute at the next H4 open; 1% equity risk includes estimated costs. Stop is applied first if stop and target are both touched in one bar. Maximum one new trade per UTC day.</p>
            <p>Round-trip spread: ${data.assumptions.spreadDollars.toFixed(2)}/oz. Slippage: ${data.assumptions.slippageDollarsPerExecution.toFixed(2)}/oz on each execution. Results omit swaps, commissions, margin constraints, and news/fundamental filters.</p>
          </section>
        </>
      )}
    </div>
  );
}