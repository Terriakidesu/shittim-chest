import { expect, test } from "bun:test";
import type { Banner } from "./api";
import { currentBannerHeads, announcedNews, forecastNews, latestBannerNews, newsUpdateLabel, topUpdates } from "./lobbyNews";

const NOW = Date.UTC(2026, 9, 23);
function banner(id: number, server: "JP" | "GL", startMs: number, over: Partial<Banner> = {}): Banner {
  return { id, server, startMs, endMs: startMs + 14 * 86_400_000, type: "PickupGacha", code: null, rerun: false, limited: false, evergreen: false, characters: [{ id, name: `Student ${id}`, school: "", starGrade: 3, avatar: "" }], imageUrl: null, confirmedGlStartMs: null, prediction: null, forecastStatus: "arrived", ...over };
}

/** Items are raw data now; badge/names/dates strings are built at render in
    LobbyNews.tsx, so these tests assert the data a card renders from. */
test("news includes every banner in the latest period for each server", () => {
  const news = latestBannerNews([banner(1, "JP", NOW - 10), banner(2, "JP", NOW - 10, { rerun: true }), banner(3, "JP", NOW - 100), banner(4, "GL", NOW - 20)], NOW);
  expect(news).toHaveLength(2);
  expect(news[0].server).toBe("GL");
  expect(news[0].kind).toBe("live");
  expect(news[1].server).toBe("JP");
  expect(news[1].kind).toBe("live");
  expect(news[1].students.map(({ student, rerun }) => [student.id, rerun])).toEqual([[1, false], [2, true]]);
  expect(news[1].students.some(({ student }) => student.id === 3)).toBe(false);
});

test("upcoming schedules are labelled distinctly and archive/empty banners are excluded", () => {
  const news = latestBannerNews([banner(1, "JP", NOW + 100), banner(2, "JP", NOW + 200, { evergreen: true }), banner(3, "JP", NOW + 300, { characters: [] })], NOW);
  expect(news).toHaveLength(1);
  expect(news[0].kind).toBe("upcoming");
  expect(news[0].server).toBe("JP");
  expect(news[0].students.map(({ student }) => student.id)).toEqual([1]);
});

test("news deduplicates students and tolerates absent or invalid snapshot dates", () => {
  const item = banner(1, "JP", NOW);
  expect(latestBannerNews([item, { ...item, id: 2 }], NOW)[0].students).toHaveLength(1);
  expect(latestBannerNews([], NOW)).toEqual([]);
  expect(latestBannerNews([banner(1, "GL", NaN)], NOW)).toEqual([]);
  expect(newsUpdateLabel(null)).toBeNull();
  expect(newsUpdateLabel(NaN)).toBeNull();
  expect(newsUpdateLabel(NOW)).toContain("2026");
});

test("live banners take priority over announcements, with expired snapshots clearly marked", () => {
  const live = banner(1, "JP", NOW - 100);
  const future = banner(2, "JP", NOW + 100);
  expect(latestBannerNews([live, future], NOW)[0].students.map(({ student }) => student.id)).toEqual([1]);
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
  expect(cards[0].kind).toBe("forecast");
  expect(cards[0].students.map(({ student }) => student.id)).toEqual([1, 2]);
  expect(cards[0].expectedMs).toBe(NOW + 1000);
  expect(cards[0].lowerMs).toBe(NOW - 1000);
  expect(cards[0].upperMs).toBe(NOW + 5000);
  expect(cards[1].kind).toBe("scheduled");
  expect(cards[1].official).toBe(true);
  expect(cards[1].expectedMs).toBe(NOW + 5000);
  expect(forecastNews([{ ...a, prediction: { ...prediction, expectedMs: NOW } }], NOW)).toEqual([]);
});

test("a hand-kept announcement leads the strip while the server is still running a period", () => {
  const live = banner(1, "JP", NOW - 100);
  const announced = banner(-1, "JP", NOW + 100, { provisional: true });
  const items = topUpdates([...announcedNews([live, announced], NOW), ...latestBannerNews([live, announced], NOW)], 3);
  expect(items).toHaveLength(2);
  expect(items[0].announced).toBe(true);
  expect(items[0].kind).toBe("upcoming");
  expect(items[0].students.map(({ student }) => student.id)).toEqual([-1]);
  expect(items[1].kind).toBe("live");
  expect(items[1].students.map(({ student }) => student.id)).toEqual([1]);
  // Wiki rows and announcements whose window already closed stay out.
  expect(announcedNews([banner(2, "JP", NOW + 100)], NOW)).toEqual([]);
  expect(announcedNews([{ ...announced, endMs: NOW - 1 }], NOW)).toEqual([]);
});

test("a batch whose pool is still a placeholder turns live, not announced", () => {
  // The wiki records the banner hours before SchaleDB publishes the student, so
  // it runs with placeholder characters for a while. One card, labelled live.
  const running = banner(1080, "JP", NOW - 100, { provisional: true });
  expect(announcedNews([running], NOW)).toEqual([]);
  const [item] = latestBannerNews([running], NOW);
  expect(item.kind).toBe("live");
  expect(item.announced).toBe(false);
  expect(item.students.map(({ student }) => student.id)).toEqual([1080]);
});

test("the strip holds three updates and keeps projections behind real windows", () => {
  const prediction = { bannerId: 4, expectedMs: NOW + 900, p05Ms: NOW + 800, p95Ms: NOW + 1000, confidence: null, confidenceToleranceDays: 7, intervalCoverage: .9, calibrationSamples: 20, method: "recent-lag" as const, explanation: "", glBatchIndex: 1, glBatchStartMs: NOW + 900 };
  const jp = latestBannerNews([banner(1, "JP", NOW - 100)], NOW);
  const gl = latestBannerNews([banner(3, "GL", NOW - 100)], NOW);
  const forecast = forecastNews([banner(4, "JP", NOW - 100, { prediction })], NOW);
  const items = topUpdates([...forecast, ...jp, ...gl]);
  expect(items.map(({ kind }) => kind)).toEqual(["live", "live", "forecast"]);
  expect(topUpdates([...jp, ...gl], 1)).toHaveLength(1);
});
