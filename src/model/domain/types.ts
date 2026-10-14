/**
 * Domain model. Everything upstream of this file deals in raw source shapes;
 * everything downstream deals in these types.
 */

import type { Server } from "../config";

export type BannerType =
  | "PickupGacha"
  | "LimitedGacha"
  | "FesGacha"
  | "SelectPickupGacha"
  | "SelectPickupFesGacha"
  | "Unknown";

export interface Banner {
  /** Per-server unique id assigned by the wiki. */
  id: number;
  server: Server;
  /** Cross-server key, e.g. `Kisaki_(Swimsuit)_release`. Null for legacy rows. */
  code: string | null;
  type: BannerType;
  /** Free-text rate-up characters, e.g. `Aru (New Year)`. */
  rateupRaw: string | null;
  /** Canonical SchaleDB character ids resolved from `rateupRaw`. */
  characterIds: number[];
  rerun: boolean;
  limited: boolean;
  /** Absolute instants (ms since epoch). */
  startMs: number;
  endMs: number;
  /**
   * The wiki parks evergreen "select pickup" banners at 2099-12-31. These are
   * always running and must not be treated as a normal timed banner.
   */
  evergreen: boolean;
  imageFile: string | null;
  nameJp: string | null;
  nameEn: string | null;
  notes: string | null;
}

export interface Character {
  id: number;
  pathName: string;
  nameEn: string;
  school: string;
  club: string;
  starGrade: number;
  collectionBg: string | null;
  /** SchaleDB's IsLimited classification: permanent, unique/limited, or event/welfare. */
  availability: "permanent" | "limited" | "event";
  releasedOn: { jp: boolean; gl: boolean; kr: boolean };
}

/**
 * A single server-side update ("patch"). Banners start on a handful of days
 * following a maintenance window, so we cluster them back into the update they
 * belong to — that is the unit the JP->Global alignment actually operates on.
 */
export interface Batch {
  server: Server;
  index: number;
  /** Earliest banner start in the batch. */
  startMs: number;
  /** Inclusive end of the batch window. */
  endMs: number;
  bannerIds: number[];
}

/** How a JP banner was tied to a Global banner. */
export type MatchMethod = "code" | "character" | "rerun-ordinal" | "none";

export interface Match {
  jpBannerId: number;
  glBannerId: number | null;
  /** 0..1 — how much we trust this pairing. */
  confidence: number;
  method: MatchMethod;
}

/** A JP batch mapped onto a Global batch by the isotonic alignment. */
export interface BatchPairing {
  jpBatchIndex: number;
  glBatchIndex: number;
  /** True when this pairing was observed in history. */
  observed: boolean;
  /** True when the Global batch is beyond our data and was projected. */
  projected?: boolean;
  lagDays: number | null;
}

export interface Prediction {
  bannerId: number;
  /** Projected Global start instant. */
  expectedMs: number;
  /** Uncertainty band, widening with distance from the frontier. */
  p05Ms: number;
  p95Ms: number;
  /** Historical probability of falling within ±7 days; null without enough data. */
  confidence: number | null;
  confidenceToleranceDays: number;
  intervalCoverage: number;
  calibrationSamples: number;
  method: "recent-lag" | "lag-trend" | "alignment" | "scheduled";
  explanation: string;
  /** Which Global batch we believe this lands in. */
  glBatchIndex: number | null;
  glBatchStartMs: number | null;
}

export interface ForecastRow extends Banner {
  characters: Character[];
  /** Present once the banner has actually landed on Global. */
  actualGlStartMs: number | null;
  prediction: Prediction | null;
}

export const isEvergreen = (endMs: number, startMs: number) =>
  endMs - startMs > 365 * 24 * 3600 * 1000;
