import type { Metadata } from "next";
import { Code, DocList, DocPage, DocSection, Note, TextLink } from "@/components/doc-page";

export const metadata: Metadata = { title: "Install" };

export default function InstallPage() {
  return (
    <DocPage
      title="Install Blame"
      status="Not released yet"
      lead={
        <p>
          Blame comes as a VS Code extension and a terminal app. Neither is released yet, so there
          is nothing to install today. Real install steps will appear here with the first release,
          and every command on this page will be tested in CI before it is shown.
        </p>
      }
    >
      <nav aria-label="On this page">
        <ul className="flex flex-wrap gap-3 text-sm">
          <li>
            <a
              className="inline-block rounded-control border border-border-control px-3 py-2 text-primary-text hover:bg-bg-raised"
              href="#extension"
            >
              VS Code extension
            </a>
          </li>
          <li>
            <a
              className="inline-block rounded-control border border-border-control px-3 py-2 text-primary-text hover:bg-bg-raised"
              href="#terminal"
            >
              Terminal app
            </a>
          </li>
          <li>
            <a
              className="inline-block rounded-control border border-border-control px-3 py-2 text-primary-text hover:bg-bg-raised"
              href="#troubleshooting"
            >
              Troubleshooting
            </a>
          </li>
        </ul>
      </nav>

      <DocSection id="extension" title="VS Code extension">
        <p>
          Runs in VS Code and in editors built on it, like Cursor and Windsurf. It will be published
          to the VS Code Marketplace and to Open VSX. Cursor and Windsurf install extensions from
          Open VSX, so use that listing there.
        </p>
        <p>Once it is installed, setup takes three steps:</p>
        <ol className="list-decimal space-y-2 pl-6 marker:text-muted-text">
          <li>Open the Blame panel.</li>
          <li>
            Choose a model provider: paste an API key, or sign in with ChatGPT.{" "}
            <TextLink href="/keys">How keys work</TextLink>
          </li>
          <li>Pick a preset: Manual, Guided or Autonomous. Guided is the default.</li>
        </ol>
        <Note title="Not published yet">
          <p>
            There is no Marketplace or Open VSX listing yet. The links will go here when the first
            release ships.
          </p>
        </Note>
      </DocSection>

      <DocSection id="terminal" title="Terminal app">
        <p>
          The <Code>blame</Code> command runs in your terminal on Windows, macOS and Linux. It needs
          Node 22.19 or newer. It will install with one npm command, then you run <Code>blame</Code>{" "}
          inside a repo.
        </p>
        <Note title="No install command yet">
          <p>
            The npm package name is not final, so there is no command to copy. It will be added here
            once the package is published and the command has passed in CI.
          </p>
        </Note>
      </DocSection>

      <DocSection id="check" title="Check it worked">
        <DocList>
          <li>
            Terminal: run <Code>blame</Code> in a repo. You should see a welcome box with your
            working directory and the current autonomy mode.
          </li>
          <li>
            Extension: the Blame panel opens and asks you to add a model key before your first task.
          </li>
        </DocList>
      </DocSection>

      <DocSection id="troubleshooting" title="Troubleshooting">
        <DocList>
          <li>
            <span className="font-medium text-heading">Node is too old.</span> Blame needs Node
            22.19 or newer. If your editor's built in Node is older and there is none on your PATH,
            the extension shows an install prompt instead of starting.
          </li>
          <li>
            <span className="font-medium text-heading">No keychain on Linux.</span> The terminal app
            stores keys in the OS keychain. On Linux without a secret service it reads keys from
            environment variables and will not write a plain text key file unless you pass{" "}
            <Code>--insecure-file-store</Code>.
          </li>
          <li>
            <span className="font-medium text-heading">Windows asks for admin.</span> The first time
            you turn on Autonomous mode on Windows, Blame needs your OK once to create a local user
            account for its sandbox. If you decline, you stay in Guided.
          </li>
          <li>
            <span className="font-medium text-heading">Cursor or Windsurf cannot find it.</span>{" "}
            They use Open VSX, not the VS Code Marketplace. Search there.
          </li>
        </DocList>
      </DocSection>
    </DocPage>
  );
}
