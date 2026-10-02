import { PriceAdapterError, type PriceAdapter } from '../types';
import { TwelveDataAdapter } from './twelveData';

export { FixturePriceAdapter, createFixtureAdapterFromDisk, parseCandleCsv } from './fixture';
export { TwelveDataAdapter } from './twelveData';
export type { TwelveDataConfig } from './twelveData';

/**
 * Adapter selection. The rest of the app asks for "a price adapter" and never
 * names a provider, so swapping Twelve Data for something else is a one-line
 * change here plus a new file in this folder.
 */

export type PriceAdapterName = 'twelvedata';

export function isPriceAdapterName(value: unknown): value is PriceAdapterName {
  return value === 'twelvedata';
}

export interface ResolveAdapterOptions {
  /** Overrides PRICE_ADAPTER. */
  adapter?: PriceAdapterName;
  /** Overrides process.env, mainly for tests. */
  env?: Record<string, string | undefined>;
}

/**
 * Resolve the configured price adapter.
 *
 * Defaults to Twelve Data. Missing credentials and unknown adapter settings
 * are hard errors; the app must never silently substitute fixture prices.
 */
export async function getPriceAdapter(
  options: ResolveAdapterOptions = {},
): Promise<PriceAdapter> {
  const env = options.env ?? process.env;
  const requested = options.adapter ?? env.PRICE_ADAPTER ?? 'twelvedata';

  if (!isPriceAdapterName(requested)) {
    throw new PriceAdapterError(
      'config',
      `unknown PRICE_ADAPTER "${requested}" (expected "twelvedata"; fixtures are test-only)`,
    );
  }

  const apiKey = env.TWELVE_DATA_API_KEY;
  if (apiKey === undefined || apiKey.trim() === '') {
    throw new PriceAdapterError(
      'config',
      'TWELVE_DATA_API_KEY is not set; live XAU/USD candles are required',
    );
  }

  return new TwelveDataAdapter({
    apiKey,
    symbol: env.TWELVE_DATA_SYMBOL ?? 'XAU/USD',
  });
}

export type AnyPriceAdapter = TwelveDataAdapter;
