import { expect, test } from "bun:test";
import { createProject } from "./editorModel";
import { pendingProjectForDirectory, readSavedEditorProject, saveManifestEditorProject, type SavedEditorProjectSource, type WritableEditorProjectSource } from "./editorProject";
import { manifestPath, type SpineManifestRecord } from "../../../src/client/spine/spineManifest";

function sourceFromFiles(files: Record<string, string>) {
  return {
    readText: async (path: string) => files[path] ?? null,
  };
}

test("asset-set switching restores the saved .editor project", async () => {
  const saved = createProject("Airi_home", [], []);
  saved.name = "Saved Airi project";
  saved.timeline.duration = 42;
  const errors: string[] = [];

  const pending = await readSavedEditorProject(sourceFromFiles({
    ".editor/Airi_home.spine-project.json": JSON.stringify(saved),
  }), "Airi_home", (message) => errors.push(message));

  expect(errors).toEqual([]);
  expect(pending?.name).toBe("Saved Airi project");
  expect(pending?.timeline.duration).toBe(42);
  expect(pendingProjectForDirectory(pending, "Airi_home")?.name).toBe("Saved Airi project");
  expect(pendingProjectForDirectory(pending, "Hina_home")).toBeNull();
});

test("saved project loading falls back to the legacy editor directory", async () => {
  const saved = createProject("Airi_home", [], []);
  const pending = await readSavedEditorProject(sourceFromFiles({
    ".shittim-spine-editor/Airi_home.spine-project.json": JSON.stringify(saved),
  }), "Airi_home", () => {});

  expect(pending?.assetDirectory).toBe("Airi_home");
});

test("editor restores manifest sequences and keeps the explicit entry sequence separate", async () => {
  const source = sourceFromFiles({
    "lobbies/Airi_home/interactions.json": JSON.stringify({ interactions: [] }),
    "lobbies/Airi_home/sequences/opening.json": JSON.stringify({ sequenceId: "opening", duration: 12, layers: [], subtitles: [], audio: [] }),
    "lobbies/Airi_home/sequences/talk-5.json": JSON.stringify({ sequenceId: "talk-5", duration: 19, durationMode: "manual", layers: [], subtitles: [], audio: [] }),
    ".editor/Airi_home.workspace.json": JSON.stringify({ selectedSequenceId: "talk-5", name: "Workspace name" }),
  }) as SavedEditorProjectSource;
  source.getManifest = async (): Promise<SpineManifestRecord> => ({
    path: "lobbies/Airi_home/manifest.json",
    manifest: {
      schemaVersion: 1,
      id: "Airi_home",
      entrySequence: "opening",
      entryMode: "authored-sequence",
      assets: { Airi_home: { atlas: { scope: "lobby", path: "spine/a.atlas" }, skeletons: [], pages: [], files: [] } },
      sequences: {
        opening: { scope: "lobby", path: "sequences/opening.json" },
        "talk-5": { scope: "lobby", path: "sequences/talk-5.json" },
      },
      interactions: { scope: "lobby", path: "interactions.json" },
      workspace: { scope: "root", path: ".editor/Airi_home.workspace.json" },
    },
  });
  const project = await readSavedEditorProject(source, "Airi_home", () => {});
  expect(project?.entrySequence).toBe("opening");
  expect(project?.timeline.sequenceId).toBe("talk-5");
  expect(project?.timeline.durationMode).toBe("auto");
  expect(project?.name).toBe("Workspace name");
});

test("manifest workspace schema marker persists and preserves a manual Talk override", async () => {
  const record: SpineManifestRecord = {
    path: "lobbies/Airi_home/manifest.json",
    manifest: {
      schemaVersion: 1,
      id: "Airi_home",
      entrySequence: null,
      entryMode: "runtime-intro",
      assets: { Airi_home: { atlas: manifestPath("lobby", "spine/a.atlas"), skeletons: [], pages: [], files: [] } },
      sequences: {},
      interactions: manifestPath("lobby", "interactions.json"),
      workspace: manifestPath("root", ".editor/Airi_home.workspace.json"),
    },
  };
  const writes: Record<string, string> = {};
  const source: WritableEditorProjectSource = {
    readText: async (path) => writes[path] ?? null,
    saveText: async (path, content) => { writes[path] = content; },
    getManifest: async () => record,
  };
  const project = createProject("Airi_home", [], []);
  project.timeline.sequenceId = "talk-1";
  project.timeline.durationMode = "manual";
  project.timeline.duration = 8;

  const saved = await saveManifestEditorProject(source, project);
  expect(JSON.parse(writes[".editor/Airi_home.workspace.json"]!).projectSchemaVersion).toBe(3);

  const reopened = await readSavedEditorProject({
    readText: async (path) => writes[path] ?? null,
    getManifest: async () => saved ? { ...record, manifest: saved.manifest } : null,
  }, "Airi_home", () => {});
  expect(reopened?.timeline).toMatchObject({ sequenceId: "talk-1", duration: 8, durationMode: "manual" });
});
