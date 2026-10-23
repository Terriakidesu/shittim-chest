import type { Banner, Prediction } from "../src/model/domain/types";

export interface OfficialGlobalSchedule {
  jpCode: string;
  globalStartMs: number;
  explanation: string;
}

/** Dates confirmed by the official Blue Archive Global account on X/Twitter. */
export const OFFICIAL_GLOBAL_SCHEDULES: readonly OfficialGlobalSchedule[] = [
  "Hikari_rerun1",
  "Nozomi_rerun1",
  "Saori_(Swimsuit)_rerun2",
  "Hiyori_(Swimsuit)_rerun2",
  "Misaki_(Swimsuit)_rerun1",
].map((jpCode) => ({
  jpCode,
  globalStartMs: Date.UTC(2026, 9, 27, 2),
  explanation: "Confirmed in an official Blue Archive Global announcement on X/Twitter.",
}));

/** Replace model estimates when an official announcement supplies the date. */
export function applyOfficialGlobalSchedules(
  banners: Banner[],
  predictions: Map<number, Prediction>,
  confirmed: Map<number, Banner>,
) {
  for (const schedule of OFFICIAL_GLOBAL_SCHEDULES) {
    const jp = banners.find((banner) => banner.server === "JP" && banner.code === schedule.jpCode);
    if (!jp || confirmed.has(jp.id)) continue;
    const previous = predictions.get(jp.id);
    predictions.set(jp.id, {
      bannerId: jp.id,
      expectedMs: schedule.globalStartMs,
      p05Ms: schedule.globalStartMs,
      p95Ms: schedule.globalStartMs,
      confidence: null,
      confidenceToleranceDays: 7,
      intervalCoverage: 1,
      calibrationSamples: 0,
      method: "scheduled",
      source: "official",
      explanation: schedule.explanation,
      glBatchIndex: previous?.glBatchIndex ?? null,
      glBatchStartMs: schedule.globalStartMs,
    });
  }
}
