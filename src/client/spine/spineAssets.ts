import type { SpineFiles } from "./spineRuntime";

export interface CharacterVariant {
  variant: string;
  directory: string;
  assetId?: string;
  devName?: string;
}

export interface CharacterExtra {
  type: string;
  directory: string;
  assetId?: string;
  devName?: string;
}

export interface CharacterEntry {
  variants: CharacterVariant[];
  extras?: CharacterExtra[];
}

export interface IndexedAsset extends CharacterVariant {
  extraType?: string;
}

export function indexedAssets(entry: CharacterEntry | undefined): IndexedAsset[] {
  if (!entry) return [];
  return [
    ...entry.variants,
    ...(entry.extras ?? []).map(({ type, directory, assetId, devName }) => ({
      variant: type,
      directory,
      ...(assetId ? { assetId } : {}),
      ...(devName ? { devName } : {}),
      extraType: type,
    })),
  ];
}

export interface CharacterIndex {
  schemaVersion: number;
  characters: Record<string, CharacterEntry>;
}

export interface AssetSource {
  getSetFiles: (directory: string) => Promise<SpineFiles>;
  getDirectories: () => Promise<string[]>;
  getFile: (path: string) => Promise<File | null>;
}

type DirectoryHandleWithEntries = FileSystemDirectoryHandle & {
  entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
};

type WebkitFile = File & { webkitRelativePath?: string };

const SPINE_SET_FILE = /\.(?:atlas|skel)$/i;

function normalizedPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+/g, "/");
}

async function childDirectory(handle: FileSystemDirectoryHandle, name: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await handle.getDirectoryHandle(name);
  } catch {
    return null;
  }
}

async function directoryEntries(handle: FileSystemDirectoryHandle): Promise<Array<[string, FileSystemHandle]>> {
  const entries: Array<[string, FileSystemHandle]> = [];
  for await (const entry of (handle as DirectoryHandleWithEntries).entries()) entries.push(entry);
  return entries;
}

async function hasAssetFiles(handle: FileSystemDirectoryHandle): Promise<boolean> {
  for (const [name, entry] of await directoryEntries(handle)) {
    if (entry.kind === "file" && SPINE_SET_FILE.test(name)) return true;
  }
  return false;
}

async function filesInDirectory(handle: FileSystemDirectoryHandle): Promise<SpineFiles> {
  const files: SpineFiles = new Map();
  for (const [name, entry] of await directoryEntries(handle)) {
    if (entry.kind === "file") files.set(name, await (entry as FileSystemFileHandle).getFile());
  }
  return files;
}

async function fileAtPath(handle: FileSystemDirectoryHandle, path: string): Promise<File | null> {
  const parts = normalizedPath(path).split("/").filter(Boolean);
  if (parts.length === 0) return null;
  let directory = handle;
  for (const part of parts.slice(0, -1)) {
    const next = await childDirectory(directory, part);
    if (!next) return null;
    directory = next;
  }
  try {
    return await directory.getFileHandle(parts.at(-1)!).then((entry) => entry.getFile());
  } catch {
    return null;
  }
}

/** Resolve the selected folder's `lobbies/` child when an asset root was chosen. */
async function lobbyHandle(root: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle> {
  return await childDirectory(root, "lobbies") ?? root;
}

export function sourceFromDirectory(root: FileSystemDirectoryHandle): AssetSource {
  return {
    getDirectories: async () => {
      const lobby = await lobbyHandle(root);
      if (await hasAssetFiles(lobby)) return [lobby === root ? root.name : lobby.name];
      return (await directoryEntries(lobby))
        .filter(([, entry]) => entry.kind === "directory")
        .map(([name]) => name)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    },
    getSetFiles: async (directory) => {
      const lobby = await lobbyHandle(root);
      const set = lobby === root && directory === root.name ? root : await lobby.getDirectoryHandle(directory);
      return filesInDirectory(set);
    },
    getFile: (path) => fileAtPath(root, path),
  };
}

interface InputFile {
  path: string;
  file: File;
}

function inputFiles(fileList: FileList): { rootName: string; files: InputFile[] } {
  const files = [...fileList].map((file) => {
    const path = normalizedPath((file as WebkitFile).webkitRelativePath || file.name);
    const slash = path.indexOf("/");
    return { path: slash === -1 ? path : path.slice(slash + 1), file, rootName: slash === -1 ? path : path.slice(0, slash) };
  });
  return { rootName: files[0]?.rootName ?? "", files: files.map(({ path, file }) => ({ path, file })) };
}

export function sourceFromInput(fileList: FileList): AssetSource {
  const { rootName, files } = inputFiles(fileList);
  const hasNestedLobbyRoot = files.some(({ path }) => path.toLocaleLowerCase().startsWith("lobbies/"));
  const lobbyPrefix = hasNestedLobbyRoot ? "lobbies/" : "";
  const directSet = !lobbyPrefix && files.some(({ path }) => !path.includes("/") && SPINE_SET_FILE.test(path));
  const findFiles = (prefix: string) => files
    .filter(({ path }) => path.startsWith(prefix))
    .map(({ path, file }) => [path.slice(prefix.length), file] as const);

  return {
    getDirectories: async () => {
      if (directSet) return [rootName];
      const names = new Set<string>();
      for (const { path } of files) {
        if (!path.startsWith(lobbyPrefix)) continue;
        const remainder = path.slice(lobbyPrefix.length);
        const slash = remainder.indexOf("/");
        if (slash > 0) names.add(remainder.slice(0, slash));
      }
      return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    },
    getSetFiles: async (directory) => {
      const prefix = directSet && directory === rootName ? "" : `${lobbyPrefix}${directory}/`;
      return new Map(findFiles(prefix));
    },
    getFile: async (path) => files.find((entry) => entry.path === normalizedPath(path))?.file ?? null,
  };
}
