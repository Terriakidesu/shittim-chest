import { expect, test } from "bun:test";
import type { Banner, Character } from "./api";
import { setLanguage } from "./i18n";
import { buildRecruitmentPeriods } from "./gachaRules";
import { filterPeriods, periodDates, periodDetail, periodNames, periodOption, periodSummary, type PeriodOption } from "./periodPickerOptions";

const character = (id: number, name: string): Character => ({ id, name, school: "", starGrade: 3, avatar: "" });
const options: PeriodOption[] = [
  { value: "a", year: 2026, server: "JP", bannerCount: 2, startMs: Date.UTC(2026, 9, 7), endMs: Date.UTC(2026, 9, 21), students: [{ ...character(1, "Tsumugi"), nameJp: "ツムギ" }, character(2, "Eri")] },
  { value: "b", year: 2025, server: "GL", bannerCount: 1, startMs: Date.UTC(2025, 8, 1), endMs: Date.UTC(2025, 8, 15), students: [character(3, "Miyako (Swimsuit)")] },
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
  expect(periodSummary({ ...options[0], students: [] })).toBe(periodNames({ ...options[0], students: [] }));
});

test("derived strings carry names, dates and the server word in the active language", () => {
  expect(periodNames(options[0])).toBe("Tsumugi / Eri");
  expect(periodDetail(options[0])).toBe("2 banners · Japan");
  expect(periodDates(options[0]).full).toContain("2026");
  expect(periodDates(options[0]).short).toContain("Oct");
  // A language switch must change the derived strings (then restore English,
  // even on failure, so later tests don't inherit a switched language).
  try {
    setLanguage("ja");
    expect(periodDetail(options[0])).toBe("2 バナー · 日本版");
    expect(periodSummary(options[0])).toBe("ツムギ +他1人");
  } finally {
    setLanguage("en");
  }
  expect(periodDetail(options[0])).toBe("2 banners · Japan");
});

test("archive options deduplicate portraits and format cross-year periods", () => {
  const banner: Banner = { id: 1, server: "JP", type: "PickupGacha", code: "test", rerun: false, limited: false, evergreen: false, startMs: Date.UTC(2025, 11, 25, 12), endMs: Date.UTC(2026, 0, 8, 12), characters: [{ id: 1, name: "Tsumugi", starGrade: 3, school: "Wildhunt", avatar: "" }], imageUrl: null, confirmedGlStartMs: null, prediction: null, forecastStatus: "arrived" };
  const period = buildRecruitmentPeriods([banner, { ...banner, id: 2 }], "JP")[0];
  const option = periodOption(period);
  expect(option.year).toBe(2025);
  expect(periodDates(option).short).toContain("2025");
  expect(periodDates(option).short).toContain("2026");
  expect(option.students).toEqual([{ id: 1, name: "Tsumugi", starGrade: 3, school: "Wildhunt", avatar: "" }]);
  expect(periodDetail(option)).toContain("2 banner");
  expect(periodDetail(option)).toContain("Japan");
});
