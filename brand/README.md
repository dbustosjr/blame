# Blame — Brand Assets

Source of truth for the Blame logo and color system, so agents and humans can find and use the same assets. Logo v4 is final (2026-11-13).

## Files

| File | What it is | Size | Use |
|---|---|---|---|
| `logo-full-dark.png` | Full lockup — icon + "Blame" wordmark — on the dark brand background | 2240×1120 | Headers, README hero, social |
| `icon-dark.png` | Icon only, on the dark brand background | 1600×1600 | App icon, favicon source, GitHub App icon |
| `icon-transparent.png` | Icon only, transparent background | 1600×1600 | Overlays on any background |
| `wordmark-transparent.png` | "Blame" wordmark only, transparent background | 2240×1120 | Overlays on any background |

The icon is a pale lavender / light sky blue "blame line" mark (a vertical bar with a `>` chevron). The wordmark is white, bold sans-serif. Do not recolor the mark or wordmark, and do not place the dark-background versions on light backgrounds — use the transparent versions there.

## Colors

Foundation — locked, taken from the final logo:

- Abyss (primary background) `#04052E`
- Deep Twilight (panels, cards) `#140152`
- Navy (elevated surfaces, hover) `#22007C`
- Lavender accent (icon, links, focus) `#B9C2FF`
- White (wordmark, headings) `#FFFFFF`

Text and chrome — proposed 2026-11-13, not yet locked in:

- Primary text `#F2F0FF`, secondary text `#A9A7CC`, muted text `#6E6C94`
- Subtle border `#26245F`, strong border `#3B3790`

Status colors — proposed, use only for status, never decoration:

- Success `#3ECF8E`, warning `#F5B544`, error `#FF6B6B`, info `#6EA8FF`

Terminal (ANSI 16) — proposed:

- Background `#04052E`, foreground `#E8E6FF`, cursor `#B9C2FF`, selection `#22007C`
- Black `#04052E` / bright `#4A4878`, red `#FF6B6B` / `#FF8A8A`, green `#3ECF8E` / `#6FE3AE`, yellow `#F5B544` / `#FFC95E`, blue `#6EA8FF` / `#8FBFFF`, magenta `#B18CFF` / `#CDB4FF`, cyan `#6ED3D3` / `#8FE3E3`, white `#E8E6FF` / `#FFFFFF`

Trust levels L0–L4 map onto a lavender ramp (proposed): L0 `#6E6C94`, L1 `#6EA8FF`, L2 `#B9C2FF`, L3 `#8B7CFF`, L4 white.

## Rules

- Keep the palette to the purple-blue family plus the four muted status colors. The pink, coral, yellow, and terracotta from the early palette explorations were deliberately excluded — too gaming / nightlife / fashion for a dev tool.
- Dark-first: the product and terminal are dark. If a light theme is ever needed, invert from the same tokens rather than introducing new hues.
