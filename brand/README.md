# Blame brand assets

This folder holds the Blame logo files and the core brand colors, so people and coding agents all use the same assets. Logo v4 is final as of November 13, 2026.

## Files

| File | What it is | Size | Use |
|---|---|---|---|
| `logo-full-dark.png` | Icon and "Blame" wordmark on the dark brand background | 2240×1120 | Headers, README hero, social |
| `icon-dark.png` | Icon only, on the dark brand background | 1600×1600 | App icon, favicon source, GitHub App icon |
| `icon-transparent.png` | Icon only, transparent background | 1600×1600 | Overlays on any background |
| `wordmark-transparent.png` | "Blame" wordmark only, transparent background | 2240×1120 | Overlays on any background |

The icon is a pale lavender "blame line" mark: a vertical bar with a `>` chevron. The wordmark is white, bold sans-serif. Don't recolor the mark or the wordmark, and don't put the dark-background versions on light backgrounds. Use the transparent versions there.

## Core colors

These five come straight from the logo and are locked.

| Name | Hex | Use |
|---|---|---|
| Abyss | `#04052E` | Main background, terminal background |
| Deep Twilight | `#140152` | Panels, cards, sidebar |
| Navy | `#22007C` | Raised surfaces, hover, selected rows |
| Lavender | `#B9C2FF` | Icon, links, focus rings, active states |
| White | `#FFFFFF` | Wordmark, headings |

Every other color (text, borders, status, the terminal's 16 ANSI colors, and the L0 to L4 trust ramp) lives in [docs/DESIGN.md](../docs/DESIGN.md). That file is the single source of truth for design tokens, and it adjusts a few of the first proposed colors so text and borders stay readable.

## Rules

- Stick to the purple-blue family plus the four muted status colors. Pink, coral, yellow and terracotta from early explorations were left out on purpose because they read as gaming or fashion, not a developer tool.
- Status colors only ever mean status. Never use them as decoration.
- Dark first. The product and the terminal are dark. If a light theme is ever needed, build it from the same tokens instead of adding new hues.
