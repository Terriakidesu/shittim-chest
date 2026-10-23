import { expect, test } from "bun:test";
import type { Banner } from "./api";
import { currentBannerHeads, forecastNews, latestBannerNews, newsUpdateLabel } from "./lobbyNews";

const NOW = Date.UTC(2026, 9, 23);
function banner(id: number, server: "JP" | "GL", startMs: number, over: Partial<Banner> = {}): Banner {
  return { id, server, startMs, endMs: startMs + 14 * 86_400_000, type: "PickupGacha", code: null, rerun: false, limited: false, evergreen: false, characters: [{ id, name: `Student ${id}`, school: "", starGrade: 3, avatar: "" }], imageUrl: null, confirmedGlStartMs: null, prediction: null, forecastStatus: "arrived", ...over };
}

test("news includes every banner in the latest period for each server", () => {
  const news = latestBannerNews([banner(1, "JP", NOW - 10), banner(2, "JP", NOW - 10, { rerun: true }), banner(3, "JP", NOW - 100), banner(4, "GL", NOW - 20)], NOW);
  expect(news).toHaveLength(2);
  expect(news[0].label).toBe("Global · Live");
  expect(news[1].names).toContain("Student 1 · Student 2 (rerun)");
  expect(news[1].names).not.toContain("Student 3");
  expect(news[1].label).toBe("Japan · Live");
});

test("upcoming schedules are labelled distinctly and archive/empty banners are excluded", () => {
  const news = latestBannerNews([banner(1, "JP", NOW + 100), banner(2, "JP", NOW + 200, { evergreen: true }), banner(3, "JP", NOW + 300, { characters: [] })], NOW);
  expect(news).toHaveLength(1);
  expect(news[0].label).toBe("Japan · Upcoming");
  expect(news[0].names).toContain("Student 1");
  expect(news[0].names).not.toContain("Student 2");
});

test("news deduplicates students and tolerates absent or invalid snapshot dates", () => {
  const item = banner(1, "JP", NOW);
  expect(latestBannerNews([item, { ...item, id: 2 }], NOW)[0].names.match(/Student 1/g)).toHaveLength(1);
  expect(latestBannerNews([], NOW)).toEqual([]);
  expect(latestBannerNews([banner(1, "GL", NaN)], NOW)).toEqual([]);
  expect(newsUpdateLabel(null)).toBeNull();
  expect(newsUpdateLabel(NaN)).toBeNull();
  expect(newsUpdateLabel(NOW)).toContain("2026");
});

test("live banners take priority over announcements, with expired snapshots clearly marked", () => {
  const live = banner(1, "JP", NOW - 100);
  const future = banner(2, "JP", NOW + 100);
  expect(latestBannerNews([live, future], NOW)[0].names).toBe("Student 1");
  expect(latestBannerNews([banner(1, "JP", NOW - 100, { endMs: NOW - 1 })], NOW)[0].kind).toBe("past");
});

test("Gacha tile shows two unique running students per server, preferring new pick-ups", () => {
  const rerun = banner(1, "JP", NOW - 100, { rerun: true });
  const jp = banner(2, "JP", NOW - 100);
  const gl = banner(3, "GL", NOW - 100);
  const result = currentBannerHeads([rerun, jp, banner(4, "JP", NOW - 100), gl, { ...gl, id: 30 }, banner(5, "GL", NOW + 100), banner(6, "GL", NOW - 100, { evergreen: true })], NOW);
  expect(result.map((group) => group.server)).toEqual(["GL", "JP"]);
  expect(result[0].students.map((student) => student.id)).toEqual([3]);
  expect(result[1].students.map((student) => student.id)).toEqual([2, 4]);
  expect(currentBannerHeads([banner(1, "GL", NOW - 100, { endMs: NOW })], NOW)).toEqual([]);
});

test("forecast cards group expected updates and retain estimate ranges", () => {
  const prediction = { bannerId: 1, expectedMs: NOW + 1000, p05Ms: NOW - 1000, p95Ms: NOW + 5000, confidence: null, confidenceToleranceDays: 7, intervalCoverage: .9, calibrationSamples: 20, method: "recent-lag" as const, explanation: "", glBatchIndex: 1, glBatchStartMs: NOW + 1000 };
  const a = banner(1, "JP", NOW - 100, { prediction });
  const b = banner(2, "JP", NOW - 100, { prediction: { ...prediction, bannerId: 2 } });
  const scheduled = banner(3, "JP", NOW - 100, { prediction: { ...prediction, method: "scheduled", source: "official", expectedMs: NOW + 5000 } });
  const cards = forecastNews([scheduled, a, b, { ...a, id: 4, confirmedGlStartMs: NOW }, { ...a, id: 5, evergreen: true }], NOW);
  expect(cards).toHaveLength(2);
  expect(cards[0].names).toBe("Student 1 · Student 2");
  expect(cards[0].dates).toContain("Estimated range");
  expect(cards[0].kind).toBe("forecast");
  expect(cards[1].kind).toBe("scheduled");
  expect(cards[1].label).toBe("Global · Confirmed");
  expect(cards[1].dates).toContain("Confirmed");
  expect(cards[1].dates).not.toContain("Estimated");
  expect(forecastNews([{ ...a, prediction: { ...prediction, expectedMs: NOW } }], NOW)).toEqual([]);
});
