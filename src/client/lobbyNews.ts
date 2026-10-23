import type { Banner, Character, Server } from "./api";

export interface LobbyNewsItem {
  key: string;
  label: string;
  names: string;
  dates: string;
  kind: "live" | "upcoming" | "past" | "forecast" | "scheduled";
}
export interface BannerHeads { server: Server; students: Character[]; }

const dateFormat = () => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
function dateRange(start: number, end: number) {
  return dateFormat().formatRange(start, Math.max(start, end));
}
function studentNames(banners: Banner[]) {
  return [...new Map(banners.flatMap((banner) => banner.characters.map((student) => [student.id, `${student.name}${banner.rerun ? " (rerun)" : ""}`] as const))).values()].join(" · ");
}
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
    return [{ key: server, label: `${server === "JP" ? "Japan" : "Global"} · ${kind === "live" ? "Live" : kind === "upcoming" ? "Upcoming" : "Latest recorded"}`, names: studentNames(batch), dates: dateRange(start, Math.max(...batch.map((banner) => banner.endMs))), kind }];
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
    const official = scheduled && prediction.source === "official";
    const lower = Math.min(...batch.map((banner) => banner.prediction!.p05Ms));
    const upper = Math.max(...batch.map((banner) => banner.prediction!.p95Ms));
    return { key, label: `Global · ${official ? "Confirmed" : scheduled ? "Scheduled" : "Forecast"}`, names: studentNames(batch), dates: official ? `Confirmed ${dateFormat().format(prediction.expectedMs)}` : scheduled ? `Scheduled ${dateFormat().format(prediction.expectedMs)}` : `Expected ${dateFormat().format(prediction.expectedMs)} · Estimated range ${dateRange(lower, upper)}`, kind: scheduled ? "scheduled" : "forecast" };
  });
}

export function currentBannerHeads(banners: Banner[], nowMs = Date.now()): BannerHeads[] {
  return (["GL", "JP"] as const).map((server) => {
    const running = banners.filter((banner) => banner.server === server && usable(banner) && banner.startMs <= nowMs && banner.endMs > nowMs)
      .sort((a, b) => Number(a.rerun) - Number(b.rerun) || b.startMs - a.startMs || a.id - b.id);
    const students = [...new Map(running.flatMap((banner) => banner.characters).map((student) => [student.id, student])).values()].slice(0, 2);
    return { server, students };
  }).filter((group) => group.students.length);
}

export function newsUpdateLabel(updatedMs: number | null) {
  return updatedMs != null && Number.isFinite(updatedMs)
    ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(updatedMs)
    : null;
}
