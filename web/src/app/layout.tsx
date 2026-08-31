import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Snippet Vault',
  description:
    'Reference application: a paid Superhuman Go agent monetised with Salable.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen antialiased">
        <header className="border-b border-neutral-200 dark:border-neutral-800">
          <nav className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
            <Link href="/" className="font-semibold tracking-tight">
              Snippet Vault
            </Link>
            <div className="flex gap-6 text-sm">
              <Link href="/pricing" className="hover:underline">
                Pricing
              </Link>
              <a
                href="https://salable.app/docs"
                className="text-neutral-500 hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                Salable docs
              </a>
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-4xl px-6 py-12">{children}</main>
        <footer className="mx-auto max-w-4xl px-6 py-8 text-sm text-neutral-500">
          Reference application — a paid Superhuman Go agent, monetised with Salable.
        </footer>
      </body>
    </html>
  );
}
