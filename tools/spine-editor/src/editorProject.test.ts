import { expect, test } from "bun:test";
import { createProject } from "./editorModel";
import { pendingProjectForDirectory, readSavedEditorProject } from "./editorProject";

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
