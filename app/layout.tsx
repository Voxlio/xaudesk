import type { Metadata } from 'next';
import Link from 'next/link';
import SymbolSearch from './components/SymbolSearch';
import { DISCLAIMER } from '../lib/disclaimer';
import './globals.css';

export const metadata: Metadata = {
  title: 'XAU Desk',
  description: 'Auditable daily XAU/USD trade ideas and HFM Cent account risk math. Educational, not financial advice.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-neutral-200 bg-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-3 sm:px-8">
            <Link href="/" className="flex items-baseline gap-3 text-neutral-950">
              <span className="text-lg font-semibold tracking-tight">XAU Desk</span>
              <span className="hidden text-sm text-neutral-500 sm:inline">Metals research terminal</span>
            </Link>
            <SymbolSearch />
            <nav className="flex w-full items-center justify-between gap-3 text-xs font-medium sm:w-auto sm:justify-start sm:gap-4 sm:text-sm" aria-label="Main navigation">
              <Link href="/" className="text-neutral-600 hover:text-neutral-950">Trade</Link>
              <Link href="/history" className="text-neutral-600 hover:text-neutral-950">History</Link>
              <Link href="/backtest" className="text-neutral-600 hover:text-neutral-950">Backtest</Link>
              <Link href="/settings" className="text-neutral-600 hover:text-neutral-950">Settings</Link>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-5 py-7 sm:px-8">{children}</main>

        {/* Required on every page, not just next to an idea. */}
        <footer className="mx-auto max-w-6xl px-5 pb-8 sm:px-8">
          <p className="border-t border-neutral-200 pt-4 text-xs leading-relaxed text-neutral-500">
            {DISCLAIMER}
          </p>
        </footer>
      </body>
    </html>
  );
}
