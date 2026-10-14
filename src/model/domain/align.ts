import type { Batch, BatchPairing, Match } from "./types";

const DAY = 86_400_000;

/**
 * Weighted pool-adjacent-violators algorithm. Produces the non-decreasing
 * least-squares fit, which is exactly the constraint we need: the JP->Global
 * batch mapping can only move forward in time, never backward.
 */
export function fitIsotonic(
  points: { x: number; y: number; w?: number }[],
): (x: number) => number {
  if (!points.length) return () => 0;

  const sorted = [...points].sort((a, b) => a.x - b.x);
  const blocks: { sum: number; w: number; start: number }[] = [];

  for (const p of sorted) {
    const w = p.w ?? 1;
    blocks.push({ sum: p.y * w, w, start: p.x });
    // Merge while the previous block's mean exceeds this one's.
    while (blocks.length >= 2) {
      const a = blocks[blocks.length - 2];
      const b = blocks[blocks.length - 1];
      if (a.sum / a.w <= b.sum / b.w) break;
      blocks.pop();
      blocks.pop();
      blocks.push({
        sum: a.sum + b.sum,
        w: a.w + b.w,
        start: a.start,
      });
    }
  }

  // Expand blocks into a piecewise-constant, non-decreasing function.
  const steps: { x: number; v: number }[] = [];
  for (const b of blocks) steps.push({ x: b.start, v: b.sum / b.w });

  return (x: number) => {
    if (x < steps[0].x) return steps[0].v;
    let v = steps[0].v;
    for (const s of steps) {
      if (s.x > x) break;
      v = s.v;
    }
    return v;
  };
}

export interface AnchorObservation {
  jpBatch: number;
  glBatch: number;
  weight: number;
}

/**
 * Collapse banner-level matches into batch-level anchors. A Global batch that
 * carried several matching JP banners is a stronger observation than one that
 * carried a single ambiguous rerun.
 */
export function batchAnchors(
  matches: Match[],
  jpBatchOfBanner: Map<number, number>,
  glBatchOfBanner: Map<number, number>,
): AnchorObservation[] {
  const votes = new Map<number, Map<number, number>>();
  for (const m of matches) {
    if (m.glBannerId == null || m.confidence <= 0) continue;
    const jp = jpBatchOfBanner.get(m.jpBannerId);
    const gl = glBatchOfBanner.get(m.glBannerId);
    if (jp == null || gl == null) continue;
    const candidates = votes.get(jp) ?? new Map<number, number>();
    candidates.set(gl, (candidates.get(gl) ?? 0) + m.confidence);
    votes.set(jp, candidates);
  }
  return [...votes.entries()]
    .flatMap(([jpBatch, candidates]) => {
      const ranked = [...candidates].sort((a, b) => b[1] - a[1]);
      const total = ranked.reduce((sum, [, weight]) => sum + weight, 0);
      // Ties and split batches are not strong evidence of a single mapping.
      if (ranked[0][1] < total * .6) return [];
      return [{ jpBatch, glBatch: ranked[0][0], weight: ranked[0][1] }];
    })
    .sort((a, b) => a.jpBatch - b.jpBatch);
}

/** Robustly drop anchors whose lag is wildly inconsistent with their neighbours. */
export function filterOutliers(
  anchors: AnchorObservation[],
  window = 5,
): AnchorObservation[] {
  if (anchors.length < window * 2) return anchors;
  const out: AnchorObservation[] = [];
  const lags = anchors.map((a) => a.glBatch - a.jpBatch);
  for (let i = 0; i < anchors.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(lags.length, i + window + 1);
    const neigh = lags.slice(lo, hi).filter((_, k) => lo + k !== i);
    const med = median(neigh);
    const mad = median(neigh.map((v) => Math.abs(v - med))) || 1;
    if (Math.abs(lags[i] - med) <= Math.max(4 * mad, 3)) out.push(anchors[i]);
  }
  return out;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * How the mapping advances as we move forward through JP batches.
 *
 * Within a stable era the mapping is a constant offset in batch-index space
 * (`gl = jp + c`). Era changes show up as drift in `c`; the caller uses the
 * measured drift and its dispersion to build the uncertainty band.
 */
export interface AdvanceModel {
  /** Median batch-index offset over the recent window. */
  offset: number;
  /** Change in offset per JP batch over the recent window (0 when stable). */
  slope: number;
  /** Dispersion of the residual, in batches. Drives the confidence band. */
  residual: number;
  /** Number of anchors the window is based on. */
  samples: number;
  /**
   * How many JP batches the Global server absorbs per Global batch, measured
   * over the recent window. `1` means Global is running strict 1:1 with JP and
   * the day-lag holds steady; `2` means Global is merging two JP updates into
   * one, which shrinks the lag over time.
   */
  absorption: number;
  /** Last JP batch with a proven Global counterpart. */
  frontierJp: number;
  /** Its Global counterpart. */
  frontierGl: number;
}

export function estimateAdvance(
  fit: (x: number) => number,
  maxJpBatch: number,
  frontierJp: number,
  window = 16,
): AdvanceModel {
  // Residuals must be measured only where we have proven pairings. Past the
  // frontier the fit is extrapolated and is not evidence of raggedness.
  const end = Math.min(maxJpBatch, frontierJp);
  const start = Math.max(0, end - window);
  const residuals: number[] = [];
  for (let i = start; i <= end; i++) residuals.push(fit(i) - i);

  if (!residuals.length) {
    return {
      offset: 0, slope: 0, residual: 0, samples: 0,
      absorption: 1, frontierJp: 0, frontierGl: 0,
    };
  }

  const offset = median(residuals);
  const residual = Math.sqrt(
    residuals.reduce((s, v) => s + (v - offset) ** 2, 0) / residuals.length,
  );

  const xs = residuals.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = residuals.reduce((a, b) => a + b, 0) / residuals.length;
  const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const slope = den
    ? xs.reduce((s, x, i) => s + (x - mx) * (residuals[i] - my), 0) / den
    : 0;

  // Absorption ratio, measured only over the proven (observed) frontier.
  const observedStart = Math.max(0, frontierJp - window);
  const jpSpan = Math.max(1, frontierJp - observedStart + 1);
  const glSpan = Math.max(
    1,
    Math.round(fit(frontierJp)) - Math.round(fit(observedStart)) + 1,
  );
  const absorption = jpSpan / glSpan;

  return {
    offset,
    slope,
    residual,
    samples: residuals.length,
    absorption,
    frontierJp,
    frontierGl: Math.round(fit(frontierJp)),
  };
}

export interface Alignment {
  pairings: BatchPairing[];
  fit: (x: number) => number;
  advance: AdvanceModel;
  lagDays: (jpBatch: number) => number | null;
}

export function alignBatches(
  jpBatches: Batch[],
  glBatches: Batch[],
  anchors: AnchorObservation[],
): Alignment {
  const clean = filterOutliers(anchors);
  const fit = fitIsotonic(
    clean.map((a) => ({ x: a.jpBatch, y: a.glBatch, w: a.weight })),
  );

  const maxJp = jpBatches.length - 1;
  const frontierJp = clean.length ? clean[clean.length - 1].jpBatch : 0;
  const advance = estimateAdvance(fit, maxJp, frontierJp);

  const observed = new Set(clean.map((a) => a.jpBatch));
  const pairings: BatchPairing[] = [];

  for (let i = 0; i <= maxJp; i++) {
    let glBatchIndex: number;
    let projected = false;

    if (i <= frontierJp) {
      glBatchIndex = Math.round(fit(i));
    } else {
      // Past the frontier the isotonic fit is flat by construction, so we
      // advance it ourselves using the measured absorption ratio.
      projected = true;
      const k = i - advance.frontierJp;
      glBatchIndex =
        advance.frontierGl +
        Math.max(1, Math.round(k / (advance.absorption || 1)));
    }

    const jb = jpBatches[i];
    const gb = glBatches[glBatchIndex];
    pairings.push({
      jpBatchIndex: i,
      glBatchIndex,
      observed: observed.has(i),
      projected,
      lagDays: gb ? Math.round((gb.startMs - jb.startMs) / DAY) : null,
    });
  }

  return {
    pairings,
    fit,
    advance,
    lagDays: (jpBatch: number) => {
      const p = pairings[jpBatch];
      return p?.lagDays ?? null;
    },
  };
}
