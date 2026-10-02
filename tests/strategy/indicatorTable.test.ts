import {
  allIndicatorSpecs,
  findIndicatorSpec,
  normalizeTitle,
} from '../../strategy/indicatorTable';

/**
 * The indicator table.
 *
 * Polarity and scale cannot be inferred from the calendar feed, so this table is
 * hand-written — which makes it exactly the kind of data that deserves tests.
 * The property tests at the bottom are the valuable ones: they catch a future
 * entry that shadows an existing one or carries a scale that would divide by
 * zero, which no amount of eyeballing a 38-row table reliably catches.
 */

describe('normalizeTitle', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeTitle('  CPI   m/m ')).toBe('cpi m/m');
  });

  it('strips bracketed qualifiers the feed adds', () => {
    // The feed has published "CPI m/m" as "CPI m/m (Jun)" and similar.
    expect(normalizeTitle('CPI m/m (Jun)')).toBe('cpi m/m');
    expect(normalizeTitle('GDP q/q (Q2) (Final)')).toBe('gdp q/q');
  });

  it('keeps the characters that carry meaning', () => {
    // The slash in m/m, the hyphen in Non-Farm, the dot in a decimal.
    expect(normalizeTitle('Non-Farm Employment Change')).toBe('non-farm employment change');
    expect(normalizeTitle('Core PCE Price Index m/m')).toBe('core pce price index m/m');
  });

  it('drops decorative punctuation', () => {
    expect(normalizeTitle('CPI m/m*')).toBe('cpi m/m');
    expect(normalizeTitle('Retail Sales m/m,')).toBe('retail sales m/m');
  });
});

describe('findIndicatorSpec', () => {
  it('finds a known indicator with its polarity and scale', () => {
    const spec = findIndicatorSpec('CPI m/m');

    expect(spec?.title).toBe('CPI m/m');
    expect(spec?.polarity).toBe('positive');
    expect(spec?.notableSurprise).toBe(0.15);
  });

  it('does not confuse core with headline', () => {
    // Both are 0.15, so asserting the scale would not catch a mix-up.
    expect(findIndicatorSpec('Core CPI m/m')?.title).toBe('Core CPI m/m');
    expect(findIndicatorSpec('CPI m/m')?.title).toBe('CPI m/m');
    expect(findIndicatorSpec('Core Retail Sales m/m')?.title).toBe('Core Retail Sales m/m');
  });

  it('is case insensitive', () => {
    expect(findIndicatorSpec('non-farm employment change')?.title).toBe(
      'Non-Farm Employment Change',
    );
  });

  it('matches a decorated title by its known prefix', () => {
    expect(findIndicatorSpec('Unemployment Rate Final')?.title).toBe('Unemployment Rate');
    expect(findIndicatorSpec('CPI m/m NSA')?.title).toBe('CPI m/m');
  });

  it('inverts polarity for the indicators where lower is stronger', () => {
    // Getting either of these backwards would invert the trade.
    expect(findIndicatorSpec('Unemployment Rate')?.polarity).toBe('negative');
    expect(findIndicatorSpec('Unemployment Claims')?.polarity).toBe('negative');
  });

  it('returns null for an indicator it does not know', () => {
    // Deliberate: an unknown polarity is excluded from the score and reported,
    // never guessed. These three appear in the real feed every week.
    expect(findIndicatorSpec('Crude Oil Inventories')).toBeNull();
    expect(findIndicatorSpec('FOMC Statement')).toBeNull();
    expect(findIndicatorSpec('Bank Holiday')).toBeNull();
    expect(findIndicatorSpec('')).toBeNull();
  });

  it('does not match on a shared suffix', () => {
    // "Something m/m" must not resolve to a random m/m indicator.
    expect(findIndicatorSpec('Widget Shipments m/m')).toBeNull();
  });
});

describe('indicator table invariants', () => {
  it('resolves every entry to itself', () => {
    // Round-tripping catches a normalisation rule that erases a distinction the
    // table relies on — say, stripping "/" and collapsing m/m into y/y. Prefix
    // ordering is exercised by the decorated-title cases above instead, since
    // exact lookup short-circuits it here.
    for (const spec of allIndicatorSpecs()) {
      expect(findIndicatorSpec(spec.title)?.title).toBe(spec.title);
    }
  });

  it('has no entry whose title prefixes another', () => {
    // Not currently true by accident — it is what makes prefix matching
    // unambiguous. If a future entry breaks it, longest-first ordering decides
    // the winner, so this failing is a prompt to check that is what you want.
    const keys = allIndicatorSpecs().map((spec) => normalizeTitle(spec.title));

    for (const key of keys) {
      const shadowed = keys.filter((other) => other !== key && key.startsWith(other));
      expect(shadowed).toEqual([]);
    }
  });

  it('has no duplicate normalised titles', () => {
    const keys = allIndicatorSpecs().map((spec) => normalizeTitle(spec.title));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has a positive notableSurprise everywhere', () => {
    // A zero scale would make the normalised surprise NaN for an on-forecast
    // print, which would poison the whole news aggregate.
    for (const spec of allIndicatorSpecs()) {
      expect(spec.notableSurprise).toBeGreaterThan(0);
      expect(Number.isFinite(spec.notableSurprise)).toBe(true);
    }
  });

  it('explains every scale it chose', () => {
    // The no-black-box rule applied to data: each number is auditable.
    for (const spec of allIndicatorSpecs()) {
      expect(spec.note.length).toBeGreaterThan(10);
    }
  });

  it('covers the releases that actually move gold', () => {
    const essential = [
      'Non-Farm Employment Change',
      'Unemployment Rate',
      'Average Hourly Earnings m/m',
      'CPI m/m',
      'Core CPI m/m',
      'Core PCE Price Index m/m',
      'Federal Funds Rate',
      'ISM Manufacturing PMI',
      'ISM Services PMI',
      'Retail Sales m/m',
      'Unemployment Claims',
    ];

    for (const title of essential) {
      expect(findIndicatorSpec(title)).not.toBeNull();
    }
  });
});
