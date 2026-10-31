import { normalizeProject, type EditorProject } from "./editorModel";
import { editorProjectPaths } from "./editorStorage";

export interface SavedEditorProjectSource {
  readText: (path: string) => Promise<string | null>;
}

export async function readSavedEditorProject(source: SavedEditorProjectSource, directory: string, onError: (message: string) => void): Promise<EditorProject | null> {
  for (const path of editorProjectPaths(directory)) {
    const content = await source.readText(path);
    if (!content) continue;
    try {
      const project = normalizeProject(JSON.parse(content) as unknown, directory);
      if (project) return project;
      onError(`Saved editor project is not compatible: ${path}`);
    } catch (value) {
      onError(`Could not read saved editor project ${path}: ${value instanceof Error ? value.message : String(value)}`);
    }
  }
  return null;
}

export function pendingProjectForDirectory(pending: EditorProject | null, directory: string): EditorProject | null {
  return pending?.assetDirectory === directory ? pending : null;
}
