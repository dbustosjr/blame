# Blame terminal theme

These files are generated from the optional Blame terminal theme in `docs/DESIGN.md`. Do not edit them by hand. From this package, run `pnpm themes` to regenerate them.

## Windows Terminal

1. Open the Windows Terminal `settings.json` file.
2. Copy the object in `blame.windows-terminal.json` into the `schemes` array.
3. On the profile you want to restyle, set `"colorScheme": "Blame"`.

## iTerm2

1. In iTerm2, open Settings (or Preferences), then Profiles, then Colors.
2. Open the Color Presets menu and choose Import.
3. Select `Blame.itermcolors`.
4. In the same menu, choose Blame.

## VS Code

1. Open your user or workspace `settings.json`.
2. Merge the `workbench.colorCustomizations` object from `blame.vscode-settings.json` into your settings. If you already have that object, copy the `terminal.*` and `terminalCursor.foreground` keys into it.
