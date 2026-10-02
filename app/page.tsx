import { getDailyTradeIdea } from '../strategy/service';
import type { TradeIdea } from '../strategy/tradeIdea';
import TradeChart from './components/TradeChart';

export const dynamic = 'force-dynamic';

function price(value: number | null): string {
  return value === null ? '—' : value.toFixed(2);
}

function dollars(value: number): string {
  return `$${value.toFixed(2)}`;
}

function candleTimestamp(value: number | null): string {
  if (value === null) return 'No candle timestamp';
  return `${new Date(value * 1000).toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

function Bias({ label, value }: { label: string; value: string }) {
  const color = value === 'BULLISH'
    ? 'text-[#2E7D4F]'
    : value === 'BEARISH'
      ? 'text-[#B3392F]'
      : 'text-[#1A1A1A]';
  return (
    <div className="border-l border-[#1A1A1A] pl-3">
      <p className="caps-label text-[#1A1A1A]/60">{label}</p>
      <p className={`mt-1 text-sm font-extrabold ${color}`}>{value}</p>
    </div>
  );
}

function PriceCard({ label, value, accent }: { label: string; value: string; accent?: 'buy' | 'sell' | 'gold' }) {
  const color = accent === 'buy' ? 'text-[#2E7D4F]' : accent === 'sell' ? 'text-[#B3392F]' : accent === 'gold' ? 'text-[#C4A060]' : 'text-[#1A1A1A]';
  return (
    <div className="outline-card idea-price-card">
      <p className="caps-label text-[#1A1A1A]/60">{label}</p>
      <p className={`display-number mt-4 break-words text-[clamp(1.35rem,4.8vw,2.1rem)] ${color}`}>{value}</p>
    </div>
  );
}

function RiskMath({ idea }: { idea: TradeIdea }) {
  const risk = idea.riskMath;
  if (risk === null) {
    return (
      <p className="border-l-2 border-[#FF6700] pl-3 text-sm text-[#1A1A1A]">
        {idea.reason.includes('ACCOUNT_EQUITY_USD is not configured')
          ? <>Lot size not calculated. Configure <code>ACCOUNT_EQUITY_USD</code> with the account value in dollars.</>
          : 'No position size: today has no actionable trade setup. Lot math requires a valid entry and stop distance.'}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-y-4 sm:grid-cols-4">
      <div><p className="caps-label text-[#1A1A1A]/60">Equity (USD)</p><p className="mt-1 font-mono">{dollars(risk.equityUsd)}</p></div>
      <div><p className="caps-label text-[#1A1A1A]/60">Terminal balance</p><p className="mt-1 font-mono">{risk.terminalBalanceCents.toFixed(0)} cents</p></div>
      <div><p className="caps-label text-[#1A1A1A]/60">Risk budget</p><p className="mt-1 font-mono">{dollars(risk.riskBudgetUsd)} ({risk.riskBudgetCents.toFixed(0)} cents)</p></div>
      <div><p className="caps-label text-[#1A1A1A]/60">Stop distance</p><p className="mt-1 font-mono">{dollars(risk.stopDistanceUsdPerOunce)}/oz</p></div>
      <div><p className="caps-label text-[#1A1A1A]/60">Unrounded size</p><p className="mt-1 font-mono">{risk.rawCentLots.toFixed(4)} cent lots</p></div>
      <div><p className="caps-label text-[#1A1A1A]/60">Rounded exposure</p><p className="mt-1 font-mono">{risk.centLots.toFixed(2)} lots / {risk.positionOunces.toFixed(2)} oz</p></div>
      <div><p className="caps-label text-[#1A1A1A]/60">Modeled stop loss</p><p className="mt-1 font-mono">{dollars(risk.modeledRiskUsd)} ({risk.modeledRiskCents.toFixed(0)} cents)</p></div>
      <div><p className="caps-label text-[#1A1A1A]/60">Contract assumption</p><p className="mt-1 font-mono">{risk.standardLotOunces} oz × 1/{risk.centLotDivisor} = {risk.ouncesPerCentLot} oz/cent lot</p></div>
    </div>
  );
}

export default async function Page() {
  let idea: TradeIdea | null = null;
  let error: string | null = null;
  try {
    idea = await getDailyTradeIdea();
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-[#1A1A1A] pb-5">
        <div>
          <p className="eyebrow text-[#C4A060]">Daily XAU/USD plan</p>
          <h1 className="mt-2 text-3xl font-extrabold">Analyze</h1>
          <p className="mt-1 text-sm text-[#1A1A1A]/65">One UTC-dated idea · fundamentals and technical setup must agree</p>
        </div>
        {idea && <p className="caps-label font-mono text-[#1A1A1A]/65">{idea.tradeDate} UTC</p>}
      </section>

      {error && (
          <p role="alert" className="outline-card border-[#B3392F] px-4 py-3 text-sm text-[#B3392F]">
          Daily idea unavailable: {error}. Ensure the SQLite schema is pushed and configured price/news sources are reachable.
        </p>
      )}

      {idea && (
        <>
          {idea.snapshot.priceUnavailableReason && (
            <p role="alert" className="outline-card border-[#B3392F] px-4 py-3 text-sm text-[#B3392F]">
              <span className="caps-label">Price source unavailable</span>
              <span className="mt-1 block">{idea.snapshot.priceUnavailableReason}</span>
            </p>
          )}
          {idea.syntheticData && (
            <p className="outline-card border-[#C4A060] px-4 py-3 text-sm text-[#1A1A1A]">
              Synthetic fixture prices are active. No trade is issued from fixture data; configure a real price source for market analysis.
            </p>
          )}

          <section className="space-y-[15px]" aria-labelledby="idea-heading">
            <div className="idea-grid">
              <div className="outline-card idea-stat-card flex flex-col justify-between">
                <p className="caps-label text-[#1A1A1A]/65">Entry zone</p>
                <div>
                  <p className="display-number break-words text-[clamp(2rem,8vw,4rem)] text-[#C4A060]">
                    {idea.entryLow === null ? '—' : `${price(idea.entryLow)}–${price(idea.entryHigh)}`}
                  </p>
                  <p className="mt-3 text-sm font-semibold">XAU/USD · {idea.snapshot.priceSource}</p>
                  <p className="mt-1 text-xs text-[#1A1A1A]/60">Latest candle · {candleTimestamp(idea.snapshot.priceCandleTimestamp)}</p>
                </div>
              </div>
              <div className="outline-card idea-stat-card flex flex-col justify-between">
                <p className="caps-label text-[#1A1A1A]/65">Direction</p>
                <div>
                  <p id="idea-heading" className="display-number text-[clamp(2.3rem,10vw,4.6rem)] text-[#1A1A1A]">
                    {idea.direction.replace('_', '-')}
                  </p>
                  {idea.direction !== 'NO_TRADE' && <span className={`history-badge mt-2 ${idea.direction === 'BUY' ? 'text-[#2E7D4F]' : 'text-[#B3392F]'}`}>{idea.direction}</span>}
                  <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
                    <Bias label="D1" value={idea.biasD1} />
                    <Bias label="H4" value={idea.biasH4} />
                    <Bias label="Fundamental" value={idea.biasFundamental} />
                  </div>
                </div>
              </div>
            </div>

            <div className="idea-level-grid">
              <PriceCard label="Stop loss" value={price(idea.stopLoss)} accent="sell" />
              <PriceCard label="TP1 · 2R" value={price(idea.takeProfit1)} accent="buy" />
              <PriceCard label="TP2 · 3R" value={price(idea.takeProfit2)} accent="buy" />
              <PriceCard label="TP3 · 4R" value={price(idea.takeProfit3)} accent="buy" />
            </div>

            <TradeChart levels={idea} />

            <div className="outline-card px-5 py-5 sm:px-7 sm:py-6">
              <p className="caps-label mb-3 text-[#FF6700]">Why</p>
              <p className="editorial-quote">“{idea.snapshot.priceUnavailableReason
                ? 'Live XAU/USD pricing is unavailable; no trade is issued until candles are restored.'
                : idea.direction === 'NO_TRADE'
                ? idea.syntheticData
                  ? 'Synthetic prices are not market evidence, so no trade is issued.'
                  : idea.reason.split('. ')[0]
                : `${idea.direction} setup: D1/H4 and fundamental bias align with ${idea.confluences.length} confirmed entry confluences.`}”</p>
              <details className="mt-4 border-t border-[#1A1A1A]/20 pt-3 text-sm">
                <summary className="cursor-pointer font-bold">Full reasoning and figures</summary>
                <p className="mt-3 leading-6 text-[#1A1A1A]/75">{idea.reason}</p>
              </details>
            </div>

            <div className="idea-grid">
              <PriceCard label="Reward / risk to TP1" value={idea.riskReward === null ? '—' : `${idea.riskReward.toFixed(2)}R`} accent="gold" />
              <PriceCard label="HFM Cent lot size" value={idea.lotSize === null ? '—' : idea.lotSize.toFixed(2)} />
            </div>

            <div className="flex flex-wrap items-end justify-between gap-4 border-t border-[#1A1A1A] pt-4">
              <div>
                <p className="signature">XAU Desk</p>
                <p className="caps-label mt-1 text-[#1A1A1A]/65">Trade idea of {idea.tradeDate}</p>
              </div>
              <div className="text-right">
                <p className="caps-label text-[#1A1A1A]/65">Confidence</p>
                <p className="display-number mt-1 text-4xl">{idea.confidence}<span className="text-2xl">/100</span></p>
              </div>
            </div>
          </section>

          <section className="space-y-4 border-t border-[#1A1A1A]/30 pt-5" aria-labelledby="confluence-heading">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="confluence-heading" className="text-lg font-bold">Entry confluences</h2>
              <p className="caps-label text-[#1A1A1A]/60">{idea.confluences.length} confirmed · 3 required</p>
            </div>
            <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
              {idea.confluenceEvidence.map((item) => (
                <li key={item.name} className="grid gap-1 py-3 sm:grid-cols-[12rem_1fr] sm:gap-4">
                  <span className={`text-sm font-bold ${item.passed ? 'text-[#2E7D4F]' : 'text-[#1A1A1A]/55'}`}>
                    {item.passed ? 'Confirmed' : 'Not confirmed'} · {item.name}
                  </span>
                  <span className="text-sm text-[#1A1A1A]/80">{item.detail}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-4 border-t border-[#1A1A1A]/30 pt-5" aria-labelledby="risk-heading">
            <div>
              <h2 id="risk-heading" className="text-lg font-bold">HFM Cent risk math</h2>
              <p className="mt-1 text-sm text-[#1A1A1A]/65">USD equity is converted to account cents only for display; it is not used as cents in the lot formula.</p>
            </div>
            <RiskMath idea={idea} />
          </section>

          <section className="space-y-4 border-t border-[#1A1A1A]/30 pt-5" aria-labelledby="bias-heading">
            <h2 id="bias-heading" className="text-lg font-bold">Timeframe snapshot</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead className="text-xs uppercase text-neutral-500">
                  <tr><th className="py-2 pr-4 font-medium">TF</th><th className="py-2 pr-4 font-medium">Close</th><th className="py-2 pr-4 font-medium">EMA 50</th><th className="py-2 pr-4 font-medium">EMA 200</th><th className="py-2 pr-4 font-medium">Structure</th><th className="py-2 font-medium">Bias</th></tr>
                </thead>
                <tbody className="font-mono">
                  {idea.snapshot.timeframes.map((row) => (
                    <tr key={row.timeframe} className="border-t border-neutral-100">
                      <td className="py-2 pr-4">{row.timeframe}</td><td className="py-2 pr-4">{price(row.close)}</td><td className="py-2 pr-4">{price(row.ema50)}</td><td className="py-2 pr-4">{price(row.ema200)}</td><td className="py-2 pr-4">{row.trend}</td><td className="py-2">{row.bias}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-4 border-t border-[#1A1A1A]/30 pt-5" aria-labelledby="macro-heading">
            <div>
              <h2 id="macro-heading" className="text-lg font-bold">Live macro inputs</h2>
              <p className="mt-1 text-sm text-[#1A1A1A]/65">Daily percentage/basis-point changes; missing provider values remain unavailable.</p>
            </div>
            <div className="grid gap-[15px] sm:grid-cols-2">
              {idea.snapshot.fundamentals.components.filter((item) => item.key !== 'news').map((item) => (
                <div key={item.key} className="outline-card p-4">
                  <p className="caps-label text-[#1A1A1A]/60">{item.key === 'usdProxy' ? 'USD proxy (UUP)' : 'US 10Y yield'}</p>
                  <p className="mt-2 text-sm font-semibold">{item.detail}</p>
                </div>
              ))}
              {idea.snapshot.fundamentals.missing.filter((item) => item.startsWith('USD proxy') || item.startsWith('US10Y')).map((item) => (
                <div key={item} className="outline-card border-[#FF6700] p-4">
                  <p className="caps-label text-[#1A1A1A]/60">Unavailable input</p>
                  <p className="mt-2 text-sm">{item}</p>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}