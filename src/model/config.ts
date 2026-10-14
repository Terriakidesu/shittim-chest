/**
 * Central configuration. Every value can be overridden via environment so the
 * app can be deployed without a rebuild.
 */

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Wiki pages are stable; only the year subpages change over time. */
export const WIKI_BASE =
  "https://bluearchive.wiki/w/index.php";

/** Scriptable endpoint on the same wiki, for structured queries. */
export const WIKI_API = "https://bluearchive.wiki/w/api.php";

export const SCHALEDB_BASE = "https://schaledb.com/data";

/** The wiki keeps full banner history in yearly subpages, per server. */
export const WIKI_PAGES: { server: "JP" | "GL"; title: string }[] = [
  ...[2021, 2022, 2023, 2024, 2025, 2026, 2027].map((year) => ({
    server: "JP" as const,
    title: `Banner List/Banners_of_${year}`,
  })),
  ...[2021, 2022, 2023, 2024, 2025, 2026, 2027].map((year) => ({
    server: "GL" as const,
    title: `Banner List (Global)/Banners_of_${year}`,
  })),
];

/** SchaleDB per-server student dumps. `en` is the Global server. */
export const SCHALEDB_SERVERS = ["jp", "en", "kr"] as const;

export const CONFIG = {
  /** Banner runs come and go on a 7-14 day cycle; daily polling is waste. */
  refreshIntervalDays: num(process.env.REFRESH_INTERVAL_DAYS, 7),

  port: num(process.env.PORT, 3001),
  host: process.env.HOST ?? "localhost",

  dbPath: process.env.DB_PATH ?? "data/calendar.db",
  /** Committed snapshots keep backtests reproducible. */
  snapshotDir: process.env.SNAPSHOT_DIR ?? "data/snapshots",
  /** Local mirror for avatar, banner and mascot art. */
  imageCacheDir: process.env.IMAGE_CACHE_DIR ?? "data/img-cache",

  /** How many days of the future to project. */
  forecastHorizonDays: num(process.env.FORECAST_HORIZON_DAYS, 240),

  /**
   * The wiki timestamps BOTH servers at +09:00, but Global's game clock is
   * genuinely UTC — `11:00+09` on a Global row means `02:00 UTC`. Everything is
   * stored and computed as absolute instants; the client renders each server in
   * whichever zone the reader picks.
   */

  /** Banner and mascot artwork, hotlinked from the wiki. */
  art: {
    bannerImage: (file: string) =>
      `https://bluearchive.wiki/wiki/Special:Redirect/file/${encodeURIComponent(file)}`,
  },

  userAgent: "blue-archive-gacha-calendar/0.1 (https://github.com/; personal project)",
} as const;

/**
 * Official school emblems on the wiki, named after the school. Filenames are
 * inconsistent — Red Winter and Wild Hunt use different casing — and ETC and
 * Sakugawa have no emblem published at all, so those two fall back to the
 * colour dot.
 */
export const SCHOOL_EMBLEMS: Record<string, string> = {
  Gehenna: "Gehenna.png",
  Trinity: "Trinity.png",
  Millennium: "Millennium.png",
  Abydos: "Abydos.png",
  Shanhaijing: "Shanhaijing.png",
  Hyakkiyako: "Hyakkiyako.png",
  RedWinter: "Red_Winter.png",
  Arius: "Arius.png",
  SRT: "SRT.png",
  Valkyrie: "Valkyrie.png",
  WildHunt: "Wildhunt.png",
  Highlander: "Highlander.png",
  Tokiwadai: "Tokiwadai.png",
  Odyssey: "Odyssey.png",
};

export type Server = "JP" | "GL";