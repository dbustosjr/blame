import type { Metadata } from "next";

export const metadata: Metadata = { title: "Install" };

const surfaces = [
  {
    id: "extension",
    title: "VS Code extension",
    body: "Runs in VS Code and editors built on it, like Cursor and Windsurf.",
  },
  {
    id: "terminal",
    title: "Terminal app",
    body: "The blame command for Windows, macOS and Linux. Needs Node 22.19 or newer.",
  },
] as const;

export default function InstallPage() {
  return (
    <main id="main" className="mx-auto max-w-[1200px] px-6 py-24">
      <h1 className="text-4xl tracking-tight">Install Blame</h1>
      <p className="mt-4 max-w-2xl text-secondary-text">
        Blame is not released yet. Install steps for each platform will appear here with the first
        release, and every command on this page will be tested in CI before it is shown.
      </p>
      <section aria-labelledby="surfaces" className="mt-16">
        <h2 id="surfaces" className="sr-only">
          Ways to use Blame
        </h2>
        <ul className="grid gap-6 md:grid-cols-2">
          {surfaces.map((s) => (
            <li
              key={s.id}
              className="rounded-card border border-border-strong bg-bg-panel p-6"
              aria-labelledby={`${s.id}-title`}
            >
              <h3 id={`${s.id}-title`} className="text-xl">
                {s.title}
              </h3>
              <p className="mt-3 text-secondary-text">{s.body}</p>
              <p className="mt-6 text-sm text-muted-text">Coming with the first release.</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
