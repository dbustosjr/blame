import type { Metadata } from "next";
import { Code, DocList, DocPage, DocSection, Note, TextLink } from "@/components/doc-page";

export const metadata: Metadata = { title: "How keys work" };

export default function KeysPage() {
  return (
    <DocPage
      title="How keys work"
      lead={
        <p>
          Blame runs on a model you already pay for. Bring your own API key, or, if you have a
          ChatGPT plan, sign in with ChatGPT. Your prompts and code go from your machine straight to
          your model provider.
        </p>
      }
    >
      <DocSection id="byok" title="Bring your own key">
        <p>
          This is the default. Paste an API key from your provider and Blame uses it for every task.
          Blame works with the providers its agent engine, Pi, supports. OpenAI, Anthropic, Google
          and OpenRouter are tested in CI. Others are best effort.
        </p>
        <p>
          When you add a key, a tiny test call goes from your device to the provider. Nothing goes
          to Blame. If the key is wrong, out of credit or the provider is offline, you get a plain
          message and can try again. Nothing is saved on failure.
        </p>
        <p>
          While a task runs, Blame always shows which provider and model it is using and what it has
          cost so far.
        </p>
      </DocSection>

      <DocSection id="storage" title="Where your key is kept">
        <DocList>
          <li>In the extension: VS Code SecretStorage.</li>
          <li>
            In the terminal app: your OS keychain (macOS Keychain, Windows Credential Manager or the
            Linux Secret Service). On Linux without a secret service, keys come from environment
            variables instead.
          </li>
        </DocList>
        <p>
          Keys are never written to plain text config, logs, telemetry, your repo or Blame's
          servers. Once saved, a key is masked and never shown again.
        </p>
      </DocSection>

      <DocSection id="chatgpt" title="Sign in with ChatGPT">
        <p>
          If you are on ChatGPT Plus, Pro or Business, you can sign in with ChatGPT and use your
          Codex allowance instead of paying for API tokens.
        </p>
        <p>
          Sign in happens in your browser and comes back to your own machine. The tokens stay on
          your device, in the same keychain or SecretStorage as an API key. OpenAI lets open source
          integrations use ChatGPT plan usage, and Blame is open source under Apache-2.0, which is
          what makes this possible.
        </p>
        <Note title="Before each release">
          <p>
            We re-check OpenAI's terms for this sign in before launch and before every major
            release. If they change, API keys keep working.
          </p>
        </Note>
      </DocSection>

      <DocSection id="claude" title="Claude">
        <p>
          Claude works with an Anthropic API key only. Blame cannot use a Claude.ai login or a
          Claude subscription.{" "}
          <TextLink href="/keys/claude">Why Claude subscriptions cannot be used</TextLink>
        </p>
      </DocSection>

      <DocSection id="revoke" title="Removing access">
        <p>
          One action removes every credential Blame holds: <Code>blame revoke</Code> in the terminal
          or the Revoke command in the extension. It deletes your stored provider keys and revokes
          Blame's own tokens, then lists each step with the time it happened.
        </p>
        <p>
          Revoking a ChatGPT sign in from inside Blame may come after the first release. Until then,
          the app tells you to sign out in your ChatGPT settings.
        </p>
      </DocSection>
    </DocPage>
  );
}
