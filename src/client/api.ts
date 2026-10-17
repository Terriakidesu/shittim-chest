/**
 * Static data layer for the serverless client.
 *
 * The full-stack app fetched these shapes from `/api/*` on a Bun server.
 * Here the same shapes are read from JSON snapshots written by
 * `scripts/export.ts` into `public/data/`, and every artwork URL is a
 * relative local path under `public/img/`. No network host besides the
 * static file host is ever contacted (external links in credits excluded).
 */

import { SCHOOL_EMBLEMS } from "../model/config";

export type Server = "JP" | "GL";
export type CharacterAvailability = "permanent" | "limited" | "event";

/** Prefix a site-relative path with the Vite base (repo subpath aware). */
export const asset = (path: string) => {
  const base = import.meta.env.BASE_URL || "./";
  return `${base}${path}`;
};

export interface Character {
  id: number;
  name: string;
  school: string;
  starGrade: number;
  /** Local bundled headshot path (relative). */
  avatar: string;
  availability?: CharacterAvailability;
}

export interface Prediction {
  bannerId: number;
  expectedMs: number;
  p05Ms: number;
  p95Ms: number;
  confidence: number | null;
  confidenceToleranceDays: number;
  intervalCoverage: number;
  calibrationSamples: number;
  method: "recent-lag" | "lag-trend" | "alignment" | "scheduled";
  explanation: string;
  glBatchIndex: number | null;
  glBatchStartMs: number | null;
}

export interface Banner {
  id: number;
  server: Server;
  type: string;
  code: string | null;
  rerun: boolean;
  limited: boolean;
  evergreen: boolean;
  startMs: number;
  endMs: number;
  characters: Character[];
  /** Local bundled banner-art path (relative), or null. */
  imageUrl: string | null;
  confirmedGlStartMs: number | null;
  prediction: Prediction | null;
  forecastStatus: "arrived" | "scheduled" | "estimated" | "unresolved";
}

/** Exported by scripts/student-profiles.ts from wiki infoboxes and audio tables. */
export interface StudentProfile {
  tacticalRole: string;
  weaponType: string;
  birthday: string;
  voiceActor: string;
  recruitmentDialogue: string;
}

export interface CharacterRecord {
  id: number;
  name: string;
  pathName: string;
  school: string;
  club: string;
  starGrade: number;
  /** Local bundled portrait path (relative). */
  avatar: string;
  availability?: CharacterAvailability;
  releasedOn?: { jp: boolean; gl: boolean; kr: boolean };
  profile?: StudentProfile;
}

export interface Status {
  ok: boolean;
  staticSite: boolean;
  stale: boolean;
  dueForRefresh: boolean;
  refreshIntervalDays: number;
  dataAgeDays: number | null;
  /** When the snapshot was exported; the client derives data age from this. */
  exportedAtMs: number;
  sources: {
    key: string;
    label: string;
    fetchedAtMs: number;
    lastModified: string | null;
  }[];
  model: {
    currentLagDays: number | null;
    jpBatches: number;
    glBatches: number;
    absorption: number;
    residual: number;
    frontierJpBatch: number;
    frontierGlBatch: number;
    medianIntervalDays: number;
    matches: {
      total: number;
      code: number;
      rerunOrdinal: number;
      character: number;
      unmatched: number;
    };
    inFlight: number;
    unresolved: number;
    scheduled: number;
    calibrationRecords: number;
    preferredWeekdays: number[];
  } | null;
}

export interface ForecastResponse {
  currentLagDays: number | null;
  count: number;
  projectedBatches: { index: number; step: number; startMs: number }[];
  banners: Banner[];
  unresolvedBanners: Banner[];
}

interface Snapshot {
  status: Status;
  banners: Banner[];
  forecast: ForecastResponse;
  characters: CharacterRecord[];
}

let cached: Promise<Snapshot> | null = null;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(asset(path));
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  return (await res.json()) as T;
}

function loadAll(): Promise<Snapshot> {
  if (!cached) {
    cached = (async () => {
      const [status, banners, forecast, characters] = await Promise.all([
        get<Status>("data/status.json"),
        get<{ banners: Banner[]; count: number }>("data/banners.json"),
        get<ForecastResponse>("data/forecast.json"),
        get<{ characters: CharacterRecord[] }>("data/characters.json"),
      ]);
      return { status, banners: banners.banners, forecast, characters: characters.characters };
    })();
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}

export const api = {
  status: async () => (await loadAll()).status,
  banners: async (from: number, to: number) => {
    const all = (await loadAll()).banners;
    // Same window semantics as the server endpoint: anything still running
    // overlaps the window even if it started long ago.
    const banners = all.filter((b) => b.endMs >= from && b.startMs <= to);
    return { from, to, count: banners.length, banners };
  },
  forecast: async () => (await loadAll()).forecast,
  characters: async () => ({ characters: (await loadAll()).characters }),
  /** No server to trigger — drop the memory cache and re-read the files. */
  refresh: async () => {
    cached = null;
    await loadAll();
    return { ok: true as const };
  },
};

/**
 * Official school emblems, served from the local bundle. ETC and Sakugawa have
 * no emblem published on the wiki, so those return null and the caller falls
 * back to the school's colour. Filenames mirror the export mirror layout.
 */
export const SCHOOLS_WITH_EMBLEM = new Set(Object.keys(SCHOOL_EMBLEMS));

export const emblemUrl = (school: string) => {
  const file = SCHOOL_EMBLEMS[school];
  return file ? asset(`img/emblem/${file.toLowerCase()}`) : null;
};

/**
 * In-game school colours. These are close visual matches rather than exact
 * hexes lifted from the client — worth eyeballing against the game.
 */
export const SCHOOL_COLORS: Record<string, string> = {
  Gehenna: "#d3383e",
  Trinity: "#e0a83a",
  Millennium: "#2fb6c4",
  Abydos: "#efd03c",
  Shanhaijing: "#c648c0",
  Hyakkiyako: "#b4304a",
  RedWinter: "#8c3a4a",
  Arius: "#3f4463",
  SRT: "#6e7a3c",
  Valkyrie: "#2e6b78",
  WildHunt: "#b5651d",
  Highlander: "#aab3c0",
  Tokiwadai: "#7b4ea8",
  Odyssey: "#4a90d9",
  ETC: "#8e9aa8",
  Sakugawa: "#8e9aa8",
};

export const schoolColor = (school: string) =>
  SCHOOL_COLORS[school] ?? "#8e9aa8";
