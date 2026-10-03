import type {
  MacroAdapter,
  MacroInstrument,
  MacroReading,
  MacroRequest,
  MacroSnapshot,
} from '../types';

/**
 * Deterministic macro readings for tests and offline development, plus the
 * degraded variants that are easy to forget to test: one instrument missing,
 * and both missing.
 */

export interface MacroFixtureValues {
  /** USD proxy level. A rising proxy is dollar-positive. */
  usdProxyLast?: number;
  usdProxyChangePercent?: number;
  /** Percent — 4.21 means 4.21%. A change of 0.15 is 15 basis points. */
  us10yLast?: number;
  us10yChange?: number;
  /** Open time of the newest bar, unix seconds UTC. */
  asOf?: number;
  lookbackBars?: number;
}

/**
 * Defaults describe a mildly dollar-positive week: proxy up 0.9%, the
 * 10-year up 12bp. Chosen so the fixture produces a clear but not extreme
 * fundamental read.
 */
const DEFAULTS: Required<Omit<MacroFixtureValues, 'asOf'>> = {
  usdProxyLast: 28.79,
  usdProxyChangePercent: 0.5,
  us10yLast: 4.21,
  us10yChange: 0.12,
  lookbackBars: 5,
};

export class FixtureMacroAdapter implements MacroAdapter {
  readonly name = 'fixture-macro';

  constructor(private readonly values: MacroFixtureValues = {}) {}

  async fetchSnapshot(request: MacroRequest = {}): Promise<MacroSnapshot> {
    const lookbackBars =
      request.lookbackBars ?? this.values.lookbackBars ?? DEFAULTS.lookbackBars;
    const asOf = this.values.asOf ?? Math.floor(Date.now() / 1000);

    return {
      usdProxy: reading(
        'USD_PROXY',
        'SYNTHETIC-USD-PROXY',
        'Synthetic USD proxy fixture',
        this.values.usdProxyLast ?? DEFAULTS.usdProxyLast,
        changeForPercent(
          this.values.usdProxyLast ?? DEFAULTS.usdProxyLast,
          this.values.usdProxyChangePercent ?? DEFAULTS.usdProxyChangePercent,
        ),
        asOf,
        lookbackBars,
      ),
      us10y: reading(
        'US10Y',
        'US10Y',
        'Synthetic US10Y fixture',
        this.values.us10yLast ?? DEFAULTS.us10yLast,
        this.values.us10yChange ?? DEFAULTS.us10yChange,
        asOf,
        lookbackBars,
      ),
      unavailable: [],
    };
  }
}

/**
 * Reports both instruments as unavailable. This is the shape the real adapter
 * returns on a plan that does not carry indices or yields, which is the most
 * likely production state on the free tier — so it deserves a first-class test
 * double rather than being improvised per test.
 */
export class UnavailableMacroAdapter implements MacroAdapter {
  readonly name = 'unavailable-macro';

  constructor(private readonly reason = 'macro data not configured') {}

  async fetchSnapshot(): Promise<MacroSnapshot> {
    return {
      usdProxy: null,
      us10y: null,
      unavailable: [
        { instrument: 'USD_PROXY', reason: this.reason },
        { instrument: 'US10Y', reason: this.reason },
      ],
    };
  }
}

/** Serves only the listed instruments; the rest come back unavailable. */
export class PartialMacroAdapter implements MacroAdapter {
  readonly name = 'partial-macro';

  private readonly inner: FixtureMacroAdapter;

  constructor(
    private readonly available: readonly MacroInstrument[],
    values: MacroFixtureValues = {},
    private readonly reason = 'not available on this plan',
  ) {
    this.inner = new FixtureMacroAdapter(values);
  }

  async fetchSnapshot(request: MacroRequest = {}): Promise<MacroSnapshot> {
    const full = await this.inner.fetchSnapshot(request);

    const snapshot: MacroSnapshot = {
      usdProxy: this.available.includes('USD_PROXY') ? full.usdProxy : null,
      us10y: this.available.includes('US10Y') ? full.us10y : null,
      unavailable: [],
    };

    for (const instrument of ['USD_PROXY', 'US10Y'] as const) {
      if (!this.available.includes(instrument)) {
        snapshot.unavailable.push({ instrument, reason: this.reason });
      }
    }

    return snapshot;
  }
}

/**
 * The absolute move that makes `reading()` report exactly `percent`.
 *
 * `reading` derives `reference = last - changeAbsolute` and then quotes the
 * change as a percentage OF THAT REFERENCE, which is what a day-over-day
 * percent change means. So `last * percent/100` is the wrong inverse — it is a
 * percent of the closing value, and asking a fixture for 0.4 handed back
 * 0.4016064257028112. A fixture whose requested inputs do not round-trip is a
 * poor oracle: the test has to restate the implementation's arithmetic to say
 * what it expects.
 *
 * Solving reference = last / (1 + percent/100) for the change gives this.
 */
function changeForPercent(last: number, percent: number): number {
  const ratio = percent / 100;
  if (!Number.isFinite(ratio) || ratio === -1) return 0;
  return (last * ratio) / (1 + ratio);
}

function reading(
  instrument: MacroInstrument,
  symbol: string,
  source: string,
  last: number,
  changeAbsolute: number,
  asOf: number,
  lookbackBars: number,
): MacroReading {
  const reference = last - changeAbsolute;

  return {
    instrument,
    symbol,
    source,
    last,
    reference,
    changeAbsolute,
    changePercent: reference === 0 ? 0 : (changeAbsolute / Math.abs(reference)) * 100,
    asOf,
    lookbackBars,
  };
}
