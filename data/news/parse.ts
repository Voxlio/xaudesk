import { parseUtcTimestamp } from '../normalize';
import type { NewsEvent, NewsImpact } from '../types';

/**
 * ForexFactory feed parsing.
 *
 * The public JSON feed is an array of loosely-typed records. Everything here is
 * defensive: a single malformed entry must not cost us the rest of the week's
 * calendar, because the fundamental bias degrades gracefully but a thrown error
 * would take down the whole idea.
 */

/** One raw entry as it arrives from the feed. All fields are untrusted. */
export interface RawForexFactoryEvent {
  title?: unknown;
  country?: unknown;
  date?: unknown;
  impact?: unknown;
  forecast?: unknown;
  previous?: unknown;
  /** Present once a release has happened. Absent on the forward calendar. */
  actual?: unknown;
}

export interface ParseIssue {
  index: number;
  reason: string;
  /** The title if we could read one, to make the log message useful. */
  title: string | null;
}

export interface ParseFeedResult {
  events: NewsEvent[];
  issues: ParseIssue[];
  /** Impact strings we did not recognise, mapped to NONE. Worth logging. */
  unknownImpacts: string[];
}

/**
 * Impact labels the feed uses. "Holiday" and "Non-Economic" are real values
 * that carry no data, so they map to NONE rather than being treated as errors.
 */
const IMPACT_BY_LABEL: Record<string, NewsImpact> = {
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
  holiday: 'NONE',
  'non-economic': 'NONE',
};

export function parseImpact(value: unknown): { impact: NewsImpact; recognised: boolean } {
  if (typeof value !== 'string') return { impact: 'NONE', recognised: false };

  const mapped = IMPACT_BY_LABEL[value.trim().toLowerCase()];
  if (mapped === undefined) return { impact: 'NONE', recognised: false };

  return { impact: mapped, recognised: true };
}

/**
 * An empty string, "-", or whitespace all mean "no value published". They are
 * distinct from "0", which is a real number, so this cannot just be falsiness.
 */
function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '-') return null;

  return trimmed;
}

/**
 * Parse one entry. Returns a reason string instead of throwing, so the caller
 * can skip the entry and carry on.
 */
export function parseEvent(raw: RawForexFactoryEvent): NewsEvent | string {
  const title = optionalString(raw.title);
  if (title === null) return 'missing title';

  const country = optionalString(raw.country);
  if (country === null) return 'missing country';

  // The feed stamps dates with an explicit offset (it publishes in US Eastern),
  // which parseUtcTimestamp honours. An unparseable or absent date is treated
  // as "no scheduled time" rather than an error: tentative and all-day entries
  // legitimately have none, and they are excluded from the blackout anyway.
  let time: number | null = null;
  const rawDate = optionalString(raw.date);
  if (rawDate !== null) {
    try {
      time = parseUtcTimestamp(rawDate);
    } catch {
      time = null;
    }
  }

  const { impact } = parseImpact(raw.impact);

  return {
    title,
    country: country.toUpperCase(),
    impact,
    time,
    actual: optionalString(raw.actual),
    forecast: optionalString(raw.forecast),
    previous: optionalString(raw.previous),
  };
}

/** Parse a whole feed payload, skipping and reporting bad entries. */
export function parseFeed(payload: unknown): ParseFeedResult {
  if (!Array.isArray(payload)) {
    return {
      events: [],
      issues: [{ index: -1, reason: 'feed payload is not an array', title: null }],
      unknownImpacts: [],
    };
  }

  const events: NewsEvent[] = [];
  const issues: ParseIssue[] = [];
  const unknownImpacts = new Set<string>();

  payload.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      issues.push({ index, reason: 'entry is not an object', title: null });
      return;
    }

    const raw = entry as RawForexFactoryEvent;
    const { recognised } = parseImpact(raw.impact);
    if (!recognised && raw.impact !== undefined && typeof raw.impact === 'string') {
      unknownImpacts.add(raw.impact);
    }

    const parsed = parseEvent(raw);
    if (typeof parsed === 'string') {
      issues.push({ index, reason: parsed, title: optionalString(raw.title) });
      return;
    }

    events.push(parsed);
  });

  // Sorted by time so downstream scans (blackout, recency weighting) can stop
  // early. Undated entries go last; they are never time-relevant.
  events.sort((a, b) => {
    if (a.time === null) return b.time === null ? 0 : 1;
    if (b.time === null) return -1;
    return a.time - b.time;
  });

  return { events, issues, unknownImpacts: [...unknownImpacts] };
}

// ---------------------------------------------------------------------------
// Economic value parsing
// ---------------------------------------------------------------------------

const MULTIPLIER_BY_SUFFIX: Record<string, number> = {
  k: 1e3,
  m: 1e6,
  b: 1e9,
  t: 1e12,
};

/**
 * Turn a published figure into a number.
 *
 * The feed gives display strings, not numbers: "3.2%", "250K", "-78.2B",
 * "<0.1%", "4.25%-4.50%". Returns null when there is no usable figure, which
 * the score treats as "no evidence" rather than zero.
 *
 * Note the unit is NOT normalised across indicators — "250K" becomes 250000 and
 * "3.2%" becomes 3.2. Comparing across indicators is the surprise table's job
 * (see strategy/fundamental.ts); here we only need actual and forecast of the
 * *same* indicator to be in the same unit, which the feed guarantees.
 */
export function parseEconomicValue(value: string | null): number | null {
  if (value === null) return null;

  // Comparators ("<0.1%", ">2.0%") are published when a figure rounds to a
  // bound. The magnitude is the useful part; the comparator is dropped.
  const cleaned = value.replace(/[<>≈~]/g, '').replace(/,/g, '').trim();
  if (cleaned === '') return null;

  // A target range such as the Fed's "4.25%-4.50%" is reported as a midpoint,
  // which is how a rate decision is normally quoted. Care is needed not to
  // split a negative number on its own sign, hence the lookbehind-free regex
  // requiring a digit or % before the dash.
  const range = cleaned.match(/^(-?\d*\.?\d+)\s*%?\s*-\s*(-?\d*\.?\d+)\s*%?$/);
  if (range !== null) {
    const low = Number(range[1]);
    const high = Number(range[2]);
    if (Number.isFinite(low) && Number.isFinite(high)) return (low + high) / 2;
  }

  const match = cleaned.match(/^(-?\d*\.?\d+)\s*([KkMmBbTt])?\s*%?$/);
  if (match === null) return null;

  const magnitude = Number(match[1]);
  if (!Number.isFinite(magnitude)) return null;

  const suffix = match[2];
  if (suffix === undefined) return magnitude;

  const multiplier = MULTIPLIER_BY_SUFFIX[suffix.toLowerCase()];
  return multiplier === undefined ? magnitude : magnitude * multiplier;
}

/** ISO week key, e.g. "2026-W40". Used as the news cache key. */
export function isoWeekKey(timestampSeconds: number): string {
  const date = new Date(timestampSeconds * 1000);

  // ISO 8601: week 1 is the week containing the first Thursday. Shifting to the
  // Thursday of the current week makes the year unambiguous around New Year.
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayNumber = (target.getUTCDay() + 6) % 7; // Monday = 0
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);

  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);

  const week =
    1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));

  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
