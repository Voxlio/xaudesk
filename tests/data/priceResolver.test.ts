import { getPriceAdapter } from '../../data/price';
import { PriceAdapterError } from '../../data/types';

describe('getPriceAdapter', () => {
  it('defaults to Twelve Data when a key is configured', async () => {
    const adapter = await getPriceAdapter({ env: { TWELVE_DATA_API_KEY: 'test-key' } });

    expect(adapter.name).toBe('twelvedata');
    expect(adapter.symbol).toBe('XAU/USD');
  });

  it('does not fall back to synthetic prices when no key is configured', async () => {
    await expect(getPriceAdapter({ env: {} })).rejects.toMatchObject({
      adapter: 'config',
    });
  });

  it('rejects fixture selection from runtime configuration', async () => {
    const result = getPriceAdapter({
      adapter: 'fixture' as 'twelvedata',
      env: { TWELVE_DATA_API_KEY: 'test-key' },
    });
    await expect(result).rejects.toBeInstanceOf(PriceAdapterError);
    await expect(result).rejects.toThrow(/fixtures are test-only/);
  });

  it('rejects an unknown source instead of choosing a fallback', async () => {
    const result = getPriceAdapter({
      adapter: 'other' as 'twelvedata',
      env: { TWELVE_DATA_API_KEY: 'test-key' },
    });
    await expect(result).rejects.toThrow(/unknown PRICE_ADAPTER/);
  });
});