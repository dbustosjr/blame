import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { tokenStyle } from "@/lib/tokens";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Blame AI", template: "%s | Blame AI" },
  description: "A coding agent that owns its mistakes.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable} style={tokenStyle}>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <a
          href="#main"
          className="sr-only inline-flex min-h-6 items-center focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded-control focus:bg-bg-panel focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <header className="border-b border-border-subtle">
          <nav
            aria-label="Main"
            className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-4"
          >
            <a href="/" className="inline-flex min-h-6 items-center font-semibold text-heading">
              <span aria-hidden="true" className="text-brand">
                {"\u258F\u203A "}
              </span>
              Blame
            </a>
            <ul className="flex items-center gap-6 text-sm text-secondary-text">
              <li>
                <a
                  className="inline-flex min-h-6 items-center hover:text-primary-text"
                  href="/docs"
                >
                  Docs
                </a>
              </li>
              <li>
                <a
                  className="inline-flex min-h-6 items-center hover:text-primary-text"
                  href="https://github.com/dbustosjr/blame"
                >
                  GitHub
                </a>
              </li>
              <li>
                <a
                  className="inline-flex min-h-6 items-center rounded-control bg-primary px-3 py-2 font-medium text-primary-foreground"
                  href="/install"
                >
                  Install
                </a>
              </li>
            </ul>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
