'use client';

import { useEffect, useState } from 'react';

interface SettingsData {
  equityUsd: number | null;
  riskPercent: number;
  centLotStep: number;
  centLotMin: number;
  symbol: string;
  priceSource: string;
  macroSource: string;
  newsSource: string;
  hasPriceApiKey: boolean;
  hasFredApiKey: boolean;
}

const DEFAULTS: SettingsData = {
  equityUsd: null,
  riskPercent: 1,
  centLotStep: 0.01,
  centLotMin: 0.01,
  symbol: 'XAUUSD',
  priceSource: 'fixture',
  macroSource: 'unavailable',
  newsSource: 'forexfactory',
  hasPriceApiKey: false,
  hasFredApiKey: false,
};

export default function SettingsPanel() {
  const [settings, setSettings] = useState(DEFAULTS);
  // Held in component state for the lifetime of the page and nowhere else. Not
  // persisted to storage and not sent on the GET, which needs no authorization —
  // a secret that only exists while the form is open is a secret with a much
  // smaller blast radius than one cached in the browser.
  const [adminSecret, setAdminSecret] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/settings', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Could not load settings.');
        setSettings({ ...DEFAULTS, ...body });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${adminSecret}`,
        },
        body: JSON.stringify({
          equityUsd: settings.equityUsd,
          riskPercent: settings.riskPercent,
          centLotStep: settings.centLotStep,
          centLotMin: settings.centLotMin,
          symbol: settings.symbol,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not save settings.');
      setSettings((current) => ({ ...current, ...body }));
      setMessage('Risk settings saved. They apply to the next generated daily idea.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  function updateNumber(key: 'equityUsd' | 'riskPercent' | 'centLotStep' | 'centLotMin', value: string) {
    setSettings((current) => ({ ...current, [key]: value === '' ? null : Number(value) }));
  }

  return (
    <div className="space-y-8">
      <section className="border-b border-[#1A1A1A] pb-5">
        <p className="eyebrow text-[#C4A060]">Workspace</p>
        <h1 className="mt-2 text-3xl font-extrabold">Settings</h1>
        <p className="mt-1 text-sm text-[#1A1A1A]/65">Account sizing and connected data sources.</p>
      </section>

      {error && <p role="alert" className="border-l-4 border-rose-600 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</p>}
      {message && <p role="status" className="border-l-4 border-emerald-700 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{message}</p>}

      <form onSubmit={save} className="space-y-7">
        <section className="outline-card space-y-5 p-5 sm:p-6" aria-labelledby="account-settings">
          <div className="border-b border-[#1A1A1A]/30 pb-3">
            <h2 id="account-settings" className="text-lg font-bold">HFM Cent account</h2>
            <p className="mt-1 text-sm text-[#1A1A1A]/65">Enter equity in USD, not the cent amount shown in the terminal.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
            <label className="block text-sm font-medium text-neutral-700">
              Account equity (USD)
              <span className="mt-1 block text-xs font-normal text-[#1A1A1A]/60">For example, enter 100 for a $100 deposit (displayed as 10,000 cents).</span>
              <input type="number" min="0" step="0.01" value={settings.equityUsd ?? ''} onChange={(event) => updateNumber('equityUsd', event.target.value)} className="mt-2 h-11 w-full rounded-lg border-[1.5px] border-[#1A1A1A] bg-transparent px-3 font-mono text-[#1A1A1A] placeholder:text-[#1A1A1A]/45" placeholder="Not configured" disabled={loading} />
            </label>
            <label className="block text-sm font-medium text-neutral-700">
              Risk per trade (%)
              <span className="mt-1 block text-xs font-normal text-[#1A1A1A]/60">Allowed range: 1–2% of USD equity.</span>
              <input type="number" min="1" max="2" step="0.1" value={settings.riskPercent} onChange={(event) => updateNumber('riskPercent', event.target.value)} className="mt-2 h-11 w-full rounded-lg border-[1.5px] border-[#1A1A1A] bg-transparent px-3 font-mono text-[#1A1A1A]" disabled={loading} />
            </label>
            <label className="block text-sm font-medium text-neutral-700">
              Cent lot step
              <span className="mt-1 block text-xs font-normal text-[#1A1A1A]/60">Verified broker increment, rounded down.</span>
              <input type="number" min="0.001" step="0.001" value={settings.centLotStep} onChange={(event) => updateNumber('centLotStep', event.target.value)} className="mt-2 h-11 w-full rounded-lg border-[1.5px] border-[#1A1A1A] bg-transparent px-3 font-mono text-[#1A1A1A]" disabled={loading} />
            </label>
            <label className="block text-sm font-medium text-neutral-700">
              Minimum Cent lot
              <span className="mt-1 block text-xs font-normal text-[#1A1A1A]/60">If the risk budget cannot support this minimum, no trade is sized.</span>
              <input type="number" min="0.001" step="0.001" value={settings.centLotMin} onChange={(event) => updateNumber('centLotMin', event.target.value)} className="mt-2 h-11 w-full rounded-lg border-[1.5px] border-[#1A1A1A] bg-transparent px-3 font-mono text-[#1A1A1A]" disabled={loading} />
            </label>
          </div>
        </section>

        <section className="outline-card space-y-4 p-5 sm:p-6" aria-labelledby="authorization-heading">
          <div className="border-b border-[#1A1A1A]/30 pb-3">
            <h2 id="authorization-heading" className="text-lg font-bold">Authorization</h2>
            <p className="mt-1 text-sm text-[#1A1A1A]/65">These fields size every published trade, so changing them requires the operator secret.</p>
          </div>
          <label className="block text-sm font-medium text-neutral-700">
            Admin secret
            <span className="mt-1 block text-xs font-normal text-[#1A1A1A]/60">Must match <code>ADMIN_SECRET</code> on the server. Not stored by the browser — re-enter it each time.</span>
            <input type="password" autoComplete="off" value={adminSecret} onChange={(event) => setAdminSecret(event.target.value)} className="mt-2 h-11 w-full rounded-lg border-[1.5px] border-[#1A1A1A] bg-transparent px-3 font-mono text-[#1A1A1A] placeholder:text-[#1A1A1A]/45" placeholder="Required to save" disabled={loading} />
          </label>
        </section>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[#1A1A1A]/30 pt-4">
          {adminSecret.trim() === '' && <p className="text-xs text-[#1A1A1A]/60">Enter the admin secret to enable saving.</p>}
          <button type="submit" disabled={saving || loading || adminSecret.trim() === ''} className="orange-button px-5 disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? 'Saving…' : 'Save risk settings'}
          </button>
        </div>
      </form>

      <section className="outline-card space-y-4 p-5 sm:p-6" aria-labelledby="connections-heading">
        <div>
          <h2 id="connections-heading" className="text-lg font-bold">Data connections</h2>
          <p className="mt-1 text-sm text-[#1A1A1A]/65">Credentials stay in server environment variables and are never returned here.</p>
        </div>
        <dl className="divide-y divide-neutral-200 border-y border-neutral-200">
          <div className="flex flex-wrap justify-between gap-2 py-3"><dt className="text-sm text-neutral-600">Active XAU/USD price feed</dt><dd className="font-mono text-sm">{settings.priceSource}</dd></div>
          <div className="flex flex-wrap justify-between gap-2 py-3"><dt className="text-sm text-neutral-600">Twelve Data credential</dt><dd className="font-mono text-sm">{settings.hasPriceApiKey ? 'configured' : 'not configured'}</dd></div>
          <div className="flex flex-wrap justify-between gap-2 py-3"><dt className="text-sm text-neutral-600">Fundamental macro feed</dt><dd className="font-mono text-sm">{settings.macroSource}</dd></div>
          <div className="flex flex-wrap justify-between gap-2 py-3"><dt className="text-sm text-neutral-600">FRED API credential</dt><dd className="font-mono text-sm">{settings.hasFredApiKey ? 'configured' : 'not configured'}</dd></div>
          <div className="flex flex-wrap justify-between gap-2 py-3"><dt className="text-sm text-neutral-600">Economic calendar</dt><dd className="font-mono text-sm">{settings.newsSource}</dd></div>
          <div className="flex flex-wrap justify-between gap-2 py-3"><dt className="text-sm text-neutral-600">Symbol</dt><dd className="font-mono text-sm">XAU/USD</dd></div>
        </dl>
        <p className="text-xs leading-relaxed text-[#1A1A1A]/60">To configure provider credentials, set <code>FRED_API_KEY</code> in the server-side <code>.env</code> file and restart the app. Live XAU pricing uses Twelve Data; fixture prices are synthetic and cannot produce an actionable idea.</p>
      </section>
    </div>
  );
}