import type { Metadata } from "next";
import { DocList, DocPage, DocSection, TextLink } from "@/components/doc-page";

export const metadata: Metadata = { title: "Why Claude subscriptions cannot be used" };

export default function ClaudeSubscriptionsPage() {
  return (
    <DocPage
      title="Why Claude subscriptions cannot be used"
      lead={
        <p>
          If you pay for Claude Pro or Max, you might expect to sign in with it. Blame can't offer
          that. To use Claude in Blame, paste an Anthropic API key.
        </p>
      }
    >
      <DocSection id="terms" title="The reason">
        <p>Anthropic's terms for Claude Code say:</p>
        <blockquote className="border-l-2 border-border-control pl-4 text-secondary-text">
          <p>
            "Anthropic does not permit third-party developers to offer Claude.ai login into their
            own applications, or to route requests through Free, Pro, Max, or Ultra plan credentials
            on behalf of their users."
          </p>
          <footer className="mt-2 text-sm">
            <TextLink href="https://code.claude.com/docs/en/legal-and-compliance">
              Claude Code legal and compliance
            </TextLink>
          </footer>
        </blockquote>
        <p>Blame is a third party app, so this applies to it.</p>
      </DocSection>

      <DocSection id="what-blame-does" title="What Blame does about it">
        <DocList>
          <li>It never asks for, stores or uses a Claude.ai login or subscription.</li>
          <li>It never launches or drives your own Claude Code install.</li>
          <li>
            Pi, the open source engine Blame is built on, includes a Claude Pro and Max login. Blame
            removes that option, and a test checks that it stays removed.
          </li>
        </DocList>
      </DocSection>

      <DocSection id="what-to-do" title="What you can do">
        <DocList>
          <li>
            Use an Anthropic API key. It is stored on your device like any other key.{" "}
            <TextLink href="/keys">How keys work</TextLink>
          </li>
          <li>
            Keep using Claude Code as it is, and connect it to Blame's memory over MCP.{" "}
            <TextLink href="/mcp">MCP setup</TextLink>
          </li>
        </DocList>
      </DocSection>
    </DocPage>
  );
}
