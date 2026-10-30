export const EDITOR_DIRECTORY = ".editor";
export const LEGACY_EDITOR_DIRECTORY = ".shittim-spine-editor";

function safeName(directory: string): string {
  return directory.replace(/[^A-Za-z0-9._-]+/g, "-") || "project";
}

export function editorProjectPath(directory: string): string {
  return `${EDITOR_DIRECTORY}/${safeName(directory)}.spine-project.json`;
}

export function legacyEditorProjectPath(directory: string): string {
  return `${LEGACY_EDITOR_DIRECTORY}/${safeName(directory)}.spine-project.json`;
}

export function editorProjectPaths(directory: string): string[] {
  return [editorProjectPath(directory), legacyEditorProjectPath(directory)];
}
