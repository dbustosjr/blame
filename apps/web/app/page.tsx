export default function HomePage() {
  return (
    <main id="main" className="mx-auto max-w-[1200px] px-6 py-24">
      <h1 className="max-w-3xl text-4xl tracking-tight sm:text-5xl">
        A coding agent that owns its mistakes.
      </h1>
      <p className="mt-6 max-w-2xl text-lg text-secondary-text">
        Blame learns from every failure, reviews every agent pull request, and runs on the model key
        you already have.
      </p>
      <p className="mt-10">
        <a
          className="rounded-control bg-primary px-4 py-3 font-medium text-primary-foreground"
          href="/install"
        >
          See install options
        </a>
      </p>
    </main>
  );
}
