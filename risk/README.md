# /risk — HFM Cent position sizing

`calculateCentLots` takes `equityUsd` in US dollars. A $100 deposit is entered as
`ACCOUNT_EQUITY_USD=100`, even though the HFM terminal displays 10,000 cents.
The terminal value is shown separately in the returned breakdown and never
feeds the sizing formula.

The model assumes one standard XAU/USD lot is 100 troy ounces and one Cent lot
is 1/100 of that, or 1 ounce. Therefore a $1/oz stop distance risks $1 per
Cent lot. At 1% risk on $100, a $10/oz stop gives a $1 budget and a raw size of
0.10 Cent lots. Size is rounded down to the configured step. If the result is
below the minimum lot, size is zero and the strategy returns `NO_TRADE`; it
never rounds up into excess risk.

Configure `ACCOUNT_EQUITY_USD`, `ACCOUNT_RISK_PERCENT` (1–2),
`ACCOUNT_CENT_LOT_STEP`, and `ACCOUNT_CENT_MIN_LOT`. The defaults for minimum
and step are 0.01, based on the project assumption; verify contract size, lot
step, minimum volume, quote precision, and any commission against the live HFM
Cent XAUUSD specification before relying on a displayed size. Swap, spread,
commission, and margin are not included in this lot calculation.
