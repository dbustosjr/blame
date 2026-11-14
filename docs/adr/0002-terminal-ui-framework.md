---
status: accepted
date: 2026-11-13
decision-makers: David Bustos Jr
consulted: Forge, Davinci
informed: Atlas
---

# Build the terminal app on Pi's interactive mode and pi-tui, branded with Blame extensions and theme

## Context and Problem Statement

David wants the terminal app to look and feel like Claude Code (PRD F23.2): prompt box at the bottom, streaming output above, compact collapsible tool blocks, colored diffs, slash commands, inline permission prompts and a status line, using Blame's palette. Which TUI framework should `apps/cli` use?

What the references actually use, from primary sources:

* **Claude Code** started on Ink and then rewrote its renderer while keeping React. Boris Cherny (Claude Code team): "We started by using Ink, and at this point it's our own framework due to the number of changes we've made to it" ([HN, Nov 2025](https://news.ycombinator.com/item?id=45901918)). A Claude Code rendering engineer described the pipeline as React scene graph, layout, rasterize, diff against the previous screen, then ANSI, with a "~16ms frame budget" ([HN, Jan 2026](https://news.ycombinator.com/item?id=46701013)). Claude Code's classic renderer keeps the conversation in native scrollback; a fullscreen renderer on the alternate screen is a research preview ([Claude Code docs](https://code.claude.com/docs/en/fullscreen)). Ink's README still lists Claude Code under "Who's Using Ink?" ([Ink README](https://github.com/vadimdemedes/ink)).
* **Pi** uses its own `@earendil-works/pi-tui`: differential rendering, synchronized output (CSI 2026), main-screen and alternate-screen renderers, components such as `Editor`, `Markdown`, `SelectList`, `ScrollView` ([pi-tui README](https://github.com/earendil-works/pi/tree/main/packages/tui)).
* Others for comparison: Gemini CLI depends on an Ink fork (`npm:@jrichman/ink@6.6.9` in `packages/cli/package.json`); OpenCode uses `@opentui/core` and `@opentui/solid` 0.8.4 (root `package.json` catalog); Codex's TUI is Rust on `ratatui` and `crossterm` (`codex-rs/tui/Cargo.toml`). Checked Nov 13, 2026.

## Decision Drivers

* Claude Code interaction feel with Blame's own identity (PRD NG10)
* Shares the agent core in process (TRD TG-1); no second renderer to maintain
* Low input latency while streaming (R-PERF-4) and clean behavior in Windows Terminal, macOS Terminal, iTerm2 and the VS Code terminal at 80 columns (F23.2 acceptance)
* `NO_COLOR` and non-TTY fallbacks (R-A11Y)
* Solo builder time

## Considered Options

* A. Pi's interactive mode on pi-tui, customized through Pi extensions (header, footer, editor, widgets, tool renderers, dialogs) and a Blame theme, rebranded with `piConfig`
* B. A new Blame app written directly on pi-tui components
* C. Ink 8 (React)
* D. OpenTUI
* E. A non-TypeScript TUI (ratatui, Bubble Tea)

## Decision Outcome

Chosen option: "A, with B as the escape hatch per screen". Pi's interactive mode already provides the editor, autocomplete, slash commands, session tree, streaming and tool rendering, and Pi's extension API lets Blame replace the header, footer and editor, add widgets near the editor, render tools and entries its own way, and open dialogs and overlays (`ctx.ui.*`, [Pi TUI doc](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/tui.md)). `piConfig.name` and `piConfig.configDir` rename the app and its config dir (`packages/coding-agent/src/config.ts`). A screen that cannot be done through extensions is built with pi-tui components directly (option B) inside the same process.

Blame-specific pieces:

| Claude Code style element | Implementation |
|---|---|
| Bordered prompt box at the bottom | Pi editor with a Blame border renderer (pattern: `examples/extensions/border-status-editor.ts`) |
| Status line: model, preset, trust level, cost | Custom footer (`examples/extensions/custom-footer.ts`, `status-line.ts`), trust colored by the ramp token |
| Collapsible tool blocks, colored diffs | Tool renderers (`built-in-tool-renderer.ts` pattern) |
| Inline permission prompt | `ctx.ui.select` from the autonomy gate (`permission-gate.ts` pattern) |
| Preset cycling shortcut | Registered keybinding plus `/mode` command |
| `/rewind`, `/lessons`, `/review` | Registered commands |
| Palette | `blame-dark` theme JSON generated from `DESIGN.md` tokens |

### Consequences

* Good, because the CLI is mostly configuration plus extensions, and the same extensions run in the extension's core process.
* Good, because main-screen differential rendering matches Claude Code's classic scrollback behavior, which is what users expect from it.
* Bad, because we depend on Pi's interactive-mode extension points; if one we need is missing we either contribute upstream or write that screen on pi-tui directly.
* Bad, because rebranding through `piConfig` reads the starting package's `package.json`; this must be confirmed with a bundled `blame` binary in the Phase 1 spike.

### Confirmation

Phase 3 exit check: the TUI renders the Blame header, prompt box, status line and an approval prompt in Windows Terminal and one other terminal at 80 columns, keystroke echo stays under 50 ms during streaming (measured with a scripted pty test), and `NO_COLOR=1` gives plain output. Revisit if more than two core screens need option B, or if Pi drops the extension UI APIs.

## Pros and Cons of the Options

### A. Pi interactive mode plus extensions
* Good, because the least new code and one renderer for agent and UI.
* Neutral, because look and feel is bounded by what extensions can replace.

### B. New app on pi-tui
Steelman: full layout control with the same renderer and process model; right if Blame's UI diverges a lot from Pi's.
* Good, because no dependency on interactive-mode internals.
* Bad, because we rebuild editor wiring, autocomplete, session navigation and streaming views.

### C. Ink 8
Steelman: React components, huge ecosystem, the original base of Claude Code and Gemini CLI. A React team would move fast.
* Good, because familiar to web developers; latest release 8.0.0.
* Bad, because Pi's interactive mode would be thrown away and re-implemented, and Claude Code itself had to replace Ink's renderer to get acceptable flicker behavior (sources above).

### D. OpenTUI
Steelman: modern, native core, Solid and React bindings, powers OpenCode.
* Bad, because pre-1.0 (0.8.4) with a native Zig core to ship per platform, and no reuse of Pi's UI.

### E. ratatui or Bubble Tea
Steelman: Codex shows ratatui gives an excellent, fast TUI.
* Bad, because a second language means the core cannot run in process; we would need RPC for the terminal too and two toolchains.

## More Information

PRD F23.2, NG10, R-PERF-4, R-A11Y. Design tokens: `DESIGN.md` (PR #2). Related: ADR-0001.
