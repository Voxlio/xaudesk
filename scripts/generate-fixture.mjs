/**
 * Generates the deterministic XAU/USD fixture CSVs used by tests, the fixture
 * price adapter, and local development without an API key.
 *
 *   node scripts/generate-fixture.mjs
 *
 * The series is synthetic but structurally realistic: trending and ranging
 * regimes, weekend gaps, and a price level in the right ballpark for gold.
 * A fixed seed means the output is byte-identical on every machine, which is
 * what lets tests assert on real indicator values.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'data', 'fixtures');

const SEED = 20261001;
const START_PRICE = 2385.0;
const M15 = 15 * 60;

/** mulberry32 — small, fast, fully deterministic PRNG. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(SEED);

/** Box-Muller, so the noise is normal rather than uniform. */
function gauss() {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function isWeekend(date) {
  const day = date.getUTCDay();
  return day === 6 || day === 0; // Saturday, Sunday
}

/** Build 500 trading days of M15 bars ending at the last full day before now. */
function buildBaseSeries(tradingDays = 500) {
  const bars = [];
  let price = START_PRICE;

  // Regime: a drift that flips every few weeks, so structure isn't monotonic.
  let drift = 0.08;
  let regimeBarsLeft = 400;

  // Walk back far enough in calendar days to cover `tradingDays` weekdays.
  const end = new Date(Date.UTC(2026, 8, 30, 21, 0, 0)); // 2026-09-30 21:00 UTC
  const cursor = new Date(end.getTime() - Math.ceil(tradingDays * 1.45) * 86400_000);
  cursor.setUTCHours(0, 0, 0, 0);

  while (cursor.getTime() < end.getTime()) {
    if (isWeekend(cursor)) {
      cursor.setTime(cursor.getTime() + 86400_000);
      continue;
    }

    for (let slot = 0; slot < 96; slot += 1) {
      if (regimeBarsLeft <= 0) {
        // New regime: trend up, trend down, or chop.
        const roll = rand();
        drift = roll < 0.38 ? 0.075 : roll < 0.76 ? -0.075 : 0.0;
        regimeBarsLeft = 300 + Math.floor(rand() * 500);
      }
      regimeBarsLeft -= 1;

      const time = Math.floor(cursor.getTime() / 1000) + slot * M15;

      // Intraday volatility: thin in the Asia session, thick at the London
      // and New York opens. Keeps ATR from being a flat line.
      const hour = (slot * 15) / 60;
      const sessionVol = hour >= 7 && hour < 16 ? 1.45 : hour >= 16 && hour < 21 ? 1.15 : 0.6;

      const open = price;
      const step = drift * 0.25 + gauss() * 1.1 * sessionVol;
      const close = open + step;

      // Wicks scale with the body, with a floor so doji bars still have range.
      const wickHigh = Math.abs(gauss()) * 0.55 * sessionVol + 0.08;
      const wickLow = Math.abs(gauss()) * 0.55 * sessionVol + 0.08;
      const high = Math.max(open, close) + wickHigh;
      const low = Math.min(open, close) - wickLow;

      bars.push({
        time,
        open: round2(open),
        high: round2(high),
        low: round2(low),
        close: round2(close),
      });

      price = close;
    }

    cursor.setTime(cursor.getTime() + 86400_000);
  }

  return bars;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/** Aggregate M15 bars into a higher timeframe by bucketing open times. */
function aggregate(bars, bucketFor) {
  const buckets = new Map();

  for (const bar of bars) {
    const key = bucketFor(bar.time);
    const existing = buckets.get(key);
    if (existing === undefined) {
      buckets.set(key, { time: key, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
    } else {
      existing.high = Math.max(existing.high, bar.high);
      existing.low = Math.min(existing.low, bar.low);
      existing.close = bar.close;
    }
  }

  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

const bucketBy = (seconds) => (time) => Math.floor(time / seconds) * seconds;
const bucketByUtcDay = (time) => {
  const d = new Date(time * 1000);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
};

function toCsv(bars) {
  const lines = ['time,open,high,low,close'];
  for (const bar of bars) {
    lines.push(
      `${new Date(bar.time * 1000).toISOString().slice(0, 19).replace('T', ' ')},` +
        `${bar.open.toFixed(2)},${bar.high.toFixed(2)},${bar.low.toFixed(2)},${bar.close.toFixed(2)}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

const base = buildBaseSeries(500);

const outputs = {
  'xauusd-m15.csv': base.slice(-400),
  'xauusd-h1.csv': aggregate(base, bucketBy(3600)).slice(-400),
  'xauusd-h4.csv': aggregate(base, bucketBy(4 * 3600)).slice(-3200),
  'xauusd-d1.csv': aggregate(base, bucketByUtcDay).slice(-500),
};

mkdirSync(OUT_DIR, { recursive: true });

for (const [filename, bars] of Object.entries(outputs)) {
  writeFileSync(join(OUT_DIR, filename), toCsv(bars), 'utf8');
  const first = bars[0];
  const last = bars[bars.length - 1];
  console.log(
    `${filename.padEnd(18)} ${String(bars.length).padStart(4)} bars  ` +
      `${new Date(first.time * 1000).toISOString().slice(0, 16)} → ` +
      `${new Date(last.time * 1000).toISOString().slice(0, 16)}  ` +
      `close ${first.close} → ${last.close}`,
  );
}
