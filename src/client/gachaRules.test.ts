import { describe, expect, test } from "bun:test";
import type { Banner, CharacterRecord } from "./api";
import {
  buildRecruitmentPeriods,
  buildRecruitmentPool,
  buildStudentPool,
  makeInitialState,
  resolvePulls,
} from "./gachaRules";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1);

function student(id: number, starGrade = 3, over: Partial<CharacterRecord> = {}): CharacterRecord {
  return {
    id,
    name: `Student ${id}`,
    pathName: `student-${id}`,
    school: "Millennium",
    club: "",
    starGrade,
    avatar: `img/portrait/${id}.webp`,
    ...over,
  };
}

function banner(id: number, startMs: number, over: Partial<Banner> = {}): Banner {
  return {
    id,
    server: "JP",
    type: "PickupGacha",
    code: `student-${id}`,
    rerun: false,
    limited: false,
    evergreen: false,
    startMs,
    endMs: startMs + 7 * DAY,
    characters: [student(id)],
    imageUrl: null,
    confirmedGlStartMs: null,
    prediction: null,
    forecastStatus: "arrived",
    ...over,
  };
}

describe("recruitment period selection", () => {
  // Mirrors the reported case: a snapshot that already lists an announced
  // future banner. Oct 15 2026, with a rerun announced for Oct 21.
  const NOW = Date.UTC(2026, 9, 15);
  const FUTURE = Date.UTC(2026, 9, 21);
  const RUNNING = Date.UTC(2026, 9, 7);

  test("hides banners that have not started yet", () => {
    const running = banner(1, RUNNING);
    const announced = banner(2, FUTURE);
    const periods = buildRecruitmentPeriods([running, announced], "JP", NOW);
    expect(periods.map((period) => period.startMs)).toEqual([RUNNING]);
  });

  test("keeps a banner that is running right now", () => {
    expect(buildRecruitmentPeriods([banner(1, RUNNING)], "JP", NOW)).toHaveLength(1);
  });

  test("hides a future banner on either server, not just JP", () => {
    const futureGl = banner(3, FUTURE, { server: "GL" });
    const pastGl = banner(4, RUNNING, { server: "GL" });
    expect(buildRecruitmentPeriods([futureGl, pastGl], "GL", NOW).map((period) => period.startMs)).toEqual([RUNNING]);
  });

  test("still excludes a student whose only banner has not started", () => {
    // Only the picker is filtered. buildStudentPool still receives the full
    // banner list, so a later debut still supplies a first-seen date and
    // cannot leak backwards into an earlier period.
    const period = buildRecruitmentPeriods([banner(6, RUNNING)], "JP", NOW)[0];
    const debutingLater = student(1, 3, { releasedOn: { jp: false, gl: false, kr: false } });
    const pool = buildStudentPool(
      [debutingLater],
      [banner(5, FUTURE, { characters: [debutingLater] }), banner(6, RUNNING)],
      period,
      6,
    );
    expect(pool.some((entry) => entry.id === debutingLater.id)).toBe(false);
  });
});

describe("historical recruitment pools", () => {
  test("excludes unreleased server students and future dated debuts", () => {
    const launch = student(1, 3, { releasedOn: { jp: true, gl: true, kr: true } });
    const unlistedLaunch = student(4, 2, { releasedOn: { jp: true, gl: true, kr: true } });
    const futureGlobal = student(2, 3, { releasedOn: { jp: false, gl: false, kr: false } });
    const futureJapan = student(3, 3, { releasedOn: { jp: true, gl: false, kr: false } });
    const oldGlobal = banner(10, T0, { server: "GL", characters: [launch] });
    const futureGlobalBanner = banner(11, T0 + DAY, { server: "GL", characters: [futureGlobal] });
    const oldJapan = banner(20, T0, { characters: [launch] });
    const futureJapanBanner = banner(21, T0 + DAY, { characters: [futureJapan] });
    const all = [launch, unlistedLaunch, futureGlobal, futureJapan];

    const globalPeriod = buildRecruitmentPeriods([oldGlobal, futureGlobalBanner], "GL").find((period) => period.startMs === T0)!;
    const japanPeriod = buildRecruitmentPeriods([oldJapan, futureJapanBanner], "JP").find((period) => period.startMs === T0)!;

    expect(buildStudentPool(all, [oldGlobal, futureGlobalBanner], globalPeriod, oldGlobal.id).map((candidate) => candidate.id).sort()).toEqual([1, 4]);
    expect(buildStudentPool(all, [oldJapan, futureJapanBanner], japanPeriod, oldJapan.id).map((candidate) => candidate.id).sort()).toEqual([1, 4]);
  });

  test("uses the documented Fes 6% table and keeps anniversary units off-rate", () => {
    const previousFes = student(20, 3, { availability: "limited" });
    const pickup = student(30, 3, { availability: "limited" });
    const regular3 = student(40);
    const regular2 = student(41, 2);
    const regular1 = student(42, 1);
    const seasonal = student(50, 3, { availability: "limited" });
    const history = banner(1, T0 - DAY, { type: "FesGacha", characters: [previousFes] });
    const current = banner(2, T0, { type: "FesGacha", characters: [pickup] });
    const seasonalBanner = banner(3, T0 - DAY, { type: "LimitedGacha", limited: true, characters: [seasonal] });
    const regularBanner = banner(4, T0, { characters: [regular3] });
    const periods = buildRecruitmentPeriods([history, current, seasonalBanner, regularBanner], "JP");
    const period = periods.find((candidate) => candidate.startMs === T0)!;
    const pool = buildRecruitmentPool([previousFes, pickup, regular3, regular2, regular1, seasonal], [history, current, seasonalBanner, regularBanner], period, current.id);

    expect(pool.entries.filter((entry) => entry.group === "pickup").map((entry) => entry.rate)).toEqual([0.7]);
    expect(pool.entries.filter((entry) => entry.group === "fes").map((entry) => entry.rate)).toEqual([0.9]);
    expect(pool.entries.find((entry) => entry.student.id === regular3.id)?.rate).toBeCloseTo(4.4);
    expect(pool.entries.find((entry) => entry.student.id === regular2.id)?.rate).toBeCloseTo(18.5);
    expect(pool.entries.find((entry) => entry.student.id === regular1.id)?.rate).toBeCloseTo(75.5);
    expect(pool.entries.some((entry) => entry.student.id === seasonal.id)).toBe(false);
    expect(pool.entries.reduce((sum, entry) => sum + entry.rate, 0)).toBeCloseTo(100);

    const outcome = resolvePulls(
      makeInitialState(period, current.id, "spark"),
      { period, banner: current, pool: pool.students, recruitmentPool: pool },
      1,
      "pyroxene",
      () => 0,
    );
    expect(outcome.results[0].student.id).toBe(pickup.id);
    expect(outcome.results[0].featured).toBe(true);
  });

  test("keeps a 2-star pickup in the pickup group at its boosted rate", () => {
    const pickup = student(1, 2);
    const regular3 = student(2, 3);
    const regular2 = student(3, 2);
    const regular1 = student(4, 1);
    const selected = banner(1, T0, { characters: [pickup] });
    const period = buildRecruitmentPeriods([selected], "JP")[0];
    const pool = buildRecruitmentPool([pickup, regular3, regular2, regular1], [selected], period, selected.id);

    expect(pool.entries.find((entry) => entry.student.id === pickup.id)).toMatchObject({ group: "pickup", rarity: 2, rate: 3 });
    expect(pool.entries.find((entry) => entry.student.id === regular2.id)?.rate).toBeCloseTo(15.5);
    expect(pool.entries.reduce((sum, entry) => sum + entry.rate, 0)).toBeCloseTo(100);
  });

  test("keeps Recollection/archive students out of the ordinary Fes group", () => {
    const fesStudent = student(1, 3, { availability: "limited" });
    const archiveStudent = student(2, 3, { availability: "limited" });
    const regular3 = student(3, 3);
    const regular2 = student(4, 2);
    const regular1 = student(5, 1);
    const fes = banner(1, T0 - DAY, { type: "FesGacha", characters: [fesStudent] });
    const archive = banner(2, T0, { type: "SelectPickupFesGacha", characters: [archiveStudent] });
    const standard = banner(3, T0, { characters: [regular3] });
    const period = buildRecruitmentPeriods([fes, archive, standard], "JP").find((candidate) => candidate.startMs === T0)!;
    const pool = buildRecruitmentPool([fesStudent, archiveStudent, regular3, regular2, regular1], [fes, archive, standard], period, archive.id);

    expect(pool.isFes).toBe(false);
    expect(pool.entries.some((entry) => entry.group === "fes")).toBe(false);
    expect(pool.entries.find((entry) => entry.student.id === archiveStudent.id)).toMatchObject({ group: "pickup", rate: 0.7 });
    expect(pool.entries.some((entry) => entry.student.id === fesStudent.id)).toBe(false);
    expect(pool.entries.reduce((sum, entry) => sum + entry.rate, 0)).toBeCloseTo(100);
  });

  test("applies the ten-pull 2-star guarantee without changing the listed rates", () => {
    const students = [student(1), student(2, 2), student(3, 1)];
    const selected = banner(1, T0, { characters: [students[0]] });
    const period = buildRecruitmentPeriods([selected], "JP")[0];
    const pool = buildRecruitmentPool(students, [selected], period, selected.id);
    const context = { period, banner: selected, pool: pool.students, recruitmentPool: pool };
    const outcome = resolvePulls(makeInitialState(period, selected.id, "spark"), context, 10, "pyroxene", () => 0.999999);

    expect(outcome.results.slice(0, 9).every((result) => result.rarity === 1)).toBe(true);
    expect(outcome.results[9].rarity).toBeGreaterThanOrEqual(2);
    expect(outcome.results[9].forced).toBe("two-star");
  });
});
