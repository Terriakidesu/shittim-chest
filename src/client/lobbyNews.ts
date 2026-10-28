import { localeFor, getLanguage } from "./i18n";
import type { Banner, Character, Server } from "./api";

/**
 * Raw news data. Localization happens at render time in `LobbyNews.tsx` so a
 * language switch never needs to re-derive the items. `server` is the picture
 * label, `students` the deduped featured students (with the per-banner rerun
 * flag), and the timestamps carry the dates the formatter renders.
 */
export interface LobbyNewsItem {
  /** Dedupe key (`GL`, `JP`, or `<kind>:<expectedMs>`), kept from the old shape. */
  key: string;
  kind: "live" | "upcoming" | "past" | "forecast" | "scheduled";
  server: Server | null;
  /** `scheduled` items only: announced officially vs. recorded on the wiki. */
  official: boolean;
  students: { student: Character; rerun: boolean }[];
  /** Live / upcoming / past windows. */
  startMs?: number;
  endMs?: number;
  /** Forecast / scheduled items. */
  expectedMs?: number;
  lowerMs?: number;
  upperMs?: number;
  /**
   * Every banner in the batch is a hand-kept announcement the wiki has not
   * recorded yet. Shape stays `upcoming` so the window formatter applies.
   */
  announced?: boolean;
}
export interface BannerHeads { server: Server; students: Character[]; }

function usable(banner: Banner) {
  return !banner.evergreen && Number.isFinite(banner.startMs) && Number.isFinite(banner.endMs) && banner.characters.length > 0;
}

/** Snapshot dates are schedule dates, never claimed to be ingestion dates. */
export function latestBannerNews(banners: Banner[], nowMs = Date.now()): LobbyNewsItem[] {
  return (["GL", "JP"] as const).flatMap((server) => {
    const all = banners.filter((banner) => banner.server === server && usable(banner));
    const live = all.filter((banner) => banner.startMs <= nowMs && banner.endMs > nowMs);
    const upcoming = all.filter((banner) => banner.startMs > nowMs);
    const candidates = live.length ? live : upcoming.length ? upcoming : all;
    const start = candidates.reduce((best, banner) => upcoming.length && !live.length ? Math.min(best, banner.startMs) : Math.max(best, banner.startMs), upcoming.length && !live.length ? Infinity : -Infinity);
    if (!Number.isFinite(start)) return [];
    const batch = candidates.filter((banner) => banner.startMs === start);
    const kind = live.length ? "live" : upcoming.length ? "upcoming" : "past";
    return [{
      key: server,
      kind,
      server,
      official: false,
      // Only an announcement that has not opened yet is *announced*. Once the
      // batch starts the card is live, even while its pool is still a
      // placeholder from the announced table.
      announced: start > nowMs && batch.every((banner) => banner.provisional === true),
      students: dedupeStudents(batch),
      startMs: start,
      endMs: Math.max(...batch.map((banner) => banner.endMs)),
    }];
  });
}

/** The next three projected updates, with uncertainty kept distinct from schedules. */
export function forecastNews(banners: Banner[], nowMs = Date.now()): LobbyNewsItem[] {
  const groups = new Map<string, Banner[]>();
  for (const banner of banners) {
    const p = banner.prediction;
    if (banner.server !== "JP" || !usable(banner) || !p || banner.confirmedGlStartMs != null || p.expectedMs <= nowMs || ![p.expectedMs, p.p05Ms, p.p95Ms].every(Number.isFinite)) continue;
    const key = `${p.method === "scheduled" ? "scheduled" : "forecast"}:${p.expectedMs}`;
    groups.set(key, [...(groups.get(key) ?? []), banner]);
  }
  return [...groups.entries()].sort(([, a], [, b]) => a[0].prediction!.expectedMs - b[0].prediction!.expectedMs).slice(0, 3).map(([key, batch]) => {
    const prediction = batch[0].prediction!;
    const scheduled = prediction.method === "scheduled";
    return {
      key,
      kind: scheduled ? "scheduled" as const : "forecast" as const,
      server: "JP" as Server,
      official: scheduled && prediction.source === "official",
      students: dedupeStudents(batch),
      expectedMs: prediction.expectedMs,
      lowerMs: Math.min(...batch.map((banner) => banner.prediction!.p05Ms)),
      upperMs: Math.max(...batch.map((banner) => banner.prediction!.p95Ms)),
    };
  });
}

/**
 * Hand-kept announcements the snapshot already carries, one item per JP start
 * day. `latestBannerNews` deliberately prefers what is *running*, so a pickup
 * announced for tomorrow would otherwise never reach the strip.
 *
 * Rows that have already opened are skipped: `latestBannerNews` reports them as
 * live, and a second card for the same batch would just repeat it. That case is
 * routine now that the wiki records a batch hours before SchaleDB publishes the
 * student — the banner is real and running while its pool is still a
 * placeholder.
 */
export function announcedNews(banners: Banner[], nowMs = Date.now()): LobbyNewsItem[] {
  const groups = new Map<string, Banner[]>();
  for (const banner of banners) {
    if (banner.provisional !== true || !usable(banner) || banner.startMs <= nowMs || banner.endMs <= nowMs) continue;
    const key = `announced:${banner.server}:${banner.startMs}`;
    groups.set(key, [...(groups.get(key) ?? []), banner]);
  }
  return [...groups.entries()]
    .sort(([, a], [, b]) => a[0].startMs - b[0].startMs)
    .map(([key, batch]) => ({
      key,
      kind: "upcoming" as const,
      server: batch[0].server,
      official: false,
      announced: true,
      students: dedupeStudents(batch),
      startMs: batch[0].startMs,
      endMs: Math.max(...batch.map((banner) => banner.endMs)),
    }));
}

/* Strip order: a fresh announcement outranks a running period, and a concrete
   window always outranks a projection. */
const KIND_RANK: Record<LobbyNewsItem["kind"], number> = { upcoming: 1, live: 2, scheduled: 3, forecast: 4, past: 5 };

/** The three updates the lobby shows: announcement, what runs, what is expected. */
export function topUpdates(items: LobbyNewsItem[], limit = 3): LobbyNewsItem[] {
  return [...items]
    .sort((a, b) => (a.announced ? 0 : KIND_RANK[a.kind]) - (b.announced ? 0 : KIND_RANK[b.kind]) || when(a) - when(b))
    .slice(0, limit);
}

/** Soonest first: a live period by when it ends, everything else by its date. */
function when(item: LobbyNewsItem) {
  return (item.kind === "live" ? item.endMs : item.expectedMs ?? item.startMs) ?? 0;
}

export function currentBannerHeads(banners: Banner[], nowMs = Date.now()): BannerHeads[] {
  return (["GL", "JP"] as const).map((server) => {
    const running = banners.filter((banner) => banner.server === server && usable(banner) && banner.startMs <= nowMs && banner.endMs > nowMs)
      .sort((a, b) => Number(a.rerun) - Number(b.rerun) || b.startMs - a.startMs || a.id - b.id);
    const students = [...new Map(running.flatMap((banner) => banner.characters).map((student) => [student.id, student])).values()].slice(0, 2);
    return { server, students };
  }).filter((group) => group.students.length);
}

/** Snapshot export time as a localized string; null keeps the generic note. */
export function newsUpdateLabel(updatedMs: number | null) {
  return updatedMs != null && Number.isFinite(updatedMs)
    ? new Intl.DateTimeFormat(localeFor(getLanguage()), { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(updatedMs)
    : null;
}

/* Rendering-time formatters (locale follows the interface language). */

const dateCase = () => new Intl.DateTimeFormat(localeFor(getLanguage()), { month: "short", day: "numeric", year: "numeric" });

export function newsDateRange(startMs: number, endMs: number): string {
  return dateCase().formatRange(startMs, Math.max(startMs, endMs));
}

export function newsDate(ms: number): string {
  return dateCase().format(ms);
}

/** Featured students deduped by id, keeping each banner's rerun flag. */
function dedupeStudents(batch: Banner[]) {
  return [...new Map(
    batch.flatMap((banner) => banner.characters.map((student) => [student.id, { student, rerun: banner.rerun }] as const)),
  ).values()];
}
