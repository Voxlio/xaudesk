import { parseEconomicValue } from '../data/news/parse';
import type { MacroReading, MacroSnapshot, NewsEvent, NewsImpact } from '../data/types';
import { findIndicatorSpec, type Polarity } from './indicatorTable';

/**
 * Fundamental Score.
 *
 * Produces a signed **USD strength** score in [-100, +100] from three inputs:
 * USD data versus forecast, a named dollar proxy, and the US 10-year yield. Gold
 * bias is then the inverse — a stronger dollar is bearish gold.
 *
 * Scoring USD strength rather than gold direction directly is deliberate: it is
 * the direction the economics actually runs, so the reason string reads the way
 * a person would explain it ("CPI beat, dollar bid, bearish gold") instead of
 * carrying a hidden inversion.
 *
 * ## Shape of the calculation
 *
 *   per event:  surprise = actual - forecast
 *               normalised = clamp(surprise / notableSurprise, -1, 1) * polarity
 *               weight = impactWeight * recencyWeight
 *
 *   news value = Σ(weight * normalised) / max(Σ weight, 1)
 *
 * Dividing by `max(Σ weight, 1)` rather than `Σ weight` is the important
 * detail. A plain weighted mean would let a single low-impact release with a
 * big miss produce a maximum-strength score, because it would be the only thing
 * in the average. The floor of 1.0 — one high-impact event's worth of weight —
 * means thin evidence produces a small score, which is the honest answer.
 *
 * The three component values are then combined by their own weights, skipping
 * whichever are unavailable and renormalising over the rest.
 *
 * Nothing here is hidden: every event that contributed appears in `scored` with
 * its arithmetic, every event that did not appears in `unscored` with a reason,
 * and every missing input appears in `missing`.
 */

// ---------------------------------------------------------------------------
// Tunables. Exported because they are judgement calls, not constants of nature.
// ---------------------------------------------------------------------------

/** How much each impact level counts. LOW is kept visible but nearly weightless. */
export const IMPACT_WEIGHTS: Record<NewsImpact, number> = {
  HIGH: 1,
  MEDIUM: 0.4,
  LOW: 0.1,
  NONE: 0,
};

/** Weight floor for the news aggregate — see the class comment. */
export const REFERENCE_NEWS_WEIGHT = 1;

/** Relative weight of each component of the final score. */
export const COMPONENT_WEIGHTS = {
  news: 0.5,
  usdProxy: 0.3,
  us10y: 0.2,
} as const;

/** UUP/DTWEXBGS percentage move, counting as full-strength dollar evidence. */
export const USD_PROXY_NOTABLE_PERCENT = 0.5;

/** One-day DGS10 move, in percentage points (0.05 = 5 basis points). */
export const US10Y_NOTABLE_CHANGE = 0.05;

/**
 * Dead-bands: the smallest move in each input that counts as real evidence.
 *
 * These are deliberately expressed in each input's OWN units and applied before
 * normalization, because that is the only place the numbers mean anything. A
 * dead-band on the normalized value instead would have a different real-world
 * threshold for every component — it divides by that component's `notable`
 * scale — so "ignore noise" would quietly mean 0.025% on the dollar proxy and
 * 0.0025pp on the 10-year. Judging a -0.04% UUP drift as genuine disagreement,
 * and dropping published confidence from 80 to 50 for it, was that bug.
 *
 * The news component is the exception: each release is already normalized by its
 * own `notableSurprise` before being weighted together, so its aggregate is the
 * natural unit and there is no rawer number to compare.
 */
export const USD_PROXY_NOISE_PERCENT = 0.05;
export const US10Y_NOISE_CHANGE = 0.01;
export const NEWS_NOISE_VALUE = 0.05;

/** Hours after which a release's weight has halved. */
export const RECENCY_HALF_LIFE_HOURS = 24;

/** Releases older than this are ignored entirely. */
export const MAX_EVENT_AGE_HOURS = 72;

/** |usdScore| below this reads as no directional bias. */
export const NEUTRAL_THRESHOLD = 15;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type GoldBias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface ScoredEvent {
  event: NewsEvent;
  actual: number;
  forecast: number;
  surprise: number;
  notableSurprise: number;
  polarity: Polarity;
  /** -1..+1, already polarity-adjusted so positive means dollar-positive. */
  normalized: number;
  impactWeight: number;
  recencyWeight: number;
  weight: number;
  ageHours: number;
  /** Plain-English summary citing the real figures. */
  note: string;
}

export interface UnscoredEvent {
  event: NewsEvent;
  reason: string;
}

export type ComponentKey = 'news' | 'usdProxy' | 'us10y';

export interface ScoreComponent {
  key: ComponentKey;
  /** -1..+1, dollar-oriented. */
  value: number;
  weight: number;
  /**
   * False when the underlying move was inside this input's dead-band, i.e. too
   * small to be evidence either way. Decided at construction, where the raw
   * value and its units are still in scope. Only significant components can
   * count as disagreement in `computeConfidence`.
   */
  significant: boolean;
  detail: string;
}

export interface FundamentalScore {
  /** -100 (dollar-negative) .. +100 (dollar-positive). */
  usdScore: number;
  /** Gold direction implied by inverting usdScore. */
  goldBias: GoldBias;
  /**
   * 0..100 — how much of the intended evidence was available and how well it
   * agrees. This measures evidence *quality*, not signal strength; magnitude
   * lives in `usdScore`. A confident zero is a real and useful answer.
   */
  confidence: number;
  components: ScoreComponent[];
  /** Inputs that could not be read, phrased for display. */
  missing: string[];
  scored: ScoredEvent[];
  unscored: UnscoredEvent[];
  /** Plain-English explanation citing real numbers. */
  reason: string;
  /** Evaluation time, unix seconds UTC. */
  asOf: number;
}

export interface FundamentalScoreOptions {
  /** Evaluation time, unix seconds UTC. Defaults to now. */
  at?: number;
  /** Currency whose releases are scored. Default "USD". */
  currency?: string;
  macro?: MacroSnapshot | null;
  /** Overrides for the tunables above, mainly for tests and backtest sweeps. */
  halfLifeHours?: number;
  maxAgeHours?: number;
  neutralThreshold?: number;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function scoreFundamentals(
  events: readonly NewsEvent[],
  options: FundamentalScoreOptions = {},
): FundamentalScore {
  const at = options.at ?? Math.floor(Date.now() / 1000);
  const currency = (options.currency ?? 'USD').toUpperCase();
  const halfLife = options.halfLifeHours ?? RECENCY_HALF_LIFE_HOURS;
  const maxAge = options.maxAgeHours ?? MAX_EVENT_AGE_HOURS;
  const neutralThreshold = options.neutralThreshold ?? NEUTRAL_THRESHOLD;

  const { scored, unscored } = scoreEvents(events, { at, currency, halfLife, maxAge });

  const components: ScoreComponent[] = [];
  const missing: string[] = [];

  // --- News component ---
  const totalWeight = scored.reduce((sum, item) => sum + item.weight, 0);
  if (scored.length > 0 && totalWeight > 0) {
    const weighted = scored.reduce((sum, item) => sum + item.weight * item.normalized, 0);
    const value = clamp(weighted / Math.max(totalWeight, REFERENCE_NEWS_WEIGHT), -1, 1);

    components.push({
      key: 'news',
      value,
      weight: COMPONENT_WEIGHTS.news,
      significant: Math.abs(value) > NEWS_NOISE_VALUE,
      detail: describeNews(scored, totalWeight),
    });
  } else {
    missing.push(
      events.length === 0
        ? 'no calendar data available'
        : `no scoreable ${currency} releases in the last ${maxAge}h`,
    );
  }

  // --- Dollar proxy component ---
  const macro = options.macro ?? null;
  const usdProxy = macro?.usdProxy ?? null;
  if (usdProxy !== null) {
    const value = clamp(usdProxy.changePercent / USD_PROXY_NOTABLE_PERCENT, -1, 1);
    components.push({
      key: 'usdProxy',
      value,
      weight: COMPONENT_WEIGHTS.usdProxy,
      significant: Math.abs(usdProxy.changePercent) > USD_PROXY_NOISE_PERCENT,
      detail:
        `${usdProxy.source} (${usdProxy.symbol}) ${format(usdProxy.last)}, ` +
        `${signed(usdProxy.changePercent, 3)}% daily change, observation ${date(usdProxy.asOf)}`,
    });
  } else {
    missing.push(`USD proxy (UUP) unavailable${reasonFor(macro, 'USD_PROXY')}`);
  }

  // --- US10Y component ---
  const us10y = macro?.us10y ?? null;
  if (us10y !== null) {
    const value = clamp(us10y.changeAbsolute / US10Y_NOTABLE_CHANGE, -1, 1);
    components.push({
      key: 'us10y',
      value,
      weight: COMPONENT_WEIGHTS.us10y,
      significant: Math.abs(us10y.changeAbsolute) > US10Y_NOISE_CHANGE,
      detail:
        `${us10y.source} ${format(us10y.last)}%, ${signed(basisPoints(us10y), 1)}bp daily change, ` +
        `observation ${date(us10y.asOf)}`,
    });
  } else {
    missing.push(`US10Y unavailable${reasonFor(macro, 'US10Y')}`);
  }

  // --- Combine ---
  const availableWeight = components.reduce((sum, item) => sum + item.weight, 0);
  const usdScore =
    availableWeight === 0
      ? 0
      : round(
          (components.reduce((sum, item) => sum + item.weight * item.value, 0) /
            availableWeight) *
            100,
          1,
        );

  const goldBias: GoldBias =
    availableWeight === 0 || Math.abs(usdScore) < neutralThreshold
      ? 'NEUTRAL'
      : usdScore > 0
        ? 'BEARISH'
        : 'BULLISH';

  const confidence = computeConfidence(components, usdScore);

  return {
    usdScore,
    goldBias,
    confidence,
    components,
    missing,
    scored,
    unscored,
    reason: buildReason({ usdScore, goldBias, confidence, components, missing, scored }),
    asOf: at,
  };
}

interface EventScoringContext {
  at: number;
  currency: string;
  halfLife: number;
  maxAge: number;
}

function scoreEvents(
  events: readonly NewsEvent[],
  context: EventScoringContext,
): { scored: ScoredEvent[]; unscored: UnscoredEvent[] } {
  const scored: ScoredEvent[] = [];
  const unscored: UnscoredEvent[] = [];

  for (const event of events) {
    // Other currencies are not an error, just not our business — skipping them
    // silently keeps `unscored` useful rather than flooding it with EUR noise.
    if (event.country.toUpperCase() !== context.currency) continue;
    if (event.impact === 'NONE') continue;

    if (event.time === null) {
      unscored.push({ event, reason: 'no scheduled time (tentative or all-day)' });
      continue;
    }

    // Anti-look-ahead: a release in the future cannot have informed the market
    // yet, whatever the feed claims. This is the guard that stops a backtest
    // from reading tomorrow's payrolls.
    if (event.time > context.at) continue;

    const ageHours = (context.at - event.time) / 3600;
    if (ageHours > context.maxAge) continue;

    const impactWeight = IMPACT_WEIGHTS[event.impact];
    if (impactWeight <= 0) continue;

    if (event.actual === null) {
      unscored.push({ event, reason: 'no actual published' });
      continue;
    }
    if (event.forecast === null) {
      unscored.push({ event, reason: 'no forecast to compare against' });
      continue;
    }

    const actual = parseEconomicValue(event.actual);
    const forecast = parseEconomicValue(event.forecast);
    if (actual === null || forecast === null) {
      unscored.push({
        event,
        reason: `unparseable figures (actual "${event.actual}", forecast "${event.forecast}")`,
      });
      continue;
    }

    const spec = findIndicatorSpec(event.title);
    if (spec === null) {
      unscored.push({
        event,
        reason: 'not in the indicator table, so polarity and scale are unknown',
      });
      continue;
    }

    const surprise = actual - forecast;
    const direction = spec.polarity === 'positive' ? 1 : -1;
    const normalized = clamp(surprise / spec.notableSurprise, -1, 1) * direction;
    const recencyWeight = 0.5 ** (ageHours / context.halfLife);

    scored.push({
      event,
      actual,
      forecast,
      surprise,
      notableSurprise: spec.notableSurprise,
      polarity: spec.polarity,
      normalized,
      impactWeight,
      recencyWeight,
      weight: impactWeight * recencyWeight,
      ageHours,
      note: describeEvent(event, actual, forecast, surprise, spec.polarity, normalized),
    });
  }

  // Strongest contribution first, so the reason string leads with what matters.
  scored.sort(
    (a, b) => Math.abs(b.weight * b.normalized) - Math.abs(a.weight * a.normalized),
  );

  return { scored, unscored };
}

/**
 * Confidence = coverage × agreement.
 *
 * Coverage is the share of intended component weight actually available, so
 * losing the USD proxy and US10Y caps confidence at 50. Agreement is the share of that
 * weight pointing the same way as the final score, so a dollar-positive data
 * week fighting a falling USD proxy is reported as the genuinely mixed picture it is.
 */
function computeConfidence(components: readonly ScoreComponent[], usdScore: number): number {
  const totalPossible = Object.values(COMPONENT_WEIGHTS).reduce((a, b) => a + b, 0);
  const available = components.reduce((sum, item) => sum + item.weight, 0);
  if (available === 0) return 0;

  const coverage = available / totalPossible;
  const scoreSign = Math.sign(usdScore);

  const opposing = components
    .filter((item) => item.significant && Math.sign(item.value) !== scoreSign)
    .reduce((sum, item) => sum + item.weight, 0);

  const agreement = scoreSign === 0 ? 1 : 1 - opposing / available;

  return Math.round(100 * coverage * agreement);
}

// ---------------------------------------------------------------------------
// Explanation
// ---------------------------------------------------------------------------

function describeEvent(
  event: NewsEvent,
  actual: number,
  forecast: number,
  surprise: number,
  polarity: Polarity,
  normalized: number,
): string {
  const verdict =
    Math.abs(surprise) < 1e-9
      ? 'in line'
      : surprise > 0
        ? 'above forecast'
        : 'below forecast';

  const effect =
    Math.abs(normalized) < 1e-9
      ? 'neutral for USD'
      : normalized > 0
        ? 'USD positive'
        : 'USD negative';

  const inverted = polarity === 'negative' ? ' (inverted: lower is stronger)' : '';

  return (
    `${event.title} ${event.actual ?? format(actual)} vs ${event.forecast ?? format(forecast)} ` +
    `forecast — ${verdict}, ${effect}${inverted}`
  );
}

function describeNews(scored: readonly ScoredEvent[], totalWeight: number): string {
  const count = scored.length;
  const thin = totalWeight < REFERENCE_NEWS_WEIGHT;

  return (
    `${count} scored ${plural(count, 'release', 'releases')}, ` +
    `combined weight ${format(totalWeight, 2)}` +
    (thin ? ' (thin — score damped toward neutral)' : '')
  );
}

function buildReason(input: {
  usdScore: number;
  goldBias: GoldBias;
  confidence: number;
  components: readonly ScoreComponent[];
  missing: readonly string[];
  scored: readonly ScoredEvent[];
}): string {
  const { usdScore, goldBias, confidence, components, missing, scored } = input;

  if (components.length === 0) {
    return `No fundamental read: ${missing.join('; ')}. Treat as technical-only.`;
  }

  const headline =
    goldBias === 'NEUTRAL'
      ? `Fundamentals are mixed for gold (USD score ${signed(usdScore, 0)}, below the ` +
        `${NEUTRAL_THRESHOLD} threshold)`
      : `Fundamentals look ${goldBias.toLowerCase()} for gold ` +
        `(USD score ${signed(usdScore, 0)}, so the dollar is ` +
        `${usdScore > 0 ? 'bid' : 'offered'})`;

  const parts = [`${headline}.`];

  // Lead with the two biggest news contributors so the explanation cites real
  // figures rather than only the aggregate.
  const drivers = scored.slice(0, 2).map((item) => item.note);
  if (drivers.length > 0) parts.push(`Drivers: ${drivers.join('; ')}.`);

  const macroParts = components
    .filter((item) => item.key !== 'news')
    .map((item) => item.detail);
  if (macroParts.length > 0) parts.push(`${macroParts.join('; ')}.`);

  parts.push(`Confidence ${confidence}/100.`);
  if (missing.length > 0) parts.push(`Missing: ${missing.join('; ')}.`);

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function format(value: number, digits = 2): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}

function signed(value: number, digits: number): string {
  const rounded = round(value, digits);
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(digits)}`;
}

function basisPoints(reading: MacroReading): number {
  return reading.changeAbsolute * 100;
}

function reasonFor(macro: MacroSnapshot | null, instrument: 'USD_PROXY' | 'US10Y'): string {
  if (macro === null) return ' (no macro adapter configured)';

  const entry = macro.unavailable.find((item) => item.instrument === instrument);
  return entry === undefined ? '' : ` (${entry.reason})`;
}

function date(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}
