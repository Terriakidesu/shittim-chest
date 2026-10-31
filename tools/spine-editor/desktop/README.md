# Optional desktop host

This directory is intentionally **not** a root workspace. The public calendar
does not install or run Electrobun/Hutch dependencies.

Install the optional desktop toolchain only when working on the native editor:

```powershell
cd tools/spine-editor/desktop
bun install
bunx electrobun prepare
bun run dev
```

From the repository root, the equivalent opt-in commands are
`bun run editor:desktop` and `bun run editor:desktop:build`.

`bun install` uses Bun through `hutch.config.ts`; it is scoped to this
directory and does not change the root `bun.lock`. The desktop build first
builds the existing private editor into `build/editor`, then packages that
embedded UI in an Electrobun window. Generated Hutch/build/release output is
ignored by the repository.

The desktop host serves the embedded editor through a local Bun process, so the
native folder picker and asset reads do not depend on browser folder
permissions. The local webview is an implementation detail; this tool has no
browser launch mode.
`Ctrl+S`/**Save files** writes the manifest-declared interactions and sequence
files beside the selected lobby, plus `.editor/workspace.json` for editor-only
state. Imported subtitle JSON is saved to the lobby-local `subtitles.json` and
the retained shared source through the same native channel. Reopening the root
restores the interaction/timeline project and automatically loads its subtitle
cues and referenced audio. Older root `.editor/*.spine-project.json` and
`.shittim-spine-editor/` projects remain readable for migration. The published
site remains unaware of this API.
