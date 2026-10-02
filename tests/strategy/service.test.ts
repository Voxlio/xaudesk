import { shouldRetryPriceUnavailable } from '../../strategy/service';

describe('shouldRetryPriceUnavailable', () => {
  it('waits five minutes after a price-source failure', () => {
    const snapshot = { asOf: 1_000, priceUnavailableReason: 'network request failed' };

    expect(shouldRetryPriceUnavailable(snapshot, 1_299)).toBe(false);
    expect(shouldRetryPriceUnavailable(snapshot, 1_300)).toBe(true);
  });

  it('does not retry a valid cached price snapshot', () => {
    const snapshot = { asOf: 1_000, priceUnavailableReason: null };

    expect(shouldRetryPriceUnavailable(snapshot, 10_000)).toBe(false);
  });
});