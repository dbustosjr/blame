# Blame design system

This is the single source of truth for how Blame looks and behaves on all three surfaces: the website, the VS Code extension, and the terminal app. The five core colors come from `brand/README.md`; every other color is defined here. This file adds the rules for using them, the type and spacing system, components, and the accessibility fixes the palette needs.

Status: draft v0.2 by Davinci, 2026-11-13. Logo files live in `brand/`.

## Sources and attribution

- Palette: David's brand palette (core colors in `brand/README.md`).
- Structural references from [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (MIT), pinned at commit `fcc70284932276d085f01ef9f83edde90b1258cb`:
  - `design-md/linear.app/DESIGN.md` for the website's restraint, dense type hierarchy, and single accent color.
  - `design-md/warp/DESIGN.md` for block-based command output and terminal-first marketing sections.
  These were used for layout and hierarchy ideas only. No colors, fonts, logos, or copy from those brands are used.
- Terminal interaction model: modeled on the Claude Code CLI as David requested (layout and interaction patterns only, in Blame's own colors and words).
- Impeccable ([pbakaus/impeccable](https://github.com/pbakaus/impeccable), Apache 2.0) runs `critique`, `audit`, `adapt`, `harden` and `polish` against this file. Its `document` step must merge into this file, never create a second one. Always start Impeccable with `IMPECCABLE_LIVE_COPY_AGENT=off` so live Apply can never launch another coding agent with approvals bypassed.

## Logo

Files in `brand/`: `logo-full-dark.png` (icon and wordmark on the brand gradient), `wordmark-transparent.png`, `icon-transparent.png`, `icon-dark.png`. The icon is a vertical bar with a chevron, in `accent`; the wordmark is white.

- Clear space on every side equals the height of the chevron.
- Minimum size: icon 16px (favicon, status bar), full lockup 96px wide.
- Use the icon in `accent` or white only, on `bg.base`, `bg.panel` or the brand gradient (`bg.base` to `bg.raised`, top left to bottom right). Never recolor it with status colors, add effects or stretch it.
- Vector (SVG) versions are still needed for the website and the extension icon. Until then, export PNGs at 2x and 3x.
- The icon doubles as Blame's prompt mark: the terminal input and the welcome box use a bar and chevron glyph (`▏›`, ASCII fallback `|>`) in `accent`, so the product and the logo read as one thing.

## Principles

1. One color family. Everything is a tint or shade of the purple-blue foundation. Status colors only ever mean status.
2. Trust brightens as it is earned. The L0 to L4 ramp is the product's main visual idea and shows up on every surface the same way.
3. Quiet by default. Big type and color are for the one thing that matters on a screen. Everything else recedes.
4. Keyboard first. Every action on every surface is reachable without a mouse and shows a visible focus state.
5. Real states, not happy paths. Every component defines loading, empty, error, and permission-denied states.

## Color tokens

Names here are what code uses. Values are from David's original brand palette except where an accessibility fix is noted.

| Token | Value | Use |
|---|---|---|
| `bg.base` | #04052E | App, website and terminal background |
| `bg.panel` | #140152 | Panels, cards, sidebar |
| `bg.raised` | #22007C | Hover, selected rows, elevated surfaces |
| `accent` | #B9C2FF | Links, focus rings, active states, primary buttons |
| `text.heading` | #FFFFFF | Wordmark and headings |
| `text.primary` | #F2F0FF | Body text |
| `text.secondary` | #A9A7CC | Supporting text |
| `text.muted` | #8A88AA | Hints, timestamps, placeholders (fix, see below) |
| `text.disabled` | #6E6C94 | Disabled controls and decoration only |
| `border.subtle` | #26245F | Dividers between areas that are already separated by spacing |
| `border.strong` | #3B3790 | Card and panel edges |
| `border.control` | #5A5AAC | Input and button outlines (fix, see below) |
| `status.success` | #3ECF8E | Passed, merged, applied |
| `status.warning` | #F5B544 | Needs attention, approval pending |
| `status.error` | #FF6B6B | Failed, blocked, regression |
| `status.info` | #6EA8FF | Neutral system notices |

Trust ramp (revised so it brightens in order and never reuses a status color):

| Level | Value | Contrast on `bg.base` / `bg.raised` |
|---|---|---|
| `trust.L0` | #8A88AA | 5.80 / 4.55 |
| `trust.L1` | #8B7CFF | 6.03 / 4.73 |
| `trust.L2` | #A29FFF | 8.38 / 6.58 |
| `trust.L3` | #B9C2FF | 11.46 / 8.99 |
| `trust.L4` | #FFFFFF | 19.69 / 15.45 |

Changes from the original palette: the first ramp used #6EA8FF for L1, which is also `status.info`, and put L3 (#8B7CFF) darker than L2 (#B9C2FF), so it did not actually brighten. L1 now takes the violet, L2 is a new midpoint between violet and lavender, and L3 takes the lavender. Always pair a trust color with its label (for example "L2"), never color alone.

Autonomy presets (Manual, Guided, Autonomous, per PRD DEC-4) are shown by name with the color of the highest trust level they allow at the current level.

### Accessibility fixes (measured, WCAG 2.2)

Contrast ratios I computed against each background:

- Muted text #6E6C94 is 3.97:1 on `bg.base`, 3.66:1 on `bg.panel` and 3.12:1 on `bg.raised`. Body text needs 4.5:1, so muted text moves to #8A88AA (5.80:1 on base, 4.55:1 on raised). #6E6C94 stays for disabled controls, which WCAG exempts.
- Strong border #3B3790 is 2.00:1 on base. Input and button outlines need 3:1 when the outline is what shows the control, so controls use #5A5AAC (3.02:1 on panel, 3.28:1 on base). Card edges can keep #3B3790.
- Terminal bright black #4A4878 is 2.33:1. Fine for decoration such as box borders. Any text in it that users must read uses #5B5986 or brighter.
- Everything else passes: primary text 17.5:1, secondary 8.5:1, accent 11.5:1, every status color above 7:1 on base, and the full trust ramp passes 4.5:1 on every surface (see the table above).
- Primary button text is `bg.base` on `accent`, 11.46:1.

## Typography

- Sans: Inter (OFL) for website and extension webviews, with system-ui fallback. Inside VS Code, webviews should inherit `--vscode-font-family` for body copy so the panel feels native, and use Inter only on marketing-style surfaces.
- Mono: JetBrains Mono (OFL) on the website. The terminal uses whatever font the user's terminal is set to.
- Scale (rem): 0.75, 0.875, 1, 1.125, 1.25, 1.5, 2, 2.75, 3.5. Body is 1rem at 1.6 line height. Headings use 1.15 line height and slight negative tracking (-0.01em to -0.02em at 2rem and up).
- Weights: 400 body, 500 labels and buttons, 600 headings. No 700+ except the wordmark if the logo needs it.

## Spacing, radius, elevation

- 4px base. Steps: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128.
- Radius: 6px controls, 10px cards, 14px large panels, 999px pills (trust badges).
- Elevation comes from surface color (base, panel, raised), not heavy shadows. Allowed shadow: `0 0 0 1px border.strong, 0 8px 24px rgba(4,5,46,0.6)` for menus and dialogs.
- Focus ring: 2px `accent` with 2px offset, on every interactive element, on every surface.

## Motion

- 120ms for hover and press, 200ms for panels and menus, ease-out. Nothing loops except progress indicators.
- Respect `prefers-reduced-motion`: replace movement with opacity changes.

## Website

Pages (PRD F23.3 and IMPLEMENTATION_PLAN Phase 8a): home (`/`), install with extension and terminal sections (`/install`), how keys work with bring your own key and ChatGPT sign-in (`/keys`), why Claude subscriptions can't be used (`/keys/claude`), privacy and data retention (`/data`), MCP setup (`/mcp`), docs entry (`/docs`), a thin proof page (an opt-in public share of a project's never-repeated chart), and changelog. Built with Next.js, Tailwind and shadcn/ui, with tokens mapped into the Tailwind theme and shadcn CSS variables.

Home, top to bottom:
1. Nav: wordmark, Docs, Changelog, GitHub, and an "Install" primary button.
2. Hero: one headline, one sentence, two buttons (Install for VS Code, Install the CLI), and a live-looking terminal block showing a real Blame session in the brand ANSI colors. No stock illustrations.
3. The trust ramp: L0 to L4 shown as a single horizontal band that brightens, each step with one line on what Blame is allowed to do there.
4. Proof sections, one per pillar: learning from failures, the second brain, independent review with one-click fix, autonomy levels, bring your own key. Each uses a real UI or terminal capture, not a mockup.
5. Install block repeated, then a short footer.

Install page: copyable commands with a copy button and confirmation, tabs for Windows, macOS and Linux, a "check it worked" step, and a troubleshooting list. Every command shown must be tested in CI. Until the first release, the page shows a "Not released yet" notice in place of commands, and the copy buttons and OS tabs arrive with the first tested command.

Rules: max content width 1200px, 12-column grid, generous section spacing (96 to 128px), one accent per viewport. Desktop, tablet (768px) and mobile (375px) screenshots are required in every UI PR.

## VS Code extension

- Use VS Code's own theme variables (`--vscode-*`) for anything that sits in the editor chrome so the extension looks right in light, dark and high contrast themes. Brand colors are for the Blame webview panel content, trust badges and the review view, layered on top.
- Support `vscode-high-contrast` and `vscode-high-contrast-light` theme kinds; test both.
- Use `@vscode/codicons` for icons. No custom icon font.
- Views: Chat (webview), Review findings (tree view with file and line, one-click "Send to agent"), Brain (what Blame knows about this repo), Status bar item showing autonomy mode and trust level, click to change.
- Diffs use VS Code's native diff editor, never a custom one. PRD F23.1 also needs accept or reject per hunk. VS Code's stable API cannot accept single hunks inside the native diff editor, so the native diff is for viewing and Blame adds its own Accept and Reject controls on each hunk, applied with a workspace edit. This keeps the extension publishable on both marketplaces.
- Every destructive or outside-the-workspace action shows a confirmation that names the exact file or command.

## Terminal app (modeled on Claude Code)

Layout, top to bottom:
1. Welcome box on start: rounded border in `border.strong`, the wordmark in `accent`, the working directory, the autonomy mode, and two or three tips in muted text.
2. Transcript: user turns prefixed with `>` in secondary text. Assistant text in primary text. Tool calls on their own line with a bullet marker in `accent`, the tool name in bold, and arguments in muted text. Tool results indented under the call with a corner marker, collapsed after a few lines with a "show more" key hint.
3. Diffs inline: added lines on a dark green-tinted background with success text, removed lines on a dark red-tinted background with error text, line numbers muted.
4. Working indicator: a spinner glyph in `accent`, a short status word, elapsed time, and "esc to interrupt" in muted text.
5. Input box: rounded border, the `▏›` prompt mark (ASCII `|>`), multi-line with shift+enter, slash commands with an autocomplete list, `@` to mention files.
6. Footer line: autonomy preset on the left (Manual, Guided, Autonomous, colored by trust level), key hints on the right ("? for shortcuts").

Behavior:
- shift+tab cycles Manual, Guided and Autonomous, the same way Claude Code cycles its modes. Autonomous needs an explicit opt-in per workspace (PRD R-AUTO-1), and the cycle skips it until then.
- Permission prompts are a bordered box with the exact command or file, and numbered choices (allow once, allow for this session, deny). Enter picks the highlighted one.
- Colors: truecolor when `COLORTERM` is `truecolor` or `24bit`, nearest ANSI 256 otherwise, plain ANSI 16 (see "Terminal ANSI 16" below) as the final fallback. Honor `NO_COLOR`.
- Must work in Windows Terminal, PowerShell, WSL, macOS Terminal, iTerm2 and the VS Code integrated terminal. Glyphs need ASCII fallbacks for consoles without Unicode.
- Check Pi's own TUI package first before adding another TUI library.

## Terminal ANSI 16

In 16-color mode Blame cannot set exact colors. The user's terminal theme decides what "blue" or "white" looks like, and that theme may be light or dark. So the 16-color mapping is semantic and has to stay readable on both:

- Never set a background color. Blame keeps the user's terminal background.
- Body text and headings use the terminal's default foreground (no color code), with bold for headings. White and bright white disappear on light themes, so they are never used for text.
- Muted and secondary text use bright black, or the default foreground with the dim attribute (SGR 2) where the terminal supports it.
- Every color-coded item also has a label or glyph, so nothing depends on color alone.

| Token | ANSI 16 |
|---|---|
| `bg.base`, `bg.panel`, `bg.raised` | none (keep the terminal background) |
| `text.heading` | default foreground, bold |
| `text.primary` | default foreground |
| `text.secondary` | default foreground, dim |
| `text.muted`, `text.disabled` | bright black |
| `accent` | bright blue |
| `border.subtle`, `border.strong` | bright black |
| `border.control` | blue |
| `status.success` | green |
| `status.warning` | yellow |
| `status.error` | red |
| `status.info` | cyan |
| trust L0 | bright black |
| trust L1 | magenta |
| trust L2 | bright magenta |
| trust L3 | bright blue |
| trust L4 | default foreground, bold |

### Optional Blame terminal theme

For users who want the full look in a terminal that only takes 16 colors, ship this as a color scheme for Windows Terminal, iTerm2 and VS Code's integrated terminal. It is David's original terminal palette, with bright black raised to #5B5986 so text in it stays readable (see the accessibility fixes above). Background #04052E, foreground #E8E6FF, cursor #B9C2FF, selection #22007C.

| Color | Normal | Bright |
|---|---|---|
| Black | #04052E | #5B5986 |
| Red | #FF6B6B | #FF8A8A |
| Green | #3ECF8E | #6FE3AE |
| Yellow | #F5B544 | #FFC95E |
| Blue | #6EA8FF | #8FBFFF |
| Magenta | #B18CFF | #CDB4FF |
| Cyan | #6ED3D3 | #8FE3E3 |
| White | #E8E6FF | #FFFFFF |

## Component states checklist

Every component in every surface ships with: default, hover, focus, active, disabled, loading, empty, error, and permission denied. Impeccable `audit` and `harden` are run against these before a UI PR is marked ready.

## Done checks for any UI change

1. Impeccable detector passes (exit 0). Exit 2 means findings, exit 1 means the scan failed; neither gets suppressed.
2. Keyboard-only walkthrough recorded in the PR.
3. Screenshots at 1440, 768 and 375 wide for the website; dark, light and high contrast for the extension; truecolor and ANSI 16 for the terminal.
4. Contrast checked for any new color pairing.
