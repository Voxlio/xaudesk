/**
 * Economic indicator reference table.
 *
 * Turning "Core CPI m/m came in at 0.4% against a 0.2% forecast" into a number
 * the score can use needs two facts the calendar feed does not provide:
 *
 * 1. **Polarity.** Does a higher reading strengthen the dollar? For CPI, yes.
 *    For the unemployment rate, no. There is no way to infer this from the
 *    feed, and guessing inverts the trade.
 *
 * 2. **Scale.** A 0.2 surprise is enormous for CPI m/m and meaningless for
 *    Non-Farm Payrolls, where the same figure in the feed's units (0.2 of a
 *    person) is noise. `notableSurprise` is the miss size that counts as a
 *    full-strength surprise, in the same unit the feed publishes.
 *
 * An indicator absent from this table is **not scored** and is reported as
 * unscored with a reason. That is the deliberate choice: a wrong polarity is
 * worse than no opinion, and the project rules forbid black-box logic.
 *
 * ## Regime assumption, stated explicitly
 *
 * Inflation prints carry positive polarity: hotter inflation implies a more
 * hawkish Fed, higher real rates, a stronger dollar and weaker gold. That is
 * the standard read and holds through a tightening or on-hold regime. It can
 * invert — in a growth-scare or stagflation regime, hot inflation can lift gold
 * as an inflation hedge while the dollar falls. This table does not model that.
 * If the regime turns, these polarities need revisiting rather than trusting.
 */

/** Does a higher-than-forecast reading strengthen (positive) the dollar? */
export type Polarity = 'positive' | 'negative';

export interface IndicatorSpec {
  /** Canonical title, matched case-insensitively against the feed. */
  title: string;
  polarity: Polarity;
  /**
   * Miss size that counts as a full-strength surprise, in the feed's own unit
   * after `parseEconomicValue` (so "250K" is 250000 and "0.4%" is 0.4).
   */
  notableSurprise: number;
  /** Why this scale, so the number is auditable rather than magic. */
  note: string;
}

const SPECS: readonly IndicatorSpec[] = [
  // --- Labour -------------------------------------------------------------
  {
    title: 'Non-Farm Employment Change',
    polarity: 'positive',
    notableSurprise: 75_000,
    note: 'a 75k miss is roughly the threshold that moves the rates curve',
  },
  {
    title: 'ADP Non-Farm Employment Change',
    polarity: 'positive',
    notableSurprise: 60_000,
    note: 'noisier than NFP and a weak predictor of it, so scaled tighter',
  },
  {
    title: 'Unemployment Rate',
    polarity: 'negative',
    notableSurprise: 0.2,
    note: 'rounds to 0.1, so a 0.2 miss is two notches — a large surprise',
  },
  {
    title: 'Unemployment Claims',
    polarity: 'negative',
    notableSurprise: 25_000,
    note: 'weekly series with ~15k noise; 25k is a signal',
  },
  {
    title: 'Average Hourly Earnings m/m',
    polarity: 'positive',
    notableSurprise: 0.15,
    note: 'wage growth is the Fed-relevant part of payrolls day',
  },
  {
    title: 'JOLTS Job Openings',
    polarity: 'positive',
    notableSurprise: 400_000,
    note: 'large absolute level, revised heavily',
  },
  {
    title: 'Employment Cost Index q/q',
    polarity: 'positive',
    notableSurprise: 0.1,
    note: 'quarterly and smooth, so small misses matter',
  },

  // --- Inflation ----------------------------------------------------------
  {
    title: 'CPI m/m',
    polarity: 'positive',
    notableSurprise: 0.15,
    note: 'published to 0.1; 0.15 is better than a one-notch miss',
  },
  {
    title: 'Core CPI m/m',
    polarity: 'positive',
    notableSurprise: 0.15,
    note: 'the Fed watches core over headline',
  },
  {
    title: 'CPI y/y',
    polarity: 'positive',
    notableSurprise: 0.2,
    note: 'annual rate moves less per release',
  },
  {
    title: 'Core CPI y/y',
    polarity: 'positive',
    notableSurprise: 0.2,
    note: 'annual core; the headline number for inflation trend',
  },
  {
    title: 'PPI m/m',
    polarity: 'positive',
    notableSurprise: 0.2,
    note: 'noisier than CPI, less market-moving',
  },
  {
    title: 'Core PPI m/m',
    polarity: 'positive',
    notableSurprise: 0.2,
    note: 'pipeline inflation, secondary to CPI',
  },
  {
    title: 'Core PCE Price Index m/m',
    polarity: 'positive',
    notableSurprise: 0.1,
    note: "the Fed's preferred gauge, and very smooth",
  },
  {
    title: 'PCE Price Index m/m',
    polarity: 'positive',
    notableSurprise: 0.1,
    note: 'headline PCE; smooth series',
  },

  // --- Growth and activity ------------------------------------------------
  {
    title: 'Advance GDP q/q',
    polarity: 'positive',
    notableSurprise: 0.5,
    note: 'first estimate, annualised, heavily revised',
  },
  {
    title: 'Prelim GDP q/q',
    polarity: 'positive',
    notableSurprise: 0.4,
    note: 'second estimate; less surprise left in it',
  },
  {
    title: 'Final GDP q/q',
    polarity: 'positive',
    notableSurprise: 0.3,
    note: 'third estimate; rarely market-moving',
  },
  {
    title: 'ISM Manufacturing PMI',
    polarity: 'positive',
    notableSurprise: 1.5,
    note: 'diffusion index; 1.5 points is a clear miss',
  },
  {
    title: 'ISM Services PMI',
    polarity: 'positive',
    notableSurprise: 1.5,
    note: 'services dominate US output, so this outranks manufacturing',
  },
  {
    title: 'Flash Manufacturing PMI',
    polarity: 'positive',
    notableSurprise: 1.5,
    note: 'S&P Global flash; early read on the month',
  },
  {
    title: 'Flash Services PMI',
    polarity: 'positive',
    notableSurprise: 1.5,
    note: 'S&P Global flash services',
  },
  {
    title: 'Retail Sales m/m',
    polarity: 'positive',
    notableSurprise: 0.4,
    note: 'volatile and revision-prone',
  },
  {
    title: 'Core Retail Sales m/m',
    polarity: 'positive',
    notableSurprise: 0.4,
    note: 'ex-autos; the cleaner consumption read',
  },
  {
    title: 'Durable Goods Orders m/m',
    polarity: 'positive',
    notableSurprise: 1.5,
    note: 'aircraft orders make the headline extremely noisy',
  },
  {
    title: 'Core Durable Goods Orders m/m',
    polarity: 'positive',
    notableSurprise: 0.8,
    note: 'ex-transport; much less noisy than the headline',
  },
  {
    title: 'Empire State Manufacturing Index',
    polarity: 'positive',
    notableSurprise: 5,
    note: 'regional survey with a wide range',
  },
  {
    title: 'Philly Fed Manufacturing Index',
    polarity: 'positive',
    notableSurprise: 5,
    note: 'regional survey with a wide range',
  },

  // --- Rates and sentiment ------------------------------------------------
  {
    title: 'Federal Funds Rate',
    polarity: 'positive',
    notableSurprise: 0.125,
    note: 'decisions move in 25bp steps, so half a step is already a shock',
  },
  {
    title: 'CB Consumer Confidence',
    polarity: 'positive',
    notableSurprise: 3,
    note: 'index level; 3 points is a notable miss',
  },
  {
    title: 'Prelim UoM Consumer Sentiment',
    polarity: 'positive',
    notableSurprise: 3,
    note: 'preliminary estimate, revised mid-month',
  },
  {
    title: 'Revised UoM Consumer Sentiment',
    polarity: 'positive',
    notableSurprise: 2,
    note: 'revision; smaller surprises available',
  },

  // --- External and housing -----------------------------------------------
  {
    title: 'Trade Balance',
    polarity: 'positive',
    notableSurprise: 5e9,
    note: 'reported as a deficit, so a smaller deficit is a positive surprise',
  },
  {
    title: 'Building Permits',
    polarity: 'positive',
    notableSurprise: 60_000,
    note: 'annualised units; forward-looking housing indicator',
  },
  {
    title: 'Housing Starts',
    polarity: 'positive',
    notableSurprise: 60_000,
    note: 'annualised units, weather-sensitive',
  },
  {
    title: 'Existing Home Sales',
    polarity: 'positive',
    notableSurprise: 150_000,
    note: 'annualised units; large level, modest sensitivity',
  },
  {
    title: 'New Home Sales',
    polarity: 'positive',
    notableSurprise: 50_000,
    note: 'annualised units; small sample, heavy revisions',
  },
];

/** Normalised title → spec. */
const SPEC_BY_KEY = new Map<string, IndicatorSpec>(
  SPECS.map((spec) => [normalizeTitle(spec.title), spec]),
);

/**
 * Keys ordered longest-first so prefix matching prefers the most specific
 * entry. Without this, "core cpi m/m" could fall through to a shorter key.
 */
const KEYS_BY_SPECIFICITY = [...SPEC_BY_KEY.keys()].sort((a, b) => b.length - a.length);

/**
 * Lowercase, strip bracketed qualifiers and punctuation, collapse whitespace.
 *
 * The feed decorates titles over time — "CPI m/m" has appeared as "CPI m/m
 * (Jun)" and "CPI m/m NSA" — so matching raw strings is brittle.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9/\s.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Look up an indicator. Returns null when the title is unknown, which the
 * score treats as "no opinion" rather than falling back to a default polarity.
 */
export function findIndicatorSpec(title: string): IndicatorSpec | null {
  const key = normalizeTitle(title);

  const exact = SPEC_BY_KEY.get(key);
  if (exact !== undefined) return exact;

  // A decorated title such as "cpi m/m nsa" still starts with a known key.
  for (const candidate of KEYS_BY_SPECIFICITY) {
    if (key.startsWith(candidate)) {
      const spec = SPEC_BY_KEY.get(candidate);
      if (spec !== undefined) return spec;
    }
  }

  return null;
}

/** Every known indicator, for tests and documentation. */
export function allIndicatorSpecs(): readonly IndicatorSpec[] {
  return SPECS;
}
