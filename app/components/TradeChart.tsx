'use client';

import { useEffect, useRef, useState } from 'react';
import { ColorType, createChart, type IChartApi, type IPriceLine, type ISeriesApi, type Time } from 'lightweight-charts';

type ChartTimeframe = 'M15' | 'H1' | 'H4' | 'D1';

interface CandlePoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface TradeLevels {
  entryLow: number | null;
  entryHigh: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  takeProfit3: number | null;
}

interface CandleResponse {
  candles?: CandlePoint[];
  source?: string;
  error?: string;
}

const TIMEFRAMES: ChartTimeframe[] = ['M15', 'H1', 'H4', 'D1'];
const REFRESH_INTERVAL_MS = 60_000;

export default function TradeChart({ levels }: { levels: TradeLevels }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const fittedTimeframeRef = useRef<ChartTimeframe | null>(null);
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('H1');
  const [bars, setBars] = useState<CandlePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let fetching = false;
    fittedTimeframeRef.current = null;
    setLoading(true);

    async function refresh() {
      if (fetching || controller.signal.aborted) return;
      fetching = true;
      try {
        const response = await fetch(`/api/candles?timeframe=${timeframe}&limit=300`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        const body = await response.json() as CandleResponse;
        if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
        setBars(body.candles ?? []);
        setSource(typeof body.source === 'string' ? body.source : null);
        setUpdatedAt(Date.now());
        setError(null);
      } catch (cause: unknown) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        fetching = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void refresh();
    const interval = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [timeframe]);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    const chart = createChart(host, {
      width: host.clientWidth,
      height: 360,
      layout: {
        background: { type: ColorType.Solid, color: '#FFF8E1' },
        textColor: '#1A1A1A',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(26,26,26,0.08)' },
        horzLines: { color: 'rgba(26,26,26,0.08)' },
      },
      rightPriceScale: { borderColor: '#1A1A1A' },
      timeScale: { borderColor: '#1A1A1A', timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: '#1A1A1A' }, horzLine: { color: '#1A1A1A' } },
    });
    const series = chart.addCandlestickSeries({
      upColor: '#2E7D4F',
      downColor: '#B3392F',
      borderUpColor: '#2E7D4F',
      borderDownColor: '#B3392F',
      wickUpColor: '#2E7D4F',
      wickDownColor: '#B3392F',
    });
    chartRef.current = chart;
    candleSeriesRef.current = series;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) chart.applyOptions({ width });
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = candleSeriesRef.current;
    const chart = chartRef.current;
    if (series === null || chart === null || bars.length === 0) return;
    for (const line of priceLinesRef.current) series.removePriceLine(line);
    priceLinesRef.current = [];
    series.setData(bars.map((bar) => ({ ...bar, time: bar.time as Time })));
    chart.timeScale().fitContent();
    const guides = [
      { price: levels.entryLow, color: '#FF6700', title: 'Entry low' },
      { price: levels.entryHigh, color: '#FF6700', title: 'Entry high' },
      { price: levels.stopLoss, color: '#B3392F', title: 'Stop' },
      { price: levels.takeProfit1, color: '#2E7D4F', title: 'TP1' },
      { price: levels.takeProfit2, color: '#2E7D4F', title: 'TP2' },
      { price: levels.takeProfit3, color: '#2E7D4F', title: 'TP3' },
    ];
    for (const guide of guides) {
      if (guide.price !== null) {
        priceLinesRef.current.push(series.createPriceLine({ price: guide.price, color: guide.color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: guide.title }));
      }
    }
  }, [bars, levels, timeframe]);

  return (
    <section className="chart-grain outline-card overflow-hidden" aria-label="XAU/USD price chart">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1A1A1A] px-4 py-3">
        <div>
          <p className="caps-label text-[#C4A060]">XAU/USD</p>
          <p className="display-number mt-1 text-2xl">{bars.at(-1)?.close.toFixed(2) ?? '—'}</p>
          <p className="mt-1 text-xs text-[#1A1A1A]/60">
            {timeframe} · {bars.length} bars · {source ?? 'price feed'} · auto-refresh 60s
            {updatedAt !== null && ` · updated ${new Date(updatedAt).toLocaleTimeString()}`}
          </p>
        </div>
        <div className="inline-flex gap-1" role="group" aria-label="Chart timeframe">
          {TIMEFRAMES.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={item === timeframe}
              onClick={() => setTimeframe(item)}
              className={`min-w-10 rounded-lg px-2 py-1.5 text-xs font-bold ${timeframe === item ? 'bg-[#FF6700] text-[#1A1A1A]' : 'text-[#1A1A1A]/60 hover:bg-[#1A1A1A]/5 hover:text-[#1A1A1A]'}`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="relative min-h-[360px]">
        <div ref={hostRef} className="w-full" />
        {loading && <div className="absolute inset-0 grid place-items-center bg-[#FFF8E1]/75 text-sm text-[#1A1A1A]/60">Loading candles…</div>}
        {error && <div role="alert" className="absolute inset-x-4 top-4 rounded-xl border border-[#B3392F] bg-[#FFF8E1] p-3 text-sm text-[#B3392F]">{error}</div>}
        {!loading && !error && bars.length === 0 && <div className="absolute inset-0 grid place-items-center text-sm text-[#1A1A1A]/60">No candles for this timeframe.</div>}
      </div>
    </section>
  );
}