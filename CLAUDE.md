Project: XAU Desk, a web app that generates ONE daily XAU/USD trade idea for an HFM Cent account.

Stack: Next.js + TypeScript + Tailwind frontend, API routes or FastAPI backend, SQLite (Prisma). Lightweight Charts for charts.

Structure: /data (price + ForexFactory adapters), /indicators, /strategy, /risk, /backtest, /api, /app.

Output per idea: direction (Buy/Sell/No-Trade), entry zone, SL, TP1-3, RR, confidence 0-100, lot size, plain-English reason.

Strategy: D1/H4 bias (structure, 50/200 EMA) + fundamental bias (USD high-impact news vs forecast, DXY, US10Y) + H1/M15 entry with at least 3 confluences (S/D zones, liquidity sweep, BOS pullback, RSI, EMA). Min 1:2 RR. No trades 30 min around high-impact news. Max 1 trade/day.

Risk: cent-account lot math (1 std lot = 100 oz, cent = 1/100), risk 1-2% per trade, show the math.

News: use ForexFactory public feed (nfs.faireconomy.media/ff_calendar_thisweek.json). Never scrape HTML. Cache it and fail gracefully.

Rules: all data sources behind swappable adapters; no black-box logic; unit tests for indicators and lot math; API keys in .env; never hardcode secrets; always show the "educational, not financial advice" disclaimer.