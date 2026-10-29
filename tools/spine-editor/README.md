# Private Spine interaction editor

This tool is local-only and is intentionally outside the GitHub Pages build.
From the repository root:

```bash
bun run editor
```

Open the local URL, choose a Spine asset folder, and author regions and
animation phases. Projects autosave to browser storage and can be exported as
versioned JSON for review or reuse. The tool reads the selected folder directly
in the browser; it does not upload assets or make network requests.

## Workflow

1. Open an asset folder; the editor starts directly on idle.
2. Select an interaction or add a new one. **Draw region** lets you drag an
   ellipse over the artwork. **Select** moves regions; the corner handle resizes
   and the round handle rotates. Change the shape to a rectangle in Regions.
3. Select a bone on the canvas or in the hierarchy, then **Anchor to selected
   bone** to attach the region without moving its center. Movement has a separate
   **Use selected bone as movement target** button.
4. In **Animations**, configure **On press / While held / On release** and the
   optional face tracks. **Auto-detect phases** restores known Pat/Touch/Pinch
   phases from the chosen press animation without changing regions.
5. Switch to **Test** and press an enabled region. Hold/drag, then release. The
   live state and movement target appear below the canvas. Body/face animations
   run over idle and movement uses the configured sensitivity, limits and easing.
   Press triggers play once; Hold triggers start immediately; Drag triggers wait
   for movement. Project changes apply on the next press. Reset idle or Escape
   cancels the test; losing window focus releases a held interaction.

The workspace fits the browser window. Each side panel scrolls independently;
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
| Ctrl/⌘ S | Export JSON backup |
| Delete / Backspace | Delete selected region (Edit mode) |
| ? | Show/hide quick help |

Existing version-1 projects remain compatible. Exported JSON can be imported
back into this editor; the published viewer does **not** consume custom projects.
Neither this editor nor its assets are included in the root Pages build.

## Bulk repair for old patting defaults

Older editor versions placed every generated patting ellipse on `Touch_Point`,
which is a movement controller and can be far below the head. **Repair saved
defaults** scans only projects already saved in the currently opened asset-folder
source. It detects visible face/head artwork per skeleton, moves only untouched
generated defaults, and leaves custom, moved, resized, renamed, disabled, or
rebound regions unchanged. The operation keeps a browser-storage backup; use
**Undo bulk repair** immediately if the result needs review. Rigs without a
reliable head candidate are reported and their uncertain default is disabled,
never guessed onto the body.
