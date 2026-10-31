# Private desktop Spine editor and timeline composer

This tool is local-only desktop development tooling and is intentionally outside
the GitHub Pages build. The normal site build never imports it, and the root
package must not gain desktop-only dependencies just to publish the calendar.
The React/Spine surface is bundled into the native Electrobun window; there is
no supported browser editor.

Install the optional native toolchain once:

```bash
cd tools/spine-editor/desktop
bun install
bunx electrobun prepare
```

From the repository root, launch the desktop editor with:

```bash
bun run editor:desktop
```

Choose a Spine asset folder in the native window, then author regions and
animation phases. The desktop host reads local files through its native Bun
bridge and does not upload assets or make network requests.

The selected root may contain an `.editorignore` file. It uses root-relative
gitignore-style patterns (`*`, `?`, `**`, directory patterns, and `!`
negation) to keep generated or unrelated files out of the imported catalog.
Editor-owned projects are saved under `.editor/`; the older
`.shittim-spine-editor/` location is still read for migration. Opening a root
or switching sets automatically restores the saved interaction/timeline
project, including its subtitle cues and audio clips.

## Workflow

1. Open an asset folder; the editor starts directly on idle.
2. Select an interaction or add a new one. **Draw region** lets you drag an
   ellipse over the artwork. **Select** moves regions; the corner handle resizes
   and the round handle rotates. Change the shape to a rectangle in Regions.
3. Select a bone on the canvas or in the hierarchy, then **Anchor to selected
   bone** to attach the region without moving its center. Movement has a
   searchable target-bone picker, local X/Y locks, local rotation limits, a
   visual bone gizmo, and a separate **Use selected bone as movement target**
   button.
4. In **Animations**, configure **On press / While held / On release** and the
   optional face tracks. The phase cards preview body and face tracks together;
   **Auto-detect phases** restores known Pat/Touch/Pinch phases from the chosen
   press animation without changing regions.
5. Switch to **Test** and press an enabled region. Hold/drag, then release. The
   live debugger shows the interaction, region, phase, body/face animation,
   target bone, applied movement offset, and rotation. Body/face animations run
   over idle and movement uses the configured local axes, limits, rotation range,
   sensitivity, and easing. Press triggers play once; Hold triggers start
   immediately; Drag triggers wait for movement. Project changes apply on the
   next press. Reset idle or Escape cancels the test; losing window focus
   releases a held interaction.

## Timeline composition

Choose **Timeline** in the header to open the composition workspace. When the
selected set is named like `Airi_home`, matching `Airi_bg` and `Airi_scene`
directories are discovered automatically. Each set remains a real Spine
instance and is rendered as a synchronized layer; the shared playhead drives
all layers together rather than flattening them into images.

- Drag layer blocks to move the whole clip, or drag either edge to change only
  its start or end time; use the inspector for exact start/end times, animation,
  looping, order, position, scale, opacity, and visibility. In Opening, the
  character layer start is the intro start, and the clip is visibly split into
  INTRO and IDLE sections. Non-looping layers use the actual Spine animation
  end by default; enter a manual end time when a deliberate hold or early cut
  is needed.
- Add subtitle cues, drag their body to move them, drag either edge to resize
  them, or enter exact timestamps. English, Japanese, and Korean text are kept
  independently in the project.
- Import the generated `subtitles.json` files to bring in subtitle markers and
  their audio paths, or add local audio clips for a session. Drag audio blocks
  to move them, drag either edge to change their timing, and edit their
  timestamps, volume, and enabled state in the Audio track.
- In the native desktop host, switch character sets from the shared header picker;
  decoded voice duration expands each imported audio block and the linked
  subtitle JSON is saved back in place. **Save files** writes the companion
  project JSON under `.editor/` in the selected asset root. When that project
  is found again, subtitle cues and referenced audio are loaded automatically.
- Change the shared duration, snap interval, playback speed, and layer order.

Timeline edits are part of the same local, versioned project JSON as the
interaction edits. They are non-destructive: the source `.atlas`, `.skel`, and
texture files are never rewritten.

The workspace fits the desktop window. Each side panel scrolls independently;
drag its divider to resize, double-click the divider to reset, or use the canvas
toolbar to hide a panel. Focused dividers also respond to arrow keys. Pan mode
drags the view, the wheel zooms, and Fit (or a canvas double-click) restores framing.
The Bones-panel display toggles are shared editor preferences, so they stay set
when switching between asset sets and across editor reloads.

Pinch tests resolve the grabbed cheek from the rig: sided chin controls (either
name order), numbered cheek pairs, and single cheek chains are supported. Old
projects using a shared `Touch_Point` target also use this resolution during
preview, without rewriting the saved project. Default pinch movement follows
the pointer directly within a small, face-scaled limit; inward motion stops at
neutral instead of pushing through the face. Releasing restores the rig's
normal constraints. Explicit custom targets and movement settings are retained.

## Shortcuts

Shortcuts are ignored while typing in a field.

| Key | Action |
| --- | --- |
| V / H / R | Select / Pan / Draw region |
| T | Toggle full-interaction Test mode |
| F / B | Fit artwork / Toggle bones |
| Space | Play/pause animation (Edit mode) |
| Escape | Cancel test, return to idle/Edit, close help |
| Ctrl/⌘ Z / Shift Z | Undo / Redo |
| Ctrl/⌘ D | Duplicate selected region |
| Ctrl/⌘ S | Save project and linked subtitle files |
| Delete / Backspace | Delete selected region (Edit mode) |
| ? | Show/hide quick help |

Existing version-1 projects remain compatible. Project companions are kept
under the selected asset root; the published viewer does **not** consume custom
projects. Use `.editorignore` when a root contains asset-like folders that
should not be imported.
Neither this editor nor its assets are included in the root Pages build.
