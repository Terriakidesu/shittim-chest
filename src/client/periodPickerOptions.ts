import type { RecruitmentPeriod } from "./gachaRules";

export interface PeriodOption {
  value: string;
  dates: string;
  shortDates: string;
  year: number;
  names: string;
  detail: string;
  students: { id: number; name: string }[];
}

export function periodOption(period: RecruitmentPeriod): PeriodOption {
  const students = [...new Map(period.banners.flatMap((banner) => banner.characters).map((student) => [student.id, { id: student.id, name: student.name }])).values()];
  const date = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
  return {
    value: period.key,
    dates: `${date.format(period.startMs)} — ${date.format(period.endMs)}`,
    shortDates: date.formatRange(period.startMs, period.endMs),
    year: new Date(period.startMs).getFullYear(),
    names: students.map((student) => student.name).join(" / ") || "Unnamed pick-up",
    detail: `${period.banners.length} banner${period.banners.length === 1 ? "" : "s"} · ${period.server === "GL" ? "Global" : "Japan"}`,
    students,
  };
}

export function filterPeriods(options: PeriodOption[], query: string, year: string) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return options.filter((option) => (!year || String(option.year) === year) && words.every((word) => `${option.dates} ${option.names} ${option.detail}`.toLocaleLowerCase().includes(word)));
}

export function periodSummary(option: PeriodOption) {
  return option.students.length ? `${option.students[0].name}${option.students.length > 1 ? ` +${option.students.length - 1} more` : ""}` : option.names;
}
