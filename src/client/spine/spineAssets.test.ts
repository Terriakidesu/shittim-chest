import { describe, expect, test } from "bun:test";
import { indexedAssets, sourceFromDirectory, sourceFromInput } from "./spineAssets";

type MockEntry = FileSystemFileHandle | MockDirectory;

interface MockDirectory extends FileSystemDirectoryHandle {
  entries: () => AsyncIterableIterator<[string, MockEntry]>;
}

function mockFile(name: string, contents = "asset"): FileSystemFileHandle {
  const file = new File([contents], name);
  return {
    kind: "file",
    name,
    getFile: async () => file,
  } as unknown as FileSystemFileHandle;
}

function mockDirectory(name: string, children: MockEntry[]): MockDirectory {
  const directory = {
    kind: "directory",
    name,
    async *entries() {
      for (const child of children) yield [child.name, child];
    },
    async getDirectoryHandle(childName: string) {
      const child = children.find((entry) => entry.kind === "directory" && entry.name === childName);
      if (!child) throw new Error(`Missing directory: ${childName}`);
      return child;
    },
    async getFileHandle(childName: string) {
      const child = children.find((entry) => entry.kind === "file" && entry.name === childName);
      if (!child) throw new Error(`Missing file: ${childName}`);
      return child;
    },
  } as unknown as MockDirectory;
  return directory;
}

function inputFile(path: string): File {
  const name = path.split("/").pop()!;
  const file = new File([path], name);
  Object.defineProperty(file, "webkitRelativePath", { configurable: true, value: path });
  return file;
}

function fileList(paths: string[]): FileList {
  const files = paths.map(inputFile) as File[] & { item: (index: number) => File | null };
  files.item = (index) => files[index] ?? null;
  return files as unknown as FileList;
}

describe("Spine local asset sources", () => {
  test("keeps extras in a separate indexed asset group", () => {
    expect(indexedAssets({
      variants: [{ variant: "Base", directory: "Airi_home" }],
      extras: [
        { type: "alternate-home", directory: "Airi0_home" },
        { type: "background", directory: "Airi_bg", assetId: "BG001" },
      ],
    })).toEqual([
      { variant: "Base", directory: "Airi_home" },
      { variant: "alternate-home", directory: "Airi0_home", extraType: "alternate-home" },
      { variant: "background", directory: "Airi_bg", assetId: "BG001", extraType: "background" },
    ]);
  });

  test("resolves lobby sets and voice files relative to a selected asset root", async () => {
    const atlas = mockFile("Airi_home.atlas");
    const skeleton = mockFile("Airi_home.skel");
    const image = mockFile("Airi_home.png");
    const voiceManifest = mockFile("voicelines.json", "manifest");
    const lobby = mockDirectory("Airi_home", [atlas, skeleton, image]);
    const root = mockDirectory("selected-assets", [
      mockDirectory("lobbies", [lobby]),
      mockDirectory("audios", [mockDirectory("voicelines", [voiceManifest])]),
      mockFile("characters.json", "index"),
    ]);

    const source = sourceFromDirectory(root);
    expect(await source.getDirectories()).toEqual(["Airi_home"]);
    expect([...((await source.getSetFiles("Airi_home")).keys())]).toEqual([
      "Airi_home.atlas",
      "Airi_home.skel",
      "Airi_home.png",
    ]);
    expect(await source.getFile("audios/voicelines/voicelines.json")).toBe(await voiceManifest.getFile());
  });

  test("treats a selected individual lobby as one direct set", async () => {
    const root = mockDirectory("Airi_home", [mockFile("Airi_home.atlas"), mockFile("Airi_home.skel")]);
    const source = sourceFromDirectory(root);

    expect(await source.getDirectories()).toEqual(["Airi_home"]);
    expect([...((await source.getSetFiles("Airi_home")).keys())]).toEqual(["Airi_home.atlas", "Airi_home.skel"]);
  });

  test("handles the directory-input fallback for a whole root and a lobby folder", async () => {
    const rootSource = sourceFromInput(fileList([
      "bundle/lobbies/Airi_home/Airi_home.atlas",
      "bundle/lobbies/Airi_home/Airi_home.skel",
      "bundle/audios/voicelines/voicelines.json",
    ]));
    expect(await rootSource.getDirectories()).toEqual(["Airi_home"]);
    expect([...((await rootSource.getSetFiles("Airi_home")).keys())]).toEqual(["Airi_home.atlas", "Airi_home.skel"]);
    expect((await rootSource.getFile("audios/voicelines/voicelines.json"))?.name).toBe("voicelines.json");

    const lobbySource = sourceFromInput(fileList([
      "Airi_home/Airi_home.atlas",
      "Airi_home/Airi_home.skel",
    ]));
    expect(await lobbySource.getDirectories()).toEqual(["Airi_home"]);
    expect([...((await lobbySource.getSetFiles("Airi_home")).keys())]).toEqual(["Airi_home.atlas", "Airi_home.skel"]);
  });
});
