# Mercury

Mercury is a coding agent that learns from its own mistakes and can show you the proof.

Most coding agents forget. A reviewer rejects a change, a test fails, a fix gets reverted, and a week later the same kind of mistake shows up again. Mercury keeps a record of what went wrong, turns each failure into a lesson backed by a test or a check, and tracks whether that mistake ever comes back. Over time you get a clear picture of how the agent is improving on your codebase, not just a promise that it is.

> Mercury is a working name. The project is in early development and the details below describe what we are building.

## What it does

**Learns from failures.** When something goes wrong, Mercury logs it with evidence, writes a lesson, and adds a regression test or static check so the same class of mistake gets caught next time. A lesson only counts once that mistake stops happening.

**Keeps a second brain for your code.** Decisions, fixes, and the reasons behind them are pulled from pull requests, reviews, and agent sessions automatically. Each note is linked to the files, lessons, and PRs it came from, marked as draft, confirmed, or superseded, and flagged when the code it describes changes. The agent reads from it before it works, so context is there without you pasting it in.

**Reviews before anything ships.** Every pull request an agent opens gets a full-context review against what Mercury knows about the repo, including past bugs and how the pieces depend on each other. When the review finds a problem, the exact file and line go straight back to the agent to fix.

**Lets you choose how hands-off it is.** Run it step by step, let it work on its own and ask before risky actions, or give it full autonomy. Autonomy is earned from its track record on your repo.

**Works with the model you already pay for.** Bring your own API key from the provider you prefer. Your memory and lessons stay portable, so switching models does not mean starting over.

## Two ways to use it

- **VS Code extension.** Runs in VS Code and editors built on it, like Cursor and Windsurf.
- **Terminal app.** A full terminal interface for people who live in the command line.

Both are built on [Pi](https://github.com/earendil-works/pi), an open-source agent toolkit, and share the same core. A website with install steps for each will live alongside them.

## How the repo is organized

```
apps/
  cli/          terminal app and its interface
  vscode/       VS Code extension
  web/          website with install instructions
packages/
  core/         agent, lessons, and second brain shared by both apps
docs/           product and technical docs
```

The folders fill in as the build moves forward. The [docs](docs/) folder holds the product requirements, architecture, and build plan, written so both people and coding agents can read them easily.

## Status

Planning and early build. Expect things to move quickly and change often.
