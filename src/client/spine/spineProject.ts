import { normalizeSpineInteractionProject, type SpineInteractionProject } from "./spineInteraction";

export interface SpineProjectSource {
  getFile: (path: string) => Promise<File | null>;
}

function safeName(directory: string): string {
  return directory.replace(/[^A-Za-z0-9._-]+/g, "-") || "project";
}

export function editorProjectPath(directory: string): string {
  return `.editor/${safeName(directory)}.spine-project.json`;
}

export function legacyEditorProjectPath(directory: string): string {
  return `.shittim-spine-editor/${safeName(directory)}.spine-project.json`;
}

export function editorProjectPaths(directory: string): string[] {
  return [editorProjectPath(directory), legacyEditorProjectPath(directory)];
}

/** Read the local project companion when the viewer is pointed at an asset root. */
export async function readLocalInteractionProject(source: SpineProjectSource, directory: string): Promise<SpineInteractionProject | null> {
  for (const path of editorProjectPaths(directory)) {
    const file = await source.getFile(path);
    if (!file) continue;
    try {
      const project = normalizeSpineInteractionProject(JSON.parse(await file.text()) as unknown, directory);
      if (project) return project;
    } catch {
      // A malformed private project should not prevent the published fallback from loading.
    }
  }
  return null;
}
