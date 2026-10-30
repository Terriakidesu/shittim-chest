import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { ApplicationMenu, BrowserWindow, Utils } from "electrobun/main";

let assetRoot: string | null = null;

type SpineSet = { directory: string; path: string };

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

async function spineSets(directory: string, output: SpineSet[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.some((entry) => entry.isFile() && /\.(?:atlas|skel)$/i.test(entry.name))) {
    const path = relative(assetRoot!, directory).replaceAll(sep, "/") || ".";
    output.push({ directory: basename(directory), path });
    return;
  }
  await Promise.all(entries.filter((entry) => entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git").map((entry) => spineSets(join(directory, entry.name), output)));
}

async function catalog(): Promise<SpineSet[]> {
  if (!assetRoot) throw new Error("Choose an asset root first.");
  const output: SpineSet[] = [];
  await spineSets(assetRoot, output);
  const unique = new Map<string, SpineSet>();
  for (const item of output) if (!unique.has(item.directory)) unique.set(item.directory, item);
  return [...unique.values()].sort((a, b) => a.directory.localeCompare(b.directory, undefined, { sensitivity: "base" }));
}

async function setFiles(directory: string): Promise<string[]> {
  const full = rootRelativePath(directory === "." ? "" : directory);
  return (await readdir(full, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
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
      return json({ path: relative(root, full).replaceAll(sep, "/"), content: await readFile(full, "utf8") });
    }
    if (url.pathname === "/__spine/open-audio" && request.method === "POST") {
      if (!assetRoot) throw new Error("Choose an asset root first.");
      const selected = await Utils.openFileDialog({
        startingFolder: assetRoot,
        allowedFileTypes: "audio",
        canChooseFiles: true,
        canChooseDirectory: false,
        allowsMultipleSelection: true,
      });
      const root = resolve(assetRoot);
      const paths = selected.map((absolute) => {
        const full = resolve(absolute);
        if (full !== root && !full.startsWith(`${root}${sep}`)) throw new Error("Choose audio files inside the selected asset root.");
        return relative(root, full).replaceAll(sep, "/");
      });
      return json({ paths });
    }
    if (url.pathname === "/__spine/catalog") return json({ rootPath: assetRoot, sets: await catalog() });
    if (url.pathname === "/__spine/files") return json({ files: await setFiles(url.searchParams.get("directory") ?? ".") });
    if (url.pathname === "/__spine/file") {
      const full = rootRelativePath(url.searchParams.get("path") ?? "");
      if (!(await Bun.file(full).exists())) return errorResponse("File not found.", 404);
      return new Response(Bun.file(full), { headers: { "content-type": contentType(full) } });
    }
    if (url.pathname === "/__spine/save" && request.method === "POST") {
      const body = await request.json() as { path?: unknown; content?: unknown };
      if (typeof body.path !== "string" || typeof body.content !== "string") return errorResponse("A relative path and text content are required.");
      const full = rootRelativePath(body.path);
      const temporary = `${full}.shittim-tmp-${process.pid}`;
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
