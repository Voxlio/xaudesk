# /backtest — strategy replay

Open `/backtest` in the app or call `GET /api/backtest?months=12` (use
`months=24` for two years). The endpoint requests up to 5,000 H4 candles from
the configured price adapter and runs a chronological 70/30 split. The in-
sample and out-of-sample segments each start with $100; the final 30% is the
holdout shown with its own equity curve.

The current baseline is deliberately simple and auditable: H4 EMA 50/200 trend
and price alignment plus an RSI 50 cross; stop at 1.5 ATR and target at net 2R.
Signals are evaluated on a completed bar, entries fill at the next bar open,
risk is 1% of segment equity, and no more than one trade is opened per UTC day.
Spread is modeled at $0.30/oz round trip and slippage at $0.10/oz per execution.
When a candle touches both stop and target, the stop is assumed first.

The default fixture adapter uses seeded **synthetic**, not historical market,
prices. Its H4 fixture spans about two years to make the UI and replay usable
offline; those metrics are not evidence of strategy performance. For historical
provider data, set `PRICE_ADAPTER=twelvedata` and `TWELVE_DATA_API_KEY`.

This is not yet the complete project strategy: it does not include D1/H4
fundamental bias, news blackouts, H1/M15 confluences, swaps, commissions, or
broker margin/lot constraints. Treat provider results as research output, not a
trade recommendation.
