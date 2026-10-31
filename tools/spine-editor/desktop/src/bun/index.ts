import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { ApplicationMenu, BrowserWindow, Utils } from "electrobun/main";
import { isEditorIgnored, parseEditorIgnore, type EditorIgnoreRule } from "../../../src/editorIgnore";
import { manifestReferenceCandidates, normalizeSpineCatalog, normalizeSpineManifest, type SpineManifestRecord } from "../../../../../src/client/spine/spineManifest";

let assetRoot: string | null = null;

type SpineSet = { directory: string; path: string; files?: string[] };

const EDITOR_DIRECTORIES = new Set([".editor", ".shittim-spine-editor"]);

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function errorResponse(value: unknown, status = 400): Response {
  return json({ error: value instanceof Error ? value.message : String(value) }, status);
}

function rootRelativePath(value: string): string {
  if (!assetRoot) throw new Error("Choose an asset root first.");
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  const full = resolve(assetRoot, normalized);
  const root = resolve(assetRoot);
  if (full !== root && !full.startsWith(`${root}${sep}`)) throw new Error("Path is outside the selected asset root.");
  return full;
}

function relativePath(full: string): string {
  return relative(resolve(assetRoot!), full).replaceAll(sep, "/");
}

function isEditorDataPath(path: string): boolean {
  return EDITOR_DIRECTORIES.has(path.split("/")[0]?.toLocaleLowerCase() ?? "");
}

async function ignoreRules(): Promise<EditorIgnoreRule[]> {
  if (!assetRoot) return [];
  try {
    return parseEditorIgnore(await readFile(join(assetRoot, ".editorignore"), "utf8"));
  } catch (value) {
    if (value && typeof value === "object" && "code" in value && (value as { code?: string }).code === "ENOENT") return [];
    throw value;
  }
}

function ignored(path: string, rules: readonly EditorIgnoreRule[], isDirectory = false): boolean {
  return !isEditorDataPath(path) && isEditorIgnored(path, rules, isDirectory);
}

async function spineSets(directory: string, output: SpineSet[], rules: readonly EditorIgnoreRule[]): Promise<void> {
  const rootRelative = relativePath(directory);
  if (isEditorDataPath(rootRelative) || ignored(rootRelative, rules, true)) return;
  const entries = await readdir(directory, { withFileTypes: true });
  const usableEntries = entries.filter((entry) => {
    const path = relativePath(join(directory, entry.name));
    return entry.name !== "node_modules" && entry.name !== ".git" && !isEditorDataPath(path) && !ignored(path, rules, entry.isDirectory());
  });
  if (usableEntries.some((entry) => entry.isFile() && /\.(?:atlas|skel)$/i.test(entry.name))) {
    const path = rootRelative || ".";
    output.push({ directory: basename(directory), path });
    return;
  }
  await Promise.all(usableEntries.filter((entry) => entry.isDirectory()).map((entry) => spineSets(join(directory, entry.name), output, rules)));
}

async function manifestRecords(): Promise<SpineManifestRecord[]> {
  if (!assetRoot) throw new Error("Choose an asset root first.");
  const paths: string[] = [];
  try {
    const catalog = normalizeSpineCatalog(JSON.parse(await readFile(join(assetRoot, "catalog.json"), "utf8")) as unknown);
    if (catalog) paths.push(...Object.values(catalog.lobbies).map((item) => item.manifest));
  } catch {
    // Fall back to the direct root manifest for a selected lobby or recursive discovery.
  }
  if (paths.length === 0) {
    try { paths.push("manifest.json"); } catch { /* no-op */ }
  }
  const records: SpineManifestRecord[] = [];
  for (const path of [...new Set(paths)]) {
    try {
      const parsed = normalizeSpineManifest(JSON.parse(await readFile(rootRelativePath(path), "utf8")) as unknown, basename(dirname(path)));
      if (parsed) records.push({ manifest: parsed, path: path.replaceAll("\\", "/") });
    } catch {
      // A stale catalog entry should not prevent the legacy recursive fallback.
    }
  }
  return records;
}

function manifestAssetFiles(record: SpineManifestRecord, directory: string): string[] | undefined {
  const assets = record.manifest.assets[directory];
  if (!assets) return undefined;
  return assets.files.map((reference) => manifestReferenceCandidates(record, reference)[0]).filter((path): path is string => Boolean(path));
}

async function catalog(): Promise<SpineSet[]> {
  if (!assetRoot) throw new Error("Choose an asset root first.");
  const records = await manifestRecords();
  if (records.length > 0) {
    const output = new Map<string, SpineSet>();
    for (const record of records) {
      const files = manifestAssetFiles(record, record.manifest.id);
      if (files) output.set(record.manifest.id, { directory: record.manifest.id, path: record.path, files });
    }
    if (output.size > 0) return [...output.values()].sort((a, b) => a.directory.localeCompare(b.directory, undefined, { sensitivity: "base" }));
  }
  const output: SpineSet[] = [];
  await spineSets(assetRoot, output, await ignoreRules());
  const unique = new Map<string, SpineSet>();
  for (const item of output) if (!unique.has(item.directory)) unique.set(item.directory, item);
  return [...unique.values()].sort((a, b) => a.directory.localeCompare(b.directory, undefined, { sensitivity: "base" }));
}

async function useRoot(path: string): Promise<string> {
  const root = resolve(path);
  const entries = await readdir(root, { withFileTypes: true });
  if (!entries.some((entry) => entry.isDirectory() || /\.(?:atlas|skel)$/i.test(entry.name))) throw new Error("The recent folder is empty or is not an asset root.");
  assetRoot = root;
  return root;
}

async function setFiles(directory: string): Promise<string[]> {
  const full = rootRelativePath(directory === "." ? "" : directory);
  const rules = await ignoreRules();
  return (await readdir(full, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && !ignored(relativePath(join(full, entry.name)), rules))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function contentType(path: string): string {
  switch (extname(path).toLocaleLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".atlas": return "text/plain; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".ogg": return "audio/ogg";
    case ".png": return "image/png";
    case ".webp": return "image/webp";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    default: return "application/octet-stream";
  }
}

async function api(request: Request, url: URL): Promise<Response> {
  try {
    if (url.pathname === "/__spine/open-root" && request.method === "POST") {
      const selected = await Utils.openFileDialog({
        startingFolder: assetRoot ?? Utils.paths.home,
        canChooseFiles: false,
        canChooseDirectory: true,
        allowsMultipleSelection: false,
      });
      assetRoot = selected[0] ?? null;
      return json({ rootPath: assetRoot });
    }
    if (url.pathname === "/__spine/use-root" && request.method === "POST") {
      const body = await request.json() as { rootPath?: unknown };
      if (typeof body.rootPath !== "string" || !body.rootPath) return errorResponse("A recent asset root is required.");
      return json({ rootPath: await useRoot(body.rootPath) });
    }
    if (url.pathname === "/__spine/open-file" && request.method === "POST") {
      if (!assetRoot) throw new Error("Choose an asset root first.");
      const selected = await Utils.openFileDialog({
        startingFolder: assetRoot,
        allowedFileTypes: "json",
        canChooseFiles: true,
        canChooseDirectory: false,
        allowsMultipleSelection: false,
      });
      const absolute = selected[0];
      if (!absolute) return json({ path: null, content: null });
      const root = resolve(assetRoot);
      const full = resolve(absolute);
      if (full !== root && !full.startsWith(`${root}${sep}`)) throw new Error("Choose a file inside the selected asset root.");
      const path = relative(root, full).replaceAll(sep, "/");
      if (ignored(path, await ignoreRules())) throw new Error("The selected file is excluded by .editorignore.");
      return json({ path, content: await readFile(full, "utf8") });
    }
    if (url.pathname === "/__spine/open-project" && request.method === "POST") {
      const selected = await Utils.openFileDialog({
        startingFolder: assetRoot ?? Utils.paths.home,
        allowedFileTypes: "json",
        canChooseFiles: true,
        canChooseDirectory: false,
        allowsMultipleSelection: false,
      });
      const absolute = selected[0];
      if (!absolute) return json({ rootPath: null, path: null, content: null });
      const full = resolve(absolute);
      const projectDirectory = EDITOR_DIRECTORIES.has(basename(dirname(full)).toLocaleLowerCase()) ? dirname(dirname(full)) : dirname(full);
      assetRoot = await useRoot(projectDirectory);
      return json({ rootPath: assetRoot, path: relative(assetRoot, full).replaceAll(sep, "/"), content: await readFile(full, "utf8") });
    }
    if (url.pathname === "/__spine/open-audio" && request.method === "POST") {
      if (!assetRoot) throw new Error("Choose an asset root first.");
      const selected = await Utils.openFileDialog({
        startingFolder: assetRoot,
        allowedFileTypes: "ogg,wav,mp3,m4a,flac,aac,opus",
        canChooseFiles: true,
        canChooseDirectory: false,
        allowsMultipleSelection: true,
      });
      const root = resolve(assetRoot);
      const rules = await ignoreRules();
      const paths = selected.map((absolute) => {
        const full = resolve(absolute);
        if (full !== root && !full.startsWith(`${root}${sep}`)) throw new Error("Choose audio files inside the selected asset root.");
        return relative(root, full).replaceAll(sep, "/");
      }).filter((path) => !ignored(path, rules));
      return json({ paths });
    }
    if (url.pathname === "/__spine/catalog") return json({ rootPath: assetRoot, sets: await catalog() });
    if (url.pathname === "/__spine/files") return json({ files: await setFiles(url.searchParams.get("directory") ?? ".") });
    if (url.pathname === "/__spine/file") {
      const path = (url.searchParams.get("path") ?? "").replaceAll("\\", "/").replace(/^\/+/, "");
      const full = rootRelativePath(path);
      if (ignored(path, await ignoreRules())) return errorResponse("File excluded by .editorignore.", 404);
      if (!(await Bun.file(full).exists())) return errorResponse("File not found.", 404);
      return new Response(Bun.file(full), { headers: { "content-type": contentType(full) } });
    }
    if (url.pathname === "/__spine/save" && request.method === "POST") {
      const body = await request.json() as { path?: unknown; content?: unknown };
      if (typeof body.path !== "string" || typeof body.content !== "string") return errorResponse("A relative path and text content are required.");
      const full = rootRelativePath(body.path);
      const temporary = `${full}.shittim-tmp-${process.pid}-${crypto.randomUUID()}`;
      await mkdir(resolve(full, ".."), { recursive: true });
      await writeFile(temporary, body.content, "utf8");
      await rename(temporary, full);
      return json({ ok: true });
    }
    return errorResponse("Unknown desktop editor endpoint.", 404);
  } catch (value) {
    return errorResponse(value, 500);
  }
}

const staticRoot = resolve(import.meta.dir, "../views/editor");
let server: ReturnType<typeof Bun.serve>;
try {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/__spine/")) return api(request, url);
      const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^\/+/, "");
      const full = resolve(staticRoot, requested);
      if (full !== staticRoot && !full.startsWith(`${staticRoot}${sep}`)) return new Response("Not found", { status: 404 });
      const file = Bun.file(full);
      if (!(await file.exists())) return new Response("Not found", { status: 404 });
      return new Response(file, { headers: { "content-type": contentType(full) } });
    },
  });
  console.log(`[spine-editor] local server ${server.url} serving ${staticRoot}`);
} catch (value) {
  console.error("[spine-editor] local server failed", value);
  throw value;
}

let window: BrowserWindow;
try {
  window = new BrowserWindow({
    title: "Shittim Chest Spine Editor",
    url: `http://${server.hostname}:${server.port}/`,
    frame: { width: 1440, height: 900 },
  });
  console.log(`[spine-editor] window ${window.id} opened`);
} catch (value) {
  console.error("[spine-editor] native window failed", value);
  server.stop();
  throw value;
}

ApplicationMenu.setApplicationMenu([
  {
    label: "Editor",
    submenu: [{ role: "quit" }],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  },
]);

void window;
