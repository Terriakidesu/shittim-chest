import type { Server } from "../config";
import type { Banner, Batch } from "./types";

const DAY = 86_400_000;

/**
 * Banners do not arrive one at a time: a single maintenance update ships
 * several banners that all start on the same day, sometimes spilling a day or
 * two. The JP->Global alignment is only meaningful at the *update* level, so we
 * cluster each server's banner start dates into batches.
 */
const BATCH_GAP_MS = 4 * DAY;

export function buildBatches(banners: Banner[]): Batch[] {
  const byServer = new Map<Server, Banner[]>();
  for (const b of banners) {
    if (!byServer.has(b.server)) byServer.set(b.server, []);
    byServer.get(b.server)!.push(b);
  }

  const out: Batch[] = [];
  for (const [server, list] of byServer) {
    const sorted = [...list].sort(
      (a, b) => a.startMs - b.startMs || a.id - b.id,
    );

    const batches: Banner[][] = [];
    let current: Banner[] = [];
    let anchorMs = -Infinity;

    for (const b of sorted) {
      // Evergreen banners start "ages ago" and would otherwise form one
      // enormous leading batch. They are permanent and handled separately.
      if (b.evergreen) continue;

      if (current.length === 0 || b.startMs - anchorMs > BATCH_GAP_MS) {
        if (current.length) batches.push(current);
        current = [b];
        anchorMs = b.startMs;
      } else {
        current.push(b);
      }
    }
    if (current.length) batches.push(current);

    batches.forEach((group, index) => {
      out.push({
        server,
        index,
        startMs: Math.min(...group.map((b) => b.startMs)),
        endMs: Math.max(...group.map((b) => b.endMs)),
        bannerIds: group.map((b) => b.id).sort((a, b) => a - b),
      });
    });
  }

  return out.sort(
    (a, b) => a.startMs - b.startMs || a.server.localeCompare(b.server),
  );
}

export interface BatchIndex {
  JP: Batch[];
  GL: Batch[];
}

export function indexBatches(batches: Batch[]): BatchIndex {
  return {
    JP: batches.filter((b) => b.server === "JP").sort((a, b) => a.index - b.index),
    GL: batches.filter((b) => b.server === "GL").sort((a, b) => a.index - b.index),
  };
}

/**
 * The latest batch on each side that we can prove has landed, i.e. the
 * progress frontier. Everything after the Global frontier is "in flight".
 */
export function frontier(idx: BatchIndex) {
  return {
    jpFrontierMs: idx.JP.length ? idx.JP[idx.JP.length - 1].startMs : 0,
    glFrontierMs: idx.GL.length ? idx.GL[idx.GL.length - 1].startMs : 0,
  };
}