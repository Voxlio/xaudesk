'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const GOLD_ALIASES = ['XAU', 'XAUUSD', 'XAU/USD', 'GOLD'];

export default function SymbolSearch() {
  const [query, setQuery] = useState('XAU');
  const [message, setMessage] = useState('');
  const router = useRouter();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const symbol = query.trim().toUpperCase().replace(/\s+/g, '');
    if (!GOLD_ALIASES.includes(symbol)) {
      setMessage('This desk currently supports XAU/USD only.');
      return;
    }
    setMessage('');
    setQuery('XAU');
    router.push('/?symbol=XAUUSD');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="relative w-full max-w-xl" role="search">
      <label htmlFor="symbol-search" className="sr-only">Search symbol</label>
      <div className="flex min-h-12 items-center gap-2 rounded-xl border-[1.5px] border-[#1A1A1A] bg-transparent p-1.5 focus-within:ring-1 focus-within:ring-[#FF6700]">
        <span aria-hidden="true" className="pl-3 text-lg text-[#1A1A1A]">⌕</span>
        <input
          id="symbol-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          placeholder="Search symbol · XAU / Gold"
          autoComplete="off"
          className="min-w-0 flex-1 border-0 bg-transparent px-2 text-sm font-semibold text-[#1A1A1A] outline-none ring-0 placeholder:text-[#1A1A1A]/45"
        />
        <button type="submit" className="orange-button px-4">Analyze</button>
      </div>
      {message && <p role="status" className="absolute right-0 top-14 z-20 w-full rounded-xl border border-[#1A1A1A] bg-[#FFF8E1] p-3 text-xs text-[#1A1A1A]">{message}</p>}
    </form>
  );
}