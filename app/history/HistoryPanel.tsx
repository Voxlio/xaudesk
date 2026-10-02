'use client';

import { useCallback, useEffect, useState } from 'react';

interface HistoryRow {
  id: string;
  tradeDate: string;
  symbol: string;
  direction: 'BUY' | 'SELL' | 'NO_TRADE';
  entryLow: number | null;
  entryHigh: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  riskReward: number | null;
  confidence: number;
  lotSize: number | null;
  reason: string;
  outcome: {
    status: 'OPEN' | 'WIN' | 'LOSS' | 'NO_TRADE' | 'EXPIRED' | 'INDETERMINATE';
    result: string | null;
    exitPrice: number | null;
    pnlUsd: number | null;
    rMultiple: number | null;
    exitTime: number | null;
  } | null;
}

interface HistoryResponse {
  startingEquityUsd: number;
  outcomeHorizonBars: number;
  /** Unix seconds of the newest scored outcome, or null before the job has run. */
  outcomesCheckedAt: number | null;
  rows: HistoryRow[];
}

function cash(value: number | null): string {
  if (value === null) return '—';
  return `${value < 0 ? '-' : ''}$${Math.abs(value).toFixed(2)}`;
}

function level(value: number | null): string {
  return value === null ? '—' : value.toFixed(2);
}

/**
 * How long ago the scoring job last wrote an outcome.
 *
 * Worth showing because this page no longer scores anything itself. If the cron
 * job stops, every idea simply stays "Pending" forever, which reads exactly like
 * a quiet market — the timestamp is the only thing that distinguishes them.
 */
function staleness(checkedAt: number | null): string {
  if (checkedAt === null) return 'outcomes have never been scored';
  const minutes = Math.max(0, Math.round((Date.now() / 1000 - checkedAt) / 60));
  if (minutes < 1) return 'outcomes scored just now';
  if (minutes < 60) return `outcomes scored ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `outcomes scored ${hours} h ago`;
  return `outcomes scored ${Math.round(hours / 24)} days ago`;
}

function statusText(row: HistoryRow): string {
  if (row.direction === 'NO_TRADE') return 'No trade';
  if (row.outcome === null || row.outcome.status === 'OPEN') return 'Open';
  if (row.outcome.status === 'WIN') return `Target ${row.outcome.result?.replace('TP', '') ?? 'hit'}`;
  if (row.outcome.status === 'LOSS') return 'Stopped';
  // Neither of these is a win or a loss, and neither is "no trade" — the idea was
  // published. Labelling them honestly keeps them out of the win rate.
  if (row.outcome.status === 'EXPIRED') return 'Expired';
  if (row.outcome.status === 'INDETERMINATE') return 'Not scored';
  return 'No trade';
}

export default function HistoryPanel() {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/history', { signal, cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
      setData(body as HistoryResponse);
      setError(null);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const interval = window.setInterval(() => void refresh(), 60_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [refresh]);

  const rows = data?.rows ?? [];
  const wins = rows.filter((row) => row.outcome?.status === 'WIN').length;
  const losses = rows.filter((row) => row.outcome?.status === 'LOSS').length;
  const closed = wins + losses;
  const realized = rows.reduce((sum, row) => sum + (row.outcome?.pnlUsd ?? 0), 0);


function EquityCurve({ rows, startingEquity }: { rows: HistoryRow[]; startingEquity: number }) {
  const chronologicalRows = [...rows].sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
  let equity = startingEquity;
  const points = [{ label: 'Start', value: equity }];
  for (const row of chronologicalRows) {
    equity += row.outcome?.pnlUsd ?? 0;
    points.push({ label: row.tradeDate, value: equity });
  }

  const width = 900;
  const height = 220;
  const pad = { left: 64, right: 24, top: 22, bottom: 30 };
  const min = Math.min(...points.map((point) => point.value), startingEquity);
  const max = Math.max(...points.map((point) => point.value), startingEquity);
  const range = max - min || Math.max(startingEquity * 0.05, 1);
  const low = min - range * 0.12;
  const high = max + range * 0.12;
  const x = (index: number) => pad.left + (index / Math.max(points.length - 1, 1)) * (width - pad.left - pad.right);
  const y = (value: number) => pad.top + ((high - value) / (high - low)) * (height - pad.top - pad.bottom);
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ');
  const currentY = y(equity);

  return (
    <section className="history-equity p-4 sm:p-5" aria-label="Realized equity curve">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="caps-label text-[#1A1A1A]/60">Realized equity</p>
          <p className="display-number mt-2 text-3xl">{cash(equity)}</p>
        </div>
        <p className="text-xs font-semibold text-[#FF6700]">CURRENT BALANCE</p>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full" role="img" aria-label={`Equity from ${cash(startingEquity)} to ${cash(equity)}`}>
        {[0, 0.5, 1].map((fraction) => {
          const value = high - fraction * (high - low);
          const lineY = y(value);
          return <g key={fraction}><line x1={pad.left} x2={width - pad.right} y1={lineY} y2={lineY} stroke="rgba(26,26,26,0.14)" /><text x={pad.left - 9} y={lineY + 4} textAnchor="end" fill="#1A1A1A" fontSize="11">{cash(value)}</text></g>;
        })}
        <line x1={pad.left} x2={width - pad.right} y1={currentY} y2={currentY} stroke="#FF6700" strokeWidth="1.5" strokeDasharray="5 5" />
        <path d={path} fill="none" stroke="#1A1A1A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={x(points.length - 1)} cy={currentY} r="5" fill="#FF6700" stroke="#1A1A1A" strokeWidth="1" />
        <text x={pad.left} y={height - 7} fill="#1A1A1A" fontSize="11">{points[0]!.label}</text>
        <text x={width - pad.right} y={height - 7} textAnchor="end" fill="#1A1A1A" fontSize="11">{points.at(-1)!.label}</text>
      </svg>
    </section>
  );
}
  return (
    <div className="space-y-7">
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-[#1A1A1A] pb-5">
        <div>
          <p className="eyebrow text-[#C4A060]">Journal</p>
          <h1 className="mt-2 text-3xl font-extrabold">Trade history</h1>
          <p className="mt-1 text-sm text-[#1A1A1A]/65">Outcomes are checked against subsequent H1 candles.</p>
        </div>
        <button type="button" onClick={() => void refresh()} className="outline-card px-4 py-2 text-sm font-bold hover:bg-[#1A1A1A]/5">
          Reload history
        </button>
      </section>

      {error && <p role="alert" className="border-l-4 border-rose-600 bg-rose-50 px-4 py-3 text-sm text-rose-900">History unavailable: {error}</p>}
        {data && <EquityCurve rows={rows} startingEquity={data.startingEquityUsd} />}

        <div className="grid grid-cols-2 gap-[15px] sm:grid-cols-4">
          <div className="outline-card p-4"><p className="caps-label text-[#1A1A1A]/60">Recorded ideas</p><p className="display-number mt-3 text-3xl">{rows.length}</p></div>
          <div className="outline-card p-4"><p className="caps-label text-[#1A1A1A]/60">Closed trades</p><p className="display-number mt-3 text-3xl">{closed}</p></div>
          <div className="outline-card p-4"><p className="caps-label text-[#1A1A1A]/60">Win rate</p><p className="display-number mt-3 text-3xl">{closed === 0 ? '—' : `${((wins / closed) * 100).toFixed(1)}%`}</p></div>
          <div className="outline-card p-4"><p className="caps-label text-[#1A1A1A]/60">Realized P/L</p><p className={`display-number mt-3 text-3xl ${realized >= 0 ? 'text-[#2E7D4F]' : 'text-[#B3392F]'}`}>{cash(realized)}</p></div>
      </div>


      {loading && <p className="py-10 text-center text-sm text-neutral-500">Loading history…</p>}
      {!loading && rows.length === 0 && !error && (
        <div className="outline-card py-12 text-center">
          <p className="font-bold">No ideas recorded yet</p>
          <p className="mt-1 text-sm text-[#1A1A1A]/60">The daily idea will appear here after it is generated.</p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="border-b-[1.5px] border-[#1A1A1A] text-[#1A1A1A]/60">
              <tr>
                <th className="py-3 pr-4 font-medium">Date</th><th className="py-3 pr-4 font-medium">Side</th><th className="py-3 pr-4 font-medium">Entry</th><th className="py-3 pr-4 font-medium">Stop / TP1</th><th className="py-3 pr-4 font-medium">Size</th><th className="py-3 pr-4 font-medium">Outcome</th><th className="py-3 pr-4 font-medium">P/L</th><th className="py-3 font-medium">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const outcome = statusText(row);
                return (
                  <tr key={row.id} className="border-b border-[#1A1A1A]/15 align-top">
                    <td className="py-3 pr-4 font-mono">{row.tradeDate}</td>
                    <td className={`py-3 pr-4 font-bold ${row.direction === 'BUY' ? 'text-[#2E7D4F]' : row.direction === 'SELL' ? 'text-[#B3392F]' : 'text-[#1A1A1A]/55'}`}>{row.direction}</td>
                    <td className="py-3 pr-4 font-mono">{row.entryLow === null ? '—' : `${level(row.entryLow)}–${level(row.entryHigh)}`}</td>
                    <td className="py-3 pr-4 font-mono">{level(row.stopLoss)} / {level(row.takeProfit1)}</td>
                    <td className="py-3 pr-4 font-mono">{row.lotSize === null ? '—' : `${row.lotSize.toFixed(2)} lots`}</td>
                    <td className="py-3 pr-4">
                      <span className={`history-badge ${outcome === 'Open' ? 'text-[#FF6700]' : outcome.startsWith('Target') ? 'text-[#2E7D4F]' : outcome === 'Stopped' ? 'text-[#B3392F]' : 'text-[#1A1A1A]/60'}`}>
                        {outcome === 'Open' ? 'Pending' : outcome === 'Stopped' ? 'SL hit' : outcome.startsWith('Target') ? 'TP hit' : 'No trade'}
                      </span>
                    </td>
                    <td className="py-3 pr-4 font-mono">{cash(row.outcome?.pnlUsd ?? null)}</td>
                    <td className="py-3 font-mono">{row.confidence}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && <p className="text-xs text-[#1A1A1A]/60">Scored by the outcomes job, not by this page: {staleness(data.outcomesCheckedAt)} · ideas are voided after {data.outcomeHorizonBars} H1 bars untouched · this view reloads every 60 seconds. Stops are evaluated before targets when the same bar touches both.</p>}
    </div>
  );
}