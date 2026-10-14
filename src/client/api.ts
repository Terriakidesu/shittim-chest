export type Server = "JP" | "GL";
export type CharacterAvailability = "permanent" | "limited" | "event";

export interface Character {
  id: number;
  name: string;
  school: string;
  starGrade: number;
  /** Local cached portrait path. */
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
  imageUrl: string | null;
  confirmedGlStartMs: number | null;
  prediction: Prediction | null;
  forecastStatus: "arrived" | "scheduled" | "estimated" | "unresolved";
}

export interface CharacterRecord {
  id: number;
  name: string;
  pathName: string;
  school: string;
  club: string;
  starGrade: number;
  avatar: string;
  availability?: CharacterAvailability;
  releasedOn?: { jp: boolean; gl: boolean; kr: boolean };
}

export interface Status {
  ok: boolean;
  stale: boolean;
  dueForRefresh: boolean;
  refreshIntervalDays: number;
  dataAgeDays: number | null;
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

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export const api = {
  status: () => get<Status>("/api/status"),
  banners: (from: number, to: number) =>
    get<{ banners: Banner[]; count: number }>(
      `/api/banners?from=${from}&to=${to}`,
    ),
  forecast: () => get<ForecastResponse>("/api/forecast"),
  characters: () => get<{ characters: CharacterRecord[] }>("/api/characters"),
  refresh: async () => {
    const res = await fetch("/api/refresh", { method: "POST" });
    return (await res.json()) as { ok: boolean; error?: string };
  },
};

/** SchaleDB upstream, used only as a fallback if the local cache misses. */
export const upstreamAvatar = (id: number) =>
  `https://schaledb.com/images/student/icon/${id}.webp`;

/**
 * Official school emblems, served from the local cache. ETC and Sakugawa have
 * no emblem published on the wiki, so those return null and the caller falls
 * back to the school's colour.
 */
export const SCHOOLS_WITH_EMBLEM = new Set([
  "Gehenna", "Trinity", "Millennium", "Abydos", "Shanhaijing", "Hyakkiyako",
  "RedWinter", "Arius", "SRT", "Valkyrie", "WildHunt", "Highlander",
  "Tokiwadai", "Odyssey",
]);

export const emblemUrl = (school: string) =>
  SCHOOLS_WITH_EMBLEM.has(school)
    ? `/api/img/emblem/${school.toLowerCase()}`
    : null;

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
