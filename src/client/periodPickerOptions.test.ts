import { expect, test } from "bun:test";
import type { Banner } from "./api";
import { buildRecruitmentPeriods } from "./gachaRules";
import { filterPeriods, periodOption, periodSummary, type PeriodOption } from "./periodPickerOptions";

const options: PeriodOption[] = [
  { value: "a", dates: "Oct 7, 2026 — Oct 21, 2026", shortDates: "Oct 7–21, 2026", year: 2026, names: "Tsumugi / Eri", detail: "2 banners · Japan", students: [{ id: 1, name: "Tsumugi" }, { id: 2, name: "Eri" }] },
  { value: "b", dates: "Sep 1, 2025 — Sep 15, 2025", shortDates: "Sep 1–15, 2025", year: 2025, names: "Miyako (Swimsuit)", detail: "1 banner · Global", students: [{ id: 3, name: "Miyako (Swimsuit)" }] },
];

test("archive filters combine year and case-insensitive search terms", () => {
  expect(filterPeriods(options, "  TSUMUGI  2026 ", "2026")).toEqual([options[0]]);
  expect(filterPeriods(options, "swimsuit Miyako", "")).toEqual([options[1]]);
  expect(filterPeriods(options, "Tsumugi", "2025")).toEqual([]);
  expect(filterPeriods(options, "", "2025")).toEqual([options[1]]);
  expect(filterPeriods(options, "", "")).toEqual(options);
});

test("closed archive picker summarizes rather than listing every student", () => {
  expect(periodSummary(options[0])).toBe("Tsumugi +1 more");
  expect(periodSummary(options[1])).toBe("Miyako (Swimsuit)");
  expect(periodSummary({ ...options[0], names: "Unnamed pick-up", students: [] })).toBe("Unnamed pick-up");
});

test("archive options deduplicate portraits and format cross-year periods", () => {
  const banner: Banner = { id: 1, server: "JP", type: "PickupGacha", code: "test", rerun: false, limited: false, evergreen: false, startMs: Date.UTC(2025, 11, 25, 12), endMs: Date.UTC(2026, 0, 8, 12), characters: [{ id: 1, name: "Tsumugi", starGrade: 3, school: "Wildhunt", avatar: "" }], imageUrl: null, confirmedGlStartMs: null, prediction: null, forecastStatus: "arrived" };
  const period = buildRecruitmentPeriods([banner, { ...banner, id: 2 }], "JP")[0];
  const option = periodOption(period);
  expect(option.year).toBe(2025);
  expect(option.shortDates).toContain("2025");
  expect(option.shortDates).toContain("2026");
  expect(option.students).toEqual([{ id: 1, name: "Tsumugi" }]);
  expect(option.detail).toBe("2 banners · Japan");
});
