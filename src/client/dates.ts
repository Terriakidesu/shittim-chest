import { getLanguage, localeFor } from "./i18n";

export type TimeZone = "local" | "Asia/Tokyo" | "UTC";

export const ZONES: { id: TimeZone; label: string }[] = [
  { id: "local", label: "Your time" },
  { id: "Asia/Tokyo", label: "JST" },
  { id: "UTC", label: "UTC" },
];

export function resolveZone(zone: TimeZone): string {
  if (zone === "local") {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  }
  return zone;
}

/** `YYYY-MM-DD` for an instant, in the given zone. */
export function dayKey(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/** Day key shifted by whole days, staying correct across DST boundaries. */
export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate(),
  ).padStart(2, "0")}`;
}

export function keyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function todayKey(tz: string): string {
  return dayKey(Date.now(), tz);
}

export function monthKey(key: string): string {
  return key.slice(0, 7);
}

/** Weekday index (0 = Sunday) for a day key. */
export function weekday(key: string): number {
  return keyToDate(key).getUTCDay();
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export interface GridCell {
  key: string;
  day: number;
  inMonth: boolean;
}

/** Monday-first month grid, padded with neighbouring days. */
export function monthGrid(year: number, month: number): GridCell[] {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const lead = (weekday(first) + 6) % 7; // Monday-first offset
  const total = daysInMonth(year, month);
  const cells: GridCell[] = [];
  for (let i = -lead; i < total; i++) {
    const key = addDays(first, i);
    cells.push({
      key,
      day: Number(key.slice(8, 10)),
      inMonth: key.slice(0, 7) === monthKey(first),
    });
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1];
    const key = addDays(last.key, 1);
    cells.push({ key, day: Number(key.slice(8, 10)), inMonth: false });
  }
  return cells;
}

/**
 * Localized month heading, e.g. "October 2026" / "2026年10月" / "2026년 10월".
 * Pure display: internal keys (`YYYY-MM-DD`) stay locale-independent.
 */
export function formatMonthHeading(year: number, month: number): string {
  return new Intl.DateTimeFormat(localeFor(getLanguage()), {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

export function formatDay(ms: number, tz: string): string {
  return new Intl.DateTimeFormat(localeFor(getLanguage()), {
    timeZone: tz,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(ms));
}

export function formatShort(ms: number, tz: string): string {
  return new Intl.DateTimeFormat(localeFor(getLanguage()), {
    timeZone: tz,
    day: "2-digit",
    month: "short",
  }).format(new Date(ms));
}

export function formatClock(ms: number, tz: string): string {
  return new Intl.DateTimeFormat(localeFor(getLanguage()), {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}