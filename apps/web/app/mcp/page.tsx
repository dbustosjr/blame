import type { Metadata } from "next";
import { Code, DocList, DocPage, DocSection, Note, TextLink } from "@/components/doc-page";

export const metadata: Metadata = { title: "MCP setup" };

const preview = `{
  "mcpServers": {
    "blame": {
      "command": "blame",
      "args": ["mcp"]
    }
  }
}`;

export default function McpPage() {
  return (
    <DocPage
      title="Use Blame from Cursor and Claude Code"
      status="Not released yet"
      lead={
        <p>
          Already happy with another coding agent? Connect it to Blame over MCP. It gets the lessons
          Blame has learned about your repo before each task, and its pull requests can still get
          Blame's review.
        </p>
      }
    >
      <DocSection id="tools" title="What your agent gets">
        <DocList>
          <li>
            <Code>get_context</Code>: the confirmed lessons and knowledge that matter for the task.
          </li>
          <li>
            <Code>search_brain</Code>: search what Blame knows about the repo.
          </li>
          <li>
            <Code>record_failure</Code>: log a mistake so Blame can learn from it.
          </li>
          <li>
            <Code>check_action</Code>: ask whether an action looks risky. This is advice only.
          </li>
        </DocList>
        <p>
          To be plain about the limits: Blame cannot block a tool call inside another vendor's
          agent. In this mode, lessons only work through the context your agent receives, the
          regression tests in your CI, and the reviewer.
        </p>
      </DocSection>

      <DocSection id="config" title="Config">
        <p>
          The recommended setup runs <Code>blame mcp</Code> on your machine. It reads short lived
          tokens from your keychain and refreshes them itself, so no long lived secret sits in your
          MCP config file.
        </p>
        <Note title="Preview only">
          <p>
            This needs the terminal app, which is not released yet, so the entry below will not work
            today. It is the shape the config will take: a server that runs the command{" "}
            <Code>blame</Code> with the argument <Code>mcp</Code>. Tested setup steps for each
            editor will replace it with the first release.
          </p>
        </Note>
        <figure>
          <figcaption className="mb-2 text-sm text-muted-text">
            MCP config entry (preview)
          </figcaption>
          <pre className="overflow-x-auto rounded-card border border-border-strong bg-bg-panel p-4 font-mono text-sm text-primary-text">
            <code>{preview}</code>
          </pre>
        </figure>
        <p>
          There will also be a hosted endpoint for clients that cannot run a local command. It uses
          a token that lasts at most one hour.
        </p>
      </DocSection>

      <DocSection id="more" title="Related">
        <DocList>
          <li>
            <TextLink href="/install#terminal">Install the terminal app</TextLink>
          </li>
          <li>
            <TextLink href="/keys/claude">Why Claude subscriptions cannot be used</TextLink>
          </li>
        </DocList>
      </DocSection>
    </DocPage>
  );
}
