# Brand colors

The Blame palette is built from the logo: three dark blues, a lavender accent, and white. Everything is a tint or shade of that purple-blue family except the status colors, which stay muted and only ever mean status.

This is the suggested starting palette. [DESIGN.md](DESIGN.md) is the source of truth for the final design tokens, and it adjusts a few of these colors so text and borders stay readable.

## Foundation

| Name | Hex | Use |
|---|---|---|
| Abyss | `#04052E` | App and terminal background |
| Deep Twilight | `#140152` | Panels, cards, sidebar |
| Navy | `#22007C` | Elevated surfaces, hover states, selected rows |
| Lavender | `#B9C2FF` | Primary accent: links, focus rings, active states |
| White | `#FFFFFF` | Wordmark and headings |

## Text and borders

| Role | Hex |
|---|---|
| Primary text | `#F2F0FF` |
| Secondary text | `#A9A7CC` |
| Muted text | `#6E6C94` |
| Subtle border | `#26245F` |
| Strong border | `#3B3790` |

## Status

Use these only to show status, never as decoration.

| Status | Hex |
|---|---|
| Success | `#3ECF8E` |
| Warning | `#F5B544` |
| Error | `#FF6B6B` |
| Info | `#6EA8FF` |

## Terminal (ANSI 16)

Background `#04052E`, foreground `#E8E6FF`, cursor `#B9C2FF`, selection `#22007C`.

| Color | Normal | Bright |
|---|---|---|
| Black | `#04052E` | `#4A4878` |
| Red | `#FF6B6B` | `#FF8A8A` |
| Green | `#3ECF8E` | `#6FE3AE` |
| Yellow | `#F5B544` | `#FFC95E` |
| Blue | `#6EA8FF` | `#8FBFFF` |
| Magenta | `#B18CFF` | `#CDB4FF` |
| Cyan | `#6ED3D3` | `#8FE3E3` |
| White | `#E8E6FF` | `#FFFFFF` |

## Trust levels

Trust levels L0 to L4 use a lavender ramp, so trust gets brighter as it is earned.

| Level | Hex |
|---|---|
| L0 | `#6E6C94` |
| L1 | `#6EA8FF` |
| L2 | `#B9C2FF` |
| L3 | `#8B7CFF` |
| L4 | `#FFFFFF` |
