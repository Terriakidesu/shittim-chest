import { buildBatches, indexBatches } from "./batches";
import { alignBatches, batchAnchors, median } from "./align";
import { matchBanners } from "./match";
import { fitCadence } from "./cadence";
import { buildForecastContext, predictBanner, FORECAST_METHODS, type CalibrationRecord } from "./forecast";
import type { Banner, Batch } from "./types";

const DAY = 86_400_000;

export function batchMap(batches: Batch[], server: "JP" | "GL") {
  return new Map(batches.filter(b => b.server === server).flatMap(b => b.bannerIds.map(id => [id, b.index] as const)));
}

/** Independent evaluation labels: only unique exact codes, never predicted indices. */
export function verifiedTruth(banners: Banner[]): Map<number, Banner> {
  const jp = new Map<string, Banner[]>();
  const gl = new Map<string, Banner[]>();
  for (const b of banners) {
    if (!b.code || b.evergreen) continue;
    const map = b.server === "JP" ? jp : gl;
    map.set(b.code, [...(map.get(b.code) ?? []), b]);
  }
  const truth = new Map<number, Banner>();
  for (const [code, js] of jp) {
    const gs = gl.get(code);
    if (js.length !== 1 || gs?.length !== 1) continue;
    if (gs[0].startMs <= js[0].startMs || gs[0].rerun !== js[0].rerun) continue;
    truth.set(js[0].id, gs[0]);
  }
  return truth;
}

export interface EvaluationSample extends CalibrationRecord {
  cutoffMs: number;
  bannerId: number;
  batch: number;
  truthMs: number;
  expectedMs: number;
  lowerMs: number;
  upperMs: number;
  horizonDays: number;
}

/** Training inputs are rebuilt from started banners; future dates are labels only. */
export function evaluateAt(banners: Banner[], cutoffMs: number, truth = verifiedTruth(banners), calibration: CalibrationRecord[] = []) {
  const known = banners.filter(b => b.startMs <= cutoffMs);
  const batches = buildBatches(known);
  const idx = indexBatches(batches);
  const jp = known.filter(b => b.server === "JP");
  const gl = known.filter(b => b.server === "GL");
  const matches = matchBanners(jp, gl);
  const jpMap = batchMap(batches, "JP");
  const alignment = alignBatches(idx.JP, idx.GL, batchAnchors(matches, jpMap, batchMap(batches, "GL")));
  const ctx = buildForecastContext(alignment, idx.JP, idx.GL, fitCadence(idx.GL), 0, cutoffMs, calibration);
  const lag = median(matches.filter(m => m.method === "code" && m.glBannerId != null)
    .map(m => ({ j: jp.find(b => b.id === m.jpBannerId)!, g: gl.find(b => b.id === m.glBannerId)! }))
    .sort((a, b) => a.g.startMs - b.g.startMs).slice(-24).map(p => (p.g.startMs - p.j.startMs) / DAY));
  const model: EvaluationSample[] = [];
  const baseline: EvaluationSample[] = [];
  const candidates: EvaluationSample[] = [];
  let eligible = 0;
  for (const j of jp) {
    const actual = truth.get(j.id);
    const batch = jpMap.get(j.id);
    if (!actual || batch == null || actual.startMs <= cutoffMs || actual.startMs > cutoffMs + 180 * DAY) continue;
    eligible++;
    const p = predictBanner(ctx, batch);
    const common = { cutoffMs, bannerId: j.id, batch, truthMs: actual.startMs, horizonDays: (actual.startMs - cutoffMs) / DAY };
    if (p) model.push({ ...common, method: p.method as CalibrationRecord["method"], expectedMs: p.expectedMs, lowerMs: p.p05Ms, upperMs: p.p95Ms });
    for (const method of FORECAST_METHODS) {
      const prediction = predictBanner(ctx, batch, method);
      if (prediction) candidates.push({ ...common, method, expectedMs: prediction.expectedMs, lowerMs: prediction.p05Ms, upperMs: prediction.p95Ms });
    }
    if (lag) baseline.push({ ...common, method: "recent-lag", expectedMs: j.startMs + lag * DAY, lowerMs: j.startMs + lag * DAY, upperMs: j.startMs + lag * DAY });
  }
  return { model, baseline, eligible, candidates };
}

export function summarise(samples: EvaluationSample[]) {
  if (!samples.length) return null;
  const errors = samples.map(s => Math.abs(s.expectedMs - s.truthMs) / DAY).sort((a, b) => a - b);
  return {
    n: samples.length,
    unique: new Set(samples.map(s => s.bannerId)).size,
    mae: errors.reduce((a, b) => a + b, 0) / errors.length,
    median: median(errors),
    p90: errors[Math.min(errors.length - 1, Math.floor(errors.length * .9))],
    within7: errors.filter(e => e <= 7).length / errors.length,
    coverage: samples.filter(s => s.truthMs >= s.lowerMs && s.truthMs <= s.upperMs).length / samples.length,
    width: samples.reduce((sum, s) => sum + (s.upperMs - s.lowerMs) / DAY, 0) / samples.length,
  };
}
