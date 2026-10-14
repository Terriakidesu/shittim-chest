import type { Alignment } from "./align";
import { median } from "./align";
import { projectBatches, type CadenceModel, type ProjectedBatch } from "./cadence";
import type { Banner, Batch, Prediction } from "./types";

const DAY = 86_400_000;
export const FORECAST_METHODS = ["recent-lag", "lag-trend", "alignment"] as const;
export type ForecastMethod = typeof FORECAST_METHODS[number];
export interface CalibrationRecord {
  cutoffMs: number;
  bannerId: number;
  truthMs: number;
  expectedMs: number;
  method: ForecastMethod;
  batch?: number;
}
export interface ForecastContext {
  alignment: Alignment;
  jpBatches: Batch[];
  glBatches: Batch[];
  glProjected: ProjectedBatch[];
  cadence: CadenceModel;
  dataAgeDays: number;
  asOfMs: number;
  calibration: CalibrationRecord[];
}

export function buildForecastContext(alignment: Alignment, jpBatches: Batch[], glBatches: Batch[], cadence: CadenceModel, dataAgeDays: number, asOfMs = Date.now(), calibration: CalibrationRecord[] = []): ForecastContext {
  return { alignment, jpBatches, glBatches, glProjected: projectBatches(glBatches, cadence, 60), cadence, dataAgeDays: Math.max(0, dataAgeDays), asOfMs, calibration };
}

function bucket(days: number) { return days <= 30 ? 0 : days <= 90 ? 1 : 2; }
function calibrationFor(ctx: ForecastContext, method: ForecastMethod, leadDays: number) {
  const available = ctx.calibration.filter(r => r.method === method && r.cutoffMs < ctx.asOfMs && r.truthMs <= ctx.asOfMs && r.truthMs >= ctx.asOfMs - 730 * DAY)
    .sort((a, b) => b.cutoffMs - a.cutoffMs);
  function unique(rows: CalibrationRecord[]) {
    const seen = new Set<string>();
    return rows.filter(r => {
      // Students released together share one schedule outcome. Do not count
      // each portrait or repeated forecast origin as independent evidence.
      const key = r.batch == null ? `banner:${r.bannerId}` : `batch:${r.batch}:${r.truthMs}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  const local = unique(available.filter(r => bucket(Math.max(0, (r.expectedMs - r.cutoffMs) / DAY)) === bucket(leadDays)));
  return local.length >= 20 ? local : unique(available);
}

function lagPoints(ctx: ForecastContext) {
  return ctx.alignment.pairings.filter(p => p.observed && p.lagDays != null)
    .map(p => ({ jpMs: ctx.jpBatches[p.jpBatchIndex].startMs, lag: p.lagDays! })).slice(-16);
}

/** Raw candidate predictors; evaluation labels never enter their calculation. */
export function rawForecast(ctx: ForecastContext, jpBatchIndex: number, method: ForecastMethod) {
  const jp = ctx.jpBatches[jpBatchIndex];
  const points = lagPoints(ctx);
  if (!jp || !points.length || !ctx.glBatches.length) return null;
  let target: number;
  if (method === "alignment") {
    const pairing = ctx.alignment.pairings[jpBatchIndex];
    if (!pairing) return null;
    const gl = ctx.glBatches[pairing.glBatchIndex] ?? ctx.glProjected[pairing.glBatchIndex - ctx.glBatches.length];
    if (!gl) return null;
    target = gl.startMs;
  } else {
    const recent = points.slice(-5);
    let lag = median(recent.map(p => p.lag));
    if (method === "lag-trend") {
      const slopes: number[] = [];
      for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
        const gap = (points[j].jpMs - points[i].jpMs) / DAY;
        if (gap >= 7) slopes.push((points[j].lag - points[i].lag) / gap);
      }
      const slope = Math.max(-.25, Math.min(.25, median(slopes)));
      lag += slope * Math.max(0, (jp.startMs - median(recent.map(p => p.jpMs))) / DAY);
    }
    target = jp.startMs + Math.max(0, lag) * DAY;
  }
  const future = ctx.glProjected.filter(b => b.startMs > ctx.asOfMs);
  if (!future.length) return null;
  // An unmatched/delayed banner must remain pending, never be predicted in the past.
  const nearest = future.reduce((best, b) => Math.abs(b.startMs - target) < Math.abs(best.startMs - target) ? b : best);
  return { expectedMs: nearest.startMs, glBatchIndex: nearest.index, glBatchStartMs: nearest.startMs };
}

function quantile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil((sorted.length + 1) * p) - 1))];
}

/** Development-selected point forecast, calibrated only on realised past outcomes. */
export function predictBanner(ctx: ForecastContext, jpBatchIndex: number, forceMethod?: ForecastMethod): Prediction | null {
  // Recent-lag wins the pre-2026 development comparison. Keep alternatives
  // explicit for evaluation rather than opportunistically picking a model on
  // incomparable, model-dependent horizon buckets.
  const candidates = (forceMethod ? [forceMethod] : ["recent-lag" as const]).flatMap(method => {
    const raw = rawForecast(ctx, jpBatchIndex, method);
    if (!raw) return [];
    const records = calibrationFor(ctx, method, (raw.expectedMs - ctx.asOfMs) / DAY);
    return [{ method, raw, records }];
  });
  if (!candidates.length) return null;
  const { method, raw, records } = candidates[0];
  const calibrated = records.length >= 20;
  const errors = records.map(r => (r.truthMs - r.expectedMs) / DAY);
  const lead = Math.max(0, (raw.expectedMs - ctx.asOfMs) / DAY);
  const fallback = 14 + 7 * Math.sqrt(lead / 30);
  // A discrete schedule jump is the main unmodelled risk. Preserve one update
  // of padding instead of presenting a zero-width interval after a stable era.
  const schedulePadding = Math.max(3, ctx.cadence.medianInterval);
  const lower = calibrated ? Math.min(0, quantile(errors, .05)) - schedulePadding : -fallback;
  const upper = calibrated ? Math.max(0, quantile(errors, .95)) + schedulePadding : fallback;
  const stale = ctx.dataAgeDays;
  const confidence = calibrated && stale <= 7 ? errors.filter(e => Math.abs(e) <= 7).length / errors.length : null;
  return {
    bannerId: 0, ...raw,
    p05Ms: raw.expectedMs + (lower - stale) * DAY,
    p95Ms: raw.expectedMs + (upper + stale) * DAY,
    confidence, confidenceToleranceDays: 7, intervalCoverage: .9,
    calibrationSamples: calibrated ? records.length : 0,
    method,
    explanation: `${method === "recent-lag" ? "Recent JP-to-Global lag" : method === "lag-trend" ? "Recent lag trend" : "Batch alignment"}, snapped to the projected Global maintenance schedule. ${calibrated ? `Range based on ${records.length} historical update outcomes, with one-update safety padding.` : "Conservative range: insufficient historical calibration."}`,
  };
}

export interface PredictOptions { confirmedIds?: Set<number>; }
export function forecastJpBanners(ctx: ForecastContext, jpBanners: Banner[], jpBatchOfBanner: Map<number, number>, options: PredictOptions = {}): Map<number, Prediction> {
  const out = new Map<number, Prediction>();
  for (const b of jpBanners) {
    if (b.evergreen || options.confirmedIds?.has(b.id)) continue;
    const batch = jpBatchOfBanner.get(b.id);
    if (batch == null) continue;
    if (batch <= ctx.alignment.advance.frontierJp) {
      const lag = currentLagDays(ctx.alignment);
      // Old holes in the correspondence are unknown, not confidently "next week".
      if (lag == null || b.startMs + lag * DAY < ctx.asOfMs - 14 * DAY) continue;
    }
    const p = predictBanner(ctx, batch);
    if (p) out.set(b.id, { ...p, bannerId: b.id });
  }
  return out;
}

export function currentLagDays(alignment: Alignment): number | null {
  const observed = alignment.pairings.filter(p => p.observed && p.lagDays != null);
  return observed.length ? Math.round(median(observed.slice(-5).map(p => p.lagDays!))) : null;
}
