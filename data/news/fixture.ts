import type { NewsAdapter, NewsCalendarRead, NewsEvent, NewsImpact } from '../types';

/**
 * Deterministic calendar for tests and offline development.
 *
 * The events are laid out relative to the Monday of the anchor week rather than
 * hardcoded to fixed dates. That gives both properties we need: tests pass an
 * explicit anchor and get byte-identical output, while `npm run dev` with no
 * network shows a calendar that looks like this week's.
 *
 * Releases after the anchor have their `actual` stripped, because a forward
 * calendar does not carry results. Without that the fixture would let a bug
 * through where the score reads actuals for events that have not happened —
 * which is exactly the kind of look-ahead that makes a backtest lie.
 */

interface TemplateEvent {
  /** Day of the week, Monday = 0. */
  day: number;
  /** Minutes past midnight UTC. Null for an all-day/tentative entry. */
  minutes: number | null;
  title: string;
  country: string;
  impact: NewsImpact;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
}

/**
 * A plausible US data week: ISM Monday, CPI Wednesday, claims Thursday, payrolls
 * Friday. The figures describe a hot-data week (CPI above forecast, payrolls
 * well above, unemployment down) so the fixture exercises a clear
 * strong-USD / bearish-gold read rather than a wash.
 */
const WEEK_TEMPLATE: readonly TemplateEvent[] = [
  {
    day: 0,
    minutes: null,
    title: 'Bank Holiday',
    country: 'JPY',
    impact: 'NONE',
    actual: null,
    forecast: null,
    previous: null,
  },
  {
    day: 0,
    minutes: 14 * 60,
    title: 'ISM Manufacturing PMI',
    country: 'USD',
    impact: 'HIGH',
    actual: '49.2',
    forecast: '48.5',
    previous: '48.7',
  },
  {
    day: 1,
    minutes: 8 * 60 + 30,
    title: 'CPI y/y',
    country: 'GBP',
    impact: 'HIGH',
    actual: '2.8%',
    forecast: '2.6%',
    previous: '2.5%',
  },
  {
    day: 1,
    minutes: 13 * 60 + 30,
    title: 'Core Retail Sales m/m',
    country: 'USD',
    impact: 'MEDIUM',
    actual: '0.5%',
    forecast: '0.3%',
    previous: '0.2%',
  },
  {
    day: 2,
    minutes: 12 * 60 + 30,
    title: 'CPI m/m',
    country: 'USD',
    impact: 'HIGH',
    actual: '0.4%',
    forecast: '0.2%',
    previous: '0.3%',
  },
  {
    day: 2,
    minutes: 12 * 60 + 30,
    title: 'Core CPI m/m',
    country: 'USD',
    impact: 'HIGH',
    actual: '0.3%',
    forecast: '0.3%',
    previous: '0.2%',
  },
  {
    day: 2,
    minutes: 18 * 60,
    title: 'FOMC Statement',
    country: 'USD',
    impact: 'HIGH',
    actual: null,
    forecast: null,
    previous: null,
  },
  {
    day: 3,
    minutes: 11 * 60 + 45,
    title: 'Main Refinancing Rate',
    country: 'EUR',
    impact: 'HIGH',
    actual: '2.15%',
    forecast: '2.15%',
    previous: '2.40%',
  },
  {
    day: 3,
    minutes: 12 * 60 + 30,
    title: 'Unemployment Claims',
    country: 'USD',
    impact: 'HIGH',
    actual: '215K',
    forecast: '230K',
    previous: '228K',
  },
  {
    day: 3,
    minutes: 14 * 60,
    title: 'Crude Oil Inventories',
    country: 'USD',
    impact: 'LOW',
    actual: '-1.2M',
    forecast: '0.4M',
    previous: '2.1M',
  },
  {
    day: 4,
    minutes: 12 * 60 + 30,
    title: 'Non-Farm Employment Change',
    country: 'USD',
    impact: 'HIGH',
    actual: '275K',
    forecast: '190K',
    previous: '165K',
  },
  {
    day: 4,
    minutes: 12 * 60 + 30,
    title: 'Unemployment Rate',
    country: 'USD',
    impact: 'HIGH',
    actual: '4.1%',
    forecast: '4.2%',
    previous: '4.2%',
  },
  {
    day: 4,
    minutes: 12 * 60 + 30,
    title: 'Average Hourly Earnings m/m',
    country: 'USD',
    impact: 'MEDIUM',
    actual: '0.3%',
    forecast: '0.3%',
    previous: '0.4%',
  },
];

/** Midnight UTC on the Monday of the week containing `timestampSeconds`. */
export function mondayOf(timestampSeconds: number): number {
  const date = new Date(timestampSeconds * 1000);
  const midnight = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  const dayNumber = (date.getUTCDay() + 6) % 7; // Monday = 0
  return Math.floor(midnight / 1000) - dayNumber * 24 * 3600;
}

export interface NewsFixtureOptions {
  /** Unix seconds UTC. Events are positioned within this timestamp's week. */
  anchor?: number;
  /**
   * Remove `actual` from events scheduled after the anchor. Default true.
   * Turn it off only to test look-ahead handling deliberately.
   */
  stripFutureActuals?: boolean;
}

export function buildFixtureWeek(options: NewsFixtureOptions = {}): NewsEvent[] {
  const anchor = options.anchor ?? Math.floor(Date.now() / 1000);
  const stripFutureActuals = options.stripFutureActuals ?? true;
  const monday = mondayOf(anchor);

  const events = WEEK_TEMPLATE.map((template): NewsEvent => {
    const time =
      template.minutes === null
        ? null
        : monday + template.day * 24 * 3600 + template.minutes * 60;

    const isFuture = time !== null && time > anchor;

    return {
      title: template.title,
      country: template.country,
      impact: template.impact,
      time,
      actual: stripFutureActuals && isFuture ? null : template.actual,
      forecast: template.forecast,
      previous: template.previous,
    };
  });

  events.sort((a, b) => {
    if (a.time === null) return b.time === null ? 0 : 1;
    if (b.time === null) return -1;
    return a.time - b.time;
  });

  return events;
}

export class FixtureNewsAdapter implements NewsAdapter {
  readonly name = 'fixture';

  constructor(private readonly options: NewsFixtureOptions = {}) {}

  async fetchThisWeek(): Promise<NewsEvent[]> {
    return buildFixtureWeek(this.options);
  }

  /**
   * Always available. A fixture week is a calendar we definitely have, even when
   * the requested options produce no qualifying releases — so this must not fall
   * back on the "empty means unavailable" heuristic and block a quiet week.
   */
  async fetchCalendar(): Promise<NewsCalendarRead> {
    return { events: await this.fetchThisWeek(), available: true, reason: null };
  }
}

/** Adapter that always returns an empty calendar, to test degraded behaviour. */
export class EmptyNewsAdapter implements NewsAdapter {
  readonly name = 'empty';

  async fetchThisWeek(): Promise<NewsEvent[]> {
    return [];
  }

  /**
   * Reports *unavailable*, not "an empty week". This adapter exists to stand in
   * for having no calendar, and the honest consequence of having no calendar is
   * that the news blackout cannot be checked.
   */
  async fetchCalendar(): Promise<NewsCalendarRead> {
    return {
      events: [],
      available: false,
      reason: 'the news adapter is configured as "empty", so no calendar is read',
    };
  }
}
