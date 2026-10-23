import type { Character, Server } from "./api";
import type { RecruitmentPeriod } from "./gachaRules";
import { getLanguage, localeFor, studentName, t, type LangKey } from "./i18n";

/**
 * Raw picker options. Strings are derived at render time (`periodDates`,
 * `periodNames`, `periodDetail`, `periodSummary`) so a language switch only
 * needs a re-render — memoized formatted strings would go stale.
 */
export interface PeriodOption {
  value: string;
  year: number;
  server: Server;
  bannerCount: number;
  startMs: number;
  endMs: number;
  students: Character[];
}

export function periodOption(period: RecruitmentPeriod): PeriodOption {
  return {
    value: period.key,
    year: new Date(period.startMs).getFullYear(),
    server: period.server,
    bannerCount: period.banners.length,
    startMs: period.startMs,
    endMs: period.endMs,
    students: [...new Map(period.banners.flatMap((banner) => banner.characters).map((student) => [student.id, student])).values()],
  };
}

const SERVER_KEYS: Record<Server, LangKey> = { GL: "sim.server.global", JP: "sim.server.japan" };

/** Full window ("Oct 7, 2026 — Oct 21, 2026") and the compact range. */
export function periodDates(option: PeriodOption): { full: string; short: string } {
  const format = new Intl.DateTimeFormat(localeFor(getLanguage()), { month: "short", day: "numeric", year: "numeric" });
  return {
    full: `${format.format(option.startMs)} — ${format.format(option.endMs)}`,
    short: format.formatRange(option.startMs, option.endMs),
  };
}

/** Localized featured names, " / "-joined, or the unnamed fallback. */
export function periodNames(option: PeriodOption): string {
  const named = option.students.map(studentName);
  return named.join(" / ") || t("period.unnamed");
}

/** "2 banners · Japan" — banner count plus server name. */
export function periodDetail(option: PeriodOption): string {
  return `${t(option.bannerCount === 1 ? "period.banners1" : "period.bannersMany", { n: option.bannerCount })} · ${t(SERVER_KEYS[option.server])}`;
}

/** First student plus "+n more", matching the compact list presentation. */
export function periodSummary(option: PeriodOption): string {
  const [first] = option.students;
  return first
    ? `${studentName(first)}${option.students.length > 1 ? t("period.more", { n: option.students.length - 1 }) : ""}`
    : periodNames(option);
}

/** What the search box matches against: names, dates, and server words. */
export function filterPeriods(options: PeriodOption[], query: string, year: string) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return options.filter((option) => (!year || String(option.year) === year) && words.every((word) => searchable(option).toLocaleLowerCase().includes(word)));
}

function searchable(option: PeriodOption) {
  return `${periodNames(option)} ${periodSummary(option)} ${periodDates(option).full} ${periodDetail(option)}`;
}
