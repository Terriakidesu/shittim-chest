import { expect, test } from "bun:test";
import { normalizeSpineInteractionProject } from "./spineInteraction";
import { editorProjectPath, legacyEditorProjectPath, readLocalInteractionProject } from "./spineProject";

function sourceFromFiles(files: Record<string, string>) {
  return {
    getFile: async (path: string) => {
      const content = files[path];
      return content === undefined ? null : new File([content], path.split("/").at(-1) ?? "project.json", { type: "application/json" });
    },
  };
}

function editorProject() {
  return {
    schemaVersion: 2,
    name: "Local project",
    assetDirectory: "Airi_home",
    interactions: [{
      id: "pat",
      name: "Patting",
      color: "#ff668f",
      enabled: true,
      trigger: "hold",
      startAnimation: "Pat_01_M",
      followAnimation: "Pat_01_M",
      endAnimation: "PatEnd_01_M",
      faceStartAnimation: "Pat_01_A",
      faceFollowAnimation: "Pat_01_A",
      faceEndAnimation: "PatEnd_01_A",
      followTargetBone: "root/Touch_Point",
      sensitivity: 0.25,
      limitX: 90,
      limitY: 65,
      smoothing: 8,
      allowX: false,
      allowY: true,
      rotationEnabled: true,
      rotationAxis: "y",
      rotationMin: -10,
      rotationMax: 20,
      regions: [{
        id: "head",
        name: "Head",
        enabled: true,
        shape: "ellipse",
        anchorBone: "root/Touch_Point",
        offsetX: 2,
        offsetY: 3,
        radiusX: 100,
        radiusY: 75,
        rotation: 4,
      }],
    }],
  };
}

test("normalizes editor projects into the viewer playback contract", () => {
  const normalized = normalizeSpineInteractionProject(editorProject(), "Airi_home");

  expect(normalized?.assetDirectory).toBe("Airi_home");
  expect(normalized?.interactions[0]).toMatchObject({ allowX: false, rotationEnabled: true, rotationAxis: "y" });
  expect(normalized?.interactions[0]?.regions[0]).toMatchObject({ offsetX: 2, offsetY: 3, rotation: 4 });
});

test("viewer local project loading prefers .editor and falls back to the legacy path", async () => {
  const content = JSON.stringify(editorProject());
  const modern = await readLocalInteractionProject(sourceFromFiles({ [editorProjectPath("Airi_home")]: content }), "Airi_home");
  expect(modern?.name).toBe("Local project");

  const legacy = await readLocalInteractionProject(sourceFromFiles({ [legacyEditorProjectPath("Airi_home")]: content }), "Airi_home");
  expect(legacy?.name).toBe("Local project");
});

test("normalizes per-sequence layers, timing, subtitles, and audio", () => {
  const raw = {
    ...editorProject(),
    timeline: {
      sequenceId: "talk-1",
      duration: 8,
      loop: false,
      layersInitialized: true,
      layers: [{ id: "character", name: "Airi", role: "character", directory: "Airi_home", enabled: true, animation: "Talk_01_M", start: 1, end: 4, animationOffset: 0.5, loop: false, x: 2, y: 3, scale: 1.1, opacity: 0.8, order: 1 }],
      subtitles: [{ id: "line", start: 1, end: 2.5, enabled: true, text: { en: "Hello", ja: "こんにちは", ko: "안녕" } }],
      audio: [{ id: "voice", name: "voice.ogg", path: "audios/voicelines/voice.ogg", start: 1, end: 2.5, enabled: true, volume: 0.75 }],
    },
    sequences: {
      opening: { sequenceId: "opening", duration: 12, loop: false, layers: [], subtitles: [], audio: [] },
    },
  };
  const normalized = normalizeSpineInteractionProject(raw, "Airi_home");

  expect(normalized?.timeline).toMatchObject({ sequenceId: "talk-1", duration: 8, loop: false });
  expect(normalized?.timeline?.layers[0]).toMatchObject({ directory: "Airi_home", start: 1, end: 4, scale: 1.1 });
  expect(normalized?.timeline?.subtitles[0]?.text.ja).toBe("こんにちは");
  expect(normalized?.timeline?.audio[0]).toMatchObject({ path: "audios/voicelines/voice.ogg", volume: 0.75 });
  expect(normalized?.sequences?.opening?.sequenceId).toBe("opening");
});
