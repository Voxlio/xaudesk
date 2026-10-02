import type { MacroAdapter, MacroInstrument } from '../types';
import {
  FixtureMacroAdapter,
  PartialMacroAdapter,
  UnavailableMacroAdapter,
} from './fixture';
import { LiveMacroAdapter } from './live';

export { FredMacroAdapter, parseObservation } from './fred';
export type { FredAdapterConfig } from './fred';
export { LiveMacroAdapter } from './live';
export type { LiveMacroConfig } from './live';
export { TwelveDataUsdProxyAdapter } from './twelveData';
export type { TwelveDataUsdProxyConfig } from './twelveData';
export {
  FixtureMacroAdapter,
  UnavailableMacroAdapter,
  PartialMacroAdapter,
} from './fixture';
export type { MacroFixtureValues } from './fixture';

/**
 * Macro adapter selection.
 *
 * Defaults to "unavailable" rather than "fixture", which is the opposite of the
 * price adapter's default and deliberate: the USD proxy and US10Y feed a *directional*
 * trading opinion, and a synthetic dollar-positive reading would push the score
 * toward a real bias on invented evidence. An honest "no opinion" is the safe
 * default. `live` uses the Twelve Data UUP ETF and FRED daily observations;
 * `fixture` is only for explicit offline development.
 */

export type MacroAdapterName = 'live' | 'twelvedata' | 'fixture' | 'unavailable';

export function isMacroAdapterName(value: unknown): value is MacroAdapterName {
  return value === 'live' || value === 'twelvedata' || value === 'fixture' || value === 'unavailable';
}

let cachedLiveAdapter: {
  twelveDataApiKey: string | undefined;
  fredApiKey: string | undefined;
  adapter: LiveMacroAdapter;
} | null = null;

export interface ResolveMacroAdapterOptions {
  adapter?: MacroAdapterName;
  env?: Record<string, string | undefined>;
}

export function getMacroAdapter(options: ResolveMacroAdapterOptions = {}): MacroAdapter {
  const env = options.env ?? process.env;
  const requested = options.adapter ?? env.MACRO_ADAPTER ?? 'unavailable';

  if (!isMacroAdapterName(requested)) {
    throw new Error(
      `unknown MACRO_ADAPTER "${requested}" (expected "twelvedata", "fixture" or "unavailable")`,
    );
  }

  if (requested === 'fixture') return new FixtureMacroAdapter();
  if (requested === 'unavailable') {
    return new UnavailableMacroAdapter('MACRO_ADAPTER is not configured');
  }

  const twelveDataApiKey = env.TWELVE_DATA_API_KEY?.trim() || undefined;
  const fredApiKey = env.FRED_API_KEY?.trim() || undefined;
  if (cachedLiveAdapter === null ||
    cachedLiveAdapter.twelveDataApiKey !== twelveDataApiKey ||
    cachedLiveAdapter.fredApiKey !== fredApiKey) {
    cachedLiveAdapter = {
      twelveDataApiKey,
      fredApiKey,
      adapter: new LiveMacroAdapter({ twelveDataApiKey, fredApiKey }),
    };
  }
  return cachedLiveAdapter.adapter;
}

/** Re-exported for tests that need a specific availability mix. */
export function partialMacroAdapter(
  available: readonly MacroInstrument[],
): MacroAdapter {
  return new PartialMacroAdapter(available);
}
