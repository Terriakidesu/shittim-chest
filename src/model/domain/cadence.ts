import type { Server } from "../config";
import { median } from "./align";
import type { Batch } from "./types";

const DAY = 86_400_000;

/**
 * Each server ships updates on its own rhythm. Blue Archive runs roughly every
 * 1-2 weeks, and the interval is far from constant — there are short gaps
 * around content drops and longer ones around holidays. We model the interval
 * distribution rather than assuming a fixed period.
 */
export interface CadenceModel {
  server: Server;
  /** Median days between consecutive batches. */
  medianInterval: number;
  /** Median absolute deviation of the interval, in days. */
  spread: number;
  /** UTC weekdays (0=Sunday), ranked by recency-weighted update frequency. */
  preferredDays: number[];
  samples: number;
}

export function fitCadence(batches: Batch[]): CadenceModel {
  const intervals: number[] = [];
  for (let i = 1; i < batches.length; i++) {
    intervals.push((batches[i].startMs - batches[i - 1].startMs) / DAY);
  }
  const med = weightedMedian(intervals) || 14;
  const spread = median(intervals.map((v) => Math.abs(v - med))) || 1;

  // Weight recent months more heavily — operators change their habits.
  const recent = batches.slice(-24);
  const weight = new Map<number, number>();
  recent.forEach((b, i) => {
    const dom = new Date(b.startMs).getUTCDay();
    weight.set(dom, (weight.get(dom) ?? 0) + 1 + i * 0.05);
  });
  const preferredDays = [...weight.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([d]) => d)
    ;

  return {
    server: (batches[0]?.server ?? "JP") as Server,
    medianInterval: Math.round(med),
    spread: Math.max(1, Math.round(spread)),
    preferredDays,
    samples: intervals.length,
  };
}

export interface ProjectedBatch {
  index: number;
  startMs: number;
  endMs: number;
  /** 1-based step number after the last observed batch. */
  step: number;
}

/** Recency-weighted median: recent update habits matter more than old ones. */
function weightedMedian(values: number[]): number {
  if (!values.length) return 14;
  const recent = values.slice(-12);
  const pairs = recent
    .map((v, i) => ({ v, w: i + 1 }))
    .sort((a, b) => a.v - b.v);
  const total = pairs.reduce((s, p) => s + p.w, 0);
  let acc = 0;
  for (const p of pairs) {
    acc += p.w;
    if (acc >= total / 2) return p.v;
  }
  return pairs[pairs.length - 1].v;
}


/**
 * Project the next `count` batch windows for a server.
 *
 * The rhythm is close to seasonal-naive: the operators' recent tempo carries
 * forward far better than any global average, because a server that has been
 * updating weekly tends to stay weekly through a content arc. We therefore
 * reuse the measured interval distribution with recency weighting rather than
 * assuming a fixed period.
 */
export function projectBatches(
  batches: Batch[],
  model: CadenceModel,
  count: number,
): ProjectedBatch[] {
  if (!batches.length) return [];
  const last = batches[batches.length - 1];

  const out: ProjectedBatch[] = [];
  let cursor = last.startMs;
  const interval = Math.max(3, model.medianInterval || 14);
  const weekday = model.preferredDays[0];

  for (let step = 1; step <= count; step++) {
    let next = cursor + interval * DAY;
    // Snap to the dominant maintenance weekday only for weekly-like rhythms.
    if (weekday != null && Math.abs(interval / 7 - Math.round(interval / 7)) < .3) {
      const delta = (weekday - new Date(next).getUTCDay() + 10) % 7 - 3;
      if (next + delta * DAY > cursor + 2 * DAY) next += delta * DAY;
    }
    cursor = next;

    out.push({
      index: last.index + step,
      startMs: cursor,
      endMs: cursor + 14 * DAY,
      step,
    });
  }
  return out;
}
