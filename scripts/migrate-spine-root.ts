import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { serializeSpineManifest, type SpineManifest, type SpineManifestAssetSet, type SpineManifestPath } from "../src/client/spine/spineManifest";

const DEFAULT_ROOT = "D:/Misc/ba-spine";
const rootArgument = process.argv.find((argument) => argument.startsWith("--root="))?.slice("--root=".length);
const root = resolve(rootArgument || DEFAULT_ROOT);
const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

interface JsonObject {
  [key: string]: unknown;
}

interface OldProject extends JsonObject {
  assetDirectory?: unknown;
  name?: unknown;
  timeline?: JsonObject;
  sequences?: Record<string, JsonObject>;
  interactions?: unknown[];
}

function pathScope(scope: "lobby" | "root", path: string): SpineManifestPath {
  return { scope, path: path.replaceAll("\\", "/").replace(/^\.\//, "") };
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-") || "project";
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function writeNew(path: string, content: string): Promise<void> {
  if (!force && await exists(path)) return;
  if (dryRun) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

async function moveAsset(source: string, destination: string): Promise<void> {
  if (!(await exists(source))) return;
  if (await exists(destination)) {
    const [sourceContent, destinationContent] = await Promise.all([readFile(source), readFile(destination)]);
    if (!sourceContent.equals(destinationContent)) throw new Error(`Refusing to overwrite changed asset: ${source}`);
    // Remove only a byte-identical duplicate; the destination is the preserved
    // copy and the original remains available if it differs.
    if (!dryRun) await unlink(source);
    return;
  }
  if (!dryRun) {
    await mkdir(dirname(destination), { recursive: true });
    await rename(source, destination);
  }
}

function assetPath(scope: "lobby" | "root", directory: string, file: string): SpineManifestPath {
  return pathScope(scope, scope === "lobby" ? `spine/${file}` : `lobbies/${directory}/spine/${file}`);
}

async function assetSet(rootDirectory: string, directory: string, scope: "lobby" | "root"): Promise<SpineManifestAssetSet> {
  const spineDirectory = join(rootDirectory, "lobbies", directory, "spine");
  const sourceDirectory = await exists(spineDirectory) ? spineDirectory : join(rootDirectory, "lobbies", directory);
  const names = (await readdir(sourceDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const atlases = names.filter((name) => /\.atlas$/i.test(name));
  if (atlases.length === 0) throw new Error(`No atlas found for ${directory}.`);
  const skeletons = names.filter((name) => /\.skel$/i.test(name));
  if (skeletons.length === 0) throw new Error(`No skeleton found for ${directory}.`);
  const pages = names.filter((name) => /\.(?:png|webp|jpe?g)$/i.test(name));
  const toPath = (name: string) => assetPath(scope, directory, name);
  const atlas = toPath(atlases[0]!);
  const skeletonPaths = skeletons.map(toPath);
  const pagePaths = pages.map(toPath);
  const allNames = [atlases[0]!, ...names.filter((name) => name !== atlases[0]!)];
  return {
    atlas,
    skeletons: skeletonPaths,
    pages: pagePaths,
    files: allNames.map(toPath),
  };
}

function sequenceEntries(project: OldProject): Record<string, JsonObject> {
  const sequences: Record<string, JsonObject> = { ...(project.sequences ?? {}) };
  const timeline = project.timeline;
  const sequenceId = typeof timeline?.sequenceId === "string" && timeline.sequenceId ? timeline.sequenceId : "legacy";
  if (timeline) sequences[sequenceId] = timeline;
  return sequences;
}

function sequenceWithAssetPaths(timeline: JsonObject, ownDirectory: string): JsonObject {
  const existing = timeline.assetPaths && typeof timeline.assetPaths === "object" && !Array.isArray(timeline.assetPaths)
    ? timeline.assetPaths as Record<string, unknown>
    : {};
  const assetPaths: Record<string, string> = Object.fromEntries(Object.entries(existing)
    .filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string"));
  for (const layer of Array.isArray(timeline.layers) ? timeline.layers : []) {
    if (!layer || typeof layer !== "object") continue;
    const directory = (layer as { directory?: unknown }).directory;
    if (typeof directory === "string" && directory) assetPaths[directory] ??= `lobbies/${directory}/spine`;
  }
  assetPaths[ownDirectory] ??= `lobbies/${ownDirectory}/spine`;
  return { ...timeline, ...(Object.keys(assetPaths).length > 0 ? { assetPaths } : {}) };
}

function referencedDirectories(project: OldProject, ownDirectory: string): string[] {
  const output = new Set<string>();
  for (const timeline of Object.values(sequenceEntries(project))) {
    for (const layer of Array.isArray(timeline.layers) ? timeline.layers : []) {
      if (!layer || typeof layer !== "object") continue;
      const directory = (layer as { directory?: unknown }).directory;
      if (typeof directory === "string" && directory && directory !== ownDirectory) output.add(directory);
    }
  }
  return [...output].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function subtitlePath(project: OldProject): string | null {
  for (const timeline of Object.values(sequenceEntries(project))) {
    const path = timeline.subtitlePath;
    if (typeof path === "string" && path.trim()) return path.replaceAll("\\", "/");
  }
  return null;
}

async function readProject(rootDirectory: string, directory: string): Promise<OldProject | null> {
  const path = join(rootDirectory, ".editor", `${safeName(directory)}.spine-project.json`);
  try {
    return JSON.parse(await readFile(path, "utf8")) as OldProject;
  } catch {
    return null;
  }
}

async function migrateLobby(rootDirectory: string, directory: string, project: OldProject | null): Promise<SpineManifest> {
  const lobbyDirectory = join(rootDirectory, "lobbies", directory);
  const spineDirectory = join(lobbyDirectory, "spine");
  if (!dryRun) await mkdir(spineDirectory, { recursive: true });
  const originalEntries = await readdir(lobbyDirectory, { withFileTypes: true });
  for (const entry of originalEntries) {
    if (entry.isFile() && !["manifest.json", "interactions.json"].includes(entry.name)) {
      await moveAsset(join(lobbyDirectory, entry.name), join(spineDirectory, entry.name));
    }
  }

  const ownAssets = await assetSet(rootDirectory, directory, "lobby");
  const assets: Record<string, SpineManifestAssetSet> = { [directory]: ownAssets };
  const sequences = project ? sequenceEntries(project) : {};
  for (const referenced of project ? referencedDirectories(project, directory) : []) {
    if (await exists(join(rootDirectory, "lobbies", referenced, "spine")) || (dryRun && await exists(join(rootDirectory, "lobbies", referenced)))) assets[referenced] = await assetSet(rootDirectory, referenced, "root");
    else console.warn(`[migrate] ${directory}: referenced asset set is missing: ${referenced}`);
  }

  const manifest: SpineManifest = {
    schemaVersion: 1,
    id: directory,
    entrySequence: project && sequences.opening ? "opening" : null,
    entryMode: project && sequences.opening ? "authored-sequence" : "runtime-intro",
    skeleton: ownAssets.skeletons[0],
    atlas: ownAssets.atlas,
    assets,
  };
  if (project) {
    manifest.sequences = Object.fromEntries(Object.keys(sequences).sort().map((id) => [id, pathScope("lobby", `sequences/${safeName(id)}.json`)]));
    manifest.interactions = pathScope("lobby", "interactions.json");
    manifest.workspace = pathScope("lobby", ".editor/workspace.json");
    const subtitle = subtitlePath(project);
    if (subtitle) {
      manifest.subtitles = pathScope("lobby", "subtitles.json");
      manifest.legacySubtitles = pathScope("root", subtitle);
      try {
        await writeNew(join(lobbyDirectory, "subtitles.json"), await readFile(join(rootDirectory, subtitle), "utf8"));
      } catch {
        console.warn(`[migrate] ${directory}: linked subtitle file is missing: ${subtitle}`);
      }
    }
    await writeNew(join(lobbyDirectory, "interactions.json"), json({
      schemaVersion: 1,
      id: directory,
      assetDirectory: directory,
      interactions: project.interactions ?? [],
    }));
    for (const [id, timeline] of Object.entries(sequences)) await writeNew(join(lobbyDirectory, "sequences", `${safeName(id)}.json`), json(sequenceWithAssetPaths(timeline, directory)));
    const workspace = {
      schemaVersion: 1,
      name: typeof project.name === "string" ? project.name : `${directory} interactions`,
      assetDirectory: directory,
      selectedSequenceId: typeof project.timeline?.sequenceId === "string" ? project.timeline.sequenceId : "legacy",
      selectedInteractionId: project.selectedInteractionId ?? null,
      selectedRegionId: project.selectedRegionId ?? null,
      selectedBonePath: project.selectedBonePath ?? null,
      showBones: project.showBones !== false,
      showBoneNames: project.showBoneNames === true,
      showConstraints: project.showConstraints !== false,
      showInactiveBones: project.showInactiveBones === true,
    };
    // Keep the root workspace companion as a readable compatibility backup,
    // while the manifest points at the lobby-local editor-only state.
    await writeNew(join(rootDirectory, ".editor", `${safeName(directory)}.workspace.json`), json(workspace));
    await writeNew(join(lobbyDirectory, ".editor", "workspace.json"), json(workspace));
  }
  await writeNew(join(lobbyDirectory, "manifest.json"), json(serializeSpineManifest(manifest)));
  return manifest;
}

async function main(): Promise<void> {
  const lobbiesDirectory = join(root, "lobbies");
  const lobbyNames = (await readdir(lobbiesDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  // Move every asset set before manifests are built so cross-lobby references are
  // complete regardless of alphabetical order.
  for (const directory of lobbyNames) {
    const lobbyDirectory = join(root, "lobbies", directory);
    const spineDirectory = join(lobbyDirectory, "spine");
    if (!dryRun) await mkdir(spineDirectory, { recursive: true });
    for (const entry of await readdir(lobbyDirectory, { withFileTypes: true })) {
      if (entry.isFile() && !["manifest.json", "interactions.json"].includes(entry.name)) {
        await moveAsset(join(lobbyDirectory, entry.name), join(spineDirectory, entry.name));
      }
    }
  }
  const manifests: Record<string, { manifest: string }> = {};
  let projects = 0;
  let authoredOpenings = 0;
  for (const directory of lobbyNames) {
    const project = await readProject(root, directory);
    if (project) projects++;
    const manifest = await migrateLobby(root, directory, project);
    if (manifest.entrySequence) authoredOpenings++;
    manifests[directory] = { manifest: `lobbies/${directory}/manifest.json` };
  }
  let catalog: JsonObject = {};
  try { catalog = JSON.parse(await readFile(join(root, "catalog.json"), "utf8")) as JsonObject; }
  catch {
    try { catalog = JSON.parse(await readFile(join(root, "characters.json"), "utf8")) as JsonObject; }
    catch { console.warn("[migrate] characters.json was not found or is invalid; writing a manifest-only catalog."); }
  }
  catalog.schemaVersion = 1;
  catalog.source = "lobbies/*/manifest.json";
  catalog.lobbies = manifests;
  await writeNew(join(root, "catalog.json"), json(catalog));
  console.log(JSON.stringify({ root, dryRun, force, lobbies: lobbyNames.length, projects, authoredOpenings, runtimeIntroEntries: lobbyNames.length - authoredOpenings }, null, 2));
}

await main();
