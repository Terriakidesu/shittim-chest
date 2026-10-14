import { CONFIG, SCHALEDB_BASE, SCHALEDB_SERVERS } from "../config";
import type { Character } from "../domain/types";
import type { SourceMeta, SourceResult } from "./types";

/**
 * SchaleDB student dumps (`schaledb.com/data/{jp,en,kr}/students.min.json`).
 *
 * Static character metadata only — no dates — but it gives us a canonical
 * character namespace. `PathName` (`azusa_swimsuit`) maps deterministically onto
 * the wiki's `Rateup_character` text (`Azusa (Swimsuit)`), which is what lets us
 * join JP banners, Global banners and artwork into one graph.
 *
 * `en` is the Global server.
 */

interface SchaleStudent {
  Id: number;
  PathName?: string;
  Name?: string;
  School?: string;
  Club?: string;
  StarGrade?: number;
  CollectionBG?: string | null;
  IsLimited?: number | number[];
  IsReleased?: boolean[];
}

function availabilityFor(raw: number | number[] | undefined): "permanent" | "limited" | "event" {
  const values = Array.isArray(raw) ? raw : [raw ?? 0];
  if (values.some((value) => value === 2)) return "event";
  // SchaleDB uses 1 for unique/seasonal students and 3 for Festival
  // students. Value 4 (Archived) is still part of the historical permanent
  // roster for the simulator; archive/select-pickup handling is resolved from
  // the banner itself.
  if (values.some((value) => value === 1 || value === 3)) return "limited";
  return "permanent";
}

export function parseStudents(payload: unknown): Map<number, Character> {
  const out = new Map<number, Character>();
  const entries = Array.isArray(payload)
    ? (payload as SchaleStudent[])
    : Object.values((payload ?? {}) as Record<string, SchaleStudent>);

  for (const s of entries) {
    if (!s?.Id || !s.PathName) continue;
    const rel = s.IsReleased ?? [];
    out.set(s.Id, {
      id: s.Id,
      pathName: s.PathName,
      nameEn: s.Name ?? s.PathName,
      school: s.School ?? "",
      club: s.Club ?? "",
      starGrade: s.StarGrade ?? 0,
      collectionBg: s.CollectionBG ?? null,
      availability: availabilityFor(s.IsLimited),
      releasedOn: { jp: !!rel[0], gl: !!rel[1], kr: !!rel[2] },
    });
  }
  return out;
}

export class SchaleDbSource {
  readonly key = "schaledb.com";
  readonly label = "SchaleDB";

  async fetchAll(): Promise<SourceResult<Map<number, Character>>> {
    const merged = new Map<number, Character>();
    let fetchedAtMs = 0;

    for (const server of SCHALEDB_SERVERS) {
      const url = `${SCHALEDB_BASE}/${server}/students.min.json`;
      const res = await fetch(url, {
        headers: { "User-Agent": CONFIG.userAgent },
      });
      if (!res.ok) continue;
      const chars = parseStudents(await res.json());
      fetchedAtMs = Math.max(fetchedAtMs, Date.now());

      for (const [id, ch] of chars) {
        const prev = merged.get(id);
        if (!prev) {
          merged.set(id, ch);
          continue;
        }
        // The JP dump localises `Name` to Japanese, so an existing English
        // record must win on naming while still absorbing release flags.
        const preferIncoming = server === "en";
        merged.set(id, {
          ...(preferIncoming ? ch : prev),
          releasedOn: {
            jp: prev.releasedOn.jp || ch.releasedOn.jp,
            gl: prev.releasedOn.gl || ch.releasedOn.gl,
            kr: prev.releasedOn.kr || ch.releasedOn.kr,
          },
        });
      }
    }

    const meta: SourceMeta = {
      key: this.key,
      label: this.label,
      fetchedAtMs: fetchedAtMs || Date.now(),
      changed: true,
    };
    return { records: merged, meta };
  }
}
