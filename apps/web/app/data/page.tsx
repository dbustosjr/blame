import type { Metadata } from "next";
import { DocList, DocPage, DocSection, Note, TextLink } from "@/components/doc-page";

export const metadata: Metadata = { title: "Your data" };

const proposed = [
  {
    data: "Evidence excerpts (diff hunks, log lines, review text)",
    where: "Blame's database, if you sync or install the GitHub App",
    window: "Deleted after a set window. Proposed: 90 days",
  },
  {
    data: "Audit events",
    where: "On your machine, then Blame's database if you sync",
    window: "Deleted after a set window. Proposed: 90 days",
  },
  {
    data: "Lessons and knowledge items",
    where: "On your machine, and Blame's database if you sync",
    window: "Kept until you delete them",
  },
  {
    data: "Code index for a repo",
    where: "On your machine, or the Actions cache in your own repo",
    window: "Deleted when you disconnect the repo. Proposed: within 24 hours",
  },
  {
    data: "Everything in your account",
    where: "Blame's database and its backups",
    window: "Deleted when you delete your account. Proposed: within 30 days, backups included",
  },
] as const;

export default function DataPage() {
  return (
    <DocPage
      title="Your data"
      lead={
        <p>
          What leaves your machine, where it goes, and how long it stays. Blame is local first: with
          your own key, prompts and code go straight to your model provider, not to Blame.
        </p>
      }
    >
      <DocSection id="leaves" title="What leaves your machine">
        <DocList>
          <li>
            Your prompts and code go from your machine straight to your model provider. Blame's
            servers do not see them unless you turn on a hosted feature.
          </li>
          <li>
            Your API keys stay on your device. <TextLink href="/keys">How keys work</TextLink>
          </li>
          <li>
            A Blame account is optional. Skip it and everything stays local. If you sign in to sync,
            lessons, knowledge items and evidence excerpts go to Blame's database, kept separate per
            team.
          </li>
          <li>
            Evidence is stored as short excerpts, about 200 lines at most, never as whole files.
          </li>
        </DocList>
      </DocSection>

      <DocSection id="retention" title="How long it is kept">
        <Note title="Draft, not decided yet">
          <p>
            The retention windows below are a proposal waiting on a decision. None of them is final,
            and this page will change when they are decided.
          </p>
        </Note>
        <section
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable table must be reachable by keyboard (WCAG 2.1.1)
          tabIndex={0}
          aria-label="Proposed retention table"
          className="overflow-x-auto rounded-card border border-border-strong"
        >
          <table className="w-full min-w-[36rem] text-left text-sm">
            <caption className="sr-only">Proposed retention for each kind of data</caption>
            <thead className="bg-bg-panel text-heading">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Data
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Where
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  How long (draft)
                </th>
              </tr>
            </thead>
            <tbody>
              {proposed.map((row) => (
                <tr key={row.data} className="border-t border-border-subtle align-top">
                  <th scope="row" className="px-4 py-3 font-medium text-primary-text">
                    {row.data}
                  </th>
                  <td className="px-4 py-3 text-secondary-text">{row.where}</td>
                  <td className="px-4 py-3 text-secondary-text">{row.window}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </DocSection>

      <DocSection id="telemetry" title="Telemetry">
        <p>
          Product telemetry is off by default. If you opt in, it never contains code, prompts or
          keys, and you can turn it off again at any time.
        </p>
      </DocSection>

      <DocSection id="yours" title="It stays yours">
        <DocList>
          <li>Blame does not sell or share your data.</li>
          <li>Blame does not train models on your data.</li>
          <li>
            You can export everything Blame knows about a repo as plain markdown files plus an{" "}
            AGENTS.md, readable by any tool.
          </li>
        </DocList>
      </DocSection>
    </DocPage>
  );
}
