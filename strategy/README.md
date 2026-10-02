# /strategy — bias and entry logic

`createTradeIdea` is a pure calculation over four candle series and a
fundamental/blackout snapshot. `GET /api/idea` fetches adapters and persists the
complete object once per UTC `tradeDate` using the SQLite unique constraint.

An actionable setup requires D1 and H4 structure plus close/EMA 50/200 to align,
non-neutral USD/fundamental gold bias in the same direction, no 30-minute
high-impact USD news blackout, and at least three of these five H1/M15
confluences: confirmed swing supply/demand zone, reclaimed liquidity sweep,
recent BOS pullback, directional RSI, and aligned EMAs. Stops use the latest
confirmed H1 swing with an ATR fallback; TP1/2/3 are 2R/3R/4R. The target is
measured from the adverse edge of the entry zone so TP1 remains at least 1:2.

`TradeIdea` includes the numeric levels, directional biases, confidence,
confluence-by-confluence pass/fail evidence, the full fundamental score, the
blackout state, the source snapshot, cent-lot arithmetic, and a plain-English
reason with the actual indicator values. Missing equity or synthetic fixture
prices always produce `NO_TRADE`. Every day has one stored result; subsequent
requests return that same row rather than recomputing a different idea.
