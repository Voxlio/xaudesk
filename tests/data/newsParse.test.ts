import {
  isoWeekKey,
  parseEconomicValue,
  parseEvent,
  parseFeed,
  parseImpact,
} from '../../data/news/parse';

/**
 * Feed parsing. The values asserted here are the ones I verified by hand
 * against the real feed's conventions: dates carry a US Eastern offset, figures
 * arrive as display strings, and "Holiday" is a legitimate impact rather than
 * an error.
 */

describe('parseImpact', () => {
  it('maps the four labels the feed actually uses', () => {
    expect(parseImpact('High')).toEqual({ impact: 'HIGH', recognised: true });
    expect(parseImpact('Medium')).toEqual({ impact: 'MEDIUM', recognised: true });
    expect(parseImpact('Low')).toEqual({ impact: 'LOW', recognised: true });
    expect(parseImpact('Holiday')).toEqual({ impact: 'NONE', recognised: true });
  });

  it('is case and whitespace insensitive', () => {
    expect(parseImpact('  hIgH ').impact).toBe('HIGH');
  });

  it('treats a holiday as recognised, not as a parse failure', () => {
    // Worth pinning: a holiday legitimately carries no data, so mapping it to
    // NONE must not pollute the "unrecognised impact" warning.
    expect(parseImpact('Non-Economic').recognised).toBe(true);
  });

  it('reports an unknown label rather than guessing', () => {
    expect(parseImpact('Catastrophic')).toEqual({ impact: 'NONE', recognised: false });
    expect(parseImpact(undefined)).toEqual({ impact: 'NONE', recognised: false });
    expect(parseImpact(7)).toEqual({ impact: 'NONE', recognised: false });
  });
});

describe('parseEvent', () => {
  it('converts the feed offset to UTC rather than trusting local time', () => {
    const event = parseEvent({
      title: 'CPI m/m',
      country: 'USD',
      date: '2026-10-07T08:30:00-04:00',
      impact: 'High',
      forecast: '0.2%',
      previous: '0.3%',
      actual: '0.4%',
    });

    if (typeof event === 'string') throw new Error(event);

    // 08:30 Eastern is 12:30 UTC. Hardcoding the expected UTC value, rather
    // than deriving it with Date, is the point of the test.
    expect(event.time).toBe(Date.UTC(2026, 9, 7, 12, 30, 0) / 1000);
    expect(event.impact).toBe('HIGH');
    expect(event.actual).toBe('0.4%');
  });

  it('upper-cases the currency code', () => {
    const event = parseEvent({ title: 'x', country: 'usd', date: '2026-10-07T00:00:00Z' });
    if (typeof event === 'string') throw new Error(event);
    expect(event.country).toBe('USD');
  });

  it('treats empty strings and dashes as absent, but keeps a real zero', () => {
    const event = parseEvent({
      title: 'Retail Sales m/m',
      country: 'USD',
      date: '2026-10-07T12:30:00Z',
      impact: 'Medium',
      actual: '0%',
      forecast: '',
      previous: '-',
    });

    if (typeof event === 'string') throw new Error(event);
    expect(event.actual).toBe('0%');
    expect(event.forecast).toBeNull();
    expect(event.previous).toBeNull();
  });

  it('leaves actual null when the feed omits it entirely', () => {
    // The forward calendar has no `actual` key at all, which must not throw.
    const event = parseEvent({
      title: 'Non-Farm Employment Change',
      country: 'USD',
      date: '2026-10-09T12:30:00Z',
      impact: 'High',
      forecast: '190K',
    });

    if (typeof event === 'string') throw new Error(event);
    expect(event.actual).toBeNull();
  });

  it('falls back to no scheduled time instead of failing on a bad date', () => {
    const event = parseEvent({
      title: 'Bank Holiday',
      country: 'JPY',
      date: 'not a date',
      impact: 'Holiday',
    });

    if (typeof event === 'string') throw new Error(event);
    expect(event.time).toBeNull();
  });

  it('rejects an entry with no title or no country', () => {
    expect(typeof parseEvent({ country: 'USD' })).toBe('string');
    expect(typeof parseEvent({ title: 'CPI m/m' })).toBe('string');
  });
});

describe('parseFeed', () => {
  it('sorts by time and pushes undated entries to the end', () => {
    const result = parseFeed([
      { title: 'Later', country: 'USD', date: '2026-10-08T12:30:00Z', impact: 'High' },
      { title: 'Undated', country: 'JPY', impact: 'Holiday' },
      { title: 'Earlier', country: 'USD', date: '2026-10-07T12:30:00Z', impact: 'High' },
    ]);

    expect(result.events.map((event) => event.title)).toEqual([
      'Earlier',
      'Later',
      'Undated',
    ]);
  });

  it('skips a malformed entry and keeps the rest of the week', () => {
    // The whole reason parseEvent returns a string instead of throwing.
    const result = parseFeed([
      { title: 'Good', country: 'USD', date: '2026-10-07T12:30:00Z', impact: 'High' },
      { country: 'USD', date: '2026-10-07T13:30:00Z' },
      'not an object',
    ]);

    expect(result.events).toHaveLength(1);
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]?.reason).toBe('missing title');
    expect(result.issues[1]?.reason).toBe('entry is not an object');
  });

  it('collects unrecognised impact labels for logging', () => {
    const result = parseFeed([
      { title: 'A', country: 'USD', date: '2026-10-07T12:30:00Z', impact: 'Severe' },
      { title: 'B', country: 'USD', date: '2026-10-07T13:30:00Z', impact: 'Severe' },
    ]);

    expect(result.unknownImpacts).toEqual(['Severe']);
    expect(result.events).toHaveLength(2);
    expect(result.events[0]?.impact).toBe('NONE');
  });

  it('reports a non-array payload instead of throwing', () => {
    const result = parseFeed({ error: 'rate limited' });
    expect(result.events).toEqual([]);
    expect(result.issues[0]?.reason).toBe('feed payload is not an array');
  });

  it('handles an empty feed', () => {
    expect(parseFeed([])).toEqual({ events: [], issues: [], unknownImpacts: [] });
  });
});

describe('parseEconomicValue', () => {
  it('reads percentages as plain numbers', () => {
    expect(parseEconomicValue('0.4%')).toBe(0.4);
    expect(parseEconomicValue('-0.1%')).toBe(-0.1);
    expect(parseEconomicValue('2.8%')).toBe(2.8);
  });

  it('expands K, M, B and T suffixes', () => {
    expect(parseEconomicValue('250K')).toBe(250_000);
    expect(parseEconomicValue('1.45M')).toBe(1_450_000);
    expect(parseEconomicValue('-78.2B')).toBe(-78_200_000_000);
    expect(parseEconomicValue('1.2T')).toBe(1_200_000_000_000);
  });

  it('is case insensitive about suffixes and strips thousands separators', () => {
    expect(parseEconomicValue('250k')).toBe(250_000);
    expect(parseEconomicValue('1,250K')).toBe(1_250_000);
  });

  it('drops comparators but keeps the magnitude', () => {
    // The feed publishes "<0.1%" when a figure rounds to a bound.
    expect(parseEconomicValue('<0.1%')).toBe(0.1);
    expect(parseEconomicValue('>2.0%')).toBe(2);
  });

  it('reads a target range as its midpoint', () => {
    // The Fed publishes a 25bp band; the midpoint is how it is normally quoted.
    expect(parseEconomicValue('4.25%-4.50%')).toBe(4.375);
    expect(parseEconomicValue('3.75-4.00')).toBe(3.875);
  });

  it('keeps a negative number intact rather than reading it as a range', () => {
    // The regression this guards: splitting "-0.3" on its own minus sign.
    expect(parseEconomicValue('-0.3')).toBe(-0.3);
    expect(parseEconomicValue('-1.2M')).toBe(-1_200_000);
  });

  it('distinguishes a published zero from a missing figure', () => {
    expect(parseEconomicValue('0%')).toBe(0);
    expect(parseEconomicValue('0.0%')).toBe(0);
    expect(parseEconomicValue(null)).toBeNull();
    expect(parseEconomicValue('')).toBeNull();
  });

  it('returns null for text it cannot read', () => {
    expect(parseEconomicValue('n/a')).toBeNull();
    expect(parseEconomicValue('--')).toBeNull();
    expect(parseEconomicValue('12/34/56')).toBeNull();
  });
});

describe('isoWeekKey', () => {
  it('formats a mid-year week', () => {
    expect(isoWeekKey(Date.UTC(2026, 9, 7) / 1000)).toBe('2026-W41');
  });

  it('gives the same key for every day of one ISO week', () => {
    // Monday 2026-10-05 through Sunday 2026-10-11.
    const keys = [5, 6, 7, 8, 9, 10, 11].map((day) =>
      isoWeekKey(Date.UTC(2026, 9, day, 12) / 1000),
    );
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('2026-W41');
  });

  it('assigns a year-end week to the ISO year that owns it', () => {
    // 2026-12-31 is a Thursday, so it belongs to 2026-W53 — not 2027-W01.
    expect(isoWeekKey(Date.UTC(2026, 11, 31, 12) / 1000)).toBe('2026-W53');
    // 2027-01-01 is a Friday of the same ISO week.
    expect(isoWeekKey(Date.UTC(2027, 0, 1, 12) / 1000)).toBe('2026-W53');
  });

  it('pads single-digit weeks', () => {
    expect(isoWeekKey(Date.UTC(2026, 0, 8, 12) / 1000)).toBe('2026-W02');
  });
});
