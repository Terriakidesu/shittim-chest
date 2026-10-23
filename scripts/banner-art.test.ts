import { expect, test } from "bun:test";
import type { Banner } from "../src/model/domain/types";
import { reuseRerunBannerImages } from "./banner-art";

function banner(id: number, startMs: number, characterIds: number[], imageFile: string | null, over: Partial<Banner> = {}): Banner {
  return {
    id,
    server: "JP",
    code: `Student_${id}`,
    type: "PickupGacha",
    rateupRaw: null,
    characterIds,
    rerun: false,
    limited: false,
    startMs,
    endMs: startMs + 86_400_000,
    evergreen: false,
    imageFile,
    nameJp: null,
    nameEn: null,
    notes: null,
    ...over,
  };
}

test("reruns reuse the latest historical image for the same roster", () => {
  const rows = reuseRerunBannerImages([
    banner(1, 1, [10], "old-release.png"),
    banner(2, 2, [10], "old-rerun.png", { rerun: true }),
    banner(3, 3, [10], "missing-current.png", { rerun: true }),
  ], new Set(["old-release.png", "old-rerun.png"]));
  expect(rows[2].imageFile).toBe("old-rerun.png");
});

test("artwork is not borrowed from another roster or server", () => {
  const rows = reuseRerunBannerImages([
    banner(1, 1, [10], "jp.png"),
    banner(2, 2, [11], "other.png", { rerun: true }),
    banner(3, 3, [10], "gl.png", { server: "GL", rerun: true }),
    banner(4, 4, [12], null, { rerun: true }),
  ], new Set(["jp.png", "other.png", "gl.png"]));
  expect(rows[1].imageFile).toBe("other.png");
  expect(rows[2].imageFile).toBe("gl.png");
  expect(rows[3].imageFile).toBeNull();
});

test("non-reruns retain their own artwork", () => {
  const rows = reuseRerunBannerImages([
    banner(1, 1, [10], "release.png"),
    banner(2, 2, [10], "new-release.png"),
  ]);
  expect(rows[1].imageFile).toBe("new-release.png");
});
