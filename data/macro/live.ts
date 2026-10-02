import type { MacroAdapter, MacroSnapshot } from '../types';
import { FredMacroAdapter } from './fred';
import { TwelveDataUsdProxyAdapter } from './twelveData';

const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface LiveMacroConfig {
  twelveDataApiKey?: string;
  fredApiKey?: string;
  twelveDataFetch?: typeof fetch;
  fredFetch?: typeof fetch;
  cacheTtlMs?: number;
  now?: () => number;
}

export class LiveMacroAdapter implements MacroAdapter {
  readonly name = 'UUP + FRED';
  private readonly twelveData: TwelveDataUsdProxyAdapter | null;
  private readonly fred: FredMacroAdapter | null;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private cachedSnapshot: MacroSnapshot | null = null;
  private cachedAt = 0;

  constructor(config: LiveMacroConfig) {
    this.twelveData = config.twelveDataApiKey?.trim()
      ? new TwelveDataUsdProxyAdapter({ apiKey: config.twelveDataApiKey, fetchImpl: config.twelveDataFetch })
      : null;
    this.fred = config.fredApiKey?.trim()
      ? new FredMacroAdapter({ apiKey: config.fredApiKey, fetchImpl: config.fredFetch })
      : null;
    this.cacheTtlMs = config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = config.now ?? Date.now;
  }

  async fetchSnapshot(): Promise<MacroSnapshot> {
    if (this.cachedSnapshot !== null && this.now() - this.cachedAt < this.cacheTtlMs) {
      return this.cachedSnapshot;
    }

    // Each reader reports its own failures and the caller orders them. They used
    // to share one array and push into it while both were in flight, so the order
    // of `unavailable` was decided by which upstream call happened to fail first —
    // a fast local "key not configured" check landed ahead of a slow network
    // timeout. Callers that read `unavailable[0]` were reading a race.
    const [usdProxy, us10y] = await Promise.all([this.readUsdProxy(), this.readUs10y()]);
    const snapshot: MacroSnapshot = {
      usdProxy: usdProxy.value,
      us10y: us10y.value,
      unavailable: [...usdProxy.unavailable, ...us10y.unavailable],
    };
    if (snapshot.usdProxy !== null || snapshot.us10y !== null) {
      this.cachedSnapshot = snapshot;
      this.cachedAt = this.now();
    }
    return snapshot;
  }

  private async readUsdProxy(): Promise<MacroRead<MacroSnapshot['usdProxy']>> {
    let uupFailure = 'Twelve Data API key is not configured';
    if (this.twelveData !== null) {
      try {
        return { value: await this.twelveData.fetchUup(), unavailable: [] };
      } catch (cause) {
        uupFailure = messageOf(cause);
      }
    }

    if (this.fred !== null) {
      try {
        return { value: await this.fred.fetchBroadDollarProxy(), unavailable: [] };
      } catch (cause) {
        return {
          value: null,
          unavailable: [{ instrument: 'USD_PROXY', reason: `UUP failed (${uupFailure}); FRED DTWEXBGS failed (${messageOf(cause)})` }],
        };
      }
    }

    return {
      value: null,
      unavailable: [{
        instrument: 'USD_PROXY',
        reason: this.twelveData === null
          ? `Twelve Data API key is not configured; FRED fallback unavailable because FRED_API_KEY is not configured`
          : `UUP failed (${uupFailure}); FRED fallback unavailable because FRED_API_KEY is not configured`,
      }],
    };
  }

  private async readUs10y(): Promise<MacroRead<MacroSnapshot['us10y']>> {
    if (this.fred === null) {
      return { value: null, unavailable: [{ instrument: 'US10Y', reason: 'FRED_API_KEY is not configured' }] };
    }
    try {
      return { value: await this.fred.fetchUs10y(), unavailable: [] };
    } catch (cause) {
      return { value: null, unavailable: [{ instrument: 'US10Y', reason: messageOf(cause) }] };
    }
  }
}

/** One instrument's reading plus the reasons it is missing, if it is. */
interface MacroRead<T> {
  value: T;
  unavailable: MacroSnapshot['unavailable'];
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}