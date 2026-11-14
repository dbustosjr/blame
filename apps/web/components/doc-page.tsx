import type { ReactNode } from "react";

/** Shared layout for the static docs pages: one h1, a lead paragraph and an optional status pill. */
export function DocPage({
  title,
  lead,
  status,
  children,
}: {
  title: string;
  lead: ReactNode;
  status?: string;
  children: ReactNode;
}) {
  return (
    <main id="main" className="mx-auto max-w-[1200px] px-6 py-16 md:py-24">
      <div className="max-w-3xl">
        {status ? (
          <p className="mb-6 inline-block rounded-full border border-border-strong bg-bg-panel px-3 py-1 text-sm font-medium text-secondary-text">
            {status}
          </p>
        ) : null}
        <h1 className="text-4xl tracking-tight">{title}</h1>
        <div className="mt-4 text-lg text-secondary-text">{lead}</div>
      </div>
      <div className="mt-16 max-w-3xl space-y-16">{children}</div>
    </main>
  );
}

/** A labelled section. The id doubles as the anchor and the heading id. */
export function DocSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="scroll-mt-8">
      <h2 id={id} className="text-2xl tracking-tight">
        {title}
      </h2>
      <div className="mt-4 space-y-4 text-primary-text">{children}</div>
    </section>
  );
}

/** Bulleted list with the site's spacing. */
export function DocList({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-6 marker:text-muted-text">{children}</ul>;
}

/** A plain callout for "not released yet" and similar notices. Uses panel surfaces, not status colors. */
export function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside
      aria-label={title}
      className="rounded-card border border-border-strong bg-bg-panel p-6 text-secondary-text"
    >
      <p className="font-medium text-heading">{title}</p>
      <div className="mt-2 space-y-2">{children}</div>
    </aside>
  );
}

/** Inline code in the mono font. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-control bg-bg-panel px-1.5 py-0.5 font-mono text-[0.875em] text-primary-text">
      {children}
    </code>
  );
}

/** A text link in the accent color with an underline so it never relies on color alone. */
export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="text-brand underline decoration-border-control underline-offset-4 hover:decoration-brand"
    >
      {children}
    </a>
  );
}
