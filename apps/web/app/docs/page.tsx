import type { Metadata } from "next";
import { DocPage } from "@/components/doc-page";

export const metadata: Metadata = { title: "Docs" };

const pages = [
  { href: "/install", title: "Install", body: "The VS Code extension and the terminal app." },
  { href: "/keys", title: "How keys work", body: "Bring your own key, or sign in with ChatGPT." },
  {
    href: "/keys/claude",
    title: "Why Claude subscriptions cannot be used",
    body: "Claude works in Blame with an Anthropic API key only.",
  },
  { href: "/data", title: "Your data", body: "What leaves your machine and how long it stays." },
  { href: "/mcp", title: "MCP setup", body: "Use Blame's memory from Cursor and Claude Code." },
] as const;

export default function DocsPage() {
  return (
    <DocPage
      title="Docs"
      lead={<p>Start here. Blame is not released yet, so these pages cover how it will work.</p>}
    >
      <ul className="grid gap-4 md:grid-cols-2">
        {pages.map((p) => (
          <li key={p.href}>
            <a
              href={p.href}
              className="block h-full rounded-card border border-border-strong bg-bg-panel p-6 hover:bg-bg-raised"
            >
              <span className="block text-lg font-semibold text-heading">{p.title}</span>
              <span className="mt-2 block text-secondary-text">{p.body}</span>
            </a>
          </li>
        ))}
      </ul>
    </DocPage>
  );
}
