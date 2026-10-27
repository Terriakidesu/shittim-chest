import { expect, test } from "bun:test";
import { aliasKey, CharacterIndex, normalizeCharName, splitRateup } from "./characters";
import type { Character } from "./types";

const student = (id: number, pathName: string, nameEn: string): Character => ({
  id,
  pathName,
  nameEn,
  school: "Trinity",
  club: "",
  starGrade: 3,
  collectionBg: null,
  availability: "permanent",
  releasedOn: { jp: true, gl: true, kr: true },
});

test("wiki display names normalise to SchaleDB keys", () => {
  expect(normalizeCharName("Azusa (Swimsuit)")).toBe("azusa_swimsuit");
  expect(normalizeCharName("Shun (Kid)")).toBe("shun_kid");
  expect(splitRateup("Kikyou (Swimsuit),Renge (Swimsuit)")).toEqual(["Kikyou (Swimsuit)", "Renge (Swimsuit)"]);
});

test("variant aliases bridge wiki display words to SchaleDB keys", () => {
  expect(aliasKey("neru_bunny_girl")).toBe("neru_bunnygirl");
  expect(aliasKey("yuuka_sportswear")).toBe("yuuka_track");
  expect(aliasKey("shun_kid")).toBe("shun_small");
  // Canonical keys never match an alias pattern, so upstream renames win.
  expect(aliasKey("shun_small")).toBeNull();
});

test("Shun (Kid) resolves to SchaleDB's Shun (Small) in a banner rate-up", () => {
  const index = new CharacterIndex([
    student(10025, "shun_small", "Shun (Small)"),
    student(10011, "shun", "Shun"),
  ]);
  expect(index.resolve("Shun (Kid)")).toEqual([10025]);
  expect(index.has("Shun (Kid)")).toBe(true);
  // Unknown variants still fail loudly rather than guessing a student.
  expect(index.has("Shun (Alien)")).toBe(false);
  expect(index.resolve("Shun (Alien)")).toEqual([]);
});
